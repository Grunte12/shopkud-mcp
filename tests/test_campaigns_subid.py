"""Tests for campaign store with 5 SubIDs and new features."""
import json
import os
import tempfile
import unittest
from pathlib import Path

from shopkud_mcp.campaigns import CampaignError, CampaignStore


class TestCampaignStoreSubIds(unittest.TestCase):
    """Test campaign store with 5 SubID fields."""

    def setUp(self):
        """Create a temporary directory for test database."""
        self.test_dir = tempfile.mkdtemp()
        os.chmod(self.test_dir, 0o700)
        self.store = CampaignStore(self.test_dir)

    def tearDown(self):
        """Clean up test directory."""
        import shutil
        if os.path.exists(self.test_dir):
            shutil.rmtree(self.test_dir)

    def test_set_link_with_5_subids(self):
        """Test setting a link with all 5 SubID fields."""
        result = self.store.set_link(
            workspace_id="a" * 32,
            channel="tiktok",
            marketplace="shopee",
            content_id="video1",
            product_id="123456",
            affiliate_url="https://s.shopee.co.th/abc123",
            sub_id="tiktok_P1_v6_a_202610",
            sub_id_1="tiktok",
            sub_id_2="P1",
            sub_id_3="v6",
            sub_id_4="a",
            sub_id_5="202610",
            clip_id="clip1",
            link_source="extension_subid_creation",
        )

        self.assertTrue(result["ok"])
        self.assertTrue(result["link"]["changed"])
        self.assertEqual(result["link"]["sub_id"], "tiktok_P1_v6_a_202610")
        self.assertEqual(result["link"]["sub_id_1"], "tiktok")
        self.assertEqual(result["link"]["sub_id_2"], "P1")
        self.assertEqual(result["link"]["sub_id_3"], "v6")
        self.assertEqual(result["link"]["sub_id_4"], "a")
        self.assertEqual(result["link"]["sub_id_5"], "202610")
        self.assertEqual(result["link"]["clip_id"], "clip1")
        self.assertEqual(result["link"]["link_source"], "extension_subid_creation")

    def test_set_link_with_partial_subids(self):
        """Test setting a link with only some SubID fields filled."""
        result = self.store.set_link(
            workspace_id="b" * 32,
            channel="instagram",
            marketplace="shopee",
            content_id="post1",
            product_id="789",
            affiliate_url="https://s.shopee.co.th/xyz789",
            sub_id="ig_P2",
            sub_id_1="instagram",
            sub_id_2="P2",
            # sub_id_3, 4, 5 are None
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["link"]["sub_id_1"], "instagram")
        self.assertEqual(result["link"]["sub_id_2"], "P2")
        self.assertNotIn("sub_id_3", result["link"])
        self.assertNotIn("sub_id_4", result["link"])
        self.assertNotIn("sub_id_5", result["link"])

    def test_set_link_with_receipt(self):
        """Test setting a link with a creation receipt."""
        receipt = {
            "created_at": "2024-10-16T12:00:00Z",
            "product_id": "123456",
            "affiliate_url": "https://s.shopee.co.th/def456",
            "status": "confirmed",
            "product_attested": True,
            "dialog_detection_method": "specific_selector",
            "sub_id_slots": [1, 2],
        }

        result = self.store.set_link(
            workspace_id="c" * 32,
            channel="facebook",
            marketplace="shopee",
            content_id="post2",
            product_id="123456",
            affiliate_url="https://s.shopee.co.th/def456",
            sub_id="fb_P3",
            sub_id_1="facebook",
            sub_id_2="P3",
            link_source="extension_subid_creation",
            link_receipt=receipt,
        )

        self.assertTrue(result["ok"])
        self.assertIn("link_receipt", result["link"])
        self.assertEqual(result["link"]["link_receipt"]["product_id"], "123456")
        self.assertNotIn("button_text", result["link"]["link_receipt"])
        with self.assertRaises(CampaignError) as caught:
            self.store.set_link(
                workspace_id="c" * 32,
                channel="facebook",
                marketplace="shopee",
                content_id="post2",
                product_id="123456",
                affiliate_url="https://s.shopee.co.th/def456",
                sub_id="fb_P3",
                link_receipt={"order_id": "ORD-12345"},
            )
        self.assertEqual(caught.exception.code, "pii_rejected")
        self.assertNotIn("ORD-12345", str(caught.exception))

    def test_find_links_by_product(self):
        """Test finding links by product_id."""
        workspace_id = "d" * 32

        # Create multiple links
        self.store.set_link(
            workspace_id=workspace_id,
            channel="tiktok",
            marketplace="shopee",
            content_id="v1",
            product_id="P1",
            affiliate_url="https://s.shopee.co.th/aaa",
            sub_id="tk1",
            sub_id_1="tiktok",
            sub_id_2="P1",
        )

        self.store.set_link(
            workspace_id=workspace_id,
            channel="instagram",
            marketplace="shopee",
            content_id="v1",
            product_id="P1",
            affiliate_url="https://s.shopee.co.th/bbb",
            sub_id="ig1",
            sub_id_1="instagram",
            sub_id_2="P1",
        )

        self.store.set_link(
            workspace_id=workspace_id,
            channel="tiktok",
            marketplace="shopee",
            content_id="v2",
            product_id="P2",
            affiliate_url="https://s.shopee.co.th/ccc",
            sub_id="tk2",
            sub_id_1="tiktok",
            sub_id_2="P2",
        )

        # Find by product_id
        result = self.store.find_links(workspace_id, product_id="P1")
        self.assertTrue(result["ok"])
        self.assertEqual(result["total"], 2)
        self.assertEqual(len(result["links"]), 2)

        # Verify both are for P1
        for link in result["links"]:
            self.assertEqual(link["product_id"], "P1")

    def test_find_links_by_channel(self):
        """Test finding links by channel."""
        workspace_id = "e" * 32

        # Create links for different channels
        self.store.set_link(
            workspace_id=workspace_id,
            channel="tiktok",
            marketplace="shopee",
            content_id="v1",
            product_id="P1",
            affiliate_url="https://s.shopee.co.th/aaa",
            sub_id="tk1",
        )

        self.store.set_link(
            workspace_id=workspace_id,
            channel="tiktok",
            marketplace="shopee",
            content_id="v2",
            product_id="P2",
            affiliate_url="https://s.shopee.co.th/bbb",
            sub_id="tk2",
        )

        self.store.set_link(
            workspace_id=workspace_id,
            channel="instagram",
            marketplace="shopee",
            content_id="p1",
            product_id="P1",
            affiliate_url="https://s.shopee.co.th/ccc",
            sub_id="ig1",
        )

        # Find by channel
        result = self.store.find_links(workspace_id, channel="tiktok")
        self.assertTrue(result["ok"])
        self.assertEqual(result["total"], 2)

        for link in result["links"]:
            self.assertEqual(link["channel"], "tiktok")

    def test_find_links_by_clip(self):
        """Test finding links by clip_id."""
        workspace_id = "f" * 32

        self.store.set_link(
            workspace_id=workspace_id,
            channel="tiktok",
            marketplace="shopee",
            content_id="v1",
            product_id="P1",
            affiliate_url="https://s.shopee.co.th/aaa",
            sub_id="tk1",
            clip_id="clip_v6",
        )

        self.store.set_link(
            workspace_id=workspace_id,
            channel="instagram",
            marketplace="shopee",
            content_id="p1",
            product_id="P1",
            affiliate_url="https://s.shopee.co.th/bbb",
            sub_id="ig1",
            clip_id="clip_v6",
        )

        self.store.set_link(
            workspace_id=workspace_id,
            channel="tiktok",
            marketplace="shopee",
            content_id="v2",
            product_id="P2",
            affiliate_url="https://s.shopee.co.th/ccc",
            sub_id="tk2",
            clip_id="clip_v7",
        )

        # Find by clip_id
        result = self.store.find_links(workspace_id, clip_id="clip_v6")
        self.assertTrue(result["ok"])
        self.assertEqual(result["total"], 2)

        for link in result["links"]:
            self.assertEqual(link["clip_id"], "clip_v6")

    def test_find_links_combined_filters(self):
        """Test finding links with multiple filters."""
        workspace_id = "0123456789abcdef" * 2  # 32 hex chars

        # Create several links
        for i in range(5):
            self.store.set_link(
                workspace_id=workspace_id,
                channel="tiktok" if i < 3 else "instagram",
                marketplace="shopee",
                content_id=f"v{i}",
                product_id="P1" if i < 2 else "P2",
                affiliate_url=f"https://s.shopee.co.th/link{i}",
                sub_id=f"sub{i}",
                clip_id="clip_v6" if i < 2 else "clip_v7",
            )

        # Find tiktok + P1
        result = self.store.find_links(workspace_id, product_id="P1", channel="tiktok")
        self.assertTrue(result["ok"])
        self.assertEqual(result["total"], 2)

        # Find clip_v6 + P1
        result = self.store.find_links(workspace_id, product_id="P1", clip_id="clip_v6")
        self.assertTrue(result["ok"])
        self.assertEqual(result["total"], 2)

    def test_link_versioning(self):
        """Test that link versions increment correctly."""
        workspace_id = "fedcba9876543210" * 2  # 32 hex chars

        # Create initial link
        result1 = self.store.set_link(
            workspace_id=workspace_id,
            channel="tiktok",
            marketplace="shopee",
            content_id="v1",
            product_id="P1",
            affiliate_url="https://s.shopee.co.th/aaa",
            sub_id="tk1",
            sub_id_1="tiktok",
        )

        self.assertEqual(result1["link"]["version"], 1)

        # Update with different SubID
        result2 = self.store.set_link(
            workspace_id=workspace_id,
            channel="tiktok",
            marketplace="shopee",
            content_id="v1",
            product_id="P1",
            affiliate_url="https://s.shopee.co.th/bbb",  # Different URL
            sub_id="tk2",  # Different SubID
            sub_id_1="tiktok",
        )

        self.assertEqual(result2["link"]["version"], 2)
        self.assertTrue(result2["link"]["changed"])

        # Update with same data (no change)
        result3 = self.store.set_link(
            workspace_id=workspace_id,
            channel="tiktok",
            marketplace="shopee",
            content_id="v1",
            product_id="P1",
            affiliate_url="https://s.shopee.co.th/bbb",
            sub_id="tk2",
            sub_id_1="tiktok",
        )

        self.assertEqual(result3["link"]["version"], 2)  # Same version
        self.assertFalse(result3["link"]["changed"])


if __name__ == "__main__":
    unittest.main()
