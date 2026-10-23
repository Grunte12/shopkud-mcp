"""Test commission health monitoring (P1-1)."""

import tempfile
import unittest
import os
from pathlib import Path

from shopkud_mcp.campaigns import CampaignStore


class TestCommissionHealth(unittest.TestCase):
    """Test commission health tracking and alerts."""

    def setUp(self):
        self.tempdir = Path(tempfile.mkdtemp()).resolve()
        os.chmod(self.tempdir, 0o700)
        self.store = CampaignStore(self.tempdir)
        self.workspace_id = "0123456789abcdef" * 2

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tempdir, ignore_errors=True)

    def test_first_observation_creates_healthy_record(self):
        """Test that first commission observation creates healthy record."""
        result = self.store.update_commission_health(
            workspace_id=self.workspace_id,
            product_id="12345",
            commission_pct=8.5,
            extra_comm=0,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["product_id"], "12345")
        self.assertEqual(result["commission_pct"], 8.5)
        self.assertEqual(result["status"], "healthy")
        self.assertFalse(result["change_detected"])

    def test_commission_drop_detected(self):
        """Test that commission rate drop is detected."""
        # First observation
        self.store.update_commission_health(
            workspace_id=self.workspace_id,
            product_id="12345",
            commission_pct=8.5,
        )

        # Rate drops
        result = self.store.update_commission_health(
            workspace_id=self.workspace_id,
            product_id="12345",
            commission_pct=5.0,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], "dropped")
        self.assertTrue(result["change_detected"])

    def test_commission_removal_detected(self):
        """Test that commission removal (0%) is detected."""
        # First observation
        self.store.update_commission_health(
            workspace_id=self.workspace_id,
            product_id="12345",
            commission_pct=8.5,
        )

        # Commission removed
        result = self.store.update_commission_health(
            workspace_id=self.workspace_id,
            product_id="12345",
            commission_pct=0,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], "removed")
        self.assertTrue(result["change_detected"])

    def test_commission_increase_detected(self):
        """Test that commission rate increase is detected."""
        # First observation
        self.store.update_commission_health(
            workspace_id=self.workspace_id,
            product_id="12345",
            commission_pct=5.0,
        )

        # Rate increases
        result = self.store.update_commission_health(
            workspace_id=self.workspace_id,
            product_id="12345",
            commission_pct=8.5,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], "increased")
        self.assertTrue(result["change_detected"])

    def test_unchanged_commission_stays_healthy(self):
        """Test that unchanged commission keeps healthy status."""
        # First observation
        self.store.update_commission_health(
            workspace_id=self.workspace_id,
            product_id="12345",
            commission_pct=8.5,
        )

        # Same rate
        result = self.store.update_commission_health(
            workspace_id=self.workspace_id,
            product_id="12345",
            commission_pct=8.5,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], "healthy")
        self.assertFalse(result["change_detected"])

    def test_check_commission_health_returns_alerts(self):
        """Test that check_commission_health returns alerts for problems."""
        # Track multiple products
        self.store.update_commission_health(
            workspace_id=self.workspace_id,
            product_id="12345",
            commission_pct=8.5,
        )

        self.store.update_commission_health(
            workspace_id=self.workspace_id,
            product_id="12346",
            commission_pct=6.0,
        )

        # Create alerts by dropping/removing rates
        self.store.update_commission_health(
            workspace_id=self.workspace_id,
            product_id="12345",
            commission_pct=3.0,  # Drop
        )

        self.store.update_commission_health(
            workspace_id=self.workspace_id,
            product_id="12346",
            commission_pct=0,  # Remove
        )

        # Check health
        health = self.store.check_commission_health(
            workspace_id=self.workspace_id,
        )

        self.assertTrue(health["ok"])
        self.assertEqual(health["checked_count"], 2)
        self.assertEqual(health["alert_count"], 2)

        # Verify alerts
        alerts = {alert["product_id"]: alert for alert in health["alerts"]}
        self.assertEqual(alerts["12345"]["alert_type"], "dropped")
        self.assertEqual(alerts["12346"]["alert_type"], "removed")

    def test_check_specific_products(self):
        """Test checking health for specific product list."""
        # Track multiple products
        for i in range(5):
            self.store.update_commission_health(
                workspace_id=self.workspace_id,
                product_id=f"1234{i}",
                commission_pct=8.5,
            )

        # Check only two products
        health = self.store.check_commission_health(
            workspace_id=self.workspace_id,
            product_ids=["12340", "12341"],
        )

        self.assertTrue(health["ok"])
        self.assertEqual(health["checked_count"], 2)

        product_ids = {p["product_id"] for p in health["products"]}
        self.assertEqual(product_ids, {"12340", "12341"})

    def test_extra_commission_tracked(self):
        """Test that extra commission is tracked."""
        result = self.store.update_commission_health(
            workspace_id=self.workspace_id,
            product_id="12345",
            commission_pct=8.5,
            extra_comm=2,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["extra_comm"], 2)

        # Check it's stored
        health = self.store.check_commission_health(
            workspace_id=self.workspace_id,
            product_ids=["12345"],
        )

        self.assertEqual(health["products"][0]["extra_comm"], 2)


if __name__ == "__main__":
    unittest.main()
