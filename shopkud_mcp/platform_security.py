"""Small platform boundary for private per-user files."""

from __future__ import annotations

import os
from pathlib import Path
import stat
import sys


def is_windows() -> bool:
    return sys.platform == "win32"


def owned_by_current_user(info: os.stat_result) -> bool:
    return is_windows() or info.st_uid == os.getuid()


def has_private_mode(info: os.stat_result, mode: int) -> bool:
    # Windows protects LocalAppData with ACLs; POSIX mode bits are not authoritative there.
    return is_windows() or stat.S_IMODE(info.st_mode) == mode


def chmod_private(path: str | os.PathLike[str], mode: int) -> None:
    if not is_windows():
        os.chmod(path, mode, follow_symlinks=False)


def fchmod_private(descriptor: int, mode: int) -> None:
    if not is_windows():
        os.fchmod(descriptor, mode)


def nofollow_flag() -> int:
    return getattr(os, "O_NOFOLLOW", 0)


def is_unaliased_path(path: str | os.PathLike[str]) -> bool:
    """Reject symlinks/junctions without rejecting Windows short/case aliases."""
    candidate = Path(path)
    try:
        info = candidate.lstat()
    except OSError:
        return False
    if is_windows():
        attributes = getattr(info, "st_file_attributes", 0)
        reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        return attributes & reparse == 0
    return candidate.resolve() == candidate


def same_existing_file(left: str | os.PathLike[str], right: str | os.PathLike[str]) -> bool:
    try:
        return os.path.samefile(left, right)
    except OSError:
        return False


def windows_state_dir() -> Path:
    value = os.environ.get("LOCALAPPDATA")
    if not value:
        raise ValueError("local_app_data_unavailable")
    root = Path(value).expanduser().absolute()
    if not root.is_absolute() or not root.name:
        raise ValueError("local_app_data_unavailable")
    return root / "ShopKud MCP"


def windows_config_path() -> Path:
    return windows_state_dir() / "config.json"
