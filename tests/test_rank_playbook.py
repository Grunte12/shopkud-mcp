import asyncio
import copy
import unittest

from shopkud_mcp.server import create_service


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
                    "name": row["name"], "offer_url": row["product_url"],
                    "price_min_thb": row["price_min_thb"], "price_max_thb": row["price_max_thb"],
                    "observed_at": "2026-10-24T00:00:00Z", "channels": [{
                        "channel": "shopee_video", "total_pct": pct,
                        "estimated_commission_thb": amount,
                        "extra_commission": {"pct": pct}, "shopee_commission": {"pct": 0},
                    }]}
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
            "not_mall": 1, "sold_below_minimum": 1, "preorder": 1, "missing_fields": 0,
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
        self.assertTrue(any(event["stage"] == "detail_check" for event in events))

    async def test_concurrent_identical_agents_share_one_scan(self):
        first, second = await asyncio.gather(self.tool("ทีวี"), self.tool("ทีวี"))
        self.assertFalse(first["cache_hit"])
        self.assertTrue(second["cache_hit"])
        self.assertEqual(first["results"], second["results"])
        self.assertEqual(second["trace"]["browser_operations"], {"scan": 0, "scan_read": 0, "detail": 0})
        self.assertTrue(second["trace"]["cache_hit"])
        self.assertEqual(sum(call[1] == "search_scan" for call in self.broker.calls), 1)
        self.assertTrue(any(call[1] == "playbook_event" and call[2]["stage"] == "cache_hit" for call in self.broker.calls))

    async def test_invalid_inputs_never_reach_browser(self):
        for arguments in [
            {"query": ""}, {"query": "ทีวี", "mall_only": 1},
            {"query": "ทีวี", "min_sold": True}, {"query": "ทีวี", "max_pages": 21},
        ]:
            result = await self.tool(**arguments)
            self.assertEqual((result["ok"], result["error"]), (False, "invalid_input"))
            self.assertFalse(result["trace"]["success"])
            self.assertFalse(result["trace"]["effective"])
        self.assertEqual(self.broker.calls, [])


if __name__ == "__main__":
    unittest.main()
