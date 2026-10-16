"""Operator-only one-time setup; never prints the private MCP bearer key."""
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import stat
import sys
import tempfile

from .server import read_config


def enable_workspace(config_path):
    """Explicit operator opt-in. Preserve key/origin/socket/port and private backup."""
    path=Path(config_path)
    before=read_config(path)
    intake=path.parent/"imports"
    if not intake.exists():intake.mkdir(mode=0o700)
    info=intake.lstat()
    if intake.resolve()!=intake or not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode)!=0o700 or info.st_uid!=os.getuid():raise ValueError("unsafe_intake_directory")
    if before.get("workspace_enabled") is True:return
    raw=path.read_bytes()
    backup_fd,backup_path=tempfile.mkstemp(prefix="config-before-workspace-",suffix=".json",dir=path.parent)
    with os.fdopen(backup_fd,"wb") as stream:stream.write(raw)
    fd,temp=tempfile.mkstemp(prefix=".workspace-config-",dir=path.parent)
    try:
        with os.fdopen(fd,"w") as stream:
            json.dump({**before,"workspace_enabled":True},stream)
            stream.flush();os.fsync(stream.fileno())
        read_config(path)  # reject unsafe replacement before atomic swap
        os.replace(temp,path)
    finally:
        if os.path.exists(temp):os.unlink(temp)


def setup(extension_id, state_dir, manifest_dir, port=8176):
    if not re.fullmatch(r"[a-p]{32}",extension_id) or type(port) is not int or not 1024<=port<=65535:
        raise ValueError("invalid_setup_input")
    state_dir=Path(state_dir).expanduser().absolute()
    if state_dir.exists():
        info=state_dir.lstat()
        if state_dir.resolve()!=state_dir or not state_dir.is_dir() or info.st_uid!=os.getuid() or info.st_mode&0o077:
            raise ValueError("unsafe_setup_directory")
    else:
        state_dir.mkdir(parents=True,mode=0o700)
    state_dir=state_dir.resolve()
    config_path=state_dir/"config.json"
    origin=f"chrome-extension://{extension_id}/"
    config={"token":secrets.token_hex(32),"port":port,"allowed_origins":[origin],"socket_path":str(state_dir/"native.sock")}
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
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_nlink!=1:
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
        fd=os.open(config_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,"w") as stream:json.dump(config,stream)
    fd=os.open(installed,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o700)
    os.fchmod(fd,0o700)
    with os.fdopen(fd,"wb") as stream:stream.write(data)
    content=f"#!/bin/sh\nexec {shlex.quote(sys.executable)} {shlex.quote(str(installed))} --config {shlex.quote(str(config_path))} \"$@\"\n"
    safe_target(launcher)
    fd=os.open(launcher,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o700)
    os.fchmod(fd,0o700)
    with os.fdopen(fd,"w") as stream:stream.write(content)
    if not manifest_path.exists():
        fd=os.open(manifest_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,"w") as stream:json.dump(manifest,stream)
    return config_path
