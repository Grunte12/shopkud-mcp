"""MCP broker contract tests for the Codex review of link creation and verify."""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path

from shopkud_mcp.broker import PRODUCT_PAGE_URL, Broker, BrokerError
from shopkud_mcp.campaigns import CampaignStore
from shopkud_mcp.server import create_service
from test_broker import ORIGIN, FakePeer, page


WORKSPACE = "c" * 32
PRODUCT = "26916762523"
URL = "https://s.shopee.co.th/ContractA1"
PAGE_URL = f"{PRODUCT_PAGE_URL}/{PRODUCT}"


def receipt(product_id: str = PRODUCT, url: str = URL, **extra) -> dict:
    body = {
        "affiliate_url": url,
        "product_id": product_id,
        "page_url": f"{PRODUCT_PAGE_URL}/{product_id}",
        "created_at": "2026-10-17T00:00:00+00:00",
        "captured_at": "2026-10-17T00:00:01+00:00",
        "status": "confirmed",
        "product_attested": True,
        "dialog_detection_method": "specific_selector",
        "sub_id_slots": [1, 2],
    }
    body.update(extra)
    return body


def confirmed(product_id: str = PRODUCT, url: str = URL) -> dict:
    return {
        "ok": True,
        "status": "confirmed",
        "affiliate_url": url,
        "product_id": product_id,
        "product_attested": True,
        "clicked": True,
        "sub_ids_used": {"sub_id_1": "tiktok", "sub_id_2": "P1"},
        "link_receipt": receipt(product_id, url),
    }


class LinkContractTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="shopkud-contract-")
        self.root = Path(self.temp.name).resolve()
        os.chmod(self.root, 0o700)
        self.store = CampaignStore(self.root)
        self.socket_path = self.root / "broker.sock"
        self.broker = Broker(self.socket_path, [ORIGIN])
        await self.broker.start()
        config = {
            "token": "a" * 64,
            "socket_path": str(self.socket_path),
            "allowed_origins": [ORIGIN],
            "workspace_enabled": True,
        }
        _, self.mcp, _ = create_service(config, broker=self.broker, campaign_store=self.store)
        self.tools = self.mcp._tool_manager._tools
        self.peers: list[FakePeer] = []
        self.page = page(7)
        self.page["url"] = PAGE_URL

    async def asyncTearDown(self) -> None:
        for peer in self.peers:
            await peer.close()
        await self.broker.stop()
        self.temp.cleanup()

    def tool(self, name: str):
        return self.tools[name].fn

    async def connect(self) -> FakePeer:
        reader, writer = await asyncio.open_unix_connection(str(self.socket_path))
        peer = FakePeer(reader, writer)
        self.peers.append(peer)
        await peer.send({"type": "hello", "origin": ORIGIN})
        self.assertEqual(await peer.recv(), {"type": "hello-ack"})
        await peer.send({"type": "pages", "pages": [self.page]})
        for _ in range(100):
            if self.broker.pages():
                return peer
            await asyncio.sleep(0.005)
        self.fail("page was not registered")

    async def answer(self, peer: FakePeer, payload):
        command = await asyncio.wait_for(peer.recv(), timeout=2)
        result = payload(command) if callable(payload) else payload
        await peer.send({"type": "result", "id": command["id"], "result": result})
        return command

    async def test_create_batch_and_verify_use_allowlisted_operations(self) -> None:
        with self.assertRaises(BrokerError) as caught:
            await self.broker.call(self.page["page_id"], "batch_create_links", {"items": [], "stop_on_error": True}, timeout=300)
        self.assertEqual(caught.exception.code, "invalid_request")

        peer = await self.connect()
        served = asyncio.create_task(self.answer(peer, confirmed()))
        created = await self.tool("create_link")(
            self.page["page_id"], PRODUCT, ["tiktok", "P1"], "tiktok", "clip-1", WORKSPACE,
        )
        command = await served
        self.assertEqual(command["operation"], "create_link_with_subids")
        self.assertEqual(set(command["arguments"]), {"product_id", "sub_ids", "dry_run", "intent_key"})
        self.assertNotIn("operation", command["arguments"])
        self.assertTrue(created["saved_to_workspace"])
        self.assertEqual(created["link_receipt"]["product_id"], PRODUCT)
        stored = self.store.find_links(WORKSPACE, product_id=PRODUCT)
        self.assertEqual(stored["links"][0]["product_id"], PRODUCT)
        self.assertEqual(stored["links"][0]["link_receipt"]["product_id"], PRODUCT)

        def batch_payload(command):
            self.assertEqual(command["operation"], "batch_create_links")
            self.assertEqual(set(command["arguments"]), {"items", "stop_on_error"})
            self.assertNotIn("operation", command["arguments"])
            item = command["arguments"]["items"][0]
            body = confirmed(item["product_id"], "https://s.shopee.co.th/BatchItem1")
            body["sub_ids_used"] = {"sub_id_1": "ig", "sub_id_2": "P9"}
            return {"ok": True, "results": [{**body, "item_index": 0}]}

        served = asyncio.create_task(self.answer(peer, batch_payload))
        batched = await self.tool("batch_create_links")(
            self.page["page_id"],
            [{"product_id": PRODUCT, "sub_ids": ["ig", "P9"], "clip_id": "clip-9"}],
            "tiktok",
            WORKSPACE,
        )
        await served
        self.assertTrue(batched["dispatched"])
        self.assertNotEqual(batched.get("error"), "invalid_request")
        self.assertTrue(batched["results"][0]["saved_to_workspace"])

        verified = await self.tool("verify_link")(
            URL, None, PRODUCT, receipt(),
        )
        self.assertTrue(verified["ok"])
        self.assertIs(verified["target_verified"], True)
        self.assertIs(verified["ownership_verified"], True)
        self.assertNotIn("extension.verify", json.dumps(verified))

    async def test_receipt_only_verify_rejects_unattested_and_pii(self) -> None:
        typed = {"product_id": PRODUCT, "product_name": "Secret", "created_at": "2026-10-17T00:00:00+00:00"}
        unknown = await self.tool("verify_link")(URL, None, PRODUCT, typed)
        self.assertEqual(unknown["error"], "pii_rejected")
        self.assertNotIn("Secret", json.dumps(unknown))

        plain = {"product_id": PRODUCT, "created_at": "2026-10-17T00:00:00+00:00", "affiliate_url": URL}
        unattested = await self.tool("verify_link")(URL, None, PRODUCT, plain)
        self.assertTrue(unattested["ok"])
        self.assertEqual(unattested["target_verified"], "unknown")
        self.assertEqual(unattested["ownership_verified"], "unknown")

        buyer = receipt(buyer_name="Ada Lovelace", order_id="ORD-12345")
        rejected = await self.tool("verify_link")(URL, None, PRODUCT, buyer)
        self.assertEqual(rejected["error"], "pii_rejected")
        encoded = json.dumps(rejected)
        self.assertNotIn("Ada", encoded)
        self.assertNotIn("ORD-12345", encoded)

    async def test_disconnected_create_is_not_replayed(self) -> None:
        peer = await self.connect()

        async def drop(_peer=peer):
            command = await asyncio.wait_for(_peer.recv(), timeout=2)
            _peer.writer.close()
            return command

        served = asyncio.create_task(drop())
        first = await self.tool("create_link")(
            self.page["page_id"], PRODUCT, ["tiktok", "P1"], "tiktok", "clip-lost", WORKSPACE,
        )
        command = await served
        self.assertEqual(command["operation"], "create_link_with_subids")
        self.assertEqual(first["status"], "unconfirmed")
        self.assertFalse(first["retry_automatically"])

        peer2 = await self.connect()
        served = asyncio.create_task(peer2.recv())
        second = await self.tool("create_link")(
            self.page["page_id"], PRODUCT, ["tiktok", "P1"], "tiktok", "clip-lost", WORKSPACE,
        )
        self.assertFalse(served.done())
        served.cancel()
        self.assertEqual(second["error"], "create_not_replayed")
        self.assertEqual(second["status"], "unconfirmed")
        self.assertFalse(second["clicked"])
        self.assertEqual(self.store.find_links(WORKSPACE, product_id=PRODUCT)["total"], 0)

    async def test_batch_does_not_bind_or_persist_a_different_product(self) -> None:
        peer = await self.connect()

        def wrong(command):
            return {
                "ok": True,
                "results": [{
                    **confirmed("999", "https://s.shopee.co.th/WrongProd1"),
                    "item_index": 0,
                }],
            }

        served = asyncio.create_task(self.answer(peer, wrong))
        batched = await self.tool("batch_create_links")(
            self.page["page_id"],
            [{"product_id": PRODUCT, "sub_ids": ["tiktok", "P1"]}],
            "tiktok",
            WORKSPACE,
        )
        await served
        row = batched["results"][0]
        self.assertFalse(row.get("saved_to_workspace"))
        self.assertEqual(row.get("save_error"), "product_not_attested")
        self.assertEqual(self.store.find_links(WORKSPACE)["total"], 0)

        def missing(command):
            return {
                "ok": False,
                "results": [{
                    "ok": False,
                    "item_index": 0,
                    "product_id": command["arguments"]["items"][0]["product_id"],
                    "status": "not_attempted",
                    "error": "subid_field_missing",
                    "clicked": False,
                }],
            }

        served = asyncio.create_task(self.answer(peer, missing))
        attempted = await self.tool("batch_create_links")(
            self.page["page_id"],
            [{"product_id": PRODUCT, "sub_ids": ["tiktok", "P2", "v6"]}],
            "tiktok",
            WORKSPACE,
        )
        await served
        self.assertEqual(attempted["results"][0]["status"], "not_attempted")
        self.assertEqual(self.store.find_links(WORKSPACE)["total"], 0)
        served = asyncio.create_task(self.answer(peer, missing))
        again = await self.tool("batch_create_links")(
            self.page["page_id"],
            [{"product_id": PRODUCT, "sub_ids": ["tiktok", "P2", "v6"]}],
            "tiktok",
            WORKSPACE,
        )
        command = await served
        self.assertEqual(command["operation"], "batch_create_links")
        self.assertEqual(again["results"][0]["status"], "not_attempted")


if __name__ == "__main__":
    unittest.main()
