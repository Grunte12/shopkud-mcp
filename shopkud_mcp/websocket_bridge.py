"""Loopback-only extension transport; shares the existing broker queue/validation."""
import asyncio
import hmac
import json
import time
import secrets

from starlette.websockets import WebSocket, WebSocketDisconnect

from .broker import (
    BrokerError, MAX_FRAME_BYTES, HANDSHAKE_TIMEOUT, _Peer,
    _reject_duplicate_keys, _reject_json_constant,
)


class _Writer:
    def __init__(self, websocket):
        self.websocket = websocket
        self.frames = []
        self.closed = False

    def write(self, frame):
        if self.closed:
            raise ConnectionError("closed")
        self.frames.append(frame[4:].decode("utf-8"))

    async def drain(self):
        while self.frames:
            await self.websocket.send_text(self.frames.pop(0))

    def close(self):
        self.closed = True


class ExtensionSocket:
    def __init__(self, broker, config):
        self.broker = broker
        self.config = config
        self.pair_until = 0
        self.pair_nonce = None

    def begin_pairing(self):
        self.pair_nonce = secrets.token_hex(32)
        self.pair_until = time.monotonic()+120
        return self.pair_nonce

    async def __call__(self, scope, receive, send):
        ws = WebSocket(scope, receive, send)
        origin = ws.headers.get("origin", "") + "/"
        if (ws.headers.get("host") != f"127.0.0.1:{self.config['port']}"
                or origin not in self.config["allowed_origins"]
                or scope.get("query_string")
                or not scope.get("client") or scope["client"][0] != "127.0.0.1"):
            await ws.close(code=1008)
            return
        await ws.accept()
        peer = None
        writer = _Writer(ws)
        try:
            hello = await asyncio.wait_for(self.read(ws), HANDSHAKE_TIMEOUT)
            if hello.get("type") == "pair":
                if (set(hello) != {"type","nonce"} or type(hello["nonce"]) is not str
                        or self.pair_nonce is None
                        or not hmac.compare_digest(hello["nonce"].encode(),self.pair_nonce.encode())
                        or time.monotonic() >= self.pair_until or self.broker._peers):
                    raise BrokerError("origin_denied")
                self.pair_until = 0
                self.pair_nonce = None
                await ws.send_json({"type": "paired", "token": self.config["extension_token"]})
                return
            if (set(hello) != {"type", "token"} or hello["type"] != "hello"
                    or type(hello["token"]) is not str
                    or not hmac.compare_digest(hello["token"].encode(), self.config["extension_token"].encode())):
                raise BrokerError("origin_denied")
            # One paired browser profile per worker; no silent session takeover.
            if self.broker._peers:
                raise BrokerError("busy")
            peer = _Peer(reader=None, writer=writer, origin=origin)
            self.broker._peers.add(peer)
            await ws.send_json({"type": "hello-ack"})
            while not peer.closed:
                message = await asyncio.wait_for(self.read(ws), 60)
                if message == {"type": "ping"}:
                    await ws.send_json({"type": "pong"})
                else:
                    await self.broker._handle_message(peer, message)
        except (BrokerError, WebSocketDisconnect, ValueError, UnicodeError,
                RecursionError, asyncio.TimeoutError, ConnectionError, RuntimeError):
            pass
        finally:
            if peer is not None:
                self.broker._drop_peer(peer, "disconnected")
            try:
                await ws.close(code=1000)
            except (RuntimeError, OSError):
                pass

    @staticmethod
    async def read(ws):
        message = await ws.receive()
        if message["type"] == "websocket.disconnect":
            raise WebSocketDisconnect(message.get("code",1000))
        raw = message.get("text")
        if type(raw) is not str:
            raise BrokerError("invalid_frame")
        if len(raw.encode("utf-8")) > MAX_FRAME_BYTES:
            raise BrokerError("payload_too_large")
        value = json.loads(raw, object_pairs_hook=_reject_duplicate_keys,
                           parse_constant=_reject_json_constant)
        if type(value) is not dict:
            raise BrokerError("invalid_frame")
        return value
