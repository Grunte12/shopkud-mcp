"""Fail fast when release versions, guide metadata, or tool catalogs drift."""

from __future__ import annotations

import json
from pathlib import Path
import re
import tomllib

from shopkud_mcp.server import GUIDED_TOOL_GROUPS


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text())
    package_version = pyproject["project"]["version"]
    node_manifest = json.loads((ROOT / "package.json").read_text())
    extension_manifest = json.loads((ROOT / "extension" / "manifest.json").read_text())
    workflow = json.loads((ROOT / "shopkud_mcp" / "workflows" / "affiliate.json").read_text())
    workflow_header = (ROOT / "shopkud_mcp" / "skills" / "shopkud-affiliate" / "references" / "workflow.md").read_text().splitlines()[0]
    header_match = re.fullmatch(r"# วิธีทำงาน ShopKud Affiliate — ([0-9]+(?:\.[0-9]+){2})", workflow_header)

    assert extension_manifest["version"] == package_version, "Python and extension versions differ"
    assert node_manifest["version"] == package_version, "development manifest and package versions differ"
    assert header_match, "workflow guide heading must carry a semantic version"
    assert workflow["version"] == header_match.group(1), "workflow manifest and guide heading differ"

    manifest_groups = {
        group: frozenset(names)
        for group, names in workflow["tool_profiles"]["guided"]["groups"].items()
    }
    assert manifest_groups == GUIDED_TOOL_GROUPS, "guided tool groups differ between runtime and workflow"
    guided_tools = frozenset().union(*manifest_groups.values())
    assert len(guided_tools) == 19, f"guided catalog must contain 19 tools, found {len(guided_tools)}"

    package_data = pyproject["tool"]["setuptools"]["package-data"]["shopkud_mcp"]
    required_package_data = {
        "workflows/affiliate.json",
        "skills/shopkud-affiliate/SKILL.md",
        "skills/shopkud-affiliate/references/workflow.md",
    }
    assert required_package_data <= set(package_data), "wheel is missing workflow or skill files"

    extension_files = {
        str(path.relative_to(ROOT))
        for path in (ROOT / "extension").iterdir()
        if path.is_file()
    }
    wheel_extension_files = set(pyproject["tool"]["setuptools"]["data-files"]["share/shopkud-mcp/extension"])
    assert extension_files == wheel_extension_files, "wheel extension file list differs from extension directory"

    executable_python = [
        path
        for scope in (ROOT / "tests", ROOT / "evals")
        for path in scope.rglob("*.py")
    ]
    hardcoded_macos_tmp = [
        str(path.relative_to(ROOT))
        for path in executable_python
        if "/private/tmp" in path.read_text(encoding="utf-8")
    ]
    assert not hardcoded_macos_tmp, f"portable tests must use tempfile, found: {hardcoded_macos_tmp}"

    print(json.dumps({
        "ok": True,
        "package_extension_version": package_version,
        "guide_version": workflow["version"],
        "guided_tools": len(guided_tools),
        "bundled_extension_files": len(extension_files),
        "portable_python_files": len(executable_python),
    }, sort_keys=True))


if __name__ == "__main__":
    main()
