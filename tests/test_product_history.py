"""Offline coverage for explicitly remembered product details."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from shopkud_mcp.campaigns import CampaignError, CampaignStore


PRODUCT_ID = "67890"
OFFER_URL = f"https://affiliate.shopee.co.th/offer/product_offer/{PRODUCT_ID}"
PRODUCT_URL = f"https://shopee.co.th/product/12345/{PRODUCT_ID}"
LINK_A = "https://s.shopee.co.th/SyntheticFixtureA"
LINK_B = "https://s.shopee.co.th/SyntheticFixtureB"


class ProductHistoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="shopkud-product-history-")
        self.root = Path(self.temp.name).resolve()
        os.chmod(self.root, 0o700)
        self.store = CampaignStore(self.root)

    def tearDown(self) -> None:
        self.temp.cleanup()

    @staticmethod
    def detail(*, affiliate_url=None, **overrides):
        result = {
            "kind": "product_detail", "product_id": PRODUCT_ID,
            "name": "สินค้า 100%_พิเศษ", "offer_url": OFFER_URL,
            "product_url": PRODUCT_URL, "price_min_thb": 10.0,
            "price_max_thb": 20.0, "affiliate_url": affiliate_url,
        }
        if affiliate_url is not None:
            result["link_source"] = "visible_link_dialog"
        result.update(overrides)
        return result

    def test_restart_deduplicates_same_link_and_preserves_distinct_links_and_no_link(self):
        first = self.store.remember_product(self.detail(affiliate_url=LINK_A))
        repeated = self.store.remember_product(self.detail(affiliate_url=LINK_A, name="ชื่อใหม่"))
        distinct = self.store.remember_product(self.detail(affiliate_url=LINK_B))
        no_link = self.store.remember_product(self.detail())
        self.assertTrue(first["new_entry"])
        self.assertFalse(repeated["new_entry"])
        self.assertTrue(distinct["new_entry"])
        self.assertTrue(no_link["new_entry"])
        self.assertIsNone(no_link["channel"])
        self.assertIsNone(no_link["sub_id"])

        reopened = CampaignStore(self.root)
        rows = reopened.get_product_history(product_id=PRODUCT_ID)["records"]
        self.assertEqual(len(rows), 3)
        self.assertEqual({row["affiliate_url"] for row in rows}, {LINK_A, LINK_B, None})
        updated = next(row for row in rows if row["affiliate_url"] == LINK_A)
        self.assertEqual(updated["name"], "ชื่อใหม่")
        self.assertLessEqual(updated["first_saved_at"], updated["last_saved_at"])
        for row in rows:
            self.assertNotIn("channel", row)
            self.assertNotIn("sub_id", row)

    def test_query_wildcards_are_literal_and_filters_and_pagination_are_bounded(self):
        self.store.remember_product(self.detail(affiliate_url=LINK_A, name="สินค้า 100%_พิเศษ"))
        self.store.remember_product(self.detail(affiliate_url=LINK_B, name="สินค้า 100Xyพิเศษ"))
        other_id = "123"
        self.store.remember_product(self.detail(
            product_id=other_id,
            offer_url=f"https://affiliate.shopee.co.th/offer/product_offer/{other_id}",
            product_url=f"https://shopee.co.th/product/12345/{other_id}",
            name="ชื่ออื่น", affiliate_url=None,
        ))
        literal = self.store.get_product_history(query="100%_")
        self.assertEqual(literal["total"], 1)
        self.assertEqual(literal["records"][0]["product_id"], PRODUCT_ID)
        self.assertEqual(self.store.get_product_history(query="100X_")["total"], 0)
        self.assertEqual(self.store.get_product_history(product_id=PRODUCT_ID, query="100%")["total"], 1)
        page = self.store.get_product_history(limit=1, offset=1)
        self.assertEqual(page["total"], 3)
        self.assertEqual(len(page["records"]), 1)
        self.assertEqual(page["next_offset"], 2)
        self.assertFalse(page["link_attribution_verified"])
        self.assertFalse(page["includes_browser_history"])
        self.assertFalse(page["recovers_unsaved_links"])

    def test_invalid_urls_ids_prices_and_boolean_prices_are_refused(self):
        invalid = [
            ("unsafe_url", {"offer_url": "https://evil.example/" + PRODUCT_ID}),
            ("unsafe_url", {"product_url": "https://evil.example/product/12345/" + PRODUCT_ID}),
            ("unsafe_url", {"affiliate_url": "https://evil.example/link", "link_source": "visible_link_dialog"}),
            ("invalid_request", {"product_id": True}),
            ("invalid_request", {"product_id": "0"}),
            ("invalid_request", {"price_min_thb": True}),
            ("invalid_request", {"price_min_thb": 21.0}),
            ("invalid_request", {"price_max_thb": float("inf")}),
            ("invalid_request", {"affiliate_url": LINK_A, "link_source": None}),
        ]
        for code, changes in invalid:
            with self.subTest(changes=changes), self.assertRaises(CampaignError) as caught:
                self.store.remember_product(self.detail(**changes))
            self.assertEqual(caught.exception.code, code)

    def test_invalid_history_filters_and_unsafe_storage_are_refused(self):
        for kwargs in (
            {"product_id": True}, {"product_id": "0"}, {"query": "%" * 121},
            {"query": "bad\nquery"}, {"limit": True}, {"offset": -1},
        ):
            with self.subTest(kwargs=kwargs), self.assertRaises(CampaignError) as caught:
                self.store.get_product_history(**kwargs)
            self.assertEqual(caught.exception.code, "invalid_request")

        os.chmod(self.root / "campaigns.sqlite3", 0o644)
        with self.assertRaises(CampaignError) as caught:
            self.store.get_product_history()
        self.assertEqual(caught.exception.code, "unsafe_database")


if __name__ == "__main__":
    unittest.main()
