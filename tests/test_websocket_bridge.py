import asyncio
import json
from pathlib import Path
import tempfile
import time
import unittest

from shopkud_mcp.broker import Broker
from shopkud_mcp.portable import install
from shopkud_mcp.server import read_config
from shopkud_mcp.websocket_bridge import ExtensionSocket

ID = "abcdefghijklmnopabcdefghijklmnop"


class PortableTests(unittest.TestCase):
    def test_idempotent_private_install(self):
        with tempfile.TemporaryDirectory() as directory:
            path = install(ID, Path(directory).resolve(), 18276)
            before = path.read_bytes()
            self.assertEqual(install(ID, path.parent, 18276), path)
            self.assertEqual(path.read_bytes(), before)
            config = read_config(path)
            self.assertEqual(config["transport"], "websocket")
            self.assertNotEqual(config["token"], config["extension_token"])
            with self.assertRaises(ValueError):
                install(ID, path.parent, 18277)


class SocketTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.config = {"port":18276, "allowed_origins":[f"chrome-extension://{ID}/"], "extension_token":"a"*64}
        self.broker = Broker(Path(tempfile.gettempdir()).resolve()/"shopkud-test"/"native.sock", self.config["allowed_origins"])
        self.broker.websocket_active = True
        self.bridge = ExtensionSocket(self.broker, self.config)
        self.inbox = asyncio.Queue()
        self.outbox = asyncio.Queue()

    async def start(self, origin=None, host="127.0.0.1:18276", query=b""):
        scope = {"type":"websocket", "path":"/extension", "query_string":query,
                 "headers":[(b"origin", (origin or f"chrome-extension://{ID}").encode()), (b"host",host.encode())],
                 "client":("127.0.0.1", 45678)}
        await self.inbox.put({"type":"websocket.connect"})
        self.task = asyncio.create_task(self.bridge(scope,self.inbox.get,self.outbox.put))
        return await asyncio.wait_for(self.outbox.get(),1)

    async def send(self, value):
        await self.inbox.put({"type":"websocket.receive", "text":json.dumps(value)})

    async def recv(self):
        return await asyncio.wait_for(self.outbox.get(),1)

    async def asyncTearDown(self):
        if hasattr(self,"task") and not self.task.done():
            await self.inbox.put({"type":"websocket.disconnect", "code":1000})
        if hasattr(self,"task"):
            await asyncio.wait_for(self.task,1)

    async def test_origin_denied_before_accept(self):
        self.assertEqual((await self.start(origin="https://evil.example"))["type"],"websocket.close")

    async def test_host_denied(self):
        self.assertEqual((await self.start(host="evil.example"))["type"],"websocket.close")

    async def test_query_secret_denied(self):
        self.assertEqual((await self.start(query=b"token=secret"))["type"],"websocket.close")

    async def test_wrong_token(self):
        await self.start()
        await self.send({"type":"hello","token":"b"*64})
        self.assertEqual((await self.recv())["type"],"websocket.close")
        self.assertFalse(self.broker._peers)

    async def test_pairing_closed_by_default(self):
        await self.start()
        await self.send({"type":"pair"})
        self.assertEqual((await self.recv())["type"],"websocket.close")

    async def test_pairing_once(self):
        nonce=self.bridge.begin_pairing()
        await self.start()
        await self.send({"type":"pair","nonce":nonce})
        result=json.loads((await self.recv())["text"])
        self.assertEqual(result,{"type":"paired","token":"a"*64})
        self.assertEqual(self.bridge.pair_until,0)
        self.assertIsNone(self.bridge.pair_nonce)

    async def test_pairing_wrong_nonce(self):
        self.bridge.begin_pairing()
        await self.start()
        await self.send({"type":"pair","nonce":"b"*64})
        self.assertEqual((await self.recv())["type"],"websocket.close")

    async def test_pairing_expired(self):
        nonce=self.bridge.begin_pairing()
        self.bridge.pair_until=time.monotonic()-1
        await self.start()
        await self.send({"type":"pair","nonce":nonce})
        self.assertEqual((await self.recv())["type"],"websocket.close")

    async def test_roundtrip_shared_broker(self):
        await self.start()
        await self.send({"type":"hello","token":"a"*64})
        self.assertEqual(json.loads((await self.recv())["text"]),{"type":"hello-ack"})
        await self.send({"type":"ping"})
        self.assertEqual(json.loads((await self.recv())["text"]),{"type":"pong"})
        call=asyncio.create_task(self.broker.call("extension","entry_info",{}))
        command=json.loads((await self.recv())["text"])
        await self.send({"type":"result","id":command["id"],"result":{"ok":True}})
        self.assertEqual(await call,{"ok":True})


if __name__ == "__main__":
    unittest.main()
