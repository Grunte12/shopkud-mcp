"""Portable setup without native host manifests, registry entries or OS services."""
import json
import os
from pathlib import Path
import re
import secrets
import sys

from .platform_security import has_private_mode, is_unaliased_path, owned_by_current_user, nofollow_flag


def default_state_dir():
    if sys.platform == "win32":
        from .platform_security import windows_state_dir
        return windows_state_dir() / "portable"
    return Path.home() / ".shopkud" / "portable"


def install(extension_id, state_dir, port=8176):
    from .server import read_config
    if not re.fullmatch(r"[a-p]{32}", extension_id) or type(port) is not int or not 1024 <= port <= 65535:
        raise ValueError("invalid_setup_input")
    state = Path(state_dir).expanduser().absolute()
    state.mkdir(parents=True, mode=0o700, exist_ok=True)
    info = state.lstat()
    if not is_unaliased_path(state) or not owned_by_current_user(info) or not has_private_mode(info, 0o700):
        raise ValueError("unsafe_directory")
    path = state / "config.json"
    origin = f"chrome-extension://{extension_id}/"
    if path.exists() or path.is_symlink():
        config = read_config(path)
        if config.get("transport") != "websocket" or config["allowed_origins"] != [origin] or config["port"] != port:
            raise ValueError("existing_setup_mismatch")
        return path
    config = {"transport":"websocket", "token":secrets.token_hex(32),
              "extension_token":secrets.token_hex(32), "port":port,
              "allowed_origins":[origin], "socket_path":str(state / "native.sock"),
              "tool_profile":"guided"}
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | nofollow_flag(), 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(config, stream)
    read_config(path)
    return path
