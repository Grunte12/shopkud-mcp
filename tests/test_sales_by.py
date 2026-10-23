"""Test SubID-based sales attribution queries (P0-6)."""

import json
import os
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from shopkud_mcp.campaigns import CampaignStore


class TestSalesByAttribution(unittest.TestCase):
    """Test sales_by dimension queries for SubID-based attribution."""

    def setUp(self):
        self.tempdir = Path(tempfile.mkdtemp()).resolve()
        os.chmod(self.tempdir, 0o700)
        self.store = CampaignStore(self.tempdir)
        self.workspace_id = "0123456789abcdef" * 2

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tempdir, ignore_errors=True)

    def test_sales_by_platform(self):
        """Test sales attribution by platform (sub_id_1)."""
        # Create links with different platforms
        self.store.set_link(
            workspace_id=self.workspace_id,
            channel="tiktok",
            marketplace="shopee",
            content_id="content1",
            product_id="12345",
            affiliate_url="https://s.shopee.co.th/abc123",
            sub_id="tiktok|P1|v1",
            sub_id_1="tiktok",
            sub_id_2="P1",
            sub_id_3="v1",
        )

        self.store.set_link(
            workspace_id=self.workspace_id,
            channel="instagram",
            marketplace="shopee",
            content_id="content2",
            product_id="12346",
            affiliate_url="https://s.shopee.co.th/def456",
            sub_id="ig|P1|v2",
            sub_id_1="ig",
            sub_id_2="P1",
            sub_id_3="v2",
        )

        # Import a report with data for these links
        csv_data = """รหัส Sub ID,คลิก,รายการสั่งซื้อ,ค่าคอมมิชชั่น (บาท)
tiktok|P1|v1,100,5,250.50
ig|P1|v2,80,3,150.75"""

        mapping = {
            "sub_id": "รหัส Sub ID",
            "clicks": "คลิก",
            "orders": "รายการสั่งซื้อ",
            "commission": "ค่าคอมมิชชั่น (บาท)",
        }

        # Preview and commit the report
        preview = self.store.import_csv(
            workspace_id=self.workspace_id,
            csv_text=csv_data,
            mapping=mapping,
            marketplace="shopee",
            period_start="2024-10-01",
            period_end="2024-10-02",
            amount_state="estimated",
            commit=False,
        )
        self.assertTrue(preview["ok"])

        result = self.store.import_csv(
            workspace_id=self.workspace_id,
            csv_text=csv_data,
            mapping=mapping,
            marketplace="shopee",
            period_start="2024-10-01",
            period_end="2024-10-02",
            amount_state="estimated",
            commit=True,
            expected_digest=preview["digest"],
        )
        self.assertTrue(result["ok"])

        # Query by platform dimension
        sales = self.store.sales_by(
            workspace_id=self.workspace_id,
            dimension="platform",
        )

        self.assertTrue(sales["ok"])
        self.assertEqual(sales["dimension"], "platform")
        self.assertEqual(len(sales["results"]), 2)

        # Should be sorted by commission descending
        self.assertEqual(sales["results"][0]["platform"], "tiktok")
        self.assertEqual(sales["results"][0]["clicks"], 100)
        self.assertEqual(sales["results"][0]["orders"], 5)
        self.assertEqual(Decimal(sales["results"][0]["commission_thb"]), Decimal("250.50"))

        self.assertEqual(sales["results"][1]["platform"], "ig")
        self.assertEqual(sales["results"][1]["clicks"], 80)
        self.assertEqual(sales["results"][1]["orders"], 3)
        self.assertEqual(Decimal(sales["results"][1]["commission_thb"]), Decimal("150.75"))

        # Check summary
        self.assertEqual(Decimal(sales["summary"]["total_commission_thb"]), Decimal("401.25"))
        self.assertEqual(sales["summary"]["total_clicks"], 180)
        self.assertEqual(sales["summary"]["total_orders"], 8)
        self.assertEqual(sales["summary"]["dimension_values_count"], 2)

    def test_sales_by_product(self):
        """Test sales attribution by product (sub_id_2)."""
        # Create links with different products
        self.store.set_link(
            workspace_id=self.workspace_id,
            channel="tiktok",
            marketplace="shopee",
            content_id="content1",
            product_id="12345",
            affiliate_url="https://s.shopee.co.th/abc123",
            sub_id="tiktok|P1|v1",
            sub_id_1="tiktok",
            sub_id_2="P1",
            sub_id_3="v1",
        )

        self.store.set_link(
            workspace_id=self.workspace_id,
            channel="tiktok",
            marketplace="shopee",
            content_id="content2",
            product_id="12346",
            affiliate_url="https://s.shopee.co.th/def456",
            sub_id="tiktok|P2|v1",
            sub_id_1="tiktok",
            sub_id_2="P2",
            sub_id_3="v1",
        )

        csv_data = """รหัส Sub ID,คลิก,รายการสั่งซื้อ,ค่าคอมมิชชั่น (บาท)
tiktok|P1|v1,100,5,250.50
tiktok|P2|v1,80,3,150.75"""

        mapping = {
            "sub_id": "รหัส Sub ID",
            "clicks": "คลิก",
            "orders": "รายการสั่งซื้อ",
            "commission": "ค่าคอมมิชชั่น (บาท)",
        }

        preview = self.store.import_csv(
            workspace_id=self.workspace_id,
            csv_text=csv_data,
            mapping=mapping,
            marketplace="shopee",
            period_start="2024-10-01",
            period_end="2024-10-02",
            amount_state="estimated",
            commit=False,
        )

        self.store.import_csv(
            workspace_id=self.workspace_id,
            csv_text=csv_data,
            mapping=mapping,
            marketplace="shopee",
            period_start="2024-10-01",
            period_end="2024-10-02",
            amount_state="estimated",
            commit=True,
            expected_digest=preview["digest"],
        )

        # Query by product dimension
        sales = self.store.sales_by(
            workspace_id=self.workspace_id,
            dimension="product",
        )

        self.assertTrue(sales["ok"])
        self.assertEqual(sales["dimension"], "product")
        self.assertEqual(len(sales["results"]), 2)
        self.assertEqual(sales["results"][0]["product"], "P1")
        self.assertEqual(sales["results"][1]["product"], "P2")

    def test_sales_by_with_period_filter(self):
        """Test sales attribution with period filters."""
        self.store.set_link(
            workspace_id=self.workspace_id,
            channel="tiktok",
            marketplace="shopee",
            content_id="content1",
            product_id="12345",
            affiliate_url="https://s.shopee.co.th/abc123",
            sub_id="tiktok|P1|v1",
            sub_id_1="tiktok",
            sub_id_2="P1",
            sub_id_3="v1",
        )

        # Import two reports with different periods
        csv1 = """รหัส Sub ID,คลิก,รายการสั่งซื้อ,ค่าคอมมิชชั่น (บาท)
tiktok|P1|v1,100,5,250.50"""

        csv2 = """รหัส Sub ID,คลิก,รายการสั่งซื้อ,ค่าคอมมิชชั่น (บาท)
tiktok|P1|v1,50,2,100.25"""

        mapping = {
            "sub_id": "รหัส Sub ID",
            "clicks": "คลิก",
            "orders": "รายการสั่งซื้อ",
            "commission": "ค่าคอมมิชชั่น (บาท)",
        }

        # Import October report
        p1 = self.store.import_csv(
            workspace_id=self.workspace_id,
            csv_text=csv1,
            mapping=mapping,
            marketplace="shopee",
            period_start="2024-10-01",
            period_end="2024-10-31",
            amount_state="estimated",
            commit=False,
        )

        self.store.import_csv(
            workspace_id=self.workspace_id,
            csv_text=csv1,
            mapping=mapping,
            marketplace="shopee",
            period_start="2024-10-01",
            period_end="2024-10-31",
            amount_state="estimated",
            commit=True,
            expected_digest=p1["digest"],
        )

        # Import November report with different idempotency key
        p2 = self.store.import_csv(
            workspace_id=self.workspace_id,
            csv_text=csv2,
            mapping=mapping,
            marketplace="shopee",
            period_start="2024-11-01",
            period_end="2024-11-30",
            amount_state="estimated",
            commit=False,
        )

        self.store.import_csv(
            workspace_id=self.workspace_id,
            csv_text=csv2,
            mapping=mapping,
            marketplace="shopee",
            period_start="2024-11-01",
            period_end="2024-11-30",
            amount_state="estimated",
            commit=True,
            expected_digest=p2["digest"],
        )

        # Query all periods
        all_sales = self.store.sales_by(
            workspace_id=self.workspace_id,
            dimension="platform",
        )
        self.assertEqual(Decimal(all_sales["summary"]["total_commission_thb"]), Decimal("350.75"))

        # Query only October
        oct_sales = self.store.sales_by(
            workspace_id=self.workspace_id,
            dimension="platform",
            period_start="2024-10-01",
            period_end="2024-10-31",
        )
        self.assertEqual(Decimal(oct_sales["summary"]["total_commission_thb"]), Decimal("250.50"))

        # Query only November
        nov_sales = self.store.sales_by(
            workspace_id=self.workspace_id,
            dimension="platform",
            period_start="2024-11-01",
            period_end="2024-11-30",
        )
        self.assertEqual(Decimal(nov_sales["summary"]["total_commission_thb"]), Decimal("100.25"))

    def test_sales_by_invalid_dimension(self):
        """Test that invalid dimension returns error."""
        with self.assertRaises(Exception):  # CampaignError
            self.store.sales_by(
                workspace_id=self.workspace_id,
                dimension="invalid",
            )

    def test_sales_by_empty_workspace(self):
        """Test sales_by on workspace with no reports returns empty results."""
        sales = self.store.sales_by(
            workspace_id=self.workspace_id,
            dimension="platform",
        )
        self.assertTrue(sales["ok"])
        self.assertEqual(len(sales["results"]), 0)
        self.assertEqual(Decimal(sales["summary"]["total_commission_thb"]), Decimal("0"))


if __name__ == "__main__":
    unittest.main()
