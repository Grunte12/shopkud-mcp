"""Test missions tracking (P1-5)."""

import tempfile
import unittest
import os
from pathlib import Path

from shopkud_mcp.campaigns import CampaignStore


class TestMissions(unittest.TestCase):
    """Test mission/campaign tracking."""

    def setUp(self):
        self.tempdir = Path(tempfile.mkdtemp()).resolve()
        os.chmod(self.tempdir, 0o700)
        self.store = CampaignStore(self.tempdir)
        self.workspace_id = "0123456789abcdef" * 2

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tempdir, ignore_errors=True)

    def test_enroll_mission(self):
        """Test enrolling in a mission."""
        result = self.store.enroll_mission(
            workspace_id=self.workspace_id,
            mission_id="mission_001",
            name="Post 3 videos about Product X",
            reward="500 THB bonus",
            requirements={"posts": 3, "min_sales": 1000},
            deadline="2024-12-31T23:59:59+00:00",
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["mission_id"], "mission_001")
        self.assertTrue(result["enrolled"])

    def test_list_enrolled_missions(self):
        """Test listing enrolled missions."""
        # Enroll in missions
        self.store.enroll_mission(
            workspace_id=self.workspace_id,
            mission_id="mission_001",
            name="Mission 1",
            requirements={"posts": 3},
        )

        self.store.enroll_mission(
            workspace_id=self.workspace_id,
            mission_id="mission_002",
            name="Mission 2",
            requirements={"sales": 5000},
        )

        # List enrolled
        result = self.store.list_missions(
            workspace_id=self.workspace_id,
            status="enrolled",
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["count"], 2)
        mission_ids = {m["mission_id"] for m in result["missions"]}
        self.assertEqual(mission_ids, {"mission_001", "mission_002"})

    def test_update_mission_progress(self):
        """Test updating mission progress."""
        # Enroll first
        self.store.enroll_mission(
            workspace_id=self.workspace_id,
            mission_id="mission_001",
            name="Mission 1",
            requirements={"posts": 3, "sales": 1000},
        )

        # Update progress
        result = self.store.update_mission_progress(
            workspace_id=self.workspace_id,
            mission_id="mission_001",
            progress={"posts": 2, "sales": 750},
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["progress"]["posts"], 2)
        self.assertEqual(result["progress"]["sales"], 750)
        self.assertFalse(result["completed"])

    def test_complete_mission(self):
        """Test marking mission as completed."""
        # Enroll
        self.store.enroll_mission(
            workspace_id=self.workspace_id,
            mission_id="mission_001",
            name="Mission 1",
            requirements={"posts": 3},
        )

        # Complete
        result = self.store.update_mission_progress(
            workspace_id=self.workspace_id,
            mission_id="mission_001",
            progress={"posts": 3},
            completed=True,
        )

        self.assertTrue(result["ok"])
        self.assertTrue(result["completed"])

        # Check it appears in completed list
        completed = self.store.list_missions(
            workspace_id=self.workspace_id,
            status="completed",
        )

        self.assertEqual(completed["count"], 1)
        self.assertEqual(completed["missions"][0]["mission_id"], "mission_001")

    def test_double_enrollment_idempotent(self):
        """Test that enrolling twice in same mission is idempotent."""
        # First enrollment
        result1 = self.store.enroll_mission(
            workspace_id=self.workspace_id,
            mission_id="mission_001",
            name="Mission 1",
            requirements={"posts": 3},
        )

        # Second enrollment
        result2 = self.store.enroll_mission(
            workspace_id=self.workspace_id,
            mission_id="mission_001",
            name="Mission 1",
            requirements={"posts": 3},
        )

        self.assertTrue(result2["ok"])
        self.assertTrue(result2.get("already_enrolled", False))

    def test_update_unenrolled_mission_fails(self):
        """Test that updating progress for unenrolled mission fails."""
        with self.assertRaises(Exception):  # CampaignError
            self.store.update_mission_progress(
                workspace_id=self.workspace_id,
                mission_id="mission_999",
                progress={"posts": 1},
            )


if __name__ == "__main__":
    unittest.main()
