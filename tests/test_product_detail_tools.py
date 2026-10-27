"""Offline server-tool tests for product detail reads and explicit history saves."""

from __future__ import annotations

import copy
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from shopkud_mcp.campaigns import CampaignStore
from shopkud_mcp.server import create_service


PAGE = "1:" + "a" * 32
PRODUCT_ID = "67890"
OFFER_URL = f"https://affiliate.shopee.co.th/offer/product_offer/{PRODUCT_ID}"
LIST_URL = "https://affiliate.shopee.co.th/offer/product_offer"
ENTRY_PAGE = "2:" + "b" * 32
DETAIL = {
    "ok": True, "kind": "product_detail", "product_id": PRODUCT_ID,
    "item_id": PRODUCT_ID, "shop_id": "12345", "observed_at": "2026-10-14T00:00:00Z",
    "name": "สินค้าทดสอบ", "offer_url": OFFER_URL,
    "product_url": f"https://shopee.co.th/product/12345/{PRODUCT_ID}",
    "price_min_thb": 10.0, "price_max_thb": 20.0,
    "offer_end_date": "2026-10-29", "offer_end_date_source": "visible_offer_dom",
    "extra_commission_start_date": None, "extra_commission_end_date": None,
    "attribution_duration_days": None, "attribution_duration_source": None,
    "affiliate_url": None,
    "offer_terms": {"status": "observed", "sections": [{"title": "ค่าคอมจากร้านค้า", "rows": [], "notes": ["เงื่อนไขตัวอย่าง"]}]},
    "link_source": None, "link_action": None, "observations_only": True,
    "link_attribution_verified": False, "missing_fields": [], "retry_automatically": False,
    "variant_info": {"model_id": None, "model_name": None, "color": None},
    "channels": [{"channel": "social", "label": "Social", "extra_commission": {"pct": 3},
                  "shopee_commission": {"pct": 2}, "total_pct": 5,
                  "estimated_commission_thb": 0.5, "cap_thb": None}],
    "images": [{"url": "https://images.example.test/main.jpg"}],
    "gallery": [{"url": "https://images.example.test/gallery.jpg"}],
    "gallery_complete": True,
    "layout_evidence": {"diagnostic": "do not include in brief"},
}


class Broker:
    def __init__(self):
        self.calls = []
        self.page_url = OFFER_URL
        self.page_list = None
        self.entry_ready = True
        self.response = copy.deepcopy(DETAIL)

    def pages(self):
        if self.page_list is not None:
            return copy.deepcopy(self.page_list)
        return [{"page_id": PAGE, "url": self.page_url, "title": "test"}]

    async def discover_pages(self):
        return {"state": "ready" if self.pages() else "no_supported_page"}

    async def call(self, page_id, operation, arguments, timeout=20):
        self.calls.append((page_id, operation, arguments, timeout))
        if page_id == "extension" and operation == "open_offer":
            if self.entry_ready:
                self.page_list = self.pages() + [
                    {"page_id": ENTRY_PAGE, "url": arguments["offer_url"], "title": "entry"}
                ]
            return {"ok": True, "page_id": ENTRY_PAGE}
        if page_id == "extension" and operation == "entry_info":
            return {"ok": True, "entries": [], "capacity": 4, "owner_tabs_included": False}
        return copy.deepcopy(self.response)


class Campaign:
    def __init__(self):
        self.calls = []
        self.history = {"ok": True, "records": [], "total": 0}

    def remember_product(self, detail):
        self.calls.append(("remember_product", copy.deepcopy(detail)))
        return {"ok": True, "saved": True, "new_entry": True,
                "affiliate_link_saved": detail.get("affiliate_url") is not None,
                "channel": None, "sub_id": None, "link_attribution_verified": False}

    def get_product_history(self, *args):
        self.calls.append(("get_product_history", args))
        return copy.deepcopy(self.history)


class ProductDetailToolTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="shopkud-detail-tools-")).resolve()
        os.chmod(self.root, 0o700)
        self.config = {"token": "a" * 64, "socket_path": str(self.root / "native.sock"),
                       "port": 8176, "allowed_origins": ["chrome-extension://" + "a" * 32 + "/"],
                       "workspace_enabled": True}
        self.broker = Broker()
        self.campaign = Campaign()
        _, self.mcp, _ = create_service(self.config, self.broker, campaign_store=self.campaign)
        self.tools = self.mcp._tool_manager._tools

    def tearDown(self):
        shutil.rmtree(self.root)

    def tool(self, name):
        return self.tools[name].fn

    async def test_read_only_default_does_not_save_and_history_is_local(self):
        result = await self.tool("get_product_detail")(PAGE)
        self.assertTrue(result["ok"])
        self.assertEqual(result["page_id"], PAGE)
        self.assertNotIn("history_saved", result)
        self.assertEqual(self.broker.calls[0][1:3], ("detail", {}))
        self.assertEqual(self.campaign.calls, [])

        history = await self.tool("get_product_history")(PRODUCT_ID, "test", 3, 2)
        self.assertTrue(history["ok"])
        self.assertEqual(self.campaign.calls, [("get_product_history", (PRODUCT_ID, "test", 3, 2))])
        self.assertEqual(len(self.broker.calls), 1)

    async def test_explicit_save_returns_storage_receipt_without_inventing_attribution(self):
        result = await self.tool("get_product_detail")(PAGE, True)
        self.assertTrue(result["history_saved"])
        receipt = result["history_receipt"]
        self.assertTrue(receipt["saved"])
        self.assertIsNone(receipt["channel"])
        self.assertIsNone(receipt["sub_id"])
        self.assertFalse(receipt["link_attribution_verified"])
        self.assertEqual(self.campaign.calls[0][0], "remember_product")

    async def test_open_link_dialog_is_opt_in_and_bound_to_registered_product(self):
        ordinary = await self.tool("get_product_detail")(PAGE)
        self.assertTrue(ordinary["ok"])
        self.assertEqual(self.broker.calls, [(PAGE, "detail", {}, 20)])

        self.broker.calls.clear()
        opened = await self.tool("get_product_detail")(PAGE, open_link_dialog=True)
        self.assertTrue(opened["ok"])
        self.assertEqual(self.broker.calls, [(PAGE, "detail", {
            "wait_ready": True, "open_link_dialog": True, "expected_product_id": PRODUCT_ID,
        }, 20)])
        self.assertEqual(self.campaign.calls, [])

    async def test_open_link_dialog_requires_canonical_registered_offer_detail(self):
        self.broker.page_url = "https://affiliate.shopee.co.th/offer/product_offer"
        result = await self.tool("get_product_detail")(PAGE, open_link_dialog=True)
        self.assertEqual(result["error"], "product_detail_page_required")
        self.assertEqual(self.broker.calls, [])

        self.broker.page_url = OFFER_URL + "?x=1"
        result = await self.tool("get_product_detail")(PAGE, open_link_dialog=True)
        self.assertEqual(result["error"], "product_detail_page_required")
        self.assertEqual(self.broker.calls, [])

    async def test_open_link_dialog_is_strict_and_not_available_for_public_listing_branch(self):
        invalid = await self.tool("get_product_detail")(PAGE, open_link_dialog=1)
        self.assertEqual(invalid["error"], "invalid_input")
        listing = await self.tool("get_product_detail")(
            product_url="https://shopee.co.th/product/12345/678", open_link_dialog=True,
        )
        self.assertEqual(listing["error"], "invalid_input")
        self.assertEqual(self.broker.calls, [])

    async def test_affiliate_brief_projection_keeps_ids_prices_channels_and_link_status_only(self):
        full = await self.tool("get_product_detail")(PAGE)
        self.broker.calls.clear()
        brief = await self.tool("get_product_detail")(PAGE, view="brief")
        self.assertEqual(self.broker.calls, [(PAGE, "detail", {}, 20)])
        for key in ("ok", "kind", "page_id", "product_id", "item_id", "shop_id", "offer_url", "product_url",
                    "price_min_thb", "price_max_thb", "observed_at", "variant_info", "offer_end_date",
                    "offer_end_date_source", "extra_commission_start_date", "extra_commission_end_date",
                    "attribution_duration_days", "attribution_duration_source", "affiliate_url",
                    "link_source", "link_action", "link_attribution_verified", "missing_fields"):
            self.assertEqual(brief.get(key), full.get(key), key)
        self.assertEqual(brief["channels"][0]["channel"], "social")
        self.assertEqual(brief["channels"][0]["total_pct"], 5)
        self.assertFalse(brief["affiliate_link_available"])
        self.assertEqual(brief["offer_terms"], full["offer_terms"])
        self.assertNotIn("images", brief)
        self.assertNotIn("gallery", brief)
        self.assertNotIn("gallery_complete", brief)
        self.assertNotIn("layout_evidence", brief)
        self.assertEqual(self.campaign.calls, [])

    async def test_affiliate_brief_preserves_explicit_save_receipt_and_entry_readiness(self):
        self.broker.page_list = [{"page_id": PAGE, "url": LIST_URL, "title": "owner"}]
        brief = await self.tool("get_product_detail")(
            offer_url=OFFER_URL, open_if_missing=True, save=True, view="brief",
        )
        self.assertTrue(brief["history_saved"])
        self.assertTrue(brief["history_receipt"]["saved"])
        self.assertEqual(brief["entry"]["page_id"], ENTRY_PAGE)
        self.assertTrue(self.campaign.calls)
        self.assertEqual(self.broker.calls, [
            ("extension", "open_offer", {"offer_url": OFFER_URL}, 25),
            (ENTRY_PAGE, "detail", {"wait_ready": True}, 20),
        ])

    async def test_brief_failures_preserve_error_and_do_not_save_or_open_link_dialog(self):
        self.broker.response = {"ok": False, "error": "detail_unconfirmed", "retry_automatically": False}
        result = await self.tool("get_product_detail")(PAGE, True, view="brief")
        self.assertEqual(result, {"ok": False, "error": "detail_unconfirmed", "retry_automatically": False})
        self.assertEqual(self.broker.calls, [(PAGE, "detail", {}, 20)])
        self.assertEqual(self.campaign.calls, [])

    async def test_brief_requires_explicit_affiliate_page_and_target_model_stays_public_only(self):
        missing = await self.tool("get_product_detail")(view="brief")
        self.assertEqual(missing["error"], "explicit_page_or_offer_required")
        target = await self.tool("get_product_detail")(offer_url=OFFER_URL, target_model="AB-123")
        self.assertEqual(target["error"], "public_product_url_required")
        self.assertEqual(self.broker.calls, [])

    async def test_failed_link_dialog_result_never_saves_history(self):
        self.broker.response = {
            "ok": False, "error": "link_dialog_unconfirmed", "retry_automatically": False,
        }
        result = await self.tool("get_product_detail")(PAGE, True, open_link_dialog=True)
        self.assertEqual(result["error"], "link_dialog_unconfirmed")
        self.assertFalse(result["retry_automatically"])
        self.assertEqual(self.broker.calls, [(PAGE, "detail", {
            "wait_ready": True, "open_link_dialog": True, "expected_product_id": PRODUCT_ID,
        }, 20)])
        self.assertEqual(self.campaign.calls, [])

    async def test_offer_url_selects_exact_registered_page_and_checks_provenance(self):
        result = await self.tool("get_product_detail")(offer_url=OFFER_URL)
        self.assertTrue(result["ok"])
        self.assertEqual(self.broker.calls, [(PAGE, "detail", {}, 20)])

        mismatch = await self.tool("get_product_detail")(page_id=PAGE, offer_url=OFFER_URL + "0")
        self.assertEqual(mismatch["error"], "page_url_mismatch")
        self.assertEqual(len(self.broker.calls), 1)

    async def test_product_id_shortcut_bypasses_search_and_returns_clickable_urls(self):
        self.broker.page_list = [{"page_id": PAGE, "url": LIST_URL, "title": "owner"}]
        result = await self.tool("get_product_detail")(
            product_id=PRODUCT_ID, open_if_missing=True, view="brief",
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["product_id"], PRODUCT_ID)
        self.assertEqual(result["offer_url"], OFFER_URL)
        self.assertEqual(result["product_url"], DETAIL["product_url"])
        self.assertEqual(self.broker.calls, [
            ("extension", "open_offer", {"offer_url": OFFER_URL}, 25),
            (ENTRY_PAGE, "detail", {"wait_ready": True}, 20),
        ])
        self.assertFalse(any(call[1] == "search_scan" for call in self.broker.calls))

    async def test_product_id_shortcut_rejects_ambiguous_or_invalid_inputs(self):
        for arguments in (
            {"product_id": "001"},
            {"product_id": PRODUCT_ID, "offer_url": OFFER_URL},
            {"product_id": PRODUCT_ID, "page_id": PAGE},
            {"product_id": PRODUCT_ID, "product_url": DETAIL["product_url"]},
        ):
            with self.subTest(arguments=arguments):
                result = await self.tool("get_product_detail")(**arguments)
                self.assertEqual(result["error"], "invalid_input")
        self.assertEqual(self.broker.calls, [])

    async def test_offer_url_resolution_fails_closed_for_missing_or_ambiguous_pages(self):
        self.broker.page_list = []
        missing = await self.tool("get_product_detail")(offer_url=OFFER_URL)
        self.assertEqual(missing["error"], "offer_page_not_open")
        self.assertEqual(missing["state"], "no_supported_page")
        self.assertFalse(missing["retry_automatically"])

        self.broker.page_list = [
            {"page_id": PAGE, "url": OFFER_URL, "title": "one"},
            {"page_id": "2:" + "b" * 32, "url": OFFER_URL, "title": "two"},
        ]
        ambiguous = await self.tool("get_product_detail")(offer_url=OFFER_URL)
        self.assertEqual(ambiguous["error"], "ambiguous_page")
        self.assertEqual(len(ambiguous["pages"]), 2)
        self.assertEqual(self.broker.calls, [])

    async def test_offer_url_rejects_noncanonical_urls_before_discovery_or_browser_call(self):
        for unsafe in (
            "http://affiliate.shopee.co.th/offer/product_offer/" + PRODUCT_ID,
            OFFER_URL + "?x=1",
            OFFER_URL + "/",
            "https://affiliate.shopee.co.th.evil/offer/product_offer/" + PRODUCT_ID,
        ):
            with self.subTest(offer_url=unsafe):
                result = await self.tool("get_product_detail")(offer_url=unsafe)
                self.assertEqual(result["error"], "invalid_input")
        self.assertEqual(self.broker.calls, [])

    async def test_open_if_missing_reads_entry_page_once_then_reuses_registered_page(self):
        self.broker.page_list = [{"page_id": PAGE, "url": LIST_URL, "title": "owner"}]

        first = await self.tool("get_product_detail")(offer_url=OFFER_URL, open_if_missing=True)
        self.assertTrue(first["ok"])
        self.assertEqual(first["page_id"], ENTRY_PAGE)
        self.assertEqual(first["entry"], {"ok": True, "page_id": ENTRY_PAGE})
        self.assertEqual(self.broker.calls, [
            ("extension", "open_offer", {"offer_url": OFFER_URL}, 25),
            (ENTRY_PAGE, "detail", {"wait_ready": True}, 20),
        ])
        self.assertIn({"page_id": PAGE, "url": LIST_URL, "title": "owner"}, self.broker.pages())

        second = await self.tool("get_product_detail")(offer_url=OFFER_URL, open_if_missing=True)
        self.assertTrue(second["ok"])
        self.assertNotIn("entry", second)
        self.assertEqual(self.broker.calls[2], (ENTRY_PAGE, "detail", {}, 20))
        self.assertEqual(sum(1 for call in self.broker.calls if call[1] == "open_offer"), 1)

    async def test_open_link_with_open_if_missing_uses_owned_entry_even_when_owner_matches_url(self):
        self.broker.page_list = [{"page_id": PAGE, "url": OFFER_URL, "title": "owner"}]
        result = await self.tool("get_product_detail")(
            offer_url=OFFER_URL, open_if_missing=True, open_link_dialog=True,
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["page_id"], ENTRY_PAGE)
        self.assertEqual(result["entry"], {"ok": True, "page_id": ENTRY_PAGE})
        self.assertEqual(self.broker.calls, [
            ("extension", "open_offer", {"offer_url": OFFER_URL}, 25),
            (ENTRY_PAGE, "detail", {
                "wait_ready": True, "open_link_dialog": True,
                "expected_product_id": PRODUCT_ID,
            }, 20),
        ])
        self.assertIn({"page_id": PAGE, "url": OFFER_URL, "title": "owner"}, self.broker.pages())
        self.assertEqual(self.campaign.calls, [])

    async def test_open_link_with_duplicate_matching_pages_uses_returned_owned_entry(self):
        self.broker.page_list = [
            {"page_id": PAGE, "url": OFFER_URL, "title": "owner one"},
            {"page_id": "3:" + "c" * 32, "url": OFFER_URL, "title": "owner two"},
        ]
        result = await self.tool("get_product_detail")(
            offer_url=OFFER_URL, open_if_missing=True, open_link_dialog=True,
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["page_id"], ENTRY_PAGE)
        self.assertEqual(self.broker.calls[0], ("extension", "open_offer", {"offer_url": OFFER_URL}, 25))
        self.assertEqual(self.broker.calls[1], (ENTRY_PAGE, "detail", {
            "wait_ready": True, "open_link_dialog": True, "expected_product_id": PRODUCT_ID,
        }, 20))
        self.assertEqual(self.campaign.calls, [])

    async def test_explicit_page_link_waits_ready_without_autonomous_entry_creation(self):
        result = await self.tool("get_product_detail")(
            PAGE, offer_url=OFFER_URL, open_if_missing=True, open_link_dialog=True,
        )
        self.assertTrue(result["ok"])
        self.assertEqual(self.broker.calls, [(PAGE, "detail", {
            "wait_ready": True, "open_link_dialog": True, "expected_product_id": PRODUCT_ID,
        }, 20)])
        self.assertFalse(any(call[1] == "open_offer" for call in self.broker.calls))

    async def test_link_readiness_failure_never_calls_detail_or_saves(self):
        self.broker.page_list = [{"page_id": PAGE, "url": OFFER_URL, "title": "owner"}]
        self.broker.entry_ready = False
        result = await self.tool("get_product_detail")(
            offer_url=OFFER_URL, open_if_missing=True, open_link_dialog=True, save=True,
        )
        self.assertEqual(result["error"], "entry_not_registered")
        self.assertEqual(self.broker.calls, [
            ("extension", "open_offer", {"offer_url": OFFER_URL}, 25),
        ])
        self.assertEqual(self.campaign.calls, [])

    async def test_entry_metadata_is_explicit_read_only_and_strict(self):
        ordinary = await self.tool("list_pages")()
        self.assertNotIn("entry_tabs", ordinary)
        self.assertEqual(self.broker.calls, [])
        detailed = await self.tool("list_pages")(include_entry_tabs=True)
        self.assertEqual(detailed["entry_tabs"]["entries"], [])
        self.assertFalse(detailed["entry_tabs"]["owner_tabs_included"])
        self.assertEqual(self.broker.calls, [("extension", "entry_info", {}, 10)])
        invalid = await self.tool("list_pages")(include_entry_tabs=1)
        self.assertEqual(invalid["error"], "invalid_input")
        self.assertEqual(len(self.broker.calls), 1)

    async def test_disabled_save_and_invalid_save_value_do_not_call_browser(self):
        disabled_config = {key: value for key, value in self.config.items() if key != "workspace_enabled"}
        _, mcp, _ = create_service(disabled_config, self.broker)
        tool = mcp._tool_manager._tools["get_product_detail"].fn
        disabled = await tool(PAGE, True)
        self.assertEqual(disabled["error"], "workspace_disabled")
        self.assertEqual(self.broker.calls, [])
        invalid = await self.tool("get_product_detail")(PAGE, "yes")
        self.assertEqual(invalid["error"], "invalid_input")
        self.assertEqual(self.broker.calls, [])

    async def test_detail_and_list_context_mismatch_refuses_result_without_saving(self):
        for page_url, response in (
            ("https://affiliate.shopee.co.th/offer/product_offer", DETAIL),
            (OFFER_URL, {**DETAIL, "offer_url": "https://affiliate.shopee.co.th/offer/product_offer/123"}),
            (OFFER_URL, {**DETAIL, "kind": "product_list"}),
        ):
            self.broker.page_url = page_url
            self.broker.response = response
            result = await self.tool("get_product_detail")(PAGE, True)
            self.assertEqual(result["error"], "invalid_extension_result")
        self.assertEqual(self.campaign.calls, [])

    async def test_history_save_schema_is_strict_and_invalid_history_arguments_reject(self):
        invalid = await self.tool("get_product_detail")(PAGE, 1)
        self.assertEqual(invalid["error"], "invalid_input")
        self.assertEqual((await self.tool("get_product_history")(limit=True))["error"], "invalid_input")
        self.assertEqual((await self.tool("get_product_history")(offset=1000))["error"], "invalid_input")
        self.assertEqual(self.broker.calls, [])
        self.assertEqual(self.campaign.calls, [])

    async def test_save_uses_campaign_store_receipt(self):
        store = CampaignStore(self.root)
        _, mcp, _ = create_service(self.config, self.broker, campaign_store=store)
        result = await mcp._tool_manager._tools["get_product_detail"].fn(PAGE, True)
        self.assertTrue(result["history_saved"])
        persisted = store.get_product_history(product_id=PRODUCT_ID)
        self.assertEqual(persisted["total"], 1)
        self.assertIsNone(persisted["records"][0]["affiliate_url"])
        self.assertFalse(persisted["link_attribution_verified"])


if __name__ == "__main__":
    unittest.main()
