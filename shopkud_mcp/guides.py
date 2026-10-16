"""Portable, versioned instructions. Reading a guide never touches Chrome or storage."""
from importlib.resources import files
import json


def workflow_guide(view="brief"):
    if view not in ("brief", "full", "skill"):
        return {"ok": False, "error": "invalid_input"}
    package = files("shopkud_mcp")
    manifest = json.loads(package.joinpath("workflows/affiliate.json").read_text(encoding="utf-8"))
    result = {"ok": True, "workflow_id": manifest["id"],
              "guide_version": manifest["version"], "view": view}
    if view == "brief":
        result["manifest"] = manifest
    else:
        result["content"] = package.joinpath(manifest["guide" if view == "full" else "skill"]).read_text(encoding="utf-8")
    return result
