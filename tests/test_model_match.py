"""Unit tests for bounded, deterministic model-code evidence matching."""

from __future__ import annotations

import unittest

from shopkud_mcp.model_match import brief_listing, model_match, normalize_model


class NormalizeModelTests(unittest.TestCase):
    def test_normalizes_case_and_nfkc_but_keeps_model_separators(self):
        self.assertEqual(normalize_model("anker-a1695"), "ANKER-A1695")
        self.assertEqual(normalize_model("ａｎｋｅｒ－Ａ１６９５"), "ANKER-A1695")
        self.assertEqual(normalize_model("  AB_123 "), None)

    def test_rejects_non_model_tokens_and_bounds_input(self):
        for value in (None, 123, "", "A", "ANKER", "A1695!", "A1695 B1695", "A" * 33):
            with self.subTest(value=value):
                self.assertIsNone(normalize_model(value))


class ModelMatchTests(unittest.TestCase):
    def ev(self, model, role="identity", source="visible_product_spec", snippet="Model code"):
        return {"model": model, "role": role, "source": source, "snippet": snippet}

    def test_identity_codes_match_only_as_exact_normalized_tokens(self):
        result = model_match({"model_evidence": [self.ev("AB-123") ]}, "ab-123")
        self.assertEqual(result["status"], "matched")
        self.assertEqual(result["target_model"], "AB-123")
        self.assertEqual(result["detected_model"], "AB-123")
        wrong = model_match({"model_evidence": [self.ev("AB-123") ]}, "AB-124")
        self.assertEqual(wrong["status"], "different")

    def test_conflicting_identity_codes_are_ambiguous(self):
        result = model_match({"model_evidence": [self.ev("AB-123"), self.ev("CD-456")]}, "AB-123")
        self.assertEqual(result["status"], "ambiguous")
        self.assertIsNone(result["detected_model"])

    def test_missing_identity_and_accessory_compatibility_are_distinct(self):
        self.assertEqual(model_match({})["status"], "unknown")
        accessory = model_match({"model_evidence": [self.ev("AB-123", "compatible")]}, "AB-123")
        self.assertEqual(accessory["status"], "accessory_only")
        self.assertIsNone(accessory["detected_model"])

    def test_evidence_sources_roles_and_output_are_bounded(self):
        data = {"model_evidence": [
            self.ev(f"AB-{100+i}", snippet="x" * 500) for i in range(10)
        ] + [self.ev("BAD-999", source="untrusted_source") for _ in range(3)]}
        result = model_match(data, "AB-100")
        self.assertEqual(result["status"], "ambiguous")
        self.assertLessEqual(len(result["evidence"]), 3)
        self.assertTrue(all(len(item["snippet"]) <= 180 for item in result["evidence"]))
        self.assertTrue(all(item["source"] != "untrusted_source" for item in result["evidence"]))

    def test_brief_listing_is_compact_and_omits_gallery_and_description(self):
        detail = {
            "ok": True, "kind": "public_product_detail", "source_url": "https://shopee.co.th/product/1/2",
            "shop_id": "1", "product_id": "2", "observed_at": "now", "name": "Power bank",
            "description": "private-long-description", "gallery": [{"url": "https://x/" + "x" * 10000}],
            "variant_info": {"model": "AB-123", "sku": "SKU-9", "color": "black",
                              "selected_options": ["black"],
                              "available_options": [{"label": "Color", "options": ["black", "white"]}]},
            "layout_evidence": {"reader_revision": "r1"},
            "model_evidence": [self.ev("AB-123")],
        }
        brief = brief_listing(detail, "AB-123")
        self.assertEqual(brief["model_match"]["status"], "matched")
        self.assertEqual(brief["variant_info"]["model"], "AB-123")
        self.assertEqual(brief["reader_revision"], "r1")
        self.assertFalse(brief["retry_automatically"])
        self.assertNotIn("gallery", brief)
        self.assertNotIn("description", brief)
        self.assertLess(len(str(brief)), 4000)

    def test_purchase_observations_are_source_checked_and_display_bounded(self):
        detail = {
            "model_evidence": [],
            "seller_info": {
                "name": {"display": "S" * 150, "source": "visible_seller_panel"},
                "mall_badge": {"display": "Mall", "source": "unsupported_source"},
                "ratings_count": {"display": "12 ratings", "source": "visible_seller_panel"},
            },
            "product_metrics": {
                "rating": {"display": "4.9", "source": "exact_product_json_ld"},
                "rating_count": {"display": "125", "source": "exact_product_json_ld"},
                "review_count": {"display": "99", "source": "visible_product_summary"},
                "sold": {"display": "2k sold", "source": "unsupported_source"},
            },
            "shipping_info": {
                "ships_from": {"display": "Bangkok", "source": "visible_product_summary"},
                "stock": {"display": "9", "source": "visible_seller_panel"},
            },
        }
        brief = brief_listing(detail)
        self.assertEqual(len(brief["seller_info"]["name"]["display"]), 120)
        self.assertEqual(brief["seller_info"]["mall_badge"], None)
        self.assertEqual(brief["seller_info"]["ratings_count"]["source"], "visible_seller_panel")
        self.assertEqual(brief["product_metrics"]["rating"]["source"], "exact_product_json_ld")
        self.assertEqual(brief["product_metrics"]["rating_count"]["display"], "125")
        self.assertEqual(brief["product_metrics"]["review_count"]["display"], "99")
        self.assertIsNone(brief["product_metrics"]["sold"])
        self.assertEqual(brief["shipping_info"]["ships_from"]["display"], "Bangkok")
        self.assertIsNone(brief["shipping_info"]["stock"])

    def test_unavailable_purchase_fields_are_null_and_option_evidence_is_bounded(self):
        detail = {
            "model_evidence": [],
            "variant_info": {"available_options": [
                {"label": f"Group {i}", "options": [f"Option {j}" for j in range(12)],
                 "option_evidence": [
                     {"value": f"Option {j}", "selected": "maybe", "disabled": bool(j % 2),
                      "source": "visible_labeled_buttons"} for j in range(12)
                 ]}
                for i in range(6)
            ]},
        }
        brief = brief_listing(detail)
        self.assertTrue(all(value is None for group in ("seller_info", "product_metrics", "shipping_info")
                            for value in brief[group].values()))
        groups = brief["variant_info"]["available_options"]
        self.assertEqual(len(groups), 4)
        self.assertEqual(len(groups[0]["options"]), 8)
        self.assertEqual(len(groups[0]["option_evidence"]), 8)
        self.assertIsNone(groups[0]["option_evidence"][0]["selected"])
        self.assertFalse(groups[0]["option_evidence"][0]["disabled"])
        self.assertEqual(groups[0]["option_evidence"][0]["source"], "visible_labeled_buttons")

    def test_option_evidence_ignores_untrusted_origins_and_never_infers_selection_or_stock(self):
        brief = brief_listing({
            "model_evidence": [],
            "variant_info": {"available_options": [{"label": "Model", "options": ["AB-123"],
                "option_evidence": [
                    {"value": "AB-123", "selected": None, "disabled": False, "source": "page_guess"},
                    {"value": "AB-123", "selected": True, "disabled": False, "source": "visible_labeled_buttons"},
                ]}]},
            "seller_info": {"followers": None},
            "shipping_info": {"stock": None},
        })
        options = brief["variant_info"]["available_options"][0]["option_evidence"]
        self.assertEqual(options, [{"value": "AB-123", "selected": True, "disabled": False,
                                    "source": "visible_labeled_buttons"}])
        self.assertIsNone(brief["seller_info"]["followers"])
        self.assertIsNone(brief["shipping_info"]["stock"])

    def test_selected_options_are_source_checked_bounded_and_bad_layout_is_safe(self):
        brief = brief_listing({
            "model_evidence": [],
            "variant_info": {
                "model": "M" * 300,
                "selected_options": [
                    {"label": "Color" * 30, "value": "Black" * 30,
                     "source": "visible_aria_selection", "extra": "drop"},
                    {"label": "Model", "value": "AB-123", "source": "page_guess"},
                    {"label": "Size", "value": "Large", "source": "visible_aria_checked"},
                    {"label": 3, "value": "bad", "source": "visible_aria_checked"},
                    {"label": "Extra", "value": "Ignored", "source": "visible_aria_checked"},
                ],
                "available_options": "malformed",
            },
            "layout_evidence": "not an object",
        })
        variant = brief["variant_info"]
        self.assertEqual(len(variant["model"]), 240)
        self.assertEqual(variant["selected_options"], [
            {"label": "Color" * 16, "value": "Black" * 24, "source": "visible_aria_selection"},
            {"label": "Size", "value": "Large", "source": "visible_aria_checked"},
        ])
        self.assertEqual(variant["available_options"], [])
        self.assertIsNone(brief["reader_revision"])


if __name__ == "__main__":
    unittest.main()
