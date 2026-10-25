import asyncio
import copy
import unittest
import time

from shopkud_mcp.server import create_service, _ranking_state, _RANKING_CACHE_MAX_ENTRIES


LIST_PAGE = "1:" + "a" * 32
DETAIL_PAGE = "2:" + "b" * 32


def product(product_id, name, price, sold, mall=True, commission=7):
    return {
        "product_id": product_id, "name": name,
        "product_url": f"https://affiliate.shopee.co.th/offer/product_offer/{product_id}",
        "price_min_thb": price, "price_max_thb": price,
        "commission_pct": commission, "baht_per_order": price * commission / 100,
        "sold": sold, "mall": mall, "extra_comm": True,
    }


class PlaybookBroker:
    def __init__(self):
        self.calls = []
        self.detail_id = None
        self.records = [
            product("1", "TCL 85T6C", 58090, 610),
            product("2", "TCL 65Q7D PRO", 46590, 944),
            product("3", "ทีวี PRE-ORDER", 99999, 9000),
            product("4", "Unknown non Mall", 100000, 10000, mall=False),
            product("5", "Trusted but no demand", 120000, 10),
        ]
        self.amounts = {"1": (5, 2904.5), "2": (3, 1397.7)}

    def pages(self):
        pages = [{"page_id": LIST_PAGE, "url": "https://affiliate.shopee.co.th/offer/product_offer", "title": "list"}]
        if self.detail_id:
            pages.append({"page_id": DETAIL_PAGE, "url": f"https://affiliate.shopee.co.th/offer/product_offer/{self.detail_id}", "title": "detail"})
        return pages

    async def call(self, page_id, operation, arguments, timeout=20):
        self.calls.append((page_id, operation, copy.deepcopy(arguments), timeout))
        if page_id == "extension" and operation == "playbook_event":
            return {"ok": True}
        if page_id == "extension" and operation == "open_offer":
            if arguments["offer_url"].endswith("/product_offer"):
                return {"ok": True, "page_id": LIST_PAGE}
            self.detail_id = arguments["offer_url"].rsplit("/", 1)[-1]
            return {"ok": True, "page_id": DETAIL_PAGE}
        if operation == "search_scan":
            await asyncio.sleep(0.01)
            return {"ok": True, "scan_id": "c" * 32, "pages_scanned": 1,
                    "unique_products": len(self.records), "reached_end": True,
                    "stop_reason": "end_of_results", "next_page": None, "outcome": "completed"}
        if operation == "scan_read":
            offset, limit = arguments["offset"], arguments["limit"]
            rows = self.records[offset:offset + limit]
            return {"ok": True, "scan_id": "c" * 32, "records": copy.deepcopy(rows),
                    "offset": offset, "next_offset": offset + len(rows) if offset + len(rows) < len(self.records) else None}
        if operation == "detail":
            pct, amount = self.amounts[self.detail_id]
            row = next(item for item in self.records if item["product_id"] == self.detail_id)
            return {"ok": True, "kind": "product_detail", "product_id": self.detail_id,
                    "name": row["name"], "offer_url": row["product_url"], "shop_id": "12345",
                    "product_url": f"https://shopee.co.th/product/12345/{self.detail_id}",
                    "price_min_thb": row["price_min_thb"], "price_max_thb": row["price_max_thb"],
                    "observed_at": "2026-10-24T00:00:00Z",
                    "images": [{"url": f"https://down-th.img.susercontent.com/file/{self.detail_id}"}],
                    "channels": [
                        {"channel": "social", "label": "Social", "total_pct": float("nan"),
                         "estimated_commission_thb": -1,
                         "extra_commission": {"pct": "unknown"}, "shopee_commission": {"pct": 1.25}},
                        {"channel": "shopee_live", "label": "Shopee Live", "total_pct": 4,
                         "estimated_commission_thb": float("inf"),
                         "extra_commission": {"pct": -1}, "shopee_commission": {"pct": True}},
                        {"channel": "shopee_video", "label": "Shopee Video", "total_pct": pct,
                         "estimated_commission_thb": amount,
                         "extra_commission": {"pct": pct}, "shopee_commission": {"pct": 0}},
                        {"channel": "future_channel", "label": "Unknown", "total_pct": 99,
                         "estimated_commission_thb": 99},
                    ]}
        raise AssertionError((page_id, operation, arguments))


class RankAffiliateProductsTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.broker = PlaybookBroker()
        config = {"token": "a" * 64, "socket_path": "/private/tmp/native.sock",
                  "allowed_origins": ["chrome-extension://" + "a" * 32 + "/"]}
        _, mcp, _ = create_service(config, self.broker)
        self.tool = mcp._tool_manager._tools["rank_affiliate_products"].fn

    async def test_filters_then_ranks_only_verified_video_commission(self):
        result = await self.tool("ทีวี")
        self.assertTrue(result["ok"])
        self.assertEqual([row["product_id"] for row in result["results"]], ["1", "2"])
        self.assertEqual(result["winner"]["commission_thb_per_order"], 2904.5)
        self.assertEqual(result["exclusions"], {
            "not_mall": 1, "mall_excluded": 0, "sold_below_minimum": 1, "price_above_maximum": 0,
            "commission_thb_below_minimum": 0, "commission_pct_below_minimum": 0,
            "preorder": 1, "missing_fields": 0,
        })
        self.assertEqual(result["criteria"]["rank_by"], "displayed_estimated_commission_thb_per_order")
        trace = result["trace"]
        self.assertTrue(trace["success"])
        self.assertTrue(trace["effective"])
        self.assertFalse(trace["cache_hit"])
        self.assertEqual(trace["browser_operations"], {"scan": 1, "scan_read": 1, "detail": 2})
        self.assertGreaterEqual(trace["latency_ms"]["total"], trace["latency_ms"]["scan_ms"])
        self.assertGreater(trace["response_bytes_without_trace"], 0)
        self.assertGreater(trace["response_tokens_estimate"], 0)
        self.assertIsNone(trace["agent_input_and_reasoning_tokens"])
        events = [call[2] for call in self.broker.calls if call[1] == "playbook_event"]
        self.assertEqual(events[0]["stage"], "queued")
        self.assertEqual(events[-1]["stage"], "completed")
        self.assertEqual(events[-1]["success"], True)
        self.assertEqual(events[-1]["dashboard"]["winner_product_id"], "1")
        self.assertEqual(events[-1]["dashboard"]["results"][0]["image_url"],
                         "https://down-th.img.susercontent.com/file/1")
        self.assertEqual(events[-1]["dashboard"]["criteria"]["ranking_goal"], "commission_value")
        self.assertTrue(any(event["stage"] == "detail_check" for event in events))

    async def test_results_include_all_known_channel_commissions_from_the_same_detail_read(self):
        result = await self.tool("ทีวี", freshness="live")
        expected_channels = [
            {"channel": "social", "label": "Social", "commission_pct": None,
             "commission_thb_per_order": None, "extra_commission_pct": None, "shopee_commission_pct": 1.25},
            {"channel": "shopee_live", "label": "Shopee Live", "commission_pct": 4,
             "commission_thb_per_order": None, "extra_commission_pct": None, "shopee_commission_pct": None},
            {"channel": "shopee_video", "label": "Shopee Video", "commission_pct": 5,
             "commission_thb_per_order": 2904.5, "extra_commission_pct": 5, "shopee_commission_pct": 0},
        ]
        first = result["results"][0]
        self.assertEqual(first["commission_channels"], expected_channels)
        self.assertEqual([row["channel"] for row in first["commission_channels"]],
                         ["social", "shopee_live", "shopee_video"])
        self.assertEqual([[item["channel"] for item in row["commission_channels"]]
                          for row in result["results"]],
                         [["social", "shopee_live", "shopee_video"]] * 2)
        self.assertTrue(all(set(row) == {
            "channel", "label", "commission_pct", "commission_thb_per_order",
            "extra_commission_pct", "shopee_commission_pct",
        } for row in first["commission_channels"]))
        self.assertEqual(first["commission_pct"], 5)
        self.assertEqual(first["commission_thb_per_order"], 2904.5)
        self.assertEqual(first["shop_id"], "12345")
        self.assertEqual(first["product_url"], f"https://shopee.co.th/product/12345/{first['product_id']}")
        self.assertEqual(first["shop_url"], "https://shopee.co.th/shop/12345")
        self.assertEqual(sum(call[1] == "detail" for call in self.broker.calls), 2)
        self.assertEqual(result["trace"]["browser_operations"]["detail"], 2)

    async def test_concurrent_identical_agents_share_one_scan(self):
        first, second = await asyncio.gather(self.tool("ทีวี"), self.tool("ทีวี"))
        self.assertFalse(first["cache_hit"])
        self.assertTrue(second["cache_hit"])
        self.assertEqual(first["results"], second["results"])
        self.assertEqual(second["trace"]["browser_operations"], {"scan": 0, "scan_read": 0, "detail": 0})
        self.assertTrue(second["trace"]["cache_hit"])
        self.assertEqual(sum(call[1] == "search_scan" for call in self.broker.calls), 1)
        self.assertTrue(any(call[1] == "playbook_event" and call[2]["stage"] == "cache_hit" for call in self.broker.calls))

    async def test_agent_can_choose_ranking_goal_without_rebuilding_the_workflow(self):
        commission = await self.tool("ทีวี", ranking_goal="commission_value", freshness="live")
        volume = await self.tool("ทีวี", ranking_goal="sales_volume", freshness="live")
        balanced = await self.tool("ทีวี", ranking_goal="balanced", freshness="live")
        self.assertEqual(commission["winner"]["product_id"], "1")
        self.assertEqual(volume["winner"]["product_id"], "2")
        self.assertIn("ranking_score", balanced["winner"])
        self.assertEqual(commission["criteria"]["rank_by"], "displayed_estimated_commission_thb_per_order")
        self.assertEqual(volume["criteria"]["rank_by"], "visible_sold_count")

    async def test_goal_aware_shortlist_keeps_low_price_sales_and_rate_winners(self):
        self.broker.records = [product(str(index), f"High price {index}", 100000 - index, 600 + index, commission=1)
                               for index in range(1, 18)]
        self.broker.records += [
            product("90", "Low price sales winner", 500, 999999, commission=2),
            product("91", "Low price rate winner", 400, 700, commission=50),
        ]
        self.broker.amounts = {row["product_id"]: (row["commission_pct"], row["baht_per_order"])
                               for row in self.broker.records}
        sales = await self.tool("ทีวี", ranking_goal="sales_volume", freshness="live")
        rate = await self.tool("ทีวี", ranking_goal="commission_rate", freshness="live")
        self.assertEqual(sales["winner"]["product_id"], "90")
        self.assertEqual(rate["winner"]["product_id"], "91")

    async def test_non_mall_only_is_explicit_and_mutually_exclusive(self):
        self.broker.amounts["4"] = (7, 7000)
        result = await self.tool("ทีวี", exclude_mall=True, min_sold=0, freshness="live")
        self.assertEqual([row["product_id"] for row in result["results"]], ["4"])
        self.assertEqual(result["criteria"]["mall_only"], False)
        self.assertEqual(result["criteria"]["exclude_mall"], True)
        self.assertGreater(result["exclusions"]["mall_excluded"], 0)
        invalid = await self.tool("ทีวี", mall_only=True, exclude_mall=True)
        self.assertEqual((invalid["ok"], invalid["error"]), (False, "invalid_input"))

    async def test_freshness_policy_is_explicit_and_live_bypasses_completed_cache(self):
        first = await self.tool("ทีวี", freshness="recent")
        second = await self.tool("ทีวี", freshness="recent")
        live = await self.tool("ทีวี", freshness="live")
        self.assertFalse(first["cache_hit"])
        self.assertTrue(second["cache_hit"])
        self.assertLessEqual(second["cache_age_ms"], 60000)
        self.assertEqual(second["cache_ttl_seconds"], 60)
        self.assertFalse(live["cache_hit"])
        self.assertEqual(live["cache_ttl_seconds"], 0)
        self.assertEqual(sum(call[1] == "search_scan" for call in self.broker.calls), 2)

    async def test_cached_criteria_reflect_current_request_without_mutating_observation(self):
        first = await self.tool("ทีวี", freshness="live")
        cached = await self.tool("ทีวี", freshness="recent")
        self.assertTrue(cached["cache_hit"])
        self.assertEqual(cached["criteria"]["freshness"], "recent")
        self.assertEqual(first["criteria"]["freshness"], "live")

    async def test_cache_evicts_oldest_and_prunes_expired_observations(self):
        _, cache = _ranking_state(self.broker)
        for index in range(_RANKING_CACHE_MAX_ENTRIES):
            cache[("seed", index)] = (time.monotonic(), {})
        await self.tool("ทีวี")
        self.assertEqual(len(cache), _RANKING_CACHE_MAX_ENTRIES)
        self.assertNotIn(("seed", 0), cache)
        cache[("expired",)] = (time.monotonic() - 601, {})
        result = await self.tool("ทีวี", freshness="recent")
        self.assertTrue(result["cache_hit"])
        self.assertNotIn(("expired",), cache)
        self.assertEqual(len(cache), _RANKING_CACHE_MAX_ENTRIES)

    async def test_agent_selected_commission_and_price_constraints_are_enforced(self):
        result = await self.tool("ทีวี", freshness="live", min_commission_thb=2000,
                                 min_commission_pct=4, max_price_thb=60000)
        self.assertEqual([row["product_id"] for row in result["results"]], ["1"])
        self.assertEqual(result["exclusions"]["commission_thb_below_minimum"], 1)
        self.assertEqual(result["criteria"]["min_commission_thb"], 2000)
        self.assertEqual(result["criteria"]["min_commission_pct"], 4)
        self.assertEqual(result["criteria"]["max_price_thb"], 60000)

    async def test_unmet_commission_constraint_returns_observed_alternative_without_retry(self):
        result = await self.tool("ทีวี", freshness="live", min_commission_thb=5000)
        self.assertIsNone(result["winner"])
        self.assertEqual(result["detail_verified"], 2)
        self.assertEqual(result["qualified_after_constraints"], 0)
        suggestion = next(row for row in result["relaxation_suggestions"]
                          if row["parameter"] == "min_commission_thb")
        self.assertEqual(suggestion["suggested"], 2904.5)
        self.assertEqual(sum(call[1] == "search_scan" for call in self.broker.calls), 1)

    async def test_empty_result_explains_filters_but_never_relaxes_them(self):
        self.broker.records = [
            product("9", "Non Mall purifier", 5000, 2000, mall=False),
            product("10", "Low-volume Mall purifier", 5000, 20, mall=True),
        ]
        self.broker.amounts = {"9": (12, 600), "10": (12, 600)}
        result = await self.tool("เครื่องฟอกอากาศ", freshness="live", max_pages=1)
        self.assertTrue(result["ok"])
        self.assertIsNone(result["winner"])
        self.assertEqual(result["results"], [])
        suggestions = {row["parameter"]: row for row in result["relaxation_suggestions"]}
        self.assertEqual(suggestions["mall_only"]["suggested"], False)
        self.assertEqual(suggestions["min_sold"]["suggested"], 250)
        self.assertEqual(result["criteria"]["mall_only"], True)
        self.assertEqual(result["criteria"]["min_sold"], 500)

    async def test_stateless_service_wrappers_share_one_process_lane(self):
        config = {"token": "a" * 64, "socket_path": "/private/tmp/native.sock",
                  "allowed_origins": ["chrome-extension://" + "a" * 32 + "/"]}
        _, second_mcp, _ = create_service(config, self.broker)
        second_tool = second_mcp._tool_manager._tools["rank_affiliate_products"].fn
        first, second = await asyncio.gather(self.tool("ทีวี"), second_tool("ทีวี"))
        self.assertFalse(first["cache_hit"])
        self.assertTrue(second["cache_hit"])
        self.assertEqual(first["results"], second["results"])
        self.assertEqual(sum(call[1] == "search_scan" for call in self.broker.calls), 1)

    async def test_invalid_inputs_never_reach_browser(self):
        for arguments in [
            {"query": ""}, {"query": "ทีวี", "mall_only": 1}, {"query": "ทีวี", "exclude_mall": 1},
            {"query": "ทีวี", "min_sold": True}, {"query": "ทีวี", "max_pages": 21},
            {"query": "ทีวี", "ranking_goal": "magic"}, {"query": "ทีวี", "freshness": "stale"},
            {"query": "ทีวี", "min_commission_thb": True},
            {"query": "ทีวี", "min_commission_pct": 101}, {"query": "ทีวี", "max_price_thb": -1},
        ]:
            result = await self.tool(**arguments)
            self.assertEqual((result["ok"], result["error"]), (False, "invalid_input"))
            self.assertFalse(result["trace"]["success"])
            self.assertFalse(result["trace"]["effective"])
        self.assertEqual(self.broker.calls, [])


if __name__ == "__main__":
    unittest.main()
