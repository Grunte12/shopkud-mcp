"""Offline tests for the private campaign ledger and explicit CSV snapshots."""

from __future__ import annotations

import os
import sqlite3
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from shopkud_mcp.campaigns import CampaignError, CampaignStore


WORKSPACE = "a" * 32
SHOPEE_URL = "https://s.shopee.co.th/SyntheticFixtureA"


class CampaignStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="shopkud-campaigns-")
        self.root = Path(self.temp.name).resolve()
        os.chmod(self.root, 0o700)
        self.store = CampaignStore(self.root)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def link(self, **overrides: str):
        values = {
            "workspace_id": WORKSPACE,
            "channel": "TikTok",
            "marketplace": "shopee",
            "content_id": "video-1",
            "product_id": "product-1",
            "affiliate_url": SHOPEE_URL,
            "sub_id": "sub-001",
        }
        values.update(overrides)
        return self.store.set_link(**values)

    def import_args(self, csv_text: str, **overrides):
        values = {
            "workspace_id": WORKSPACE,
            "csv_text": csv_text,
            "mapping": {"sub_id": "SubID", "commission": "Commission"},
            "marketplace": "shopee",
            "period_start": "2026-09-01",
            "period_end": "2026-09-30",
        }
        values.update(overrides)
        return values

    def test_private_file_permissions_and_unsafe_database_paths(self) -> None:
        info = os.lstat(self.root / "campaigns.sqlite3")
        self.assertTrue(stat.S_ISREG(info.st_mode))
        self.assertEqual(stat.S_IMODE(info.st_mode), 0o600)
        self.assertEqual(info.st_uid, os.getuid())
        self.assertEqual(info.st_nlink, 1)

        os.chmod(self.root, 0o755)
        with self.assertRaises(CampaignError) as caught:
            self.store.get_links(WORKSPACE)
        self.assertEqual(caught.exception.code, "unsafe_directory")
        os.chmod(self.root, 0o700)

        alias = self.root / "alias"
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(CampaignError) as caught:
            CampaignStore(alias)
        self.assertEqual(caught.exception.code, "unsafe_directory")

    def test_database_symlink_and_hardlink_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="shopkud-campaign-alias-") as outside:
            other_root = Path(outside).resolve()
            os.chmod(other_root, 0o700)
            other_file = other_root / "private.db"
            other_file.write_bytes(b"do not open")
            os.chmod(other_file, 0o600)

            symlink_root = other_root / "symlink-root"
            symlink_root.mkdir(mode=0o700)
            os.chmod(symlink_root, 0o700)
            (symlink_root / "campaigns.sqlite3").symlink_to(other_file)
            with self.assertRaises(CampaignError) as caught:
                CampaignStore(symlink_root)
            self.assertEqual(caught.exception.code, "unsafe_database")

            hardlink_root = other_root / "hardlink-root"
            hardlink_root.mkdir(mode=0o700)
            os.chmod(hardlink_root, 0o700)
            hardlink = hardlink_root / "campaigns.sqlite3"
            os.link(other_file, hardlink)
            os.chmod(hardlink, 0o600)
            with self.assertRaises(CampaignError) as caught:
                CampaignStore(hardlink_root)
            self.assertEqual(caught.exception.code, "unsafe_database")

    def test_link_upsert_optimistic_version_collision_and_dynamic_thai_channel(self) -> None:
        created = self.link(channel="คลิปสั้น", expected_version=0)["link"]
        self.assertEqual(created["version"], 1)
        self.assertTrue(created["changed"])
        self.assertEqual(created["provenance"], "owner_provided_not_independently_verified")
        self.assertEqual(created["url_validation"], "format_only")

        unchanged = self.link(channel="คลิปสั้น", expected_version=1)["link"]
        self.assertFalse(unchanged["changed"])
        self.assertEqual(unchanged["version"], 1)

        updated = self.link(channel="คลิปสั้น", affiliate_url="https://s.shopee.co.th/NewLink",
                            expected_version=1)["link"]
        self.assertEqual(updated["version"], 2)
        self.assertEqual(updated["channel"], "คลิปสั้น")
        with self.assertRaises(CampaignError) as caught:
            self.link(channel="คลิปสั้น", expected_version=1)
        self.assertEqual(caught.exception.code, "version_conflict")

        with self.assertRaises(CampaignError) as caught:
            self.link(channel="Instagram", content_id="other-content", product_id="p2",
                      affiliate_url="https://s.shopee.co.th/NewLink", sub_id="sub-002")
        self.assertEqual(caught.exception.code, "duplicate_url")

        with self.assertRaises(CampaignError) as caught:
            self.link(channel="Instagram", content_id="other-content", product_id="p2",
                      affiliate_url="https://s.shopee.co.th/Different", sub_id="sub-001")
        self.assertEqual(caught.exception.code, "duplicate_sub_id")

    def test_unsafe_urls_and_undeclared_marketplaces_are_rejected(self) -> None:
        unsafe = [
            "http://s.shopee.co.th/a",
            "https://evil.example/a",
            "https://user@s.shopee.co.th/a",
            "https://localhost/a",
            "https://127.0.0.1/a",
            "https://s.shopee.co.th:443/a",
            "javascript:alert(1)",
            "https://s.shopee.co.th/",
        ]
        for url in unsafe:
            with self.subTest(url=url), self.assertRaises(CampaignError) as caught:
                self.link(affiliate_url=url)
            self.assertEqual(caught.exception.code, "unsafe_url")
        with self.assertRaises(CampaignError) as caught:
            self.link(marketplace="unknown_market")
        self.assertEqual(caught.exception.code, "unsupported_marketplace")
        with self.assertRaises(CampaignError) as caught:
            self.link(marketplace="tiktok_shop", affiliate_url="https://shop.tiktok.com/a")
        self.assertEqual(caught.exception.code, "unsafe_url")

    def test_csv_preview_bom_thai_headers_quoted_newlines_and_commit(self) -> None:
        self.link(channel="คลิปสั้น")
        data = (
            "\ufeffSubID,คอมมิชชัน,Clicks,Orders,Status,Note\r\n"
            'sub-001,10.25,0,2,DONE,"buyer note starts\ncontinues"\r\n'
            ",,,1,WAITING,\r\n"
        )
        mapping = {"sub_id": "SubID", "commission": "คอมมิชชัน", "clicks": "Clicks",
                   "orders": "Orders", "status": "Status"}
        status_map = {"DONE": "completed", "WAITING": "pending"}
        args = self.import_args(data, mapping=mapping, status_map=status_map, amount_state="confirmed")

        preview = self.store.import_csv(**args)
        self.assertFalse(preview["committed"])
        self.assertEqual(len(preview["digest"]), 64)
        self.assertEqual(preview["preview"]["rows_count"], 2)
        self.assertEqual(preview["preview"]["commission_total_thb"], "10.25")
        self.assertEqual(preview["preview"]["commission_by_amount_state"], {
            "confirmed": "10.25", "estimated": None, "paid": None,
        })
        self.assertEqual(preview["preview"]["clicks_total"], 0)
        self.assertEqual(preview["preview"]["status_counts"], {
            "pending": 1, "completed": 1, "cancelled": 0, "unknown": 0,
        })
        self.assertIsNone(self.store.get_report(WORKSPACE)["report"])

        with self.assertRaises(CampaignError) as caught:
            self.store.import_csv(**args, commit=True)
        self.assertEqual(caught.exception.code, "stale_preview")

        committed = self.store.import_csv(**args, commit=True, expected_digest=preview["digest"])
        self.assertTrue(committed["committed"])
        self.assertFalse(committed["duplicate"])
        self.assertEqual(committed["report"]["source_marketplace"], "shopee")
        self.assertEqual(committed["report"]["mapped_rows_count"], 1)
        self.assertEqual(committed["report"]["unmapped_rows_count"], 1)

        report = self.store.get_report(WORKSPACE)
        self.assertEqual(report["report"]["amount_state"], "confirmed")
        self.assertEqual(report["report"]["commission_total_thb"], "10.25")
        self.assertEqual(report["groups"][0]["channel"], "คลิปสั้น")
        self.assertEqual(report["groups"][0]["destination_marketplace"], "shopee")

    def test_mapping_changes_digest_and_stale_preview_cannot_commit(self) -> None:
        data = "SubID,Commission,Bonus\nunknown,1.00,0.50\n"
        preview = self.store.import_csv(**self.import_args(data))
        changed_mapping = {"sub_id": "SubID", "commission": "Bonus"}
        changed = self.store.import_csv(**self.import_args(data, mapping=changed_mapping))
        self.assertNotEqual(preview["digest"], changed["digest"])
        with self.assertRaises(CampaignError) as caught:
            self.store.import_csv(**self.import_args(data, mapping=changed_mapping), commit=True,
                                  expected_digest=preview["digest"])
        self.assertEqual(caught.exception.code, "stale_preview")
        accepted = self.store.import_csv(**self.import_args(data), commit=True,
                                         expected_digest=preview["digest"])
        self.assertTrue(accepted["committed"])

    def test_import_is_idempotent_and_does_not_persist_raw_csv_or_buyer_pii(self) -> None:
        self.link()
        email = "private-buyer@example.invalid"
        data = f"SubID,Commission,Buyer Email\nsub-001,12.00,{email}\n"
        args = self.import_args(data)
        preview = self.store.import_csv(**args)
        first = self.store.import_csv(**args, commit=True, expected_digest=preview["digest"])
        second_preview = self.store.import_csv(**args)
        second = self.store.import_csv(**args, commit=True,
                                       expected_digest=second_preview["digest"])
        self.assertTrue(second_preview["duplicate"])
        self.assertTrue(second["duplicate"])
        self.assertEqual(first["report"]["report_id"], second["report"]["report_id"])
        database = (self.root / "campaigns.sqlite3").read_bytes()
        self.assertNotIn(email.encode(), database)
        self.assertNotIn(data.encode(), database)

    def test_null_missing_money_counts_and_unknown_status_are_not_fabricated(self) -> None:
        data = "SubID,Commission,Clicks,Status\nmissing,,,mystery\n,0.00,0,\n"
        mapping = {"sub_id": "SubID", "commission": "Commission", "clicks": "Clicks",
                   "status": "Status"}
        preview = self.store.import_csv(**self.import_args(data, mapping=mapping))
        summary = preview["preview"]
        self.assertEqual(summary["rows_count"], 2)
        self.assertEqual(summary["unmapped_rows_count"], 2)
        self.assertEqual(summary["commission_total_thb"], "0.00")
        self.assertEqual(summary["commission_rows_count"], 1)
        self.assertEqual(summary["missing_commission_rows_count"], 1)
        self.assertEqual(summary["clicks_rows_count"], 1)
        self.assertEqual(summary["clicks_total"], 0)
        self.assertEqual(summary["status_counts"]["unknown"], 2)
        self.assertEqual(summary["commission_by_amount_state"]["paid"], None)
        self.assertIsNone(summary["orders_total"])
        self.assertEqual(str(CampaignError("stale_preview")), "stale_preview")

    def test_unknown_subids_are_unmapped_and_channel_is_not_source_marketplace(self) -> None:
        self.link(channel="TikTok Shop", content_id="tt-clip")
        data = "SubID,Commission\nsub-001,3.00\nnot-saved,2.00\n,\n"
        args = self.import_args(data, marketplace="tiktok_shop")
        preview = self.store.import_csv(**args)
        committed = self.store.import_csv(**args, commit=True, expected_digest=preview["digest"])
        report = self.store.get_report(WORKSPACE, committed["report"]["report_id"])
        self.assertEqual(report["report"]["source_marketplace"], "tiktok_shop")
        self.assertEqual(report["report"]["provenance"], "owner_provided_not_independently_verified")
        mapped = next(group for group in report["groups"] if not group["unmapped"])
        unmapped = next(group for group in report["groups"] if group["unmapped"])
        self.assertEqual(mapped["channel"], "TikTok Shop")
        self.assertEqual(mapped["destination_marketplace"], "shopee")
        self.assertEqual(mapped["commission_total_thb"], "3.00")
        self.assertEqual(unmapped["commission_total_thb"], "2.00")

    def test_default_report_reads_only_latest_snapshot_not_overlapping_periods(self) -> None:
        first_data = "SubID,Commission\nunknown,10.00\n"
        first_args = self.import_args(first_data)
        first_preview = self.store.import_csv(**first_args)
        first = self.store.import_csv(**first_args, commit=True,
                                      expected_digest=first_preview["digest"])

        second_data = "SubID,Commission\nunknown,4.00\n"
        second_args = self.import_args(second_data, period_start="2026-09-10", period_end="2026-10-01")
        second_preview = self.store.import_csv(**second_args)
        second = self.store.import_csv(**second_args, commit=True,
                                       expected_digest=second_preview["digest"])

        latest = self.store.get_report(WORKSPACE)
        self.assertEqual(latest["report"]["report_id"], second["report"]["report_id"])
        self.assertEqual(latest["report"]["commission_total_thb"], "4.00")
        older = self.store.get_report(WORKSPACE, first["report"]["report_id"])
        self.assertEqual(older["report"]["commission_total_thb"], "10.00")

    def test_content_grouping_keeps_same_content_separate_by_source_channel(self) -> None:
        self.link(channel="TikTok", content_id="same-video", product_id="tiktok-product",
                  affiliate_url="https://s.shopee.co.th/TikTokLink", sub_id="tt-sub")
        self.link(channel="Instagram", content_id="same-video", product_id="instagram-product",
                  affiliate_url="https://s.shopee.co.th/InstagramLink", sub_id="ig-sub")
        data = "SubID,Commission\ntt-sub,10\nig-sub,20\n"
        args = self.import_args(data)
        preview = self.store.import_csv(**args)
        committed = self.store.import_csv(**args, commit=True, expected_digest=preview["digest"])

        result = self.store.get_report(
            WORKSPACE, committed["report"]["report_id"], group_by="content"
        )
        self.assertEqual(result["total"], 2)
        self.assertEqual({group["channel"] for group in result["groups"]}, {"TikTok", "Instagram"})
        self.assertEqual({group["content_id"] for group in result["groups"]}, {"same-video"})
        self.assertEqual(
            {group["channel"]: group["commission_total_thb"] for group in result["groups"]},
            {"TikTok": "10", "Instagram": "20"},
        )

    def test_global_storage_caps_refuse_atomically_and_allow_existing_idempotent_report(self) -> None:
        first_args = self.import_args("SubID,Commission\nunmapped,1.00\n")
        first_preview = self.store.import_csv(**first_args)
        first = self.store.import_csv(
            **first_args, commit=True, expected_digest=first_preview["digest"]
        )
        first_id = first["report"]["report_id"]

        # Existing idempotent reads remain available at the global report cap.
        with patch("shopkud_mcp.campaigns.MAX_TOTAL_REPORTS", 1):
            repeated_preview = self.store.import_csv(**first_args)
            self.assertTrue(repeated_preview["duplicate"])
            repeated = self.store.import_csv(
                **first_args, commit=True, expected_digest=repeated_preview["digest"]
            )
            self.assertTrue(repeated["duplicate"])
            self.assertEqual(repeated["report"]["report_id"], first_id)
            second_args = self.import_args("SubID,Commission\nunmapped,2.00\n")
            second_preview = self.store.import_csv(**second_args)
            with self.assertRaises(CampaignError) as caught:
                self.store.import_csv(**second_args, commit=True,
                                      expected_digest=second_preview["digest"])
            self.assertEqual(caught.exception.code, "report_limit")

        # Group capacity and database byte capacity both reject without leaving
        # a report row or partial aggregate behind.
        group_limited_args = self.import_args("SubID,Commission\nunmapped,3.00\n")
        group_limited_preview = self.store.import_csv(**group_limited_args)
        with patch("shopkud_mcp.campaigns.MAX_TOTAL_REPORT_GROUPS", 1):
            duplicate_preview = self.store.import_csv(**first_args)
            duplicate = self.store.import_csv(
                **first_args, commit=True, expected_digest=duplicate_preview["digest"]
            )
            self.assertTrue(duplicate["duplicate"])
            with self.assertRaises(CampaignError) as caught:
                self.store.import_csv(**group_limited_args, commit=True,
                                      expected_digest=group_limited_preview["digest"])
            self.assertEqual(caught.exception.code, "storage_limit")

        db_size = (self.root / "campaigns.sqlite3").stat().st_size
        db_limited_args = self.import_args("SubID,Commission\nunmapped,4.00\n")
        db_limited_preview = self.store.import_csv(**db_limited_args)
        with patch("shopkud_mcp.campaigns.MAX_DATABASE_BYTES", db_size):
            duplicate_preview = self.store.import_csv(**first_args)
            duplicate = self.store.import_csv(
                **first_args, commit=True, expected_digest=duplicate_preview["digest"]
            )
            self.assertTrue(duplicate["duplicate"])
            with self.assertRaises(CampaignError) as caught:
                self.store.import_csv(**db_limited_args, commit=True,
                                      expected_digest=db_limited_preview["digest"])
            self.assertEqual(caught.exception.code, "storage_limit")

        connection = sqlite3.connect(self.root / "campaigns.sqlite3")
        try:
            self.assertEqual(connection.execute("SELECT count(*) FROM reports").fetchone()[0], 1)
            self.assertEqual(connection.execute("SELECT count(*) FROM report_groups").fetchone()[0], 1)
        finally:
            connection.close()
        self.assertEqual(self.store.get_report(WORKSPACE)["report"]["report_id"], first_id)

    def test_csv_limits_duplicate_headers_and_mapping_must_be_explicit(self) -> None:
        with self.assertRaises(CampaignError) as caught:
            self.store.import_csv(**self.import_args("SubID,subid,Commission\na,b,1\n"))
        self.assertEqual(caught.exception.code, "invalid_csv")
        with self.assertRaises(CampaignError) as caught:
            self.store.import_csv(**self.import_args("SubID,Commission\na,1\n",
                                                      mapping={"sub_id": "SubID", "commission": "Amount"}))
        self.assertEqual(caught.exception.code, "invalid_mapping")
        too_many_columns = ",".join([f"c{i}" for i in range(51)]) + "\n"
        with self.assertRaises(CampaignError) as caught:
            self.store.import_csv(**self.import_args(too_many_columns))
        self.assertEqual(caught.exception.code, "csv_too_many_columns")
        too_many_rows = "SubID,Commission\n" + "a,1\n" * 1_001
        with self.assertRaises(CampaignError) as caught:
            self.store.import_csv(**self.import_args(too_many_rows))
        self.assertEqual(caught.exception.code, "csv_too_many_rows")
        oversized = "x" * 200_001
        with self.assertRaises(CampaignError) as caught:
            self.store.import_csv(**self.import_args(oversized))
        self.assertEqual(caught.exception.code, "csv_too_large")

    def test_large_subid_mapping_lookup_is_chunked_below_sqlite_bind_limits(self) -> None:
        rows = "SubID,Commission\n" + "".join(f"unmapped-{index},1\n" for index in range(1_000))
        preview = self.store.import_csv(**self.import_args(rows))
        self.assertEqual(preview["preview"]["rows_count"], 1_000)
        self.assertEqual(preview["preview"]["unmapped_rows_count"], 1_000)
        self.assertEqual(preview["preview"]["commission_total_thb"], "1000")

    def test_link_and_report_pagination_are_bounded(self) -> None:
        self.link()
        result = self.store.get_links(WORKSPACE, limit=1, offset=0)
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["links"][0]["sub_id"], "sub-001")
        with self.assertRaises(CampaignError) as caught:
            self.store.get_links(WORKSPACE, limit=101)
        self.assertEqual(caught.exception.code, "invalid_request")
        with self.assertRaises(CampaignError) as caught:
            self.store.get_report(WORKSPACE, offset=100_001)
        self.assertEqual(caught.exception.code, "invalid_request")


if __name__ == "__main__":
    unittest.main()
