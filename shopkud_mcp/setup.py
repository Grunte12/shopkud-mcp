"""Operator-only one-time setup; never prints the private MCP bearer key."""
import json
import http.client
import os
from pathlib import Path
import plistlib
import re
import secrets
import shlex
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time

from .platform_security import (
    chmod_private,
    fchmod_private,
    has_private_mode,
    nofollow_flag,
    owned_by_current_user,
    windows_config_path,
    windows_state_dir,
)
from .server import read_config


_NATIVE_HOST = "org.shopkud.mcp"
_CHROME_NATIVE_KEY = rf"Software\Google\Chrome\NativeMessagingHosts\{_NATIVE_HOST}"
_WINDOWS_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def _replace_config(path, after, prefix):
    """Atomically replace one private config after validating both states."""
    path=Path(path)
    backup_fd,backup_path=tempfile.mkstemp(prefix=f"config-before-{prefix}-",suffix=".json",dir=path.parent)
    with os.fdopen(backup_fd,"wb") as stream:stream.write(path.read_bytes())
    fd,temp=tempfile.mkstemp(prefix=f".{prefix}-config-",dir=path.parent)
    try:
        with os.fdopen(fd,"w") as stream:
            json.dump(after,stream)
            stream.flush();os.fsync(stream.fileno())
        chmod_private(temp,0o600)
        read_config(Path(temp))
        os.replace(temp,path)
    finally:
        if os.path.exists(temp):os.unlink(temp)


def set_tool_profile(config_path, profile):
    """Select the small workflow surface or the complete compatibility catalog."""
    if profile not in {"guided","full"}:raise ValueError("invalid_tool_profile")
    path=Path(config_path)
    before=read_config(path)
    if before.get("tool_profile", "full")==profile:return
    _replace_config(path,{**before,"tool_profile":profile},"tool-profile")


def enable_workspace(config_path):
    """Explicit operator opt-in. Preserve key/origin/socket/port and private backup."""
    path=Path(config_path)
    before=read_config(path)
    intake=path.parent/"imports"
    if not intake.exists():intake.mkdir(mode=0o700)
    info=intake.lstat()
    if (intake.resolve()!=intake or not stat.S_ISDIR(info.st_mode)
            or not has_private_mode(info,0o700) or not owned_by_current_user(info)):
        raise ValueError("unsafe_intake_directory")
    if before.get("workspace_enabled") is True:return
    _replace_config(path,{**before,"workspace_enabled":True},"workspace")


