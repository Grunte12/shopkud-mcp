"""A bounded, local-only bridge from a Unix socket to extension pages."""

from __future__ import annotations

import asyncio
import errno
import json
import os
import re
import secrets
import stat
import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


MAX_FRAME_BYTES = 512_000
MAX_PAGES = 20
MAX_TITLE_CHARS = 500
MAX_CALL_TIMEOUT = 120.0
HANDSHAKE_TIMEOUT = 10.0
ABANDONED_RESULT_TTL = 90.0
MAX_ABANDONED_CALLS = MAX_PAGES
ALLOWED_OPERATIONS = frozenset({
    "snapshot", "selections", "prepare", "apply", "export", "clear",
    "pagination", "navigate", "scan", "scan_read", "review", "detail", "open_offer", "entry_info", "search_scan", "read_listing",
    "playbook_event", "reload_extension",
    "create_link_with_subids", "batch_create_links", "verify_link", "selector_health",
})
PRODUCT_PAGE_URL = "https://affiliate.shopee.co.th/offer/product_offer"
_PRODUCT_DETAIL_URL_RE = re.compile(re.escape(PRODUCT_PAGE_URL) + r"/[1-9][0-9]{0,19}\Z")
_ORIGIN_RE = re.compile(r"chrome-extension://[a-p]{32}/\Z")
_PAGE_ID_RE = re.compile(r"(?:0|[1-9][0-9]{0,9}):[0-9a-f]{32}\Z")
_MESSAGE_ID_RE = re.compile(r"[0-9a-f]{32}\Z")

_ERROR_CODES = frozenset({
    "configuration",
    "unsafe_directory",
    "socket_in_use",
    "startup_failed",
    "already_started",
    "not_started",
    "invalid_request",
    "payload_too_large",
    "origin_denied",
    "invalid_frame",
    "invalid_message",
    "protocol_error",
    "unknown_page",
    "ambiguous_extension",
    "busy",
    "timeout",
    "disconnected",
    "closed",
})


class BrokerError(Exception):
    """An error with a stable code and no peer-controlled detail."""

    def __init__(self, code: str):
        self.code = code if code in _ERROR_CODES else "protocol_error"
        super().__init__(self.code)


@dataclass(eq=False)
class _Pending:
    page_id: str
    future: asyncio.Future[dict[str, Any]]
    abandoned: bool = False
    expiry: asyncio.TimerHandle | None = None


@dataclass(eq=False)
class _Peer:
    reader: asyncio.StreamReader
    writer: asyncio.StreamWriter
    origin: str
    pages: dict[str, dict[str, str]] = field(default_factory=dict)
    pending: dict[str, _Pending] = field(default_factory=dict)
    closed: bool = False
    discovery: asyncio.Future | None = None


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _reject_json_constant(_value: str) -> None:
    raise ValueError("invalid JSON number")


def _encode_frame(value: dict[str, Any]) -> bytes:
    try:
        body = json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError, UnicodeError):
        raise BrokerError("invalid_request") from None
    if not body or len(body) > MAX_FRAME_BYTES:
        raise BrokerError("payload_too_large")
    return struct.pack("<I", len(body)) + body


async def _read_frame(reader: asyncio.StreamReader) -> dict[str, Any]:
    try:
        header = await reader.readexactly(4)
        size = struct.unpack("<I", header)[0]
        if size == 0 or size > MAX_FRAME_BYTES:
            raise BrokerError("invalid_frame")
        body = await reader.readexactly(size)
        value = json.loads(
            body.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_json_constant,
        )
    except BrokerError:
        raise
    except (asyncio.IncompleteReadError, UnicodeDecodeError, json.JSONDecodeError, ValueError, RecursionError):
        raise BrokerError("invalid_frame") from None
    if not isinstance(value, dict):
        raise BrokerError("invalid_frame")
    return value


