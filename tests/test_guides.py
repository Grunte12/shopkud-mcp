"""Offline tests for the portable, versioned affiliate workflow guide."""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import unittest
from pathlib import Path

from shopkud_mcp.server import GUIDED_TOOL_GROUPS, create_service


PACKAGE = Path(__file__).resolve().parents[1] / "shopkud_mcp"
MANIFEST_PATH = PACKAGE / "workflows" / "affiliate.json"


class Broker:
    def __init__(self):
        self.calls = []

    def pages(self):
        return []

    async def call(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return {"ok": args[1] == "developer_event" if len(args) > 1 else False}


class Campaign:
    def __init__(self):
        self.calls = []

    def __getattr__(self, name):
        def call(*args, **kwargs):
            self.calls.append((name, args, kwargs))
            return {"ok": True}
        return call


class WorkflowGuideTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp_root = Path(tempfile.mkdtemp(prefix="shopkud-guide-test-")).resolve()
        os.chmod(self.temp_root, 0o700)
        config = {
            "token": "a" * 64,
            "socket_path": str(self.temp_root / "native.sock"),
            "port": 8176,
            "allowed_origins": ["chrome-extension://" + "a" * 32 + "/"],
            "workspace_enabled": True,
        }
        self.broker = Broker()
        self.campaign = Campaign()
        _, self.mcp, _ = create_service(config, self.broker, campaign_store=self.campaign)
        self.tool = self.mcp._tool_manager._tools["get_workflow_guide"].fn

    def tearDown(self):
        shutil.rmtree(self.temp_root)

    async def test_mcp_tool_defaults_to_small_manifest_brief(self):
        result = await self.tool()
        self.assertTrue(result["ok"])
        self.assertEqual(result["workflow_id"], "shopkud-affiliate")
        self.assertEqual(result["guide_version"], "1.5.6")
        self.assertEqual(result["view"], "brief")
        self.assertIn("manifest", result)
        self.assertLess(len(json.dumps(result, ensure_ascii=False)), 5000)
        schema = self.mcp._tool_manager._tools["get_workflow_guide"].parameters
        self.assertEqual(schema["properties"]["view"]["default"], "brief")
        annotations = self.mcp._tool_manager._tools["get_workflow_guide"].annotations
        self.assertIsNotNone(annotations)
        self.assertTrue(annotations.readOnlyHint)
        self.assertFalse(annotations.destructiveHint)
        self.assertTrue(annotations.idempotentHint)
        self.assertFalse(annotations.openWorldHint)
        self.assertEqual(self.broker.calls, [])
        self.assertEqual(self.campaign.calls, [])

    async def test_runtime_tool_manager_streams_agent_and_code_lifecycle_without_argument_values(self):
        await self.mcp._tool_manager.call_tool("get_workflow_guide", {"view": "brief"})
        events = [args[2] for args, _kwargs in self.broker.calls if args[1] == "developer_event"]
        self.assertEqual([event["actor"] for event in events], ["agent", "code"])
        self.assertEqual([event["phase"] for event in events], ["started", "completed"])
        self.assertEqual(events[0]["operation"], "get_workflow_guide")
        self.assertEqual(json.loads(events[0]["detail"]), {"argument_keys": ["view"]})
        self.assertNotIn("brief", events[0]["detail"])
        self.assertEqual(json.loads(events[1]["detail"]), {"ok": True})
        self.assertEqual(events[1]["message"], "Returned result to Agent")

    async def test_runtime_result_preview_allows_only_shopee_media(self):
        tool = self.mcp._tool_manager._tools["get_product_media"]
        original = tool.fn
        async def fixture(*_args, **_kwargs):
            return {"ok": True, "total": 2, "images": [
                {"url": "https://down-th.img.susercontent.com/file/product.jpg"},
                {"url": "https://evil.example/private.jpg"},
            ]}
        tool.fn = fixture
        try:
            await self.mcp._tool_manager.call_tool("get_product_media", {"workspace_id": "a" * 32, "item_id": "1"},
                                                   convert_result=True)
        finally:
            tool.fn = original
        event = [args[2] for args, _kwargs in self.broker.calls if args[1] == "developer_event"][-1]
        self.assertEqual(event["media"], ["https://down-th.img.susercontent.com/file/product.jpg"])
        self.assertEqual(json.loads(event["detail"]), {"ok": True, "total": 2, "image_count": 1})

    async def test_full_and_skill_views_return_exact_packaged_files(self):
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        for view, key in (("full", "guide"), ("skill", "skill")):
            with self.subTest(view=view):
                result = await self.tool(view)
                self.assertEqual(result["view"], view)
                self.assertEqual(result["workflow_id"], manifest["id"])
                self.assertEqual(result["guide_version"], manifest["version"])
                self.assertEqual(result["content"], (PACKAGE / manifest[key]).read_text(encoding="utf-8"))
                self.assertEqual(self.broker.calls, [])
                self.assertEqual(self.campaign.calls, [])

    async def test_invalid_view_is_rejected_without_browser_or_store_access(self):
        self.assertEqual(await self.tool("unknown"), {"ok": False, "error": "invalid_input"})
        self.assertEqual(await self.tool(123), {"ok": False, "error": "invalid_input"})
        self.assertEqual(self.broker.calls, [])
        self.assertEqual(self.campaign.calls, [])

    def test_manifest_tools_exist_and_packaged_references_are_portable(self):
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        package_tools = set(self.mcp._tool_manager._tools)
        named_tools = {name for stage in manifest["stages"] for name in stage["tools"]}
        self.assertTrue(named_tools)
        self.assertTrue(named_tools <= package_tools, named_tools - package_tools)
        guided = manifest["tool_profiles"]["guided"]["groups"]
        self.assertEqual({key: set(value) for key, value in guided.items()},
                         {key: set(value) for key, value in GUIDED_TOOL_GROUPS.items()})

        for key in ("skill", "guide"):
            relative = Path(manifest[key])
            self.assertFalse(relative.is_absolute())
            resolved = (PACKAGE / relative).resolve(strict=True)
            self.assertTrue(resolved.is_relative_to(PACKAGE.resolve()))
            self.assertTrue(resolved.is_file())

        skill_text = (PACKAGE / manifest["skill"]).read_text(encoding="utf-8")
        refs = re.findall(r"\[[^\]]+\]\(([^)]+)\)", skill_text)
        self.assertTrue(refs)
        for ref in refs:
            self.assertFalse(Path(ref).is_absolute())
            self.assertTrue(((PACKAGE / manifest["skill"]).parent / ref).resolve(strict=True).is_relative_to(
                (PACKAGE / manifest["skill"]).parent.resolve()))

        for path in (MANIFEST_PATH, PACKAGE / manifest["skill"], PACKAGE / manifest["guide"]):
            content = path.read_text(encoding="utf-8")
            self.assertNotRegex(content, r"(?i)(?:/Users/|C:\\Users\\)")
            self.assertNotRegex(content, r"https?://(?:affiliate\.shopee\.co\.th|s\.shopee\.co\.th)/")


if __name__ == "__main__":
    unittest.main()
