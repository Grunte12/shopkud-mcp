import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import unittest

import shopkud_mcp.workspace as workspace_module
from shopkud_mcp.workspace import AnalysisStore


def product(product_id="101", commission_pct=7, extra_comm=False, **fields):
    return {
        "product_id": product_id,
        "name": f"Fixture {product_id}",
        "product_url": f"https://affiliate.shopee.co.th/offer/product_offer/{product_id}",
        "price_min_thb": 100,
        "price_max_thb": 100,
        "commission_pct": commission_pct,
        "baht_per_order": 7,
        "sold": 10,
        "mall": False,
        "extra_comm": extra_comm,
        **fields,
    }


class AnalysisStoreTests(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix="shopkud-workspace-"))
        self.root = self.base / "private"
        self.root.mkdir(mode=0o700)
        self.root.chmod(0o700)
        self.store = AnalysisStore(self.root)

    def tearDown(self):
        shutil.rmtree(self.base)

    def test_observed_cache_persists_and_reads_multi_id_subsets_in_requested_order(self):
        records = [product("101"), product("102", commission_pct=9), product("103")]
        result = self.store.observe(records, "2026-01-02T03:04:05Z")
        self.assertTrue(result["ok"])
        self.assertEqual(result["timestamp_source"], "source_observed_at")

        reopened = AnalysisStore(self.root)
        page = reopened.get_workspace(view="products", product_ids=["103", "101"], limit=1)
        self.assertTrue(page["ok"])
        self.assertEqual([item["product_id"] for item in page["records"]], ["103"])
        self.assertEqual(page["records"][0], records[2])
        self.assertEqual(page["observations"][0], {
            "product_id": "103", "observed_at": "2026-01-02T03:04:05Z",
            "timestamp_source": "source_observed_at",
        })
        self.assertEqual(page["next_offset"], 1)
        next_page = reopened.get_workspace(view="products", product_ids=["103", "101"], limit=1, offset=1)
        self.assertEqual([item["product_id"] for item in next_page["records"]], ["101"])
        self.assertFalse(page["selection_snapshot"])
        self.assertTrue(page["requires_fresh_page_snapshot_before_selection"])
        self.assertFalse(page["reusable_apply_authority"])

    def test_commission_history_tracks_only_changes_and_rejects_stale_observations(self):
        first = product("201", commission_pct=5, extra_comm=False)
        same = product("201", commission_pct=5, extra_comm=False, name="Renamed from live page")
        changed = product("201", commission_pct=8, extra_comm=True)
        self.assertEqual(self.store.observe([first], "2026-01-01T00:00:00Z")["initial_rate_states"], 1)
        repeated = self.store.observe([same], "2026-01-02T00:00:00Z")
        self.assertEqual(repeated["rate_changes"], 0)
        self.assertEqual(self.store.observe([changed], "2026-01-03T00:00:00Z")["rate_changes"], 1)

        stale = self.store.observe([product("201", commission_pct=2)], "2026-01-01T12:00:00Z")
        self.assertEqual(stale["stale"], 1)
        self.assertEqual(stale["updated"], 0)
        latest = self.store.get_workspace(view="products", product_ids=["201"])
        self.assertEqual(latest["records"][0]["commission_pct"], 8)
        history = self.store.get_workspace(view="history", product_ids=["201"])
        self.assertEqual(history["total"], 2)
        self.assertEqual([row["commission_pct"] for row in history["history"]], [8, 5])
        self.assertEqual(history["history"][0]["observed_at"], "2026-01-03T00:00:00Z")
        self.assertIn("not paid or locked rates", history["history_semantics"])
        self.assertTrue(history["history_incomplete"])
        self.assertEqual(history["history_coverage"], "opt_in_observations_only")
        self.assertEqual(history["retention_pruned_count"], 0)
        self.assertTrue(history["retention_pruned_count_complete"])
        self.assertFalse(history["page_truncated"])

    def test_missing_source_timestamp_is_explicitly_only_receive_time(self):
        result = self.store.observe([product("202")])
        self.assertEqual(result["timestamp_source"], "received_at_not_original_freshness")
        read = self.store.get_workspace(view="products", product_ids=["202"])
        self.assertEqual(read["observations"][0]["timestamp_source"], "received_at_not_original_freshness")
        history = self.store.get_workspace(view="history", product_ids=["202"])
        self.assertEqual(history["history"][0]["timestamp_source"], "received_at_not_original_freshness")

    def test_saved_brief_and_agent_review_data_remain_separate_from_observations(self):
        native = product("301", observed_at="2026-02-03T00:00:00Z")
        self.assertTrue(self.store.observe([native], native["observed_at"])["ok"])
        saved_record = {
            **native,
            "agent_analysis": {"reason": "Caller-authored analysis", "risks": ["Unverified claim"]},
            "human_kept": True,
        }
        brief = {"strategy": "Thai-language home-office videos", "notes": ["caller authored"]}
        saved = self.store.save_workspace(None, "Home office", brief, [saved_record])
        self.assertTrue(saved["ok"])
        self.assertRegex(saved["workspace_id"], r"^[0-9a-f]{32}$")
        self.assertFalse(saved["selection_snapshot"])
        self.assertFalse(saved["reusable_apply_authority"])

        reopened = AnalysisStore(self.root)
        brief_read = reopened.get_workspace(saved["workspace_id"])
        self.assertEqual(brief_read["brief"], brief)
        products = reopened.get_workspace(saved["workspace_id"], view="products")
        self.assertEqual(products["records"], [native])
        self.assertEqual(products["analysis"], [{
            "product_id": "301",
            "agent_analysis": saved_record["agent_analysis"],
            "human_kept": True,
        }])
        self.assertEqual(products["observations"][0]["observed_at"], native["observed_at"])
        history = reopened.get_workspace(saved["workspace_id"], view="history")
        self.assertEqual(history["total"], 1)
        self.assertNotIn("agent_analysis", history["history"][0])

    def test_records_none_retains_recordset_and_empty_list_explicitly_clears(self):
        saved = self.store.save_workspace(None, "Plan", {"v": 1}, [product("401")])
        workspace_id = saved["workspace_id"]
        updated = self.store.save_workspace(
            workspace_id, "Renamed plan", {"v": 2}, None, expected_version=1
        )
        self.assertEqual(updated["record_count"], 1)
        self.assertEqual(updated["version"], 2)
        retained = self.store.get_workspace(workspace_id, view="products")
        self.assertEqual([r["product_id"] for r in retained["records"]], ["401"])
        self.assertEqual(self.store.get_workspace(workspace_id)["brief"], {"v": 2})

        conflict = self.store.save_workspace(workspace_id, "Stale edit", {"v": 3}, None, expected_version=1)
        self.assertEqual(conflict, {"ok": False, "error": "version_conflict", "current_version": 2})
        unchanged = self.store.save_workspace(workspace_id, "Renamed plan", {"v": 2}, None, expected_version=2)
        self.assertEqual(unchanged["version"], 2)
        cleared = self.store.save_workspace(workspace_id, "Renamed plan", {"v": 2}, [], expected_version=2)
        self.assertEqual(cleared["record_count"], 0)
        self.assertEqual(self.store.get_workspace(workspace_id, view="products")["total"], 0)

    def test_workspace_listing_unknown_ids_and_global_cache_require_explicit_ids(self):
        listed = self.store.get_workspace()
        self.assertEqual(listed["total"], 0)
        self.assertEqual(listed["workspaces"], [])
        self.assertEqual(self.store.get_workspace("a" * 32)["error"], "unknown_workspace")
        self.assertEqual(self.store.get_workspace(view="products")["error"], "invalid_input")
        self.assertEqual(self.store.get_workspace(view="history")["error"], "invalid_input")
        missing = self.store.get_workspace(view="products", product_ids=["999"])
        self.assertEqual(missing, {"ok": False, "error": "unknown_products", "product_ids": ["999"]})
        self.assertEqual(self.store.get_workspace(view="history", product_ids=["999"])["error"], "unknown_products")

    def test_invalid_records_urls_nulls_and_argument_bounds_are_rejected(self):
        invalid_records = [
            None,
            {},
            product("bad/id"),
            {**product("501"), "product_url": "https://evil.example/offer/product_offer/501"},
            {**product("502"), "commission_pct": None},
            {**product("503"), "commission_pct": True},
            {**product("504"), "commission_pct": 101},
            {**product("505"), "extra_comm": 0},
            {**product("506"), "commission_pct": float("nan")},
            {**product("507"), "agent_analysis": {"reason": "not an observation"}},
            [product("508")],
        ]
        for record in invalid_records:
            with self.subTest(record=record):
                self.assertEqual(self.store.observe([record])["error"], "invalid_input")
        self.assertEqual(self.store.observe([])["error"], "invalid_input")
        self.assertEqual(self.store.observe([product("509")], "not-a-time")["error"], "invalid_input")
        self.assertEqual(self.store.observe([product("510")], None)["ok"], True)

        good = [product("601")]
        self.assertEqual(self.store.save_workspace(None, "", {}, good)["error"], "invalid_input")
        self.assertEqual(self.store.save_workspace(None, "x", [], good)["error"], "invalid_input")
        self.assertEqual(self.store.save_workspace(None, "x", {"bad": float("inf")}, good)["error"], "invalid_input")
        self.assertEqual(self.store.save_workspace(None, "x", {}, good, expected_version=0)["error"], "invalid_input")
        self.assertEqual(self.store.save_workspace(None, "x", {}, None)["ok"], True)

        for kwargs in [
            {"workspace_id": True},
            {"view": "ranked"},
            {"product_ids": []},
            {"product_ids": ["601", "601"]},
            {"product_ids": ["x" * 201]},
            {"product_ids": [str(i) for i in range(51)]},
            {"limit": 0},
            {"limit": True},
            {"limit": 51},
            {"offset": -1},
            {"offset": 1000},
            {"offset": True},
        ]:
            with self.subTest(kwargs=kwargs):
                self.assertEqual(self.store.get_workspace(**kwargs)["error"], "invalid_input")

    def test_workspace_analysis_metadata_is_bounded_and_strictly_typed(self):
        valid = product("701", agent_analysis={"reason": "Okay"}, human_kept=False)
        self.assertTrue(self.store.save_workspace(None, "Plan", {}, [valid])["ok"])
        for extra in [
            {"agent_analysis": "not a dict"},
            {"agent_analysis": {"x": "y" * 9000}},
            {"human_kept": 1},
        ]:
            record = product("702", **extra)
            self.assertEqual(self.store.save_workspace(None, "Plan", {}, [record])["error"], "invalid_input")

    def test_private_directory_database_and_sqlite_sidecars_are_verified(self):
        unsafe_root = self.base / "public"
        unsafe_root.mkdir(mode=0o755)
        unsafe_root.chmod(0o755)
        with self.assertRaisesRegex(ValueError, "unsafe_workspace_store"):
            AnalysisStore(unsafe_root)

        symlink_root = self.base / "root-link"
        symlink_root.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "unsafe_workspace_store"):
            AnalysisStore(symlink_root)

        bad_file_root = self.base / "bad-file"
        bad_file_root.mkdir(mode=0o700)
        bad_file_root.chmod(0o700)
        bad_db = bad_file_root / "workspace.sqlite3"
        bad_db.write_bytes(b"")
        bad_db.chmod(0o644)
        with self.assertRaisesRegex(ValueError, "unsafe_workspace_store"):
            AnalysisStore(bad_file_root)

        link_file_root = self.base / "link-file"
        link_file_root.mkdir(mode=0o700)
        link_file_root.chmod(0o700)
        (link_file_root / "workspace.sqlite3").symlink_to(self.root / "workspace.sqlite3")
        with self.assertRaisesRegex(ValueError, "unsafe_workspace_store"):
            AnalysisStore(link_file_root)

        hardlink_root = self.base / "hardlink-file"
        hardlink_root.mkdir(mode=0o700)
        hardlink_root.chmod(0o700)
        os.link(self.root / "workspace.sqlite3", hardlink_root / "workspace.sqlite3")
        with self.assertRaisesRegex(ValueError, "unsafe_workspace_store"):
            AnalysisStore(hardlink_root)

        sidecar = Path(str(self.root / "workspace.sqlite3") + "-journal")
        sidecar.symlink_to(self.root / "workspace.sqlite3")
        with self.assertRaisesRegex(ValueError, "unsafe_workspace_store"):
            self.store.observe([product("801")])
        sidecar.unlink()

        sidecar.write_bytes(b"unsafe")
        sidecar.chmod(0o644)
        with self.assertRaisesRegex(ValueError, "unsafe_workspace_store"):
            self.store.observe([product("802")])

        sidecar.unlink()
        os.link(self.root / "workspace.sqlite3", sidecar)
        with self.assertRaisesRegex(ValueError, "unsafe_workspace_store"):
            self.store.observe([product("803")])
        sidecar.unlink()

    def test_legacy_history_without_a_retention_marker_is_labeled_incomplete(self):
        self.assertTrue(self.store.observe([product("850")], "2026-01-01T00:00:00Z")["ok"])
        connection = sqlite3.connect(self.store.path)
        try:
            connection.execute("DROP TABLE store_metadata")
            connection.commit()
        finally:
            connection.close()
        migrated = AnalysisStore(self.root).get_workspace(view="history", product_ids=["850"])
        self.assertTrue(migrated["history_incomplete"])
        self.assertEqual(migrated["retention_pruned_count"], 0)
        self.assertFalse(migrated["retention_pruned_count_complete"])

    def test_new_storage_paths_are_created_private_and_cap_pruning_is_bounded(self):
        new_root = self.base / "created" / "nested-private"
        store = AnalysisStore(new_root)
        self.assertEqual(new_root.stat().st_mode & 0o777, 0o700)
        self.assertEqual((new_root / "workspace.sqlite3").stat().st_mode & 0o777, 0o600)

        old_products, old_history = workspace_module._MAX_PRODUCTS, workspace_module._MAX_HISTORY_ROWS
        old_workspaces, old_workspace_records = (
            workspace_module._MAX_WORKSPACES, workspace_module._MAX_WORKSPACE_RECORDS
        )
        try:
            workspace_module._MAX_PRODUCTS = 1
            workspace_module._MAX_HISTORY_ROWS = 2
            workspace_module._MAX_WORKSPACES = 2
            workspace_module._MAX_WORKSPACE_RECORDS = 1
            self.assertTrue(store.observe([product("901")], "2026-01-01T00:00:00Z")["ok"])
            pruned = store.observe([product("902")], "2026-01-02T00:00:00Z")
            self.assertEqual(pruned["pruned"]["products"], 1)
            self.assertEqual(store.get_workspace(view="products", product_ids=["901"])["error"], "unknown_products")
            # Historical commission evidence is still available after a product
            # record ages out of the current cache.
            self.assertEqual(store.get_workspace(view="history", product_ids=["901"])["total"], 1)
            changed = store.observe([product("901", commission_pct=8)], "2026-01-03T00:00:00Z")
            self.assertEqual(changed["pruned"]["history_rows"], 1)
            self.assertEqual(changed["retention_pruned_count"], 1)
            surviving_history = store.get_workspace(view="history", product_ids=["901"])
            self.assertEqual(surviving_history["total"], 1)
            self.assertEqual(surviving_history["history"][0]["commission_pct"], 8)
            self.assertTrue(surviving_history["history_incomplete"])
            self.assertEqual(surviving_history["retention_pruned_count"], 1)
            self.assertEqual(surviving_history["retained_from"], "2026-01-03T00:00:00Z")
            self.assertFalse(surviving_history["page_truncated"])

            reopened = AnalysisStore(new_root)
            persisted = reopened.get_workspace(view="history", product_ids=["901"])
            self.assertEqual(persisted["retention_pruned_count"], 1)
            self.assertEqual(persisted["retained_from"], "2026-01-03T00:00:00Z")
            unchanged = reopened.observe([product("901", commission_pct=8)], "2026-01-04T00:00:00Z")
            self.assertEqual(unchanged["rate_changes"], 0)
            self.assertEqual(unchanged["retention_pruned_count"], 1)
            stale = reopened.observe([product("901", commission_pct=5)], "2026-01-02T00:00:00Z")
            self.assertEqual(stale["stale"], 1)
            self.assertEqual(stale["rate_changes"], 0)
            after_stale = reopened.get_workspace(view="history", product_ids=["901"])
            self.assertEqual(after_stale["retention_pruned_count"], 1)
            self.assertEqual(after_stale["history"], persisted["history"])

            first = store.save_workspace(None, "One", {}, [product("901")])
            self.assertTrue(first["ok"])
            over_records = store.save_workspace(None, "Two", {}, [product("902")])
            self.assertEqual(over_records, {"ok": False, "error": "capacity_exceeded", "capacity": "workspace_records"})
            # The failed save is atomic and doesn't leave a workspace row behind.
            self.assertEqual(store.get_workspace()["total"], 1)
            second = store.save_workspace(None, "Two", {}, [])
            self.assertTrue(second["ok"])
            over_workspaces = store.save_workspace(None, "Three", {}, [])
            self.assertEqual(over_workspaces, {"ok": False, "error": "capacity_exceeded", "capacity": "workspaces"})
        finally:
            workspace_module._MAX_PRODUCTS = old_products
            workspace_module._MAX_HISTORY_ROWS = old_history
            workspace_module._MAX_WORKSPACES = old_workspaces
            workspace_module._MAX_WORKSPACE_RECORDS = old_workspace_records


if __name__ == "__main__":
    unittest.main()
