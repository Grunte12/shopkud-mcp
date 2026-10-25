"""Synthetic concurrency/latency/context eval for the deterministic rank playbook."""
import asyncio
import json
from pathlib import Path
import statistics
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shopkud_mcp.server import create_service
from tests.test_rank_playbook import PlaybookBroker


async def main():
    broker = PlaybookBroker()
    config = {"token": "a" * 64, "socket_path": str(Path(tempfile.gettempdir()) / "shopkud-eval-native.sock"),
              "allowed_origins": ["chrome-extension://" + "a" * 32 + "/"]}
    _, mcp, _ = create_service(config, broker)
    tool = mcp._tool_manager._tools["rank_affiliate_products"].fn
    started = time.monotonic()
    results = await asyncio.gather(*(tool("ทีวี") for _ in range(5)))
    latencies = [row["trace"]["latency_ms"]["total"] for row in results]
    winners = [row.get("winner", {}).get("product_id") for row in results]
    report = {
        "kind": "synthetic_rank_playbook_eval",
        "agents": len(results),
        "success_rate": sum(row["trace"]["success"] for row in results) / len(results),
        "effective_rate": sum(row["trace"]["effective"] for row in results) / len(results),
        "winner_agreement_rate": max(winners.count(value) for value in set(winners)) / len(winners),
        "physical_scans": sum(call[1] == "search_scan" for call in broker.calls),
        "cache_hits": sum(row["trace"]["cache_hit"] for row in results),
        "latency_ms": {"min": min(latencies), "p50": statistics.median(latencies),
                       "max": max(latencies), "wall": round((time.monotonic() - started) * 1000, 2)},
        "response_bytes": [row["trace"]["response_bytes_without_trace"] for row in results],
        "response_tokens_estimate": [row["trace"]["response_tokens_estimate"] for row in results],
        "agent_tokens_available": False,
        "agent_token_note": "The MCP server does not receive model input/reasoning/output token accounting.",
    }
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    asyncio.run(main())
