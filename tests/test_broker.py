"""Offline protocol tests for the ShopKud Unix-socket broker."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import stat
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from shopkud_mcp.broker import (
    MAX_FRAME_BYTES,
    PRODUCT_PAGE_URL,
    Broker,
    BrokerError,
)


ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"
OTHER_ORIGIN = "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/"


def encode_frame(value: dict) -> bytes:
    body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return struct.pack("<I", len(body)) + body


async def read_frame(reader: asyncio.StreamReader) -> dict:
    size = struct.unpack("<I", await reader.readexactly(4))[0]
    body = await reader.readexactly(size)
    return json.loads(body.decode("utf-8"))


def page(tab_id: int, random: str | None = None, *, title: str = "ShopKud offer") -> dict:
    suffix = random if random is not None else f"{tab_id:032x}"
    return {
        "page_id": f"{tab_id}:{suffix}",
        "url": PRODUCT_PAGE_URL,
        "title": title,
    }


class FakePeer:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self.reader = reader
        self.writer = writer

    async def send(self, value: dict) -> None:
        self.writer.write(encode_frame(value))
        await self.writer.drain()

    async def recv(self) -> dict:
        return await asyncio.wait_for(read_frame(self.reader), timeout=1)

    async def close(self) -> None:
        self.writer.close()
        try:
            await self.writer.wait_closed()
        except (ConnectionError, OSError):
            pass


class TcpBrokerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="shopkud-tcp-broker-")
        self.root=Path(self.temp.name).resolve();os.chmod(self.root,0o700)
        self.token="f"*64
        self.broker=Broker(self.root/"unused.sock",[ORIGIN],native_port=0,native_token=self.token)
        await self.broker.start()

    async def asyncTearDown(self):
        await self.broker.stop();self.temp.cleanup()

    async def connect(self,token):
        reader,writer=await asyncio.open_connection("127.0.0.1",self.broker.native_port)
        writer.write(encode_frame({"type":"hello","origin":ORIGIN,"token":token}))
        await writer.drain()
        return reader,writer

    async def test_tcp_bridge_requires_secret_and_accepts_exact_origin(self):
        rejected_reader,rejected_writer=await self.connect("0"*64)
        self.assertEqual(await asyncio.wait_for(rejected_reader.read(),timeout=1),b"")
        rejected_writer.close();await rejected_writer.wait_closed()
        reader,writer=await self.connect(self.token)
        self.assertEqual(await asyncio.wait_for(read_frame(reader),timeout=1),{"type":"hello-ack"})
        writer.close();await writer.wait_closed()

    async def test_native_host_relays_over_tcp(self):
        config=self.root/"config.json"
        config.write_text(json.dumps({
            "token":"a"*64,"port":8176,"socket_path":str(self.root/"native.sock"),
            "allowed_origins":[ORIGIN],"native_port":self.broker.native_port,
            "native_token":self.token,
        }))
        os.chmod(config,0o600)
        launcher=shutil.which("shopkud-native-host")
        command=[launcher] if launcher else [sys.executable,str(Path(__file__).parents[1]/"shopkud_mcp"/"native_host.py")]
        process=await asyncio.create_subprocess_exec(
            *command,"--config",str(config),ORIGIN,"--parent-window=0",
            stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self.assertEqual(await asyncio.wait_for(read_frame(process.stdout),timeout=2),{"type":"hello-ack"})
        process.stdin.write(encode_frame({"type":"pages","pages":[page(31)]}))
        await process.stdin.drain()
        for _ in range(100):
            if len(self.broker.pages())==1:break
            await asyncio.sleep(0.01)
        self.assertEqual(len(self.broker.pages()),1)
        process.stdin.close()
        await asyncio.wait_for(process.wait(),timeout=2)
        self.assertEqual(process.returncode,0)


class BrokerTests(unittest.IsolatedAsyncioTestCase):
    async def test_product_detail_roster_is_canonical_and_narrow(self):
        item=page(10)
        item["url"]=PRODUCT_PAGE_URL+"/67890"
        self.assertEqual(Broker._validate_page(item),item)
        for suffix in ["/", "/0", "/0123", "/-1", "/123/", "/123?x=1", "/123#x", "/123/456", "/"+"9"*21, "/%31"]:
            with self.subTest(suffix=suffix), self.assertRaises(BrokerError):
                Broker._validate_page({**item,"url":PRODUCT_PAGE_URL+suffix})
        with self.assertRaises(BrokerError):
            Broker._validate_page({**item,"url":"https://affiliate.shopee.co.th.evil/offer/product_offer/123"})

    async def asyncSetUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="shopkud-broker-")
        self.root = Path(self.temp.name).resolve()
        os.chmod(self.root, 0o700)
        self.socket_path = self.root / "broker.sock"
        self.broker = Broker(self.socket_path, [ORIGIN])
        await self.broker.start()
        self.peers: list[FakePeer] = []

    async def asyncTearDown(self) -> None:
        for peer in self.peers:
            await peer.close()
        await self.broker.stop()
        self.temp.cleanup()

    async def connect(self, *, origin: str = ORIGIN, pages: list[dict] | None = None) -> FakePeer:
        reader, writer = await asyncio.open_unix_connection(str(self.socket_path))
        peer = FakePeer(reader, writer)
        self.peers.append(peer)
        await peer.send({"type": "hello", "origin": origin})
        ack = await peer.recv()
        self.assertEqual(ack, {"type": "hello-ack"})
        if pages is not None:
            expected_total = len(self.broker.pages()) + len(pages)
            await peer.send({"type": "pages", "pages": pages})
            await self.wait_for_pages(expected_total)
        return peer

    async def wait_for_pages(self, count: int) -> None:
        for _ in range(100):
            if len(self.broker.pages()) == count:
                return
            await asyncio.sleep(0.005)
        self.fail(f"broker page roster did not reach {count} entries")

    async def expect_closed(self, peer: FakePeer) -> None:
        closed = await asyncio.wait_for(peer.reader.read(1), timeout=1)
        self.assertEqual(closed, b"")

    async def test_socket_permissions_refuse_existing_and_remove_only_owned_inode(self) -> None:
        info = os.lstat(self.socket_path)
        self.assertTrue(stat.S_ISSOCK(info.st_mode))
        self.assertEqual(stat.S_IMODE(info.st_mode), 0o600)

        competing = Broker(self.socket_path, [ORIGIN])
        with self.assertRaises(BrokerError) as caught:
            await competing.start()
        self.assertEqual(caught.exception.code, "socket_in_use")
        current = os.lstat(self.socket_path)
        self.assertEqual((current.st_dev, current.st_ino), (info.st_dev, info.st_ino))

        await self.broker.stop()
        self.assertFalse(self.socket_path.exists())
        await self.broker.stop()  # stop is idempotent

        replacement = Broker(self.socket_path, [ORIGIN])
        await replacement.start()
        self.socket_path.unlink()
        self.socket_path.write_text("not the broker socket", encoding="utf-8")
        await replacement.stop()
        self.assertEqual(self.socket_path.read_text(encoding="utf-8"), "not the broker socket")

    async def test_parent_directory_must_be_canonical_private_and_owned(self) -> None:
        await self.broker.stop()
        os.chmod(self.root, 0o755)
        with self.assertRaises(BrokerError) as caught:
            await self.broker.start()
        self.assertEqual(caught.exception.code, "unsafe_directory")
        self.assertFalse(self.socket_path.exists())
        os.chmod(self.root, 0o700)

        alias = self.root / "alias"
        alias.symlink_to(self.root, target_is_directory=True)
        noncanonical = Broker(alias / "other.sock", [ORIGIN])
        with self.assertRaises(BrokerError) as caught:
            await noncanonical.start()
        self.assertEqual(caught.exception.code, "unsafe_directory")

    async def test_wrong_origin_and_oversized_frame_are_closed_without_registration(self) -> None:
        reader, writer = await asyncio.open_unix_connection(str(self.socket_path))
        wrong = FakePeer(reader, writer)
        self.peers.append(wrong)
        await wrong.send({"type": "hello", "origin": OTHER_ORIGIN})
        self.assertEqual(await asyncio.wait_for(reader.read(1), timeout=1), b"")
        self.assertEqual(self.broker.pages(), [])

        peer = await self.connect(pages=[page(10)])
        peer.writer.write(struct.pack("<I", MAX_FRAME_BYTES + 1))
        await peer.writer.drain()
        await self.expect_closed(peer)
        await self.wait_for_pages(0)

        malformed = await self.connect()
        malformed.writer.write(struct.pack("<I", 2) + b"xx")
        await malformed.writer.drain()
        await self.expect_closed(malformed)

    async def test_global_page_cap_and_bounded_title_are_enforced(self) -> None:
        items = [page(tab_id, title=f"Offer {tab_id}") for tab_id in range(100, 120)]
        await self.connect(pages=items)
        self.assertEqual(len(self.broker.pages()), 20)

        extra = await self.connect()
        await extra.send({"type": "pages", "pages": [page(120)]})
        await self.expect_closed(extra)
        self.assertEqual(len(self.broker.pages()), 20)

        await self.broker.stop()
        restarted = Broker(self.socket_path, [ORIGIN])
        await restarted.start()
        self.broker = restarted
        too_long = await self.connect()
        await too_long.send({"type": "pages", "pages": [page(121, title="x" * 501)]})
        await self.expect_closed(too_long)
        self.assertEqual(self.broker.pages(), [])

    async def test_roster_rejects_bad_url_duplicate_ids_and_unknown_operations(self) -> None:
        peer = await self.connect()
        bad_url = page(11)
        bad_url["url"] += "/"
        await peer.send({"type": "pages", "pages": [bad_url]})
        await self.expect_closed(peer)
        self.assertEqual(self.broker.pages(), [])

        duplicate = await self.connect()
        item = page(12)
        await duplicate.send({"type": "pages", "pages": [item, dict(item)]})
        await self.expect_closed(duplicate)
        self.assertEqual(self.broker.pages(), [])

        live = await self.connect(pages=[page(13)])
        with self.assertRaises(BrokerError) as caught:
            await self.broker.call("13:" + f"{13:032x}", "arbitrary-js", {})
        self.assertEqual(caught.exception.code, "invalid_request")
        with self.assertRaises(BrokerError) as caught:
            await self.broker.call("999:" + "f" * 32, "snapshot", {})
        self.assertEqual(caught.exception.code, "unknown_page")
        self.assertEqual(self.broker.pages()[0]["title"], "ShopKud offer")

    async def test_multiple_pages_route_commands_and_correlate_results_per_peer(self) -> None:
        first = page(21)
        second = page(22)
        peer_one = await self.connect(pages=[first, second])
        third = page(23)
        peer_two = await self.connect(pages=[third])
        self.assertEqual(len(self.broker.pages()), 3)

        task = asyncio.create_task(self.broker.call(third["page_id"], "prepare", {"brief": "bounded"}))
        command = await peer_two.recv()
        self.assertEqual(command["type"], "command")
        self.assertEqual(command["page_id"], third["page_id"])
        self.assertEqual(command["operation"], "prepare")
        self.assertEqual(command["arguments"], {"brief": "bounded"})
        with self.assertRaises(asyncio.TimeoutError):
            await asyncio.wait_for(read_frame(peer_one.reader), timeout=0.03)
        await peer_one.send({"type": "result", "id": command["id"], "result": {"wrong_peer": True}})
        await self.expect_closed(peer_one)
        result = {"status": "prepared", "opaque": [1, 2, 3]}
        await peer_two.send({"type": "result", "id": command["id"], "result": result})
        self.assertEqual(await task, result)

    async def test_discover_pages_recovers_roster_without_replaying_product_commands(self) -> None:
        current = page(61)
        peer = await self.connect()

        recovery = asyncio.create_task(self.broker.discover_pages())
        self.assertEqual(await peer.recv(), {"type": "discover"})
        await peer.send({"type": "pages", "pages": [current]})
        await peer.send({
            "type": "discovered", "extension_version": "0.8.1",
            "blocked_pages": [], "tab_limit_reached": False,
        })
        self.assertEqual(await recovery, {
            "state": "ready", "extension_versions": ["0.8.1"],
            "blocked_pages": [], "tab_limit_reached": False,
        })
        self.assertEqual(self.broker.pages(), [current])
        with self.assertRaises(asyncio.TimeoutError):
            await asyncio.wait_for(read_frame(peer.reader), timeout=0.03)

    async def test_discover_pages_reports_disconnected_and_challenge_states(self) -> None:
        self.assertEqual(await self.broker.discover_pages(), {
            "state": "extension_disconnected", "extension_versions": [], "blocked_pages": [],
        })

        peer = await self.connect()
        task = asyncio.create_task(self.broker.discover_pages())
        self.assertEqual(await peer.recv(), {"type": "discover"})
        await peer.send({
            "type": "discovered", "extension_version": "0.8.1",
            "blocked_pages": [{"tab_id": 61, "state": "challenge_detected"}],
            "tab_limit_reached": False,
        })
        self.assertEqual(await task, {
            "state": "challenge_detected", "extension_versions": ["0.8.1"],
            "blocked_pages": [{"tab_id": 61, "state": "challenge_detected"}],
            "tab_limit_reached": False,
        })
        self.assertEqual(self.broker.pages(), [])

    async def test_discover_pages_does_not_probe_peer_with_in_flight_command(self) -> None:
        current = page(62)
        peer = await self.connect(pages=[current])
        command_task = asyncio.create_task(self.broker.call(current["page_id"], "snapshot", {}))
        command = await peer.recv()
        recovery = await self.broker.discover_pages()
        # Existing pages keep the aggregate state ready, but the busy peer itself
        # must not receive an overlapping discovery frame.
        self.assertEqual(recovery["state"], "ready")
        with self.assertRaises(asyncio.TimeoutError):
            await asyncio.wait_for(read_frame(peer.reader), timeout=0.03)
        await peer.send({"type": "result", "id": command["id"], "result": {"ok": True}})
        self.assertEqual(await command_task, {"ok": True})

    async def test_open_offer_uses_only_extension_target_and_serializes_global_entries(self) -> None:
        peer = await self.connect()
        opening = asyncio.create_task(self.broker.call(
            "extension", "open_offer", {"offer_url": PRODUCT_PAGE_URL + "/123"}, timeout=2,
        ))
        command = await peer.recv()
        self.assertEqual(command["page_id"], "extension")
        self.assertEqual(command["operation"], "open_offer")
        self.assertEqual(command["arguments"], {"offer_url": PRODUCT_PAGE_URL + "/123"})

        queued = asyncio.create_task(self.broker.call("extension", "open_offer", {"offer_url": PRODUCT_PAGE_URL + "/456"}, timeout=2))
        await asyncio.sleep(0.03)
        self.assertFalse(queued.done())
        with self.assertRaises(BrokerError) as caught:
            await self.broker.call("extension", "snapshot", {})
        self.assertEqual(caught.exception.code, "invalid_request")

        result = {"ok": True, "page_id": "123:" + "c" * 32}
        await peer.send({"type": "result", "id": command["id"], "result": result})
        self.assertEqual(await opening, result)

        next_command = await peer.recv()
        self.assertEqual(next_command["arguments"]["offer_url"], PRODUCT_PAGE_URL + "/456")
        await peer.send({"type": "result", "id": next_command["id"], "result": result})
        self.assertEqual(await queued, result)

    async def test_open_offer_fails_closed_when_multiple_extension_peers_are_connected(self) -> None:
        await self.connect()
        await self.connect()
        with self.assertRaises(BrokerError) as caught:
            await self.broker.call("extension", "open_offer", {"offer_url": PRODUCT_PAGE_URL + "/123"})
        self.assertEqual(caught.exception.code, "ambiguous_extension")

    async def test_extension_read_and_report_share_one_serial_queue(self) -> None:
        peer = await self.connect()
        reading = asyncio.create_task(self.broker.call("extension", "read_listing", {"url": PRODUCT_PAGE_URL + "/123"}, timeout=2))
        first = await peer.recv()
        self.assertEqual(first["operation"], "read_listing")
        reporting = asyncio.create_task(self.broker.call("extension", "research_report", {"report_id": "c"*16}, timeout=2))
        await asyncio.sleep(0.03)
        self.assertFalse(reporting.done())
        await peer.send({"type":"result","id":first["id"],"result":{"ok":True,"product_id":"123"}})
        self.assertEqual((await reading)["product_id"],"123")
        second = await peer.recv()
        self.assertEqual(second["operation"],"research_report")
        await peer.send({"type":"result","id":second["id"],"result":{"ok":True}})
        self.assertEqual(await reporting,{"ok":True})

    async def test_two_detail_reads_on_one_page_serialize(self) -> None:
        current=page(27)
        peer=await self.connect(pages=[current])
        first_task=asyncio.create_task(self.broker.call(current["page_id"],"detail",{},timeout=2))
        first=await peer.recv()
        second_task=asyncio.create_task(self.broker.call(current["page_id"],"detail",{},timeout=2))
        await asyncio.sleep(0.03)
        self.assertFalse(second_task.done())
        await peer.send({"type":"result","id":first["id"],"result":{"ok":True,"read":1}})
        self.assertEqual((await first_task)["read"],1)
        second=await peer.recv()
        await peer.send({"type":"result","id":second["id"],"result":{"ok":True,"read":2}})
        self.assertEqual((await second_task)["read"],2)

    async def test_queue_wait_and_execution_share_one_timeout_budget(self) -> None:
        peer = await self.connect()
        active = asyncio.create_task(self.broker.call("extension", "read_listing", {}, timeout=2))
        first = await peer.recv()
        started = asyncio.get_running_loop().time()
        queued = asyncio.create_task(self.broker.call("extension", "research_report", {}, timeout=0.08))
        await asyncio.sleep(0.05)
        await peer.send({"type":"result","id":first["id"],"result":{"ok":True}})
        self.assertEqual(await active,{"ok":True})
        second = await peer.recv()
        with self.assertRaises(BrokerError) as caught:
            await queued
        self.assertEqual(caught.exception.code,"timeout")
        self.assertLess(asyncio.get_running_loop().time()-started,0.13)
        self.assertEqual(second["operation"],"research_report")
        await self.expect_closed(peer)

    async def test_entry_wait_timeout_and_cancel_never_dispatch(self) -> None:
        peer = await self.connect()
        active = asyncio.create_task(self.broker.call("extension", "research_report", {}, timeout=2))
        command = await peer.recv()
        with self.assertRaises(BrokerError) as caught:
            await self.broker.call("extension", "open_offer", {}, timeout=0.02)
        self.assertEqual(caught.exception.code, "busy")
        queued = asyncio.create_task(self.broker.call("extension", "open_offer", {}, timeout=2))
        await asyncio.sleep(0.02)
        queued.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await queued
        self.assertEqual(len(next(iter(self.broker._peers)).pending), 1)
        await peer.send({"type":"result", "id":command["id"], "result":{"ok":True}})
        self.assertEqual(await active, {"ok":True})

    async def test_playbook_event_uses_extension_target_and_is_allowlisted(self) -> None:
        peer = await self.connect()
        event = {"schema_version": 1, "trace_id": "a" * 16, "stage": "queued"}
        task = asyncio.create_task(self.broker.call("extension", "playbook_event", event, timeout=2))
        command = await peer.recv()
        self.assertEqual(command["page_id"], "extension")
        self.assertEqual(command["operation"], "playbook_event")
        self.assertEqual(command["arguments"], event)
        await peer.send({"type": "result", "id": command["id"], "result": {"ok": True}})
        self.assertEqual(await task, {"ok": True})

    async def test_developer_event_uses_extension_target_and_is_allowlisted(self) -> None:
        peer = await self.connect()
        event = {"schema_version": 1, "event_id": "b" * 16, "trace_id": "a" * 16,
                 "actor": "code", "operation": "rank_affiliate_products"}
        task = asyncio.create_task(self.broker.call("extension", "developer_event", event, timeout=2))
        command = await peer.recv()
        self.assertEqual(command["page_id"], "extension")
        self.assertEqual(command["operation"], "developer_event")
        self.assertEqual(command["arguments"], event)
        await peer.send({"type": "result", "id": command["id"], "result": {"ok": True}})
        self.assertEqual(await task, {"ok": True})

    async def test_research_report_uses_extension_target_and_is_allowlisted(self) -> None:
        peer = await self.connect()
        report = {"schema_version": 1, "report_id": "c" * 16, "status": "working"}
        task = asyncio.create_task(self.broker.call("extension", "research_report", report, timeout=2))
        command = await peer.recv()
        self.assertEqual(command["page_id"], "extension")
        self.assertEqual(command["operation"], "research_report")
        self.assertEqual(command["arguments"], report)
        await peer.send({"type": "result", "id": command["id"], "result": {"ok": True}})
        self.assertEqual(await task, {"ok": True})

    async def test_pagination_navigation_and_scan_operations_are_allowlisted(self) -> None:
        current = page(24)
        peer = await self.connect(pages=[current])
        operations = [
            ("pagination", {}),
            ("navigate", {"page_number": 3}),
            ("scan", {"start_page": 1, "max_pages": 2, "max_products": 50}),
            ("scan_read", {"scan_id": "c" * 32, "limit": 10, "offset": 20}),
        ]
        for operation, arguments in operations:
            task = asyncio.create_task(
                self.broker.call(current["page_id"], operation, arguments, timeout=90 if operation == "scan" else 20)
            )
            command = await peer.recv()
            self.assertEqual(command["operation"], operation)
            self.assertEqual(command["arguments"], arguments)
            response = {"ok": True, "operation": operation}
            await peer.send({"type": "result", "id": command["id"], "result": response})
            self.assertEqual(await task, response)

    async def test_one_in_flight_per_page_timeout_closes_peer_without_retry(self) -> None:
        current = page(31)
        peer = await self.connect(pages=[current])
        pending_call = asyncio.create_task(
            self.broker.call(current["page_id"], "snapshot", {}, timeout=0.08)
        )
        first_command = await peer.recv()
        self.assertEqual(first_command["type"], "command")

        with self.assertRaises(BrokerError) as caught:
            await self.broker.call(current["page_id"], "clear", {})
        self.assertEqual(caught.exception.code, "busy")

        with self.assertRaises(BrokerError) as caught:
            await pending_call
        self.assertEqual(caught.exception.code, "timeout")
        await self.expect_closed(peer)
        await self.wait_for_pages(0)

    async def test_caller_cancel_sends_cancel_and_keeps_page_busy_until_late_result(self) -> None:
        current = page(51)
        peer = await self.connect(pages=[current])
        abandoned = asyncio.create_task(
            self.broker.call(current["page_id"], "scan", {"max_pages": 4}, timeout=90)
        )
        command = await peer.recv()
        abandoned.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await abandoned

        self.assertEqual(await peer.recv(), {
            "type": "cancel",
            "id": command["id"],
            "page_id": current["page_id"],
        })
        with self.assertRaises(BrokerError) as caught:
            await self.broker.call(current["page_id"], "snapshot", {})
        self.assertEqual(caught.exception.code, "busy")
        with self.assertRaises(asyncio.TimeoutError):
            await asyncio.wait_for(read_frame(peer.reader), timeout=0.03)

        await peer.send({"type": "result", "id": command["id"], "result": {"ok": True, "cancelled": True}})
        for _ in range(100):
            if current["page_id"] not in self.broker._busy_pages:
                break
            await asyncio.sleep(0.005)
        self.assertNotIn(current["page_id"], self.broker._busy_pages)
        self.assertEqual(len(self.broker.pages()), 1)

        next_call = asyncio.create_task(self.broker.call(current["page_id"], "snapshot", {}))
        next_command = await peer.recv()
        self.assertEqual(next_command["operation"], "snapshot")
        await peer.send({"type": "result", "id": next_command["id"], "result": {"ok": True}})
        self.assertEqual(await next_call, {"ok": True})

    async def test_unknown_or_duplicate_result_after_cancellation_still_closes_peer(self) -> None:
        for current, use_unknown_id in [
            (page(52), True),
            (page(53), None),
        ]:
            peer = await self.connect(pages=[current])
            abandoned = asyncio.create_task(self.broker.call(current["page_id"], "scan", {}, timeout=90))
            command = await peer.recv()
            abandoned.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await abandoned
            await peer.recv()  # assert the explicit cancel frame arrived
            accepted_id = command["id"]
            if use_unknown_id:
                unknown_id = "f" * 32 if accepted_id != "f" * 32 else "e" * 32
                await peer.send({"type": "result", "id": unknown_id, "result": {"ok": True}})
            else:
                await peer.send({"type": "result", "id": accepted_id, "result": {"ok": True}})
                for _ in range(100):
                    if current["page_id"] not in self.broker._busy_pages:
                        break
                    await asyncio.sleep(0.005)
                await peer.send({"type": "result", "id": accepted_id, "result": {"ok": True}})
            await self.expect_closed(peer)
            await self.wait_for_pages(0)

    async def test_abandoned_result_correlation_expires_and_releases_resources(self) -> None:
        current = page(54)
        peer = await self.connect(pages=[current])
        with patch("shopkud_mcp.broker.ABANDONED_RESULT_TTL", 0.03):
            abandoned = asyncio.create_task(self.broker.call(current["page_id"], "scan", {}, timeout=90))
            await peer.recv()
            abandoned.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await abandoned
            cancel_frame = await peer.recv()
            self.assertEqual(cancel_frame["type"], "cancel")
            await self.expect_closed(peer)
        self.assertEqual(self.broker.pages(), [])
        self.assertNotIn(current["page_id"], self.broker._busy_pages)
        with self.assertRaises(BrokerError) as caught:
            await self.broker.call(current["page_id"], "snapshot", {})
        self.assertEqual(caught.exception.code, "unknown_page")

    async def test_abandoned_capacity_overflow_sends_cancel_then_fails_closed(self) -> None:
        current = page(55)
        peer = await self.connect(pages=[current])
        with patch("shopkud_mcp.broker.MAX_ABANDONED_CALLS", 0):
            abandoned = asyncio.create_task(self.broker.call(current["page_id"], "scan", {}, timeout=90))
            command = await peer.recv()
            abandoned.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await abandoned
            self.assertEqual(await peer.recv(), {
                "type": "cancel",
                "id": command["id"],
                "page_id": current["page_id"],
            })
            await self.expect_closed(peer)
        self.assertEqual(self.broker.pages(), [])
        self.assertNotIn(current["page_id"], self.broker._busy_pages)

    async def test_disconnect_fails_call_once_and_duplicate_result_is_rejected(self) -> None:
        current = page(41)
        peer = await self.connect(pages=[current])
        pending_call = asyncio.create_task(self.broker.call(current["page_id"], "export", {}))
        command = await peer.recv()
        await peer.close()
        with self.assertRaises(BrokerError) as caught:
            await pending_call
        self.assertEqual(caught.exception.code, "disconnected")
        await self.wait_for_pages(0)

        duplicate_peer = await self.connect(pages=[page(42)])
        duplicate_call = asyncio.create_task(
            self.broker.call("42:" + f"{42:032x}", "selections", {})
        )
        command = await duplicate_peer.recv()
        await duplicate_peer.send({"type": "result", "id": command["id"], "result": {"ok": True}})
        self.assertEqual(await duplicate_call, {"ok": True})
        await duplicate_peer.send({"type": "result", "id": command["id"], "result": {"ok": True}})
        await self.expect_closed(duplicate_peer)
        await self.wait_for_pages(0)


if __name__ == "__main__":
    unittest.main()