def install_macos_service(config_path, launch_agents_dir=None, python_executable=None, start=True):
    """Install one per-user launchd worker without exposing the bearer key."""
    if sys.platform != "darwin" or type(start) is not bool:
        raise ValueError("unsupported_service_platform")
    config_path = Path(config_path).expanduser().absolute().resolve(strict=True)
    read_config(config_path)
    executable = Path(python_executable or sys.executable).expanduser().absolute().resolve(strict=True)
    if not executable.is_file():
        raise ValueError("python_executable_unavailable")
    launch_dir = Path(launch_agents_dir or Path.home()/"Library"/"LaunchAgents").expanduser().absolute()
    launch_dir.mkdir(parents=True, exist_ok=True)
    info = launch_dir.lstat()
    if launch_dir.resolve() != launch_dir or not stat.S_ISDIR(info.st_mode) or not owned_by_current_user(info):
        raise ValueError("unsafe_launch_agents_directory")
    label = "org.shopkud.mcp"
    target = launch_dir/f"{label}.plist"
    payload = {
        "Label": label,
        "ProgramArguments": [str(executable), "-m", "shopkud_mcp.server", "serve", "--config", str(config_path)],
        "RunAtLoad": True,
        "KeepAlive": True,
        "ProcessType": "Background",
        "ThrottleInterval": 10,
        "WorkingDirectory": str(config_path.parent),
        "StandardOutPath": "/dev/null",
        "StandardErrorPath": "/dev/null",
    }
    data = plistlib.dumps(payload, fmt=plistlib.FMT_XML, sort_keys=True)
    if target.exists() or target.is_symlink():
        current = target.lstat()
        if (target.resolve() != target or not stat.S_ISREG(current.st_mode)
                or not owned_by_current_user(current) or current.st_nlink != 1):
            raise ValueError("unsafe_launch_agent_target")
        if target.read_bytes() != data:
            raise ValueError("existing_launch_agent_mismatch")
    else:
        fd = os.open(target, os.O_WRONLY|os.O_CREAT|os.O_EXCL|nofollow_flag(), 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
    state = "installed"
    if start:
        service = f"gui/{os.getuid()}/{label}"
        known = subprocess.run(["launchctl", "print", service], stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, check=False)
        if known.returncode == 0:
            state = "already_running"
        else:
            started = subprocess.run(["launchctl", "bootstrap", f"gui/{os.getuid()}", str(target)],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            if started.returncode != 0:
                raise OSError("launch_agent_start_failed")
            state = "running"
    return {"ok": True, "state": state, "label": label, "plist": str(target)}


def setup(extension_id, state_dir, manifest_dir, port=8176):
    if sys.platform == "win32":
        raise ValueError("use_setup_windows")
    if not re.fullmatch(r"[a-p]{32}",extension_id) or type(port) is not int or not 1024<=port<=65535:
        raise ValueError("invalid_setup_input")
    state_dir=Path(state_dir).expanduser().absolute()
    if state_dir.exists():
        info=state_dir.lstat()
        if (state_dir.resolve()!=state_dir or not state_dir.is_dir()
                or not owned_by_current_user(info) or not has_private_mode(info,0o700)):
            raise ValueError("unsafe_setup_directory")
    else:
        state_dir.mkdir(parents=True,mode=0o700)
    state_dir=state_dir.resolve()
    config_path=state_dir/"config.json"
    origin=f"chrome-extension://{extension_id}/"
    config={"token":secrets.token_hex(32),"port":port,"allowed_origins":[origin],"socket_path":str(state_dir/"native.sock"),"tool_profile":"guided"}
    if config_path.exists():
        config=read_config(config_path)
        if config["allowed_origins"]!=[origin] or config["port"]!=port:
            raise ValueError("existing_setup_mismatch")
    # Included Python module also ships in the wheel; no source checkout needed.
    source=Path(__file__).with_name("native_host.py")
    if not source.is_file():raise ValueError("native_source_unavailable")
    installed=state_dir/"native-host.py"
    data=source.read_bytes()
    def safe_target(path):
        if path.exists() or path.is_symlink():
            info=path.lstat()
            if not stat.S_ISREG(info.st_mode) or not owned_by_current_user(info) or info.st_nlink!=1:
                raise ValueError("unsafe_native_target")
    safe_target(installed)
    launcher=state_dir/"native-launcher"
    safe_target(launcher)
    manifest_dir=Path(manifest_dir).expanduser().absolute()
    manifest_dir.mkdir(parents=True,exist_ok=True)
    if manifest_dir.resolve()!=manifest_dir:raise ValueError("unsafe_manifest_directory")
    manifest_path=manifest_dir/"org.shopkud.mcp.json"
    manifest={"name":"org.shopkud.mcp","description":"ShopKud MCP Chrome bridge","path":str(launcher),"type":"stdio","allowed_origins":[origin]}
    # Preflight every existing target before writing config or runtime files.
    safe_target(manifest_path)
    if manifest_path.exists() and json.loads(manifest_path.read_text())!=manifest:
        raise ValueError("existing_manifest_mismatch")
    if not config_path.exists():
        fd=os.open(config_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|nofollow_flag(),0o600)
        with os.fdopen(fd,"w") as stream:json.dump(config,stream)
    fd=os.open(installed,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|nofollow_flag(),0o700)
    fchmod_private(fd,0o700)
    with os.fdopen(fd,"wb") as stream:stream.write(data)
    content=f"#!/bin/sh\nexec {shlex.quote(sys.executable)} {shlex.quote(str(installed))} --config {shlex.quote(str(config_path))} \"$@\"\n"
    safe_target(launcher)
    fd=os.open(launcher,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|nofollow_flag(),0o700)
    fchmod_private(fd,0o700)
    with os.fdopen(fd,"w") as stream:stream.write(content)
    if not manifest_path.exists():
        fd=os.open(manifest_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|nofollow_flag(),0o600)
        with os.fdopen(fd,"w") as stream:json.dump(manifest,stream)
    return config_path


def _registry_value(registry, key_path, name):
    try:
        with registry.OpenKey(registry.HKEY_CURRENT_USER, key_path) as key:
            return registry.QueryValueEx(key, name)[0]
    except FileNotFoundError:
        return None


def _set_registry_value(registry, key_path, name, value):
    current = _registry_value(registry, key_path, name)
    if current is not None and current != value:
        raise ValueError("existing_registry_value_mismatch")
    with registry.CreateKey(registry.HKEY_CURRENT_USER, key_path) as key:
        registry.SetValueEx(key, name, 0, registry.REG_SZ, value)


def setup_windows(extension_id, port=8176, native_port=8177, *, host_executable=None,
                  registry_module=None):
    """Create one per-user Windows config and register Chrome Native Messaging."""
    if sys.platform != "win32":
        raise ValueError("unsupported_setup_platform")
    if (not re.fullmatch(r"[a-p]{32}",extension_id) or type(port) is not int
            or type(native_port) is not int or not 1024<=port<=65535
            or not 1024<=native_port<=65535 or port==native_port):
        raise ValueError("invalid_setup_input")
    state_dir=windows_state_dir()
    state_dir.mkdir(parents=True,exist_ok=True)
    info=state_dir.lstat()
    if state_dir.resolve()!=state_dir or not stat.S_ISDIR(info.st_mode):
        raise ValueError("unsafe_setup_directory")
    config_path=windows_config_path()
    origin=f"chrome-extension://{extension_id}/"
    config={
        "token":secrets.token_hex(32),
        "port":port,
        "allowed_origins":[origin],
        "socket_path":str(state_dir/"native.sock"),
        "native_port":native_port,
        "native_token":secrets.token_hex(32),
        "tool_profile":"guided",
    }
    if config_path.exists():
        config=read_config(config_path)
        if (config["allowed_origins"]!=[origin] or config["port"]!=port
                or config.get("native_port")!=native_port):
            raise ValueError("existing_setup_mismatch")
    executable=Path(host_executable or Path(sys.executable).with_name("shopkud-native-host.exe")).absolute()
    if not executable.is_file():
        located=shutil.which("shopkud-native-host")
        if not located:raise ValueError("native_host_executable_unavailable")
        executable=Path(located).absolute()
    executable_info=executable.lstat()
    if (executable.resolve()!=executable or not stat.S_ISREG(executable_info.st_mode)
            or executable_info.st_nlink!=1):
        raise ValueError("native_host_executable_unavailable")
    manifest_path=state_dir/f"{_NATIVE_HOST}.json"
    manifest={"name":_NATIVE_HOST,"description":"ShopKud MCP Chrome bridge",
              "path":str(executable),"type":"stdio","allowed_origins":[origin]}
    if manifest_path.exists():
        existing=manifest_path.lstat()
        if (manifest_path.resolve()!=manifest_path or not stat.S_ISREG(existing.st_mode)
                or existing.st_nlink!=1 or json.loads(manifest_path.read_text())!=manifest):
            raise ValueError("existing_manifest_mismatch")
    registry=registry_module
    if registry is None:
        import winreg as registry
    registered=_registry_value(registry,_CHROME_NATIVE_KEY,None)
    if registered is not None and registered!=str(manifest_path):
        raise ValueError("existing_registry_value_mismatch")
    if not config_path.exists():
        fd=os.open(config_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|nofollow_flag(),0o600)
        with os.fdopen(fd,"w") as stream:json.dump(config,stream)
    if not manifest_path.exists():
        fd=os.open(manifest_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|nofollow_flag(),0o600)
        with os.fdopen(fd,"w") as stream:json.dump(manifest,stream)
    _set_registry_value(registry,_CHROME_NATIVE_KEY,None,str(manifest_path))
    return config_path


def _probe_worker(config):
    body=json.dumps({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-11-25","capabilities":{},
        "clientInfo":{"name":"shopkud-startup-probe","version":"1"},
    }})
    connection=http.client.HTTPConnection("127.0.0.1",config["port"],timeout=0.5)
    try:
        connection.request("POST","/mcp",body=body,headers={
            "Authorization":"Bearer "+config["token"],
            "Content-Type":"application/json",
            "Accept":"application/json, text/event-stream",
            "MCP-Protocol-Version":"2025-11-25",
        })
        response=connection.getresponse()
        if response.status!=200:return False
        payload=json.loads(response.read(8193))
        return payload.get("result",{}).get("serverInfo",{}).get("name")=="ShopKud MCP"
    except (OSError,ValueError,TypeError,json.JSONDecodeError):
        return False
    finally:
        connection.close()


def install_windows_startup(config_path=None, python_executable=None, start=True, *,
                            registry_module=None, popen=None):
    """Register and optionally start one hidden per-user worker on Windows."""
    if sys.platform!="win32" or type(start) is not bool:
        raise ValueError("unsupported_service_platform")
    path=Path(config_path or windows_config_path()).absolute().resolve(strict=True)
    config=read_config(path)
    executable=Path(python_executable or sys.executable).absolute().resolve(strict=True)
    pythonw=executable.with_name("pythonw.exe")
    if pythonw.is_file():executable=pythonw
    command=[str(executable),"-m","shopkud_mcp.server","serve","--config",str(path)]
    value=subprocess.list2cmdline(command)
    registry=registry_module
    if registry is None:
        import winreg as registry
    _set_registry_value(registry,_WINDOWS_RUN_KEY,"ShopKudMCP",value)
    state="installed"
    if start:
        if _probe_worker(config):
            return {"ok":True,"state":"already_running","registry_value":"ShopKudMCP"}
        try:
            with socket.create_connection(("127.0.0.1",config["port"]),timeout=0.2):pass
        except OSError:
            pass
        else:
            raise OSError("worker_port_in_use")
        process=(popen or subprocess.Popen)(
            command,cwd=str(path.parent),stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,close_fds=True,
            creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0),
        )
        if process.poll() is not None:raise OSError("windows_worker_start_failed")
        for _ in range(50):
            if _probe_worker(config):break
            if process.poll() is not None:raise OSError("windows_worker_start_failed")
            time.sleep(0.1)
        else:raise OSError("windows_worker_start_failed")
        state="running"
    return {"ok":True,"state":state,"registry_value":"ShopKudMCP"}
