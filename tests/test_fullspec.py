"""Offline coverage for the remaining P0/P1/P2 behaviors."""

from __future__ import annotations

import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from shopkud_mcp.campaigns import CampaignError, CampaignStore
from shopkud_mcp.spec_ops import ASSUMPTIONS, classify_cancellation, excluded_category, project_offer


WORKSPACE = "0123456789abcdef" * 2
PRODUCT = "67890"
OFFER_URL = f"https://affiliate.shopee.co.th/offer/product_offer/{PRODUCT}"
PRODUCT_URL = f"https://shopee.co.th/product/12345/{PRODUCT}"


class FullSpecTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="shopkud-fullspec-")
        self.root = Path(self.temp.name).resolve()
        os.chmod(self.root, 0o700)
        self.store = CampaignStore(self.root)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def offer(self, item_id="26916762523", **kwargs):
        payload = dict(
            title="กระติกน้ำสแตนเลส 1 ลิตร",
            category="Home",
            official=True,
            price=199,
            rate_social=8.5,
            rate_video=6,
            extra_comm=2,
            stock="in_stock",
            sales=40,
            rating=4.8,
            image_urls=["https://down-th.img.susercontent.com/file/fixture.jpg"],
        )
        payload.update(kwargs)
        return self.store.record_offer(WORKSPACE, item_id, **payload)

    def link(self, **kwargs):
        payload = dict(
            workspace_id=WORKSPACE,
            channel="x",
            marketplace="shopee",
            content_id="clip-v6",
            product_id="26916762523",
            affiliate_url="https://s.shopee.co.th/FixtureP1X",
            sub_id="x|P1|v6|a|202610",
            sub_id_1="x",
            sub_id_2="P1",
            sub_id_3="v6",
            sub_id_4="a",
            sub_id_5="202610",
            clip_id="v6",
        )
        payload.update(kwargs)
        return self.store.set_link(**payload)

    def test_hidden_link_field_can_be_saved_without_opening_it(self):
        saved = self.store.remember_product({
            "product_id": PRODUCT,
            "name": "สินค้าทดสอบ",
            "offer_url": OFFER_URL,
            "product_url": PRODUCT_URL,
            "price_min_thb": 10,
            "price_max_thb": 12,
            "affiliate_url": "https://s.shopee.co.th/HiddenField1",
            "link_source": "hidden_link_field",
        })
        self.assertTrue(saved["affiliate_link_saved"])

    def test_offer_projection_keeps_channel_split_and_excluded_flag(self):
        projected = project_offer({
            "product_id": "26916762523",
            "shop_id": "12345",
            "name": "นมผงสำหรับเด็ก",
            "category": "นมผงทุกชนิด",
            "price_min_thb": 50,
            "official": False,
            "channels": [
                {"channel": "social", "total_pct": 4, "extra_commission": {"pct": 1}},
                {"channel": "shopee_video", "total_pct": 7, "extra_commission": {"pct": None}},
            ],
            "observed_at": "2026-10-16T00:00:00+00:00",
        })
        self.assertEqual(projected["per_channel"], {"social": 4.0, "video": 7.0})
        self.assertEqual(projected["extra_comm"], 1.0)
        self.assertTrue(projected["excluded_category"])
        self.assertIn("excluded_category", projected["warnings"])
        self.assertFalse(projected["commission_eligible"])
        self.assertEqual(excluded_category("นมผงทุกชนิด"), "นมผง")
        self.assertEqual(excluded_category("หมวดหมู่เครื่องประดับ"), "เครื่องประดับ")
        self.assertIsNone(excluded_category("บัตรกำนัลร้านค้า"))
        self.assertIsNone(excluded_category("E-Voucher"))
        self.assertEqual(excluded_category("Utilites"), "utilites")
        self.assertIsNone(excluded_category("utilities"))
        self.assertEqual(excluded_category("จี้"), "จี้")
        self.assertEqual(ASSUMPTIONS["excluded_categories"]["evidence"], "cited")
        self.assertIn("132895", ASSUMPTIONS["excluded_categories"]["citation"])
        self.assertFalse(ASSUMPTIONS["category_guesses"]["applied"])
        self.assertEqual(ASSUMPTIONS["earnings_expiry"]["evidence"], "unverified")

    def test_find_link_by_product_code_and_channel(self):
        self.link()
        self.link(channel="ig", affiliate_url="https://s.shopee.co.th/FixtureP1IG", sub_id="ig|P1|v6", sub_id_1="ig", content_id="other")
        found = self.store.find_links(WORKSPACE, product="P1", channel="x")
        self.assertEqual(found["total"], 1)
        self.assertEqual(found["links"][0]["affiliate_url"], "https://s.shopee.co.th/FixtureP1X")

    def test_snapshot_search_history_media_and_replacement(self):
        self.offer()
        self.offer(item_id="26916762524", title="กระติกน้ำเดินป่า", price=249, as_of="2026-10-15T00:00:00+00:00")
        self.offer(item_id="26916762524", title="กระติกน้ำเดินป่า", price=219, as_of="2026-10-16T00:00:00+00:00")
        prohibited = self.offer(item_id="999", title="อาวุธทดสอบ", category="อาวุธ", rate_social=20, official=False, extra_comm=0)
        self.assertTrue(prohibited["excluded_category"])
        voucher = self.store.record_offer(
            WORKSPACE, "998", title="คูปองอาหาร", category="voucher", official=False,
            price=10, rate_social=20, extra_comm=0, stock="in_stock",
        )
        self.assertFalse(voucher["excluded_category"])
        found = self.store.search_offers(WORKSPACE, keyword="กระติก", sort="commission", official=True, extra_comm=True, min_rate=5)
        self.assertGreaterEqual(found["count"], 1)
        self.assertTrue(all(item["item_id"] != "999" for item in found["items"]))
        history = self.store.get_price_history(WORKSPACE, "26916762524")
        self.assertEqual([point["price"] for point in history["points"]], [249.0, 219.0])
        media = self.store.get_product_media(WORKSPACE, "26916762523")
        self.assertEqual(media["images"], ["https://down-th.img.susercontent.com/file/fixture.jpg"])
        self.store.record_offer(
            WORKSPACE, "26916762523", title="กระติกน้ำสแตนเลส 1 ลิตร", category="Home",
            official=True, price=199, rate_social=8.5, extra_comm=2, stock="in_stock",
            image_urls=["https://evil.example/a.jpg"],
        )
        self.assertEqual(self.store.get_product_media(WORKSPACE, "26916762523")["images"], [])
        suggestions = self.store.suggest_replacement(WORKSPACE, "26916762523", k=3)
        self.assertTrue(suggestions["candidates"])
        self.assertNotIn("999", [row["item_id"] for row in suggestions["candidates"]])
        self.assertIn("official_shop", suggestions["candidates"][0]["reason"])

    def test_commission_snapshot_diff_reports_drop_removal_and_stock(self):
        self.offer(item_id="1", rate_social=10, rate_video=10, as_of="2026-10-01T00:00:00+00:00")
        self.offer(item_id="1", rate_social=4, rate_video=4, as_of="2026-10-02T00:00:00+00:00")
        self.offer(item_id="2", rate_social=5, rate_video=5, as_of="2026-10-01T00:00:00+00:00")
        self.offer(item_id="2", rate_social=0, rate_video=0, as_of="2026-10-02T00:00:00+00:00")
        self.offer(item_id="3", stock="out_of_stock", as_of="2026-10-02T00:00:00+00:00")
        self.link(product_id="1", clip_id="clip-a", content_id="health", affiliate_url="https://s.shopee.co.th/Health1", sub_id="x|health|1")
        health = self.store.commission_health_from_snapshots(WORKSPACE, scope=["clip-a"])
        self.assertEqual(health["results"][0]["status"], "dropped")
        self.assertEqual(health["results"][0]["old_rate"], 10)
        self.assertEqual(health["results"][0]["new_rate"], 4)
        all_rows = {row["item_id"]: row["status"] for row in self.store.commission_health_from_snapshots(WORKSPACE)["results"]}
        self.assertEqual(all_rows["2"], "removed")
        self.assertEqual(all_rows["3"], "oos")

    def test_cancellation_rules_use_aggregates_only(self):
        self.assertEqual(classify_cancellation({"buyer_class": "household", "status": "cancelled"})["likely_reason"], "self_or_household_purchase")
        self.assertEqual(classify_cancellation({"reason_hint": "another_link"})["likely_reason"], "buyer_clicked_another_link")
        self.assertEqual(classify_cancellation({"category": "บุหรี่", "status": "completed"})["likely_reason"], "excluded_category")
        self.assertNotEqual(classify_cancellation({"category": "gift card", "status": "completed"})["likely_reason"], "excluded_category")
        self.assertEqual(classify_cancellation({"reason_hint": "voucher", "commission_thb": "0", "orders": 2})["likely_reason"], "voucher_fully_paid")
        self.assertEqual(classify_cancellation({"status": "cancelled"})["likely_reason"], "order_cancelled_or_returned")
        csv_text = "SubID,Commission,Orders,Status,Reason,Category,Buyer\n" \
                   "x|P1|v6,0,1,CANCEL,SELF,Home,self\n" \
                   "x|P1|v6,0,2,CANCEL,VOUCHER,Home,other\n"
        mapping = {"sub_id": "SubID", "commission": "Commission", "orders": "Orders", "status": "Status",
                   "reason": "Reason", "category": "Category", "buyer_class": "Buyer"}
        status_map = {"CANCEL": "cancelled"}
        preview = self.store.import_csv(WORKSPACE, csv_text, mapping, "shopee", "2026-10-01", "2026-10-16", status_map=status_map)
        self.store.import_csv(WORKSPACE, csv_text, mapping, "shopee", "2026-10-01", "2026-10-16",
                              commit=True, expected_digest=preview["digest"], status_map=status_map)
        explained = self.store.explain_cancellations(WORKSPACE, "2026-10-01", "2026-10-16")
        reasons = {row["likely_reason"]: row["count"] for row in explained["classifications"]}
        self.assertEqual(reasons["self_or_household_purchase"], 1)
        self.assertEqual(reasons["voucher_fully_paid"], 1)
        self.assertNotIn("order_id", str(explained))
        conversions = self.store.get_conversions(WORKSPACE, "2026-10-01", "2026-10-16", status="cancelled")
        self.assertEqual(sum(row["rows"] for row in conversions["rows"]), 2)
        self.assertTrue(all(row["reason_hint"] in {"self", "voucher", "unrecognized", None} or row["reason_hint"] in {"self", "voucher"} for row in conversions["rows"]))

    def test_mission_compliance_does_not_post(self):
        self.store.enroll_mission(WORKSPACE, "mission-1", "Reels", requirements={"keywords": ["ลดราคา"], "forbidden": ["ของปลอม"], "require_link": True, "require_sub_id": True})
        self.link()
        bad = self.store.check_post_compliance(WORKSPACE, "mission-1", "ของปลอมลดราคา", None)
        self.assertFalse(bad["compliant"])
        self.assertTrue(bad["forbidden_hits"])
        good = self.store.check_post_compliance(WORKSPACE, "mission-1", "ลดราคาวันนี้", "https://s.shopee.co.th/FixtureP1X")
        self.assertTrue(good["compliant"])
        self.assertFalse(good["publishes"])

    def test_video_swap_stays_local_until_confirm_and_never_submits(self):
        self.store.track_video_clip(WORKSPACE, "video-1", "คลิป", "observed", [{"product_id": "111", "affiliate_url": "https://s.shopee.co.th/OldCart"}])
        preview = self.store.prepare_cart_swap(WORKSPACE, "video-1", "111", "222", "https://s.shopee.co.th/NewCart", confirm=False)
        self.assertTrue(preview["confirmation_required"])
        self.assertFalse(preview["submitted_to_shopee"])
        self.assertFalse(preview["local_cart_updated"])
        applied = self.store.prepare_cart_swap(WORKSPACE, "video-1", "111", "222", "https://s.shopee.co.th/NewCart", confirm=True)
        self.assertTrue(applied["local_cart_updated"])
        self.assertFalse(applied["submitted_to_shopee"])
        clips = self.store.list_video_clips(WORKSPACE)
        self.assertEqual(clips["clips"][0]["items"][0]["product_id"], "222")

    def test_video_level_earnings_draft_budget_and_export(self):
        level = self.store.record_video_level(WORKSPACE, level=0, active_days=10, qualifying_clips=4)
        self.assertEqual(level["next_threshold"]["level"], 1)
        self.assertEqual(level["refresh_day"], "tuesday")
        self.assertEqual(level["refresh_day_evidence"], "cited")
        self.assertIsNone(level["min_clip_seconds"])
        self.assertEqual(level["quantitative_thresholds"], "unverified")
        self.assertTrue(level["rules_are_assumptions"])
        self.assertIn("203761", level["refresh_day_citation"])
        old = (datetime.now(timezone.utc) - timedelta(days=160)).isoformat(timespec="seconds")
        earnings = self.store.record_earnings(WORKSPACE, pending="10.00", validated="5.00", paid="1.00", kyc_status="verified", as_of=old)
        self.assertEqual(earnings["expiring"][0]["kind"], "six_month_window")
        self.assertEqual(earnings["balance_since"], old)
        refreshed = self.store.record_earnings(WORKSPACE, pending="10.00", validated="5.00", paid="1.00", kyc_status="verified")
        self.assertEqual(refreshed["balance_since"], old)
        self.assertEqual(refreshed["expiring"][0]["kind"], "six_month_window")
        draft = self.store.create_video_draft(WORKSPACE, "clip.mp4", "แคปชัน", ["ลดราคา"], ["26916762523"])
        self.assertFalse(draft["publish_allowed"])
        self.assertFalse(draft["uploaded"])
        with self.assertRaises(CampaignError):
            self.store.create_video_draft(WORKSPACE, "../clip.mp4", "แคปชัน")
        self.link(channel="tiktok", sub_id_1="tiktok", affiliate_url="https://s.shopee.co.th/Budget1", sub_id="tiktok|P1|v6|a|202610", content_id="b1")
        self.store.set_posting_cap(WORKSPACE, "tiktok", 1)
        budget = self.store.posting_budget(WORKSPACE, "tiktok")
        self.assertEqual(budget["today"], 1)
        self.assertFalse(budget["ok_to_post"])
        self.assertEqual(budget["cap_evidence"], "owner_set")
        guessed = self.store.posting_budget(WORKSPACE, "ig")
        self.assertEqual(guessed["cap"], 30)
        self.assertEqual(guessed["cap_evidence"], "unverified_local")
        exported = self.store.export_data(WORKSPACE, "links", format="csv")
        self.assertTrue(exported["formula_neutralized"])
        self.assertIn("Budget1", exported["body"])
        hostile = self.store.record_offer(WORKSPACE, "55", title="=cmd|' /C calc'!A0", price=1)
        csv_offers = self.store.export_data(WORKSPACE, "offers", format="csv")
        self.assertIn("'=cmd|", csv_offers["body"])
        self.assertEqual(hostile["title"].startswith("="), True)

    def test_convert_links_replaces_registry_urls_and_leaves_unknowns(self):
        self.link()
        text = "ดู https://shopee.co.th/product/12345/26916762523 และ https://shopee.co.th/product/1/999"
        converted = self.store.convert_links_in_text(WORKSPACE, text, "x", "v6")
        self.assertIn("https://s.shopee.co.th/FixtureP1X", converted["text"])
        self.assertIn("https://shopee.co.th/product/1/999", converted["text"])
        self.assertEqual(converted["replaced"], 1)
        self.assertFalse(converted["opens_links"])

    def test_account_scopes_snapshots(self):
        self.offer(account="brand-a", title="กระติก A")
        self.store.record_offer(WORKSPACE, "77", title="กระติก B", account="brand-b", price=10, rate_social=3, stock="in_stock")
        only_b = self.store.search_offers(WORKSPACE, keyword="กระติก", account="brand-b")
        self.assertEqual([item["item_id"] for item in only_b["items"]], ["77"])


if __name__ == "__main__":
    unittest.main()
