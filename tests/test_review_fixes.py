"""PII rejection, account isolation, scoped identities, and earnings age."""

from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from shopkud_mcp.campaigns import DB_FILENAME, CampaignError, CampaignStore


WORKSPACE = "d" * 32
URL_A = "https://s.shopee.co.th/AccountA01"
URL_B = "https://s.shopee.co.th/AccountB01"


class ReviewFixTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="shopkud-review-")
        self.root = Path(self.temp.name).resolve()
        os.chmod(self.root, 0o700)
        self.store = CampaignStore(self.root)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def link(self, **overrides):
        values = {
            "workspace_id": WORKSPACE,
            "channel": "tiktok",
            "marketplace": "shopee",
            "content_id": "clip-1",
            "product_id": "26916762523",
            "affiliate_url": URL_A,
            "sub_id": "tiktok|P1|v6",
            "sub_id_1": "tiktok",
            "sub_id_2": "P1",
            "sub_id_3": "v6",
        }
        values.update(overrides)
        return self.store.set_link(**values)

    def test_receipt_and_subid_pii_are_rejected_without_echo(self) -> None:
        with self.assertRaises(CampaignError) as caught:
            self.link(link_receipt={"buyer_name": "Ada", "order_id": "ORD-12345", "affiliate_url": URL_A})
        self.assertEqual(caught.exception.code, "pii_rejected")
        self.assertNotIn("Ada", str(caught.exception))
        self.assertNotIn("ORD-12345", str(caught.exception))
        self.assertEqual(self.store.find_links(WORKSPACE)["total"], 0)

        with self.assertRaises(CampaignError) as caught:
            self.link(sub_id="ORD-12345", sub_id_1="ORD-12345")
        self.assertEqual(caught.exception.code, "pii_rejected")

        with self.assertRaises(CampaignError) as caught:
            self.store.import_csv(
                WORKSPACE,
                "Order ID,commission\nORD-1,10\n",
                {"sub_id": "Order ID", "commission": "commission"},
                "shopee",
                "2026-10-01",
                "2026-10-02",
            )
        self.assertEqual(caught.exception.code, "pii_rejected")

        kept = self.link(link_receipt={
            "affiliate_url": URL_A,
            "product_id": "26916762523",
            "page_url": "https://affiliate.shopee.co.th/offer/product_offer/26916762523",
            "created_at": "2026-10-17T00:00:00+00:00",
            "status": "confirmed",
            "product_attested": True,
            "dialog_detection_method": "specific_selector",
            "sub_id_slots": [1],
        })
        self.assertNotIn("buyer_name", kept["link"]["link_receipt"])
        self.assertEqual(kept["link"]["link_receipt"]["product_id"], "26916762523")

    def test_accounts_do_not_share_links_health_missions_or_exports(self) -> None:
        self.link(account="shop-a", sub_id="tiktok|P1|a", affiliate_url=URL_A, content_id="a")
        self.link(account="shop-b", sub_id="tiktok|P1|a", affiliate_url=URL_B, content_id="a", sub_id_1="tiktok")
        only_a = self.store.find_links(WORKSPACE, account="shop-a")
        self.assertEqual(only_a["total"], 1)
        self.assertEqual(only_a["links"][0]["affiliate_url"], URL_A)
        exported = self.store.export_data(WORKSPACE, "links", account="shop-b")
        self.assertEqual(exported["count"], 1)
        self.assertEqual(exported["rows"][0]["affiliate_url"], URL_B)

        self.store.update_commission_health(WORKSPACE, "26916762523", 12.0, account="shop-a")
        self.store.update_commission_health(WORKSPACE, "26916762523", 4.0, account="shop-b")
        health = self.store.export_data(WORKSPACE, "commissions", account="shop-a")
        self.assertEqual(health["count"], 1)
        self.assertEqual(health["rows"][0]["commission_pct"], 12.0)

        self.store.record_offer(WORKSPACE, "26916762523", "Item", account="shop-a", price=100, rate_social=12, as_of="2026-10-01T00:00:00+00:00")
        self.store.record_offer(WORKSPACE, "26916762523", "Item", account="shop-a", price=100, rate_social=9, as_of="2026-10-02T00:00:00+00:00")
        self.store.record_offer(WORKSPACE, "26916762523", "Item", account="shop-b", price=100, rate_social=20, as_of="2026-10-02T00:00:00+00:00")
        blended = self.store.commission_health_from_snapshots(WORKSPACE)
        by_account = {row["account"]: row["new_rate"] for row in blended["results"]}
        self.assertEqual(by_account, {"shop-a": 9.0, "shop-b": 20.0})
        scoped = self.store.commission_health_from_snapshots(WORKSPACE, account="shop-a")
        self.assertEqual([row["account"] for row in scoped["results"]], ["shop-a"])

        self.store.enroll_mission(WORKSPACE, "m-1", "Mission", account="shop-a")
        self.store.enroll_mission(WORKSPACE, "m-1", "Mission", account="shop-b")
        self.assertEqual(self.store.list_missions(WORKSPACE, account="shop-a")["count"], 1)
        self.assertEqual(self.store.export_data(WORKSPACE, "missions", account="shop-b")["count"], 1)

        self.store.track_video_clip(WORKSPACE, "video-1", "คลิป", "observed", account="shop-a")
        self.store.track_video_clip(WORKSPACE, "video-1", "คลิปอื่น", "observed", account="shop-b")
        titles = {row["title"] for row in self.store.list_video_clips(WORKSPACE)["clips"]}
        self.assertEqual(titles, {"คลิป", "คลิปอื่น"})
        self.assertEqual(self.store.list_video_clips(WORKSPACE, account="shop-a")["clips"][0]["title"], "คลิป")

    def test_legacy_product_only_health_key_is_rebuilt_per_account(self) -> None:
        legacy = tempfile.TemporaryDirectory(prefix="shopkud-legacy-")
        self.addCleanup(legacy.cleanup)
        root = Path(legacy.name).resolve()
        os.chmod(root, 0o700)
        db_path = root / DB_FILENAME
        connection = sqlite3.connect(db_path)
        connection.execute(
            """CREATE TABLE commission_health (
                product_id TEXT PRIMARY KEY,
                workspace_id TEXT,
                last_check_at TEXT NOT NULL,
                last_commission_pct REAL NOT NULL,
                last_extra_comm INTEGER NOT NULL,
                status TEXT NOT NULL
            )"""
        )
        connection.execute(
            "INSERT INTO commission_health VALUES (?, ?, ?, ?, ?, ?)",
            ("26916762523", WORKSPACE, "2026-10-01T00:00:00+00:00", 8, 0, "healthy"),
        )
        connection.commit()
        connection.close()
        os.chmod(db_path, 0o600)
        store = CampaignStore(root)
        info = sqlite3.connect(store.db_path).execute("PRAGMA table_info(commission_health)").fetchall()
        primary = [name for ordinal, name in sorted((row[5], row[1]) for row in info if row[5])]
        self.assertEqual(primary, ["workspace_id", "account_id", "product_id"])
        store.update_commission_health(WORKSPACE, "26916762523", 3, account="shop-b")
        default_rows = store.export_data(WORKSPACE, "commissions")
        self.assertEqual(default_rows["count"], 2)

    def test_unchanged_earnings_balance_keeps_its_age(self) -> None:
        old = (datetime.now(timezone.utc) - timedelta(days=160)).isoformat(timespec="seconds")
        first = self.store.record_earnings(WORKSPACE, pending="10.00", validated="5.00", paid="1.00", kyc_status="verified", as_of=old)
        second = self.store.record_earnings(WORKSPACE, pending="10.00", validated="5.00", paid="2.00", kyc_status="verified")
        self.assertEqual(first["balance_since"], old)
        self.assertEqual(second["balance_since"], old)
        self.assertEqual(second["expiring"][0]["kind"], "six_month_window")
        changed = self.store.record_earnings(WORKSPACE, pending="1.00", validated="5.00", paid="2.00", kyc_status="verified")
        self.assertNotEqual(changed["balance_since"], old)


if __name__ == "__main__":
    unittest.main()
