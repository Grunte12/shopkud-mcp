"""Offline cancellation diagnostic: fake extension peer, private temp socket."""
import asyncio
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
from test_broker import BrokerTests, page
from shopkud_mcp.broker import BrokerError


async def main():
    fixture = BrokerTests()
    await fixture.asyncSetUp()
    try:
        current = page(71)
        peer = await fixture.connect(pages=[current])
        task = asyncio.create_task(fixture.broker.call(current["page_id"], "scan", {"max_pages": 20}, timeout=90))
        command = await peer.recv()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        cancel = None
        try:
            cancel = await asyncio.wait_for(peer.recv(), timeout=0.25)
        except asyncio.TimeoutError:
            pass
        cancel_frame_received = cancel == {
            "type": "cancel",
            "id": command["id"],
            "page_id": current["page_id"],
        }
        busy_error = None
        if cancel_frame_received:
            try:
                await fixture.broker.call(current["page_id"], "snapshot", {}, timeout=20)
            except BrokerError as error:
                busy_error = error.code
        no_overlap = busy_error == "busy"
        await peer.send({"type": "result", "id": command["id"], "result": {"ok": True, "pages_scanned": 20}})
        closed = False
        try:
            closed = await asyncio.wait_for(peer.reader.read(1), timeout=0.05) == b""
        except asyncio.TimeoutError:
            pass
        late_result_kept_peer = not closed and len(fixture.broker.pages()) == 1
        next_result_released_busy = False
        if late_result_kept_peer:
            next_call = asyncio.create_task(fixture.broker.call(current["page_id"], "snapshot", {}, timeout=20))
            next_command = await peer.recv()
            await peer.send({"type": "result", "id": next_command["id"], "result": {"ok": True, "snapshot": 1}})
            next_result_released_busy = await next_call == {"ok": True, "snapshot": 1}
        passed = cancel_frame_received and no_overlap and late_result_kept_peer and next_result_released_busy
        print(json.dumps({"lane": "offline fake-peer broker cancellation", "status": "pass" if passed else "fail",
                          "caller_cancelled": True, "cancel_frame_received": cancel_frame_received,
                          "second_call_blocked_busy": no_overlap, "late_result_kept_peer": late_result_kept_peer,
                          "next_call_after_late_result_completed": next_result_released_busy,
                          "production_touched": False}))
        return 0 if passed else 1
    finally:
        await fixture.asyncTearDown()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