class Broker:
    """Serve an exact-origin extension bridge over a private Unix socket."""

    def __init__(self, socket_path: Path, allowed_origins: list[str]):
        try:
            self.socket_path = Path(socket_path)
        except (TypeError, ValueError):
            raise BrokerError("configuration") from None
        if not self.socket_path.is_absolute() or not self.socket_path.name:
            raise BrokerError("configuration")
        if not isinstance(allowed_origins, list) or not allowed_origins or len(allowed_origins) > MAX_PAGES:
            raise BrokerError("configuration")
        if any(type(origin) is not str or not _ORIGIN_RE.fullmatch(origin) for origin in allowed_origins):
            raise BrokerError("configuration")
        if len(set(allowed_origins)) != len(allowed_origins):
            raise BrokerError("configuration")

        self._allowed_origins = frozenset(allowed_origins)
        self._server: asyncio.AbstractServer | None = None
        self._socket_identity: tuple[int, int] | None = None
        self._peers: set[_Peer] = set()
        self._busy_pages: set[str] = set()

    async def start(self) -> None:
        if self._server is not None:
            raise BrokerError("already_started")
        self._validate_parent_directory()
        try:
            os.lstat(self.socket_path)
        except FileNotFoundError:
            pass
        except OSError:
            raise BrokerError("startup_failed") from None
        else:
            raise BrokerError("socket_in_use")

        server: asyncio.AbstractServer | None = None
        identity: tuple[int, int] | None = None
        try:
            server = await asyncio.start_unix_server(
                self._handle_peer,
                path=str(self.socket_path),
                limit=MAX_FRAME_BYTES + 4,
            )
            info = os.lstat(self.socket_path)
            if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid():
                raise BrokerError("startup_failed")
            identity = (info.st_dev, info.st_ino)
            os.chmod(self.socket_path, 0o600, follow_symlinks=False)
            secured = os.lstat(self.socket_path)
            if ((secured.st_dev, secured.st_ino) != identity
                    or not stat.S_ISSOCK(secured.st_mode)
                    or secured.st_uid != os.getuid()
                    or stat.S_IMODE(secured.st_mode) != 0o600):
                raise BrokerError("startup_failed")
        except BrokerError:
            if server is not None:
                server.close()
                await server.wait_closed()
            self._unlink_if_owned(identity)
            raise
        except OSError as exc:
            if server is not None:
                server.close()
                await server.wait_closed()
            self._unlink_if_owned(identity)
            if exc.errno == errno.EADDRINUSE:
                raise BrokerError("socket_in_use") from None
            raise BrokerError("startup_failed") from None

        self._server = server
        self._socket_identity = identity

    async def stop(self) -> None:
        server, self._server = self._server, None
        if server is not None:
            server.close()
        for peer in tuple(self._peers):
            self._drop_peer(peer, "closed")
        if server is not None:
            await server.wait_closed()
        self._unlink_if_owned(self._socket_identity)
        self._socket_identity = None

    def pages(self) -> list[dict[str, str]]:
        pages = [dict(page) for peer in self._peers if not peer.closed for page in peer.pages.values()]
        pages.sort(key=lambda item: item["page_id"])
        return pages

    async def discover_pages(self) -> dict[str, Any]:
        """One bounded extension roster recovery; never replay a product action."""
        peers = [peer for peer in self._peers if not peer.closed]
        if not peers:
            return {"state": "extension_disconnected", "extension_versions": [], "blocked_pages": []}

        async def discover(peer):
            if peer.pending:
                return {"state": "busy"}
            if peer.discovery is not None and not peer.discovery.done():
                return await asyncio.shield(peer.discovery)
            future = asyncio.get_running_loop().create_future()
            peer.discovery = future
            try:
                peer.writer.write(_encode_frame({"type": "discover"}))
                await peer.writer.drain()
                return await asyncio.wait_for(asyncio.shield(future), timeout=6)
            except (asyncio.TimeoutError, ConnectionError, OSError):
                return {"state": "recovery_unavailable_reload_extension"}
            finally:
                if peer.discovery is future:
                    peer.discovery = None
                if not future.done():
                    future.cancel()

        results = await asyncio.gather(*(discover(peer) for peer in peers))
        blocked = [page for result in results for page in result.get("blocked_pages", [])]
        versions = sorted({result["extension_version"] for result in results if "extension_version" in result})
        state = ("ready" if self.pages() else "challenge_detected" if any(page["state"] == "challenge_detected" for page in blocked)
                 else "busy" if any(result["state"] == "busy" for result in results)
                 else "no_supported_page" if versions else "recovery_unavailable_reload_extension")
        return {"state": state, "extension_versions": versions, "blocked_pages": blocked,
                "tab_limit_reached": any(result.get("tab_limit_reached", False) for result in results)}

    async def call(
        self,
        page_id: str,
        operation: str,
        arguments: dict[str, Any],
        timeout: float = 20,
    ) -> dict[str, Any]:
        if self._server is None:
            raise BrokerError("not_started")
        extension_target = operation in {"open_offer", "entry_info", "read_listing", "playbook_event", "reload_extension"}
        if type(page_id) is not str or (page_id != "extension" if extension_target else not _PAGE_ID_RE.fullmatch(page_id)):
            raise BrokerError("invalid_request")
        if type(operation) is not str or operation not in ALLOWED_OPERATIONS:
            raise BrokerError("invalid_request")
        if type(arguments) is not dict:
            raise BrokerError("invalid_request")
        if (type(timeout) not in (int, float) or timeout <= 0 or timeout > MAX_CALL_TIMEOUT):
            raise BrokerError("invalid_request")

        candidates = [candidate for candidate in self._peers if not candidate.closed and (extension_target or page_id in candidate.pages)]
        if extension_target and len(candidates)>1:
            raise BrokerError("ambiguous_extension")
        peer = next(iter(candidates), None)
        if peer is None:
            raise BrokerError("disconnected" if extension_target else "unknown_page")
        if page_id in self._busy_pages:
            raise BrokerError("busy")

        command_id = secrets.token_hex(16)
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        pending = _Pending(page_id=page_id, future=future)
        peer.pending[command_id] = pending
        self._busy_pages.add(page_id)
        command_queued = False
        try:
            frame = _encode_frame({
                "type": "command",
                "id": command_id,
                "page_id": page_id,
                "operation": operation,
                "arguments": arguments,
            })
            peer.writer.write(frame)
            command_queued = True
            await peer.writer.drain()
            return await asyncio.wait_for(asyncio.shield(future), timeout=float(timeout))
        except asyncio.CancelledError:
            if command_queued and peer.pending.get(command_id) is pending and not peer.closed:
                abandoned_count = sum(
                    item.abandoned
                    for candidate in self._peers
                    for item in candidate.pending.values()
                )
                cancel_frame = _encode_frame({
                    "type": "cancel",
                    "id": command_id,
                    "page_id": page_id,
                })
                if abandoned_count >= MAX_ABANDONED_CALLS:
                    # Closing is the bounded fail-closed alternative: no untracked
                    # browser work can later be mistaken for a new request.
                    if not future.done():
                        future.cancel()
                    try:
                        peer.writer.write(cancel_frame)
                        await peer.writer.drain()
                    except asyncio.CancelledError:
                        self._drop_peer(peer, "closed")
                        raise
                    except (ConnectionError, OSError, RuntimeError):
                        pass
                    self._drop_peer(peer, "closed")
                else:
                    pending.abandoned = True
                    if not future.done():
                        future.cancel()
                    loop = asyncio.get_running_loop()
                    pending.expiry = loop.call_later(
                        ABANDONED_RESULT_TTL,
                        self._expire_abandoned,
                        peer,
                        command_id,
                        pending,
                    )
                    try:
                        peer.writer.write(cancel_frame)
                        await peer.writer.drain()
                    except asyncio.CancelledError:
                        self._drop_peer(peer, "closed")
                        raise
                    except (ConnectionError, OSError, RuntimeError):
                        self._drop_peer(peer, "disconnected")
            raise
        except asyncio.TimeoutError:
            if not future.done():
                future.cancel()
            self._drop_peer(peer, "timeout")
            raise BrokerError("timeout") from None
        except BrokerError:
            raise
        except (ConnectionError, OSError):
            self._drop_peer(peer, "disconnected")
            raise BrokerError("disconnected") from None
        finally:
            if not pending.abandoned:
                if peer.pending.get(command_id) is pending:
                    del peer.pending[command_id]
                self._busy_pages.discard(page_id)
                if not future.done():
                    future.cancel()

    def _expire_abandoned(self, peer: _Peer, command_id: str, pending: _Pending) -> None:
        if peer.pending.get(command_id) is pending and pending.abandoned:
            self._drop_peer(peer, "timeout")

    def _validate_parent_directory(self) -> None:
        parent = self.socket_path.parent
        try:
            resolved = parent.resolve(strict=True)
            info = parent.stat()
        except OSError:
            raise BrokerError("unsafe_directory") from None
        if (resolved != parent or not stat.S_ISDIR(info.st_mode)
                or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700):
            raise BrokerError("unsafe_directory")

    def _unlink_if_owned(self, identity: tuple[int, int] | None) -> None:
        if identity is None:
            return
        try:
            info = os.lstat(self.socket_path)
            if (stat.S_ISSOCK(info.st_mode) and info.st_uid == os.getuid()
                    and (info.st_dev, info.st_ino) == identity):
                os.unlink(self.socket_path)
        except OSError:
            pass

    async def _handle_peer(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        peer: _Peer | None = None
        try:
            hello = await asyncio.wait_for(_read_frame(reader), timeout=HANDSHAKE_TIMEOUT)
            if (set(hello) != {"type", "origin"} or hello.get("type") != "hello"
                    or type(hello.get("origin")) is not str
                    or hello["origin"] not in self._allowed_origins):
                raise BrokerError("origin_denied")
            peer = _Peer(reader=reader, writer=writer, origin=hello["origin"])
            writer.write(_encode_frame({"type": "hello-ack"}))
            await writer.drain()
            self._peers.add(peer)

            while not peer.closed:
                message = await _read_frame(reader)
                await self._handle_message(peer, message)
        except asyncio.CancelledError:
            raise
        except (BrokerError, asyncio.TimeoutError, ConnectionError, OSError):
            pass
        finally:
            if peer is not None:
                self._drop_peer(peer, "disconnected")
            writer.close()
            try:
                await writer.wait_closed()
            except (ConnectionError, OSError):
                pass

    async def _handle_message(self, peer: _Peer, message: dict[str, Any]) -> None:
        message_type = message.get("type")
        if message_type == "discovered":
            if (set(message) != {"type", "extension_version", "blocked_pages", "tab_limit_reached"}
                    or type(message["extension_version"]) is not str
                    or not re.fullmatch(r"[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}", message["extension_version"])
                    or type(message["tab_limit_reached"]) is not bool
                    or type(message["blocked_pages"]) is not list or len(message["blocked_pages"]) > 200):
                raise BrokerError("invalid_message")
            for item in message["blocked_pages"]:
                if (type(item) is not dict or set(item) != {"tab_id", "state"}
                        or type(item["tab_id"]) is not int or not 0 <= item["tab_id"] <= 9999999999
                        or type(item["state"]) is not str
                        or item["state"] not in {"challenge_detected", "unsupported_affiliate_route", "busy"}):
                    raise BrokerError("invalid_message")
            if peer.discovery is not None and not peer.discovery.done():
                peer.discovery.set_result({**message, "state": "completed"})
            return
        if message_type == "pages":
            if set(message) != {"type", "pages"} or type(message.get("pages")) is not list:
                raise BrokerError("invalid_message")
            if len(message["pages"]) > MAX_PAGES:
                raise BrokerError("invalid_message")
            roster: dict[str, dict[str, str]] = {}
            for entry in message["pages"]:
                page = self._validate_page(entry)
                if page["page_id"] in roster:
                    raise BrokerError("invalid_message")
                roster[page["page_id"]] = page

            other_pages = {
                page_id
                for other in self._peers
                if other is not peer and not other.closed
                for page_id in other.pages
            }
            if other_pages.intersection(roster) or len(other_pages) + len(roster) > MAX_PAGES:
                raise BrokerError("invalid_message")
            peer.pages = roster
            return

        if message_type == "result":
            if (set(message) != {"type", "id", "result"}
                    or type(message.get("id")) is not str
                    or not _MESSAGE_ID_RE.fullmatch(message["id"])
                    or type(message.get("result")) is not dict):
                raise BrokerError("invalid_message")
            pending = peer.pending.pop(message["id"], None)
            if pending is None or (pending.future.done() and not pending.abandoned):
                raise BrokerError("protocol_error")
            if pending.expiry is not None:
                pending.expiry.cancel()
                pending.expiry = None
            self._busy_pages.discard(pending.page_id)
            if not pending.abandoned:
                pending.future.set_result(message["result"])
            return

        raise BrokerError("protocol_error")

    @staticmethod
    def _validate_page(value: Any) -> dict[str, str]:
        if type(value) is not dict or set(value) != {"page_id", "url", "title"}:
            raise BrokerError("invalid_message")
        page_id, url, title = value["page_id"], value["url"], value["title"]
        if type(page_id) is not str or not _PAGE_ID_RE.fullmatch(page_id):
            raise BrokerError("invalid_message")
        if type(url) is not str or (url != PRODUCT_PAGE_URL and not _PRODUCT_DETAIL_URL_RE.fullmatch(url)):
            raise BrokerError("invalid_message")
        if (type(title) is not str or len(title) > MAX_TITLE_CHARS
                or any(ord(char) < 32 or ord(char) == 127 for char in title)):
            raise BrokerError("invalid_message")
        return {"page_id": page_id, "url": url, "title": title}

    def _drop_peer(self, peer: _Peer, pending_code: str) -> None:
        if peer.closed:
            return
        peer.closed = True
        self._peers.discard(peer)
        peer.pages.clear()
        for command_id, pending in tuple(peer.pending.items()):
            peer.pending.pop(command_id, None)
            self._busy_pages.discard(pending.page_id)
            if pending.expiry is not None:
                pending.expiry.cancel()
                pending.expiry = None
            if not pending.future.done():
                pending.future.set_exception(BrokerError(pending_code))
        peer.writer.close()
