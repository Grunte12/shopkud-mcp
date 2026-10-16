"""Offline tests for public Shopee listing-detail reads."""

from __future__ import annotations

import copy
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from shopkud_mcp.server import create_service


PRODUCT_URL = "https://shopee.co.th/product/12345/67890"
SUCCESS = {
    "ok": True,
    "kind": "public_product_detail",
    "source_url": PRODUCT_URL,
    "shop_id": "12345",
    "product_id": "67890",
    "name": "สินค้าทดสอบ",
    "observed_at": "2026-10-14T00:00:00Z",
    "model_evidence": [],
    "variant_info": {"model": None, "sku": None, "color": None, "selected_options": [],
                      "available_options": [{"label": "Model", "options": ["AB-123", "CD-456"],
                                              "option_evidence": [
                                                  {"value": "AB-123", "selected": None, "disabled": False,
                                                   "source": "visible_labeled_buttons"}
                                              ]}]},
    "seller_info": {"name": {"display": "Seller", "source": "visible_seller_panel"},
                    "mall_badge": None, "ratings_count": None, "followers": None,
                    "shop_age": None, "response_rate": None, "response_time": None},
    "product_metrics": {"rating": {"display": "4.8", "source": "exact_product_json_ld"},
                        "review_count": None, "rating_count": {"display": "12", "source": "exact_product_json_ld"},
                        "sold": {"display": "4k", "source": "visible_product_summary"}},
    "shipping_info": {"ships_from": {"display": "Bangkok", "source": "visible_product_summary"},
                      "delivery": None, "shipping_fee": None, "stock": None},
}


class Broker:
    def __init__(self):
        self.calls = []
        self.response = copy.deepcopy(SUCCESS)

    async def call(self, page_id, operation, arguments, timeout=20):
        self.calls.append((page_id, operation, arguments, timeout))
        return copy.deepcopy(self.response)


class Campaign:
    def __init__(self):
        self.calls = []

    def remember_product(self, detail):
        self.calls.append(("remember_product", detail))
        return {"ok": True}

    def get_product_history(self, *args):
        self.calls.append(("get_product_history", args))
        return {"ok": True, "records": [], "total": 0}


class ListingToolTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="shopkud-listing-tools-", dir="/private/tmp")).resolve()
        os.chmod(self.root, 0o700)
        self.config = {
            "token": "a" * 64,
            "socket_path": str(self.root / "native.sock"),
            "port": 8176,
            "allowed_origins": ["chrome-extension://" + "a" * 32 + "/"],
            "workspace_enabled": True,
        }
        self.broker = Broker()
        self.campaign = Campaign()
        _, self.mcp, _ = create_service(self.config, self.broker, campaign_store=self.campaign)
        self.tools = self.mcp._tool_manager._tools

    def tearDown(self):
        shutil.rmtree(self.root)

    def tool(self, name):
        return self.tools[name].fn

    async def test_default_is_read_only_and_does_not_open_a_tab(self):
        result = await self.tool("get_product_detail")(product_url=PRODUCT_URL)
        self.assertTrue(result["ok"])
        self.assertEqual(self.broker.calls, [("extension", "read_listing", {
            "product_url": PRODUCT_URL, "open_if_missing": False,
        }, 25)])
        self.assertEqual(self.campaign.calls, [])

    async def test_explicit_open_is_forwarded_and_success_is_bound_to_requested_url(self):
        result = await self.tool("get_product_detail")(product_url=PRODUCT_URL, open_if_missing=True)
        self.assertTrue(result["ok"])
        self.assertEqual(result["kind"], "public_product_detail")
        self.assertEqual(result["source_url"], PRODUCT_URL)
        self.assertEqual(result["shop_id"], "12345")
        self.assertEqual(result["product_id"], "67890")
        self.assertEqual(self.broker.calls[0], ("extension", "read_listing", {
            "product_url": PRODUCT_URL, "open_if_missing": True,
        }, 25))

    async def test_strict_url_validation_rejects_noncanonical_inputs_before_call(self):
        for unsafe in (
            "http://shopee.co.th/product/12345/678",
            "https://user@shopee.co.th/product/12345/678",
            "https://shopee.co.th:443/product/12345/678",
            "https://www.shopee.co.th/product/12345/678",
            "https://shopee.co.th.evil/product/12345/678",
            "https://shopee.co.th/product/0/678",
            "https://shopee.co.th/product/12345/0",
            "https://shopee.co.th/product/12345/678?x=1",
            "https://shopee.co.th/product/12345/678#fragment",
            PRODUCT_URL + "\n",
        ):
            with self.subTest(product_url=unsafe):
                result = await self.tool("get_product_detail")(product_url=unsafe)
                self.assertEqual(result["error"], "invalid_input")
        self.assertEqual(self.broker.calls, [])

    async def test_conflicting_arguments_are_rejected_before_broker_call(self):
        for kwargs in (
            {"page_id": "1:" + "a" * 32},
            {"offer_url": "https://affiliate.shopee.co.th/offer/product_offer/123"},
            {"save": True},
        ):
            with self.subTest(kwargs=kwargs):
                result = await self.tool("get_product_detail")(product_url=PRODUCT_URL, **kwargs)
                self.assertEqual(result["error"], "invalid_input")
        self.assertEqual(self.broker.calls, [])
        self.assertEqual(self.campaign.calls, [])

    async def test_open_if_missing_is_strict_boolean(self):
        for invalid in (1, "true", None):
            with self.subTest(value=invalid):
                result = await self.tool("get_product_detail")(product_url=PRODUCT_URL, open_if_missing=invalid)
                self.assertEqual(result["error"], "invalid_input")
        self.assertEqual(self.broker.calls, [])

    async def test_extension_errors_are_preserved_without_retry_or_history(self):
        self.broker.response = {"ok": False, "error": "listing_not_found", "retry_automatically": False}
        result = await self.tool("get_product_detail")(product_url=PRODUCT_URL)
        self.assertEqual(result["error"], "listing_not_found")
        self.assertFalse(result["retry_automatically"])
        self.assertEqual(len(self.broker.calls), 1)
        self.assertEqual(self.campaign.calls, [])

    async def test_malformed_mismatched_and_oversized_successes_are_rejected(self):
        for malformed in (
            {**SUCCESS, "kind": "product_detail"},
            {**SUCCESS, "source_url": PRODUCT_URL + "?other=1"},
            {**SUCCESS, "shop_id": "54321"},
            {**SUCCESS, "product_id": "999"},
            {**SUCCESS, "unexpected": True},
            {**SUCCESS, "padding": "x" * 450001},
        ):
            with self.subTest(keys=tuple(malformed)):
                self.broker.response = malformed
                result = await self.tool("get_product_detail")(product_url=PRODUCT_URL)
                self.assertEqual(result["error"], "invalid_extension_result")
        self.assertEqual(self.campaign.calls, [])

    def test_tool_schema_exposes_product_url(self):
        schema = self.tools["get_product_detail"].parameters
        self.assertIn("product_url", schema["properties"])
        self.assertIn("target_model", schema["properties"])
        self.assertIn("view", schema["properties"])

    async def test_default_full_view_preserves_extension_result_and_arguments(self):
        result = await self.tool("get_product_detail")(product_url=PRODUCT_URL)
        self.assertEqual(result, SUCCESS)
        self.assertEqual(self.broker.calls[0][2], {
            "product_url": PRODUCT_URL, "open_if_missing": False,
        })

    async def test_target_model_full_view_adds_match_without_changing_read_call(self):
        self.broker.response["model_evidence"] = [{
            "model": "AB-123", "role": "identity", "source": "visible_product_spec", "snippet": "Model AB-123",
        }]
        result = await self.tool("get_product_detail")(product_url=PRODUCT_URL, target_model="ab-123")
        self.assertEqual(result["model_match"]["status"], "matched", result)
        self.assertEqual(self.broker.calls[0][2], {
            "product_url": PRODUCT_URL, "open_if_missing": False,
        })
        self.assertEqual(self.campaign.calls, [])

    async def test_brief_view_is_compact_and_excludes_full_listing_payload(self):
        self.broker.response.update({
            "gallery": [{"url": "https://example.test/" + "x" * 5000}],
            "variant_info": {"model": "AB-123", "selected_options": ["black"],
                              "available_options": [{"label": "Model", "options": ["AB-123"],
                                                      "option_evidence": [{"value": "AB-123", "selected": None,
                                                                           "disabled": False,
                                                                           "source": "visible_labeled_buttons"}]}]},
            "model_evidence": [{"model": "AB-123", "role": "identity", "source": "visible_product_spec", "snippet": "Model AB-123"}],
        })
        result = await self.tool("get_product_detail")(product_url=PRODUCT_URL, target_model="AB-123", view="brief")
        self.assertTrue(result.get("ok"), result)
        self.assertEqual(result["model_match"]["status"], "matched", result)
        self.assertEqual(result["variant_info"]["model"], "AB-123")
        self.assertEqual(result["seller_info"]["name"], {"display": "Seller", "source": "visible_seller_panel"})
        self.assertEqual(result["product_metrics"]["rating_count"]["display"], "12")
        self.assertEqual(result["product_metrics"]["review_count"], None)
        self.assertEqual(result["shipping_info"]["ships_from"]["display"], "Bangkok")
        self.assertEqual(result["variant_info"]["available_options"][0]["option_evidence"][0]["selected"], None)
        self.assertFalse(result["retry_automatically"])
        self.assertNotIn("gallery", result)
        self.assertNotIn("description", result)
        self.assertLess(len(str(result)), 4000)
        self.assertEqual(self.broker.calls[0][2], {"product_url": PRODUCT_URL, "open_if_missing": False})

    async def test_public_full_default_preserves_purchase_evidence_and_option_strings(self):
        result = await self.tool("get_product_detail")(product_url=PRODUCT_URL)
        self.assertEqual(result, SUCCESS)
        self.assertEqual(result["variant_info"]["available_options"][0]["options"], ["AB-123", "CD-456"])
        self.assertEqual(self.broker.calls, [("extension", "read_listing", {
            "product_url": PRODUCT_URL, "open_if_missing": False,
        }, 25)])

    async def test_brief_ignores_malformed_provenance_and_missing_old_reader_fields(self):
        self.broker.response.update({
            "seller_info": {"name": {"display": "invented", "source": "model_guess"}},
            "product_metrics": {"rating": {"display": "5", "source": "unsupported"}},
            "shipping_info": {"stock": {"display": "99", "source": "visible_seller_panel"}},
            "variant_info": {"available_options": [{"label": "Model", "options": ["AB-123"],
                "option_evidence": [{"value": "AB-123", "selected": True, "disabled": False, "source": "page_guess"}]}]},
        })
        result = await self.tool("get_product_detail")(product_url=PRODUCT_URL, view="brief")
        self.assertTrue(result["ok"], result)
        self.assertIsNone(result["seller_info"]["name"])
        self.assertIsNone(result["product_metrics"]["rating"])
        self.assertIsNone(result["shipping_info"]["stock"])
        self.assertEqual(result["variant_info"]["available_options"][0]["option_evidence"], [])
        self.assertEqual(self.broker.calls, [("extension", "read_listing", {
            "product_url": PRODUCT_URL, "open_if_missing": False,
        }, 25)])
        self.assertEqual(self.campaign.calls, [])

    async def test_invalid_match_options_and_affiliate_branch_options_reject_before_call(self):
        for kwargs in (
            {"target_model": "not a code"},
            {"target_model": "AB-123", "view": "unknown"},
            {"target_model": "AB-123"},
        ):
            with self.subTest(kwargs=kwargs):
                result = await self.tool("get_product_detail")(**kwargs)
                self.assertIn(result["error"], {"invalid_input", "public_product_url_required"})
        no_target = await self.tool("get_product_detail")(view="brief")
        self.assertEqual(no_target["error"], "explicit_page_or_offer_required")
        affiliate = await self.tool("get_product_detail")(
            offer_url="https://affiliate.shopee.co.th/offer/product_offer/123", target_model="AB-123",
        )
        self.assertEqual(affiliate["error"], "public_product_url_required")
        self.assertEqual(self.broker.calls, [])

    async def test_requested_model_views_require_extension_model_evidence(self):
        self.broker.response.pop("model_evidence")
        full = await self.tool("get_product_detail")(product_url=PRODUCT_URL, target_model="AB-123")
        self.assertEqual(full["error"], "extension_upgrade_required")
        brief = await self.tool("get_product_detail")(product_url=PRODUCT_URL, view="brief")
        self.assertEqual(brief["error"], "extension_upgrade_required")

    async def test_matching_options_do_not_trigger_saving_or_get_link(self):
        self.broker.response["model_evidence"] = [{
            "model": "AB-123", "role": "identity", "source": "visible_product_spec", "snippet": "Model AB-123",
        }]
        await self.tool("get_product_detail")(product_url=PRODUCT_URL, target_model="AB-123", view="brief")
        self.assertEqual(self.broker.calls, [("extension", "read_listing", {
            "product_url": PRODUCT_URL, "open_if_missing": False,
        }, 25)])
        self.assertEqual(self.campaign.calls, [])


if __name__ == "__main__":
    unittest.main()
