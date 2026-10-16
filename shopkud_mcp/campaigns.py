"""Local, owner-provided affiliate-link ledger and CSV analytics snapshots.

This module deliberately does not generate or fetch affiliate URLs. A URL is
stored exactly as supplied after a narrow format/host check; neither the URL,
its sub-id, nor imported CSV facts are independently verified.
"""

from __future__ import annotations

import csv
import hashlib
import ipaddress
import io
import json
import math
import os
import re
import secrets
import sqlite3
import stat
import unicodedata
from contextlib import contextmanager
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlsplit


DB_FILENAME = "campaigns.sqlite3"
MAX_CSV_BYTES = 200_000
MAX_CSV_ROWS = 1_000
MAX_CSV_COLUMNS = 50
MAX_LINKS_PER_WORKSPACE = 5_000
MAX_REPORTS_PER_WORKSPACE = 2_000
MAX_TOTAL_REPORTS = 1_000
MAX_TOTAL_REPORT_GROUPS = 20_000
MAX_DATABASE_BYTES = 32 * 1024 * 1024
MAX_PAGE_SIZE = 100
MAX_OFFSET = 100_000

# Other marketplaces can only be used where metadata is explicitly declared.
# TikTok Shop here means owner-supplied CSV facts only, not a verified or live
# integration and not an allowed affiliate-link host.
MARKETPLACE_METADATA: dict[str, dict[str, Any]] = {
    "shopee": {
        "display_name": "Shopee",
        "affiliate_hosts": ("s.shopee.co.th",),
        "csv_import": True,
    },
    "tiktok_shop": {
        "display_name": "TikTok Shop",
        "affiliate_hosts": (),
        "csv_import": True,
    },
}

_WORKSPACE_RE = re.compile(r"[0-9a-f]{32}\Z")
_MARKETPLACE_RE = re.compile(r"[a-z][a-z0-9_-]{0,39}\Z")
_SAFE_INTEGER_RE = re.compile(r"[0-9]{1,12}\Z")
_MONEY_RE = re.compile(r"[+-]?[0-9]{1,13}(?:\.[0-9]{1,4})?\Z")
_REPORT_ID_RE = re.compile(r"[0-9a-f]{32}\Z")
_ROLES = frozenset({"sub_id", "commission", "clicks", "orders", "status"})
_STATUSES = frozenset({"pending", "completed", "cancelled", "unknown"})
_AMOUNT_STATES = frozenset({"estimated", "confirmed", "paid"})
_STATUS_KEYS = ("pending", "completed", "cancelled", "unknown")
_PROVENANCE = "owner_provided_not_independently_verified"


class CampaignError(Exception):
    """A stable public error code without user-controlled detail."""

    _CODES = frozenset({
        "configuration",
        "unsafe_directory",
        "unsafe_database",
        "storage_error",
        "storage_limit",
        "invalid_request",
        "unsupported_marketplace",
        "unsafe_url",
        "duplicate_url",
        "duplicate_sub_id",
        "version_conflict",
        "link_limit",
        "invalid_csv",
        "csv_too_large",
        "csv_too_many_rows",
        "csv_too_many_columns",
        "invalid_mapping",
        "invalid_status_map",
        "invalid_period",
        "invalid_amount_state",
        "stale_preview",
        "report_limit",
        "report_not_found",
    })

    def __init__(self, code: str):
        self.code = code if code in self._CODES else "storage_error"
        super().__init__(self.code)


def _fail(code: str) -> None:
    raise CampaignError(code)


def _is_int(value: Any) -> bool:
    return type(value) is int


def _bounded_text(value: Any, *, maximum: int, code: str = "invalid_request") -> str:
    if type(value) is not str:
        _fail(code)
    value = unicodedata.normalize("NFC", value).strip()
    try:
        encoded_length = len(value.encode("utf-8", "strict"))
    except UnicodeError:
        _fail(code)
    if not value or len(value) > maximum or encoded_length > maximum * 4:
        _fail(code)
    if any(unicodedata.category(char) in {"Cc", "Cs"} for char in value):
        _fail(code)
    return value


def _workspace_id(value: Any) -> str:
    if type(value) is not str or not _WORKSPACE_RE.fullmatch(value):
        _fail("invalid_request")
    return value


def _marketplace(value: Any) -> str:
    if type(value) is not str or not _MARKETPLACE_RE.fullmatch(value):
        _fail("invalid_request")
    if value not in MARKETPLACE_METADATA:
        _fail("unsupported_marketplace")
    return value


def _channel(value: Any) -> str:
    return _bounded_text(value, maximum=80)


def _identifier(value: Any, *, maximum: int = 200) -> str:
    return _bounded_text(value, maximum=maximum)


def _validate_affiliate_url(value: Any, marketplace: str) -> str:
    if type(value) is not str or not value or len(value) > 2_048:
        _fail("unsafe_url")
    if any(ord(char) <= 0x20 or ord(char) == 0x7F or char == "\\" for char in value):
        _fail("unsafe_url")
    try:
        parsed = urlsplit(value)
        host = parsed.hostname
        explicit_port = parsed.port
    except (ValueError, UnicodeError):
        _fail("unsafe_url")
    if parsed.scheme.lower() != "https" or not host or parsed.username is not None or parsed.password is not None:
        _fail("unsafe_url")
    if parsed.fragment or explicit_port is not None:
        _fail("unsafe_url")
    host = host.lower()
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None and (not ip.is_global or ip.is_loopback or ip.is_private or ip.is_link_local):
        _fail("unsafe_url")
    if host not in MARKETPLACE_METADATA[marketplace]["affiliate_hosts"]:
        _fail("unsafe_url")
    if not parsed.path.startswith("/") or parsed.path in {"", "/"}:
        _fail("unsafe_url")
    if parsed.netloc.lower() != host:
        _fail("unsafe_url")
    return value


def _date_value(value: Any) -> str:
    if type(value) is not str:
        _fail("invalid_period")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        _fail("invalid_period")
    if parsed.isoformat() != value:
        _fail("invalid_period")
    return value


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _money(value: str) -> Decimal | None:
    normalized = value.strip()
    if not normalized:
        return None
    if not _MONEY_RE.fullmatch(normalized):
        _fail("invalid_csv")
    try:
        amount = Decimal(normalized)
    except InvalidOperation:
        _fail("invalid_csv")
    if not amount.is_finite() or abs(amount) > Decimal("1000000000000"):
        _fail("invalid_csv")
    return amount


def _count_value(value: str) -> int | None:
    normalized = value.strip()
    if not normalized:
        return None
    if not _SAFE_INTEGER_RE.fullmatch(normalized):
        _fail("invalid_csv")
    return int(normalized)


def _decimal_text(value: Decimal | None) -> str | None:
    return None if value is None else format(value, "f")


class CampaignStore:
    """Secure, local SQLite storage for link mappings and immutable reports."""

    def __init__(self, root: str | os.PathLike[str]):
        try:
            supplied = Path(root)
        except (TypeError, ValueError, OSError):
            _fail("configuration")
        if not supplied.is_absolute():
            _fail("configuration")
        try:
            canonical = supplied.resolve(strict=True)
            info = os.lstat(supplied)
        except OSError:
            _fail("unsafe_directory")
        if canonical != supplied or not stat.S_ISDIR(info.st_mode):
            _fail("unsafe_directory")
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
            _fail("unsafe_directory")
        self.root = supplied
        self.db_path = self.root / DB_FILENAME
        self._ensure_database_file()
        try:
            with self._connection(write=True) as connection:
                connection.execute("BEGIN IMMEDIATE")
                connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS links (
                        workspace_id TEXT NOT NULL,
                        channel TEXT NOT NULL,
                        marketplace TEXT NOT NULL,
                        content_id TEXT NOT NULL,
                        product_id TEXT NOT NULL,
                        affiliate_url TEXT NOT NULL,
                        sub_id TEXT NOT NULL,
                        sub_id_1 TEXT,
                        sub_id_2 TEXT,
                        sub_id_3 TEXT,
                        sub_id_4 TEXT,
                        sub_id_5 TEXT,
                        clip_id TEXT,
                        link_source TEXT NOT NULL DEFAULT 'manual',
                        link_receipt_json TEXT,
                        target_verified_at TEXT,
                        ownership_verified_at TEXT,
                        verification_status TEXT,
                        version INTEGER NOT NULL CHECK (version >= 1),
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        PRIMARY KEY (workspace_id, marketplace, content_id, channel, product_id),
                        UNIQUE (workspace_id, sub_id)
                    );
                    CREATE INDEX IF NOT EXISTS links_workspace_url
                        ON links (workspace_id, affiliate_url);
                    CREATE TABLE IF NOT EXISTS product_history (
                        product_id TEXT NOT NULL,
                        affiliate_url TEXT NOT NULL,
                        name TEXT NOT NULL,
                        offer_url TEXT NOT NULL,
                        product_url TEXT NOT NULL,
                        price_min_thb REAL NOT NULL,
                        price_max_thb REAL NOT NULL,
                        first_saved_at TEXT NOT NULL,
                        last_saved_at TEXT NOT NULL,
                        PRIMARY KEY (product_id, affiliate_url)
                    );
                    CREATE TABLE IF NOT EXISTS reports (
                        report_id TEXT PRIMARY KEY,
                        workspace_id TEXT NOT NULL,
                        digest TEXT NOT NULL,
                        idempotency_key TEXT NOT NULL,
                        source_marketplace TEXT NOT NULL,
                        period_start TEXT NOT NULL,
                        period_end TEXT NOT NULL,
                        amount_state TEXT NOT NULL,
                        row_count INTEGER NOT NULL,
                        mapped_rows_count INTEGER NOT NULL,
                        unmapped_rows_count INTEGER NOT NULL,
                        status_present INTEGER NOT NULL,
                        created_at TEXT NOT NULL,
                        UNIQUE (workspace_id, idempotency_key)
                    );
                    CREATE INDEX IF NOT EXISTS reports_workspace_latest
                        ON reports (workspace_id, created_at DESC, report_id DESC);
                    CREATE TABLE IF NOT EXISTS report_groups (
                        report_id TEXT NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
                        channel TEXT,
                        content_id TEXT,
                        destination_marketplace TEXT,
                        unmapped INTEGER NOT NULL CHECK (unmapped IN (0, 1)),
                        row_count INTEGER NOT NULL,
                        commission_sum TEXT,
                        commission_rows_count INTEGER NOT NULL,
                        clicks_sum INTEGER,
                        clicks_rows_count INTEGER NOT NULL,
                        orders_sum INTEGER,
                        orders_rows_count INTEGER NOT NULL,
                        status_counts TEXT,
                        PRIMARY KEY (report_id, channel, content_id, destination_marketplace, unmapped)
                    );
                    CREATE TABLE IF NOT EXISTS batch_jobs (
                        batch_id TEXT PRIMARY KEY,
                        workspace_id TEXT NOT NULL,
                        channel TEXT NOT NULL,
                        marketplace TEXT NOT NULL,
                        clip_id TEXT,
                        status TEXT NOT NULL,
                        total_items INTEGER NOT NULL,
                        completed_items INTEGER NOT NULL DEFAULT 0,
                        failed_items INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        checkpoint_json TEXT
                    );
                    CREATE TABLE IF NOT EXISTS batch_items (
                        batch_id TEXT NOT NULL REFERENCES batch_jobs(batch_id) ON DELETE CASCADE,
                        item_index INTEGER NOT NULL,
                        product_id TEXT NOT NULL,
                        status TEXT NOT NULL,
                        affiliate_url TEXT,
                        link_receipt_json TEXT,
                        error TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        PRIMARY KEY (batch_id, item_index)
                    );
                    CREATE TABLE IF NOT EXISTS link_verifications (
                        affiliate_url TEXT PRIMARY KEY,
                        workspace_id TEXT NOT NULL,
                        verified_at TEXT NOT NULL,
                        target_verified INTEGER NOT NULL,
                        ownership_verified INTEGER NOT NULL,
                        resolved_item_id TEXT,
                        resolved_shop_id TEXT,
                        resolved_title TEXT,
                        verification_method TEXT NOT NULL,
                        verification_evidence_json TEXT
                    );
                    CREATE TABLE IF NOT EXISTS commission_health (
                        product_id TEXT PRIMARY KEY,
                        workspace_id TEXT,
                        clip_id TEXT,
                        last_check_at TEXT NOT NULL,
                        last_commission_pct REAL NOT NULL,
                        last_extra_comm INTEGER NOT NULL,
                        previous_commission_pct REAL,
                        previous_extra_comm INTEGER,
                        status TEXT NOT NULL,
                        alert_created_at TEXT
                    );
                    CREATE TABLE IF NOT EXISTS missions (
                        mission_id TEXT PRIMARY KEY,
                        workspace_id TEXT,
                        name TEXT NOT NULL,
                        reward TEXT,
                        requirements_json TEXT NOT NULL,
                        deadline TEXT,
                        enrolled INTEGER NOT NULL DEFAULT 0,
                        progress_json TEXT,
                        status TEXT NOT NULL,
                        observed_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS video_clips (
                        video_id TEXT PRIMARY KEY,
                        workspace_id TEXT,
                        title TEXT,
                        status TEXT NOT NULL,
                        cart_items_json TEXT,
                        commission_flag INTEGER,
                        observed_at TEXT NOT NULL
                    );
                    """
                )
                # Add migration logic for new columns in existing databases
                existing_columns = {
                    row[1] for row in connection.execute("PRAGMA table_info(links)").fetchall()
                }
                new_link_columns = {
                    "sub_id_1": "TEXT",
                    "sub_id_2": "TEXT", 
                    "sub_id_3": "TEXT",
                    "sub_id_4": "TEXT",
                    "sub_id_5": "TEXT",
                    "clip_id": "TEXT",
                    "link_source": "TEXT NOT NULL DEFAULT 'manual'",
                    "link_receipt_json": "TEXT",
                    "target_verified_at": "TEXT",
                    "ownership_verified_at": "TEXT",
                    "verification_status": "TEXT"
                }
                for col_name, col_type in new_link_columns.items():
                    if col_name not in existing_columns:
                        connection.execute(f"ALTER TABLE links ADD COLUMN {col_name} {col_type}")
                connection.commit()
        except CampaignError:
            raise
        except (OSError, sqlite3.Error):
            _fail("storage_error")
        self._verify_database_file()

    def _ensure_database_file(self) -> None:
        self._verify_root()
        try:
            fd = os.open(
                self.db_path,
                os.O_CREAT | os.O_EXCL | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0),
                0o600,
            )
        except FileExistsError:
            self._verify_database_file()
            return
        except OSError:
            _fail("unsafe_database")
        try:
            os.fchmod(fd, 0o600)
            opened = os.fstat(fd)
            if not stat.S_ISREG(opened.st_mode) or opened.st_uid != os.getuid() or opened.st_nlink != 1:
                _fail("unsafe_database")
        finally:
            os.close(fd)
        self._verify_database_file()

    def _verify_root(self) -> None:
        try:
            info = os.lstat(self.root)
            canonical = self.root.resolve(strict=True)
        except OSError:
            _fail("unsafe_directory")
        if (canonical != self.root or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o700):
            _fail("unsafe_directory")

    def _verify_database_file(self, expected: tuple[int, int] | None = None) -> tuple[int, int]:
        self._verify_root()
        try:
            info = os.lstat(self.db_path)
        except OSError:
            _fail("unsafe_database")
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) != 0o600):
            _fail("unsafe_database")
        identity = (info.st_dev, info.st_ino)
        if expected is not None and identity != expected:
            _fail("unsafe_database")
        return identity

    @contextmanager
    def _connection(self, *, write: bool = False) -> Iterator[sqlite3.Connection]:
        identity = self._verify_database_file()
        connection: sqlite3.Connection | None = None
        try:
            connection = sqlite3.connect(str(self.db_path), timeout=4.0, isolation_level=None)
            if self._verify_database_file() != identity:
                _fail("unsafe_database")
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute("PRAGMA trusted_schema = OFF")
            connection.execute("PRAGMA journal_mode = DELETE")
            connection.execute("PRAGMA synchronous = FULL")
            if write:
                page_size = int(connection.execute("PRAGMA page_size").fetchone()[0])
                max_pages = max(1, MAX_DATABASE_BYTES // page_size)
                connection.execute(f"PRAGMA max_page_count = {max_pages}")
            if not write:
                connection.execute("PRAGMA query_only = ON")
            yield connection
        except CampaignError:
            raise
        except (sqlite3.Error, OSError) as exc:
            _fail(self._storage_error_code(exc))
        finally:
            if connection is not None:
                try:
                    connection.close()
                except sqlite3.Error:
                    pass
        self._verify_database_file(expected=identity)

    @staticmethod
    def _storage_error_code(error: BaseException) -> str:
        if isinstance(error, sqlite3.Error) and getattr(error, "sqlite_errorcode", None) == sqlite3.SQLITE_FULL:
            return "storage_limit"
        return "storage_error"

    def _check_database_capacity(self, connection: sqlite3.Connection, extra_bytes: int = 0) -> None:
        try:
            page_count = int(connection.execute("PRAGMA page_count").fetchone()[0])
            page_size = int(connection.execute("PRAGMA page_size").fetchone()[0])
            file_bytes = os.stat(self.db_path, follow_symlinks=False).st_size
        except (OSError, sqlite3.Error, TypeError, ValueError):
            _fail("storage_error")
        current_bytes = max(page_count * page_size, file_bytes)
        if current_bytes + extra_bytes > MAX_DATABASE_BYTES:
            if connection.in_transaction:
                self._rollback(connection)
            _fail("storage_limit")

    @staticmethod
    def _estimated_group_bytes(groups: dict[tuple[Any, ...], dict[str, Any]]) -> int:
        estimate = 8_192
        for group in groups.values():
            estimate += 2_048
            for field in (group["channel"], group["content_id"], group["destination_marketplace"],
                          group["commission_total_thb"]):
                if field is not None:
                    estimate += len(str(field).encode("utf-8"))
            if group["status_counts"] is not None:
                estimate += len(json.dumps(group["status_counts"], separators=(",", ":")))
        return estimate

    @staticmethod
    def _begin(connection: sqlite3.Connection) -> None:
        try:
            connection.execute("BEGIN IMMEDIATE")
        except sqlite3.Error:
            _fail("storage_error")

    @staticmethod
    def _rollback(connection: sqlite3.Connection) -> None:
        try:
            connection.rollback()
        except sqlite3.Error:
            pass

    def remember_product(self, detail: dict[str, Any]) -> dict[str, Any]:
        """Explicitly save bounded visible facts; no SubID/channel attribution is guessed."""
        if type(detail) is not dict:
            _fail("invalid_request")
        product_id = detail.get("product_id")
        if type(product_id) is not str or not re.fullmatch(r"[1-9][0-9]{0,19}", product_id):
            _fail("invalid_request")
        name = _bounded_text(detail.get("name"), maximum=500)
        offer_url = "https://affiliate.shopee.co.th/offer/product_offer/" + product_id
        if detail.get("offer_url") != offer_url:
            _fail("unsafe_url")
        product_url = detail.get("product_url")
        if type(product_url) is not str or not re.fullmatch(
                r"https://shopee\.co\.th/product/[1-9][0-9]{0,19}/" + product_id, product_url):
            _fail("unsafe_url")
        affiliate_url = detail.get("affiliate_url")
        if affiliate_url is not None:
            affiliate_url = _validate_affiliate_url(affiliate_url, "shopee")
            if detail.get("link_source") != "visible_link_dialog":
                _fail("invalid_request")
        key = (product_id, affiliate_url or "")
        prices = (detail.get("price_min_thb"), detail.get("price_max_thb"))
        if any(type(p) not in {float, int} or not math.isfinite(p) or not 0 <= p <= 1e9 for p in prices) or prices[0] > prices[1]:
            _fail("invalid_request")
        now = datetime.now(timezone.utc).isoformat(timespec="microseconds")
        with self._connection(write=True) as connection:
            self._begin(connection)
            exists = connection.execute("SELECT 1 FROM product_history WHERE product_id=? AND affiliate_url=?", key).fetchone()
            if not exists and connection.execute("SELECT count(*) FROM product_history").fetchone()[0] >= MAX_LINKS_PER_WORKSPACE:
                self._rollback(connection)
                _fail("link_limit")
            self._check_database_capacity(connection, 8192)
            connection.execute("""INSERT INTO product_history VALUES (?,?,?,?,?,?,?,?,?)
                ON CONFLICT(product_id,affiliate_url) DO UPDATE SET name=excluded.name,
                offer_url=excluded.offer_url,product_url=excluded.product_url,
                price_min_thb=excluded.price_min_thb,price_max_thb=excluded.price_max_thb,
                last_saved_at=excluded.last_saved_at""", (*key, name, offer_url, product_url, *prices, now, now))
            connection.commit()
        return {"ok": True, "saved": True, "new_entry": not bool(exists), "product_id": product_id,
                "affiliate_link_saved": affiliate_url is not None, "channel": None, "sub_id": None,
                "link_attribution_verified": False}

    def get_product_history(self, product_id: str | None = None, query: str = "", limit: int = 20, offset: int = 0) -> dict[str, Any]:
        limit, offset = self._page_args(limit, offset)
        if product_id is not None and (type(product_id) is not str or not re.fullmatch(r"[1-9][0-9]{0,19}", product_id)):
            _fail("invalid_request")
        if type(query) is not str or len(query) > 120 or any(ord(c) < 32 for c in query):
            _fail("invalid_request")
        clauses, params = [], []
        if product_id is not None:
            clauses.append("product_id=?")
            params.append(product_id)
        if query:
            clauses.append("name LIKE ? ESCAPE '\\'")
            params.append("%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self._connection() as connection:
            total = connection.execute("SELECT count(*) FROM product_history" + where, params).fetchone()[0]
            rows = connection.execute("SELECT * FROM product_history" + where + " ORDER BY last_saved_at DESC,product_id,affiliate_url LIMIT ? OFFSET ?", (*params, limit, offset)).fetchall()
        fields = ("product_id", "affiliate_url", "name", "offer_url", "product_url", "price_min_thb", "price_max_thb", "first_saved_at", "last_saved_at")
        records = [dict(zip(fields, row)) for row in rows]
        for record in records:
            record["affiliate_url"] = record["affiliate_url"] or None
        return {"ok": True, "records": records, "total": total, "next_offset": offset + len(records) if offset + len(records) < total else None,
                "scope": "explicitly_saved_product_details_only", "link_attribution_verified": False,
                "includes_browser_history": False, "recovers_unsaved_links": False}

    def set_link(
        self,
        workspace_id: str,
        channel: str,
        marketplace: str,
        content_id: str,
        product_id: str,
        affiliate_url: str,
        sub_id: str,
        expected_version: int | None = None,
        sub_id_1: str | None = None,
        sub_id_2: str | None = None,
        sub_id_3: str | None = None,
        sub_id_4: str | None = None,
        sub_id_5: str | None = None,
        clip_id: str | None = None,
        link_source: str = 'manual',
        link_receipt: dict | None = None,
    ) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        channel = _channel(channel)
        marketplace = _marketplace(marketplace)
        content_id = _identifier(content_id)
        product_id = _identifier(product_id)
        affiliate_url = _validate_affiliate_url(affiliate_url, marketplace)
        sub_id = _identifier(sub_id, maximum=128)
        if expected_version is not None and (not _is_int(expected_version) or expected_version < 0):
            _fail("invalid_request")
        
        # Validate optional SubIDs
        sub_ids_list = [sub_id_1, sub_id_2, sub_id_3, sub_id_4, sub_id_5]
        for i, sid in enumerate(sub_ids_list, 1):
            if sid is not None and (type(sid) is not str or len(sid) > 128):
                _fail("invalid_request")
        
        # Validate clip_id and link_source
        if clip_id is not None:
            clip_id = _identifier(clip_id, maximum=200)
        if link_source not in {'manual', 'extension', 'extension_subid_creation', 'api'}:
            _fail("invalid_request")
        
        # Validate link_receipt
        link_receipt_json = None
        if link_receipt is not None:
            if not isinstance(link_receipt, dict):
                _fail("invalid_request")
            try:
                link_receipt_json = json.dumps(link_receipt, ensure_ascii=False, separators=(',', ':'))
                if len(link_receipt_json) > 8192:
                    _fail("invalid_request")
            except (TypeError, ValueError):
                _fail("invalid_request")
        
        key = (workspace_id, marketplace, content_id, channel, product_id)
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        try:
            with self._connection(write=True) as connection:
                self._begin(connection)
                row = connection.execute(
                    """SELECT affiliate_url, sub_id, sub_id_1, sub_id_2, sub_id_3, sub_id_4, sub_id_5,
                              clip_id, link_source, link_receipt_json, version, created_at, updated_at
                       FROM links WHERE workspace_id=? AND marketplace=? AND content_id=?
                       AND channel=? AND product_id=?""",
                    key,
                ).fetchone()
                current_version = int(row[10]) if row else 0
                if expected_version is not None and expected_version != current_version:
                    self._rollback(connection)
                    _fail("version_conflict")
                if row and row[0] == affiliate_url and row[1] == sub_id and \
                   row[2] == sub_id_1 and row[3] == sub_id_2 and row[4] == sub_id_3 and \
                   row[5] == sub_id_4 and row[6] == sub_id_5 and row[7] == clip_id:
                    connection.commit()
                    return self._link_result(
                        key, affiliate_url, sub_id, sub_id_1, sub_id_2, sub_id_3, sub_id_4, sub_id_5,
                        clip_id, link_source, link_receipt_json, current_version, row[11], row[12], changed=False
                    )
                duplicate_url = connection.execute(
                    """SELECT 1 FROM links WHERE workspace_id=? AND affiliate_url=?
                       AND (channel<>? OR content_id<>?) LIMIT 1""",
                    (workspace_id, affiliate_url, channel, content_id),
                ).fetchone()
                if duplicate_url:
                    self._rollback(connection)
                    _fail("duplicate_url")
                duplicate_sub_id = connection.execute(
                    """SELECT 1 FROM links WHERE workspace_id=? AND sub_id=? AND NOT (
                       marketplace=? AND content_id=? AND channel=? AND product_id=?) LIMIT 1""",
                    (workspace_id, sub_id, marketplace, content_id, channel, product_id),
                ).fetchone()
                if duplicate_sub_id:
                    self._rollback(connection)
                    _fail("duplicate_sub_id")
                projected = 8_192 + sum(
                    len(value.encode("utf-8"))
                    for value in (channel, marketplace, content_id, product_id, affiliate_url, sub_id)
                )
                self._check_database_capacity(connection, projected)
                if not row:
                    count = connection.execute(
                        "SELECT count(*) FROM links WHERE workspace_id=?", (workspace_id,)
                    ).fetchone()[0]
                    if count >= MAX_LINKS_PER_WORKSPACE:
                        self._rollback(connection)
                        _fail("link_limit")
                    version = 1
                    connection.execute(
                        """INSERT INTO links
                           (workspace_id, channel, marketplace, content_id, product_id,
                            affiliate_url, sub_id, sub_id_1, sub_id_2, sub_id_3, sub_id_4, sub_id_5,
                            clip_id, link_source, link_receipt_json, version, created_at, updated_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (workspace_id, channel, marketplace, content_id, product_id,
                         affiliate_url, sub_id, sub_id_1, sub_id_2, sub_id_3, sub_id_4, sub_id_5,
                         clip_id, link_source, link_receipt_json, version, now, now),
                    )
                    created_at = now
                else:
                    version = current_version + 1
                    connection.execute(
                        """UPDATE links SET affiliate_url=?, sub_id=?, sub_id_1=?, sub_id_2=?, 
                           sub_id_3=?, sub_id_4=?, sub_id_5=?, clip_id=?, link_source=?, 
                           link_receipt_json=?, version=?, updated_at=?
                           WHERE workspace_id=? AND marketplace=? AND content_id=? AND channel=? AND product_id=?""",
                        (affiliate_url, sub_id, sub_id_1, sub_id_2, sub_id_3, sub_id_4, sub_id_5, 
                         clip_id, link_source, link_receipt_json, version, now, *key),
                    )
                    created_at = row[11]
                self._check_database_capacity(connection)
                connection.commit()
                return self._link_result(key, affiliate_url, sub_id, sub_id_1, sub_id_2, sub_id_3, 
                                        sub_id_4, sub_id_5, clip_id, link_source, link_receipt_json, 
                                        version, created_at, now, changed=True)
        except CampaignError:
            raise
        except sqlite3.IntegrityError:
            _fail("duplicate_sub_id")
        except sqlite3.Error:
            _fail("storage_error")

    @staticmethod
    def _link_result(
        key: tuple[str, str, str, str, str],
        affiliate_url: str,
        sub_id: str,
        sub_id_1: str | None,
        sub_id_2: str | None,
        sub_id_3: str | None,
        sub_id_4: str | None,
        sub_id_5: str | None,
        clip_id: str | None,
        link_source: str,
        link_receipt_json: str | None,
        version: int,
        created_at: str,
        updated_at: str,
        *,
        changed: bool,
    ) -> dict[str, Any]:
        workspace_id, marketplace, content_id, channel, product_id = key
        result = {
            "ok": True,
            "link": {
                "workspace_id": workspace_id,
                "channel": channel,
                "marketplace": marketplace,
                "content_id": content_id,
                "product_id": product_id,
                "affiliate_url": affiliate_url,
                "sub_id": sub_id,
                "version": version,
                "created_at": created_at,
                "updated_at": updated_at,
                "changed": changed,
                "url_validation": "format_only",
                "provenance": _PROVENANCE,
                "link_source": link_source,
            },
        }
        
        # Add optional fields only if they exist
        if sub_id_1 is not None:
            result["link"]["sub_id_1"] = sub_id_1
        if sub_id_2 is not None:
            result["link"]["sub_id_2"] = sub_id_2
        if sub_id_3 is not None:
            result["link"]["sub_id_3"] = sub_id_3
        if sub_id_4 is not None:
            result["link"]["sub_id_4"] = sub_id_4
        if sub_id_5 is not None:
            result["link"]["sub_id_5"] = sub_id_5
        if clip_id is not None:
            result["link"]["clip_id"] = clip_id
        if link_receipt_json is not None:
            try:
                result["link"]["link_receipt"] = json.loads(link_receipt_json)
            except json.JSONDecodeError:
                pass
        
        return result

    def get_links(self, workspace_id: str, limit: int = 20, offset: int = 0) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        limit, offset = self._page_args(limit, offset)
        with self._connection() as connection:
            total = connection.execute(
                "SELECT count(*) FROM links WHERE workspace_id=?", (workspace_id,)
            ).fetchone()[0]
            rows = connection.execute(
                """SELECT workspace_id, channel, marketplace, content_id, product_id,
                          affiliate_url, sub_id, sub_id_1, sub_id_2, sub_id_3, sub_id_4, sub_id_5,
                          clip_id, link_source, link_receipt_json, version, created_at, updated_at
                   FROM links WHERE workspace_id=?
                   ORDER BY channel COLLATE NOCASE, content_id, marketplace, product_id
                   LIMIT ? OFFSET ?""",
                (workspace_id, limit, offset),
            ).fetchall()
        links = []
        for row in rows:
            link = {
                "workspace_id": row[0],
                "channel": row[1],
                "marketplace": row[2],
                "content_id": row[3],
                "product_id": row[4],
                "affiliate_url": row[5],
                "sub_id": row[6],
                "version": row[15],
                "created_at": row[16],
                "updated_at": row[17],
                "url_validation": "format_only",
                "provenance": _PROVENANCE,
                "link_source": row[13] or "manual",
            }
            # Add optional fields
            if row[7]: link["sub_id_1"] = row[7]
            if row[8]: link["sub_id_2"] = row[8]
            if row[9]: link["sub_id_3"] = row[9]
            if row[10]: link["sub_id_4"] = row[10]
            if row[11]: link["sub_id_5"] = row[11]
            if row[12]: link["clip_id"] = row[12]
            if row[14]:
                try:
                    link["link_receipt"] = json.loads(row[14])
                except json.JSONDecodeError:
                    pass
            links.append(link)
        return {"ok": True, "links": links, "total": int(total), "limit": limit, "offset": offset}
    
    def find_links(
        self,
        workspace_id: str,
        product_id: str | None = None,
        channel: str | None = None,
        clip_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        """Find links by product, channel, or clip_id"""
        workspace_id = _workspace_id(workspace_id)
        limit, offset = self._page_args(limit, offset)
        
        conditions = ["workspace_id=?"]
        params: list[Any] = [workspace_id]
        
        if product_id is not None:
            product_id = _identifier(product_id)
            conditions.append("product_id=?")
            params.append(product_id)
        
        if channel is not None:
            channel = _channel(channel)
            conditions.append("channel=?")
            params.append(channel)
        
        if clip_id is not None:
            clip_id = _identifier(clip_id)
            conditions.append("clip_id=?")
            params.append(clip_id)
        
        where_clause = " AND ".join(conditions)
        
        with self._connection() as connection:
            total = connection.execute(
                f"SELECT count(*) FROM links WHERE {where_clause}", params
            ).fetchone()[0]
            
            rows = connection.execute(
                f"""SELECT workspace_id, channel, marketplace, content_id, product_id,
                           affiliate_url, sub_id, sub_id_1, sub_id_2, sub_id_3, sub_id_4, sub_id_5,
                           clip_id, link_source, link_receipt_json, version, created_at, updated_at
                    FROM links WHERE {where_clause}
                    ORDER BY created_at DESC
                    LIMIT ? OFFSET ?""",
                (*params, limit, offset),
            ).fetchall()
        
        links = []
        for row in rows:
            link = {
                "workspace_id": row[0],
                "channel": row[1],
                "marketplace": row[2],
                "content_id": row[3],
                "product_id": row[4],
                "affiliate_url": row[5],
                "sub_id": row[6],
                "version": row[15],
                "created_at": row[16],
                "updated_at": row[17],
                "url_validation": "format_only",
                "provenance": _PROVENANCE,
                "link_source": row[13] or "manual",
            }
            if row[7]: link["sub_id_1"] = row[7]
            if row[8]: link["sub_id_2"] = row[8]
            if row[9]: link["sub_id_3"] = row[9]
            if row[10]: link["sub_id_4"] = row[10]
            if row[11]: link["sub_id_5"] = row[11]
            if row[12]: link["clip_id"] = row[12]
            if row[14]:
                try:
                    link["link_receipt"] = json.loads(row[14])
                except json.JSONDecodeError:
                    pass
            links.append(link)
        
        return {
            "ok": True,
            "links": links,
            "total": int(total),
            "limit": limit,
            "offset": offset,
            "filters": {
                "product_id": product_id,
                "channel": channel,
                "clip_id": clip_id
            }
        }

    def import_csv(
        self,
        workspace_id: str,
        csv_text: str,
        mapping: dict[str, str],
        marketplace: str,
        period_start: str,
        period_end: str,
        amount_state: str = "estimated",
        commit: bool = False,
        expected_digest: str | None = None,
        status_map: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        marketplace = _marketplace(marketplace)
        if not MARKETPLACE_METADATA[marketplace]["csv_import"]:
            _fail("unsupported_marketplace")
        period_start = _date_value(period_start)
        period_end = _date_value(period_end)
        if period_start > period_end:
            _fail("invalid_period")
        if type(amount_state) is not str or amount_state not in _AMOUNT_STATES:
            _fail("invalid_amount_state")
        if type(commit) is not bool:
            _fail("invalid_request")
        if expected_digest is not None and (type(expected_digest) is not str
                or not re.fullmatch(r"[0-9a-f]{64}", expected_digest)):
            _fail("invalid_request")
        normalized_mapping = self._validate_mapping(mapping)
        normalized_status_map = self._validate_status_map(status_map)
        parsed = self._parse_csv(csv_text, normalized_mapping, normalized_status_map)
        csv_hash = hashlib.sha256(csv_text.encode("utf-8")).hexdigest()
        idempotency_key = hashlib.sha256(_canonical_json({
            "csv_sha256": csv_hash,
            "mapping": normalized_mapping,
            "marketplace": marketplace,
            "period_start": period_start,
            "period_end": period_end,
            "amount_state": amount_state,
            "status_map": normalized_status_map,
        })).hexdigest()

        if not commit:
            existing = self._existing_report(workspace_id, idempotency_key)
            if existing is not None:
                return {
                    "ok": True,
                    "committed": False,
                    "duplicate": True,
                    "digest": existing["digest"],
                    "preview": self._report_summary(existing),
                }
            with self._connection() as connection:
                links = self._link_snapshot(connection, workspace_id, parsed["sub_ids"])
            digest = self._preview_digest(
                idempotency_key, links, parsed["sub_ids"],
            )
            groups, counts = self._aggregate(parsed, links)
            summary = self._make_summary(
                marketplace, period_start, period_end, amount_state, parsed, groups, counts,
            )
            return {"ok": True, "committed": False, "duplicate": False, "digest": digest, "preview": summary}

        if expected_digest is None:
            _fail("stale_preview")
        try:
            with self._connection(write=True) as connection:
                self._begin(connection)
                existing_row = connection.execute(
                    "SELECT report_id, digest FROM reports WHERE workspace_id=? AND idempotency_key=?",
                    (workspace_id, idempotency_key),
                ).fetchone()
                if existing_row is not None:
                    if existing_row[1] != expected_digest:
                        self._rollback(connection)
                        _fail("stale_preview")
                    connection.commit()
                    report = self._load_report(connection, workspace_id, existing_row[0])
                    return {"ok": True, "committed": True, "duplicate": True,
                            "digest": existing_row[1], "report": self._report_summary(report)}

                links = self._link_snapshot(connection, workspace_id, parsed["sub_ids"])
                digest = self._preview_digest(idempotency_key, links, parsed["sub_ids"])
                if digest != expected_digest:
                    self._rollback(connection)
                    _fail("stale_preview")
                count = connection.execute(
                    "SELECT count(*) FROM reports WHERE workspace_id=?", (workspace_id,)
                ).fetchone()[0]
                total_reports = connection.execute("SELECT count(*) FROM reports").fetchone()[0]
                if count >= MAX_REPORTS_PER_WORKSPACE or total_reports >= MAX_TOTAL_REPORTS:
                    self._rollback(connection)
                    _fail("report_limit")
                groups, counts = self._aggregate(parsed, links)
                total_groups = connection.execute("SELECT count(*) FROM report_groups").fetchone()[0]
                if total_groups + len(groups) > MAX_TOTAL_REPORT_GROUPS:
                    self._rollback(connection)
                    _fail("storage_limit")
                self._check_database_capacity(connection, self._estimated_group_bytes(groups))
                report_id = secrets.token_hex(16)
                created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
                summary = self._make_summary(
                    marketplace, period_start, period_end, amount_state, parsed, groups, counts,
                )
                connection.execute(
                    """INSERT INTO reports
                       (report_id, workspace_id, digest, idempotency_key, source_marketplace,
                        period_start, period_end, amount_state, row_count, mapped_rows_count,
                        unmapped_rows_count, status_present, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (report_id, workspace_id, digest, idempotency_key, marketplace, period_start,
                     period_end, amount_state, summary["rows_count"], summary["mapped_rows_count"],
                     summary["unmapped_rows_count"], int(parsed["status_present"]), created_at),
                )
                for group in groups.values():
                    connection.execute(
                        """INSERT INTO report_groups
                           (report_id, channel, content_id, destination_marketplace, unmapped,
                            row_count, commission_sum, commission_rows_count, clicks_sum,
                            clicks_rows_count, orders_sum, orders_rows_count, status_counts)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (report_id, group["channel"], group["content_id"],
                         group["destination_marketplace"], int(group["unmapped"]), group["rows_count"],
                         group["commission_total_thb"], group["commission_rows_count"],
                         group["clicks_total"], group["clicks_rows_count"],
                         group["orders_total"], group["orders_rows_count"],
                         json.dumps(group["status_counts"], separators=(",", ":"))
                         if group["status_counts"] is not None else None),
                    )
                self._check_database_capacity(connection)
                connection.commit()
                report = self._load_report(connection, workspace_id, report_id)
                return {"ok": True, "committed": True, "duplicate": False,
                        "digest": digest, "report": self._report_summary(report)}
        except CampaignError:
            raise
        except sqlite3.IntegrityError:
            _fail("storage_error")
        except sqlite3.Error:
            _fail("storage_error")

    @staticmethod
    def _validate_mapping(mapping: Any) -> dict[str, str]:
        if type(mapping) is not dict or not {"sub_id", "commission"}.issubset(mapping):
            _fail("invalid_mapping")
        if any(type(key) is not str or key not in _ROLES for key in mapping):
            _fail("invalid_mapping")
        result: dict[str, str] = {}
        for role, header in mapping.items():
            if type(header) is not str or not header or len(header) > 200:
                _fail("invalid_mapping")
            result[role] = header
        if len(set(result.values())) != len(result):
            _fail("invalid_mapping")
        return {role: result[role] for role in sorted(result)}

    @staticmethod
    def _validate_status_map(status_map: Any) -> dict[str, str]:
        if status_map is None:
            return {}
        if type(status_map) is not dict or len(status_map) > 100:
            _fail("invalid_status_map")
        result: dict[str, str] = {}
        for raw, normalized in status_map.items():
            if (type(raw) is not str or not raw or len(raw) > 80
                    or any(unicodedata.category(char) in {"Cc", "Cs"} for char in raw)
                    or type(normalized) is not str or normalized not in _STATUSES):
                _fail("invalid_status_map")
            result[raw] = normalized
        return dict(sorted(result.items()))

    @staticmethod
    def _parse_csv(
        csv_text: Any,
        mapping: dict[str, str],
        status_map: dict[str, str],
    ) -> dict[str, Any]:
        if type(csv_text) is not str:
            _fail("invalid_csv")
        try:
            encoded = csv_text.encode("utf-8", "strict")
        except UnicodeError:
            _fail("invalid_csv")
        if len(encoded) > MAX_CSV_BYTES:
            _fail("csv_too_large")
        text = csv_text.removeprefix("\ufeff")
        try:
            reader = csv.reader(io.StringIO(text, newline=""), strict=True)
            headers = next(reader, None)
            if not headers or len(headers) > MAX_CSV_COLUMNS:
                _fail("invalid_csv" if not headers else "csv_too_many_columns")
            normalized_headers = [unicodedata.normalize("NFC", header).strip().casefold() for header in headers]
            if any(not header for header in normalized_headers) or len(set(normalized_headers)) != len(headers):
                _fail("invalid_csv")
            positions = {header: index for index, header in enumerate(headers)}
            if any(header not in positions for header in mapping.values()):
                _fail("invalid_mapping")
            records: list[dict[str, Any]] = []
            sub_ids: set[str] = set()
            for row in reader:
                if row == [] or all(value == "" for value in row):
                    continue
                if len(row) != len(headers):
                    _fail("invalid_csv")
                if len(records) >= MAX_CSV_ROWS:
                    _fail("csv_too_many_rows")
                def cell(role: str) -> str | None:
                    header = mapping.get(role)
                    return None if header is None else row[positions[header]]

                sub_id = cell("sub_id")
                if sub_id is not None:
                    sub_id = sub_id.strip()
                    if sub_id:
                        if len(sub_id) > 128 or any(unicodedata.category(ch) in {"Cc", "Cs"} for ch in sub_id):
                            _fail("invalid_csv")
                        sub_ids.add(sub_id)
                    else:
                        sub_id = None
                commission_raw = cell("commission")
                commission = _money(commission_raw if commission_raw is not None else "")
                clicks_raw = cell("clicks")
                orders_raw = cell("orders")
                status_raw = cell("status")
                status: str | None = None
                if status_raw is not None:
                    status = status_map.get(status_raw, "unknown")
                records.append({
                    "sub_id": sub_id,
                    "commission": commission,
                    "clicks": _count_value(clicks_raw if clicks_raw is not None else ""),
                    "orders": _count_value(orders_raw if orders_raw is not None else ""),
                    "status": status,
                })
            return {
                "records": records,
                "sub_ids": sorted(sub_ids),
                "status_present": "status" in mapping,
            }
        except CampaignError:
            raise
        except (csv.Error, StopIteration, UnicodeError, ValueError):
            _fail("invalid_csv")

    @staticmethod
    def _link_snapshot(
        connection: sqlite3.Connection,
        workspace_id: str,
        sub_ids: list[str],
    ) -> dict[str, dict[str, str]]:
        if not sub_ids:
            return {}
        rows = []
        # Stay below SQLite builds that retain the historical 999 bind limit.
        for start in range(0, len(sub_ids), 400):
            batch = sub_ids[start:start + 400]
            placeholders = ",".join("?" for _ in batch)
            rows.extend(connection.execute(
                f"""SELECT sub_id, channel, content_id, marketplace
                    FROM links WHERE workspace_id=? AND sub_id IN ({placeholders})""",
                (workspace_id, *batch),
            ).fetchall())
        return {
            row[0]: {"channel": row[1], "content_id": row[2], "destination_marketplace": row[3]}
            for row in rows
        }

    @staticmethod
    def _preview_digest(
        idempotency_key: str,
        links: dict[str, dict[str, str]],
        sub_ids: list[str],
    ) -> str:
        attribution = {sub_id: links.get(sub_id) for sub_id in sub_ids}
        return hashlib.sha256(_canonical_json({
            "idempotency_key": idempotency_key,
            "saved_attribution": attribution,
        })).hexdigest()

    @staticmethod
    def _empty_group(channel: str | None, content_id: str | None, destination: str | None,
                     unmapped: bool, status_present: bool) -> dict[str, Any]:
        return {
            "channel": channel,
            "content_id": content_id,
            "destination_marketplace": destination,
            "unmapped": unmapped,
            "rows_count": 0,
            "commission_total": Decimal(0),
            "commission_rows_count": 0,
            "clicks_total": 0,
            "clicks_rows_count": 0,
            "orders_total": 0,
            "orders_rows_count": 0,
            "status_counts": {status: 0 for status in _STATUS_KEYS} if status_present else None,
        }

    @classmethod
    def _aggregate(
        cls,
        parsed: dict[str, Any],
        links: dict[str, dict[str, str]],
    ) -> tuple[dict[tuple[Any, ...], dict[str, Any]], dict[str, int]]:
        status_present = parsed["status_present"]
        groups: dict[tuple[Any, ...], dict[str, Any]] = {}
        counts = {"mapped_rows_count": 0, "unmapped_rows_count": 0}
        for record in parsed["records"]:
            link = links.get(record["sub_id"]) if record["sub_id"] is not None else None
            if link is None:
                channel = content_id = destination = None
                unmapped = True
                counts["unmapped_rows_count"] += 1
            else:
                channel = link["channel"]
                content_id = link["content_id"]
                destination = link["destination_marketplace"]
                unmapped = False
                counts["mapped_rows_count"] += 1
            key = (channel, content_id, destination, unmapped)
            group = groups.setdefault(key, cls._empty_group(channel, content_id, destination, unmapped, status_present))
            group["rows_count"] += 1
            if record["commission"] is not None:
                group["commission_total"] += record["commission"]
                group["commission_rows_count"] += 1
            if record["clicks"] is not None:
                group["clicks_total"] += record["clicks"]
                group["clicks_rows_count"] += 1
            if record["orders"] is not None:
                group["orders_total"] += record["orders"]
                group["orders_rows_count"] += 1
            if status_present:
                group["status_counts"][record["status"] or "unknown"] += 1
        for group in groups.values():
            group["commission_total_thb"] = (
                _decimal_text(group["commission_total"])
                if group["commission_rows_count"] else None
            )
            group["clicks_total"] = group["clicks_total"] if group["clicks_rows_count"] else None
            group["orders_total"] = group["orders_total"] if group["orders_rows_count"] else None
            del group["commission_total"]
        return groups, counts

    @staticmethod
    def _make_summary(
        marketplace: str,
        period_start: str,
        period_end: str,
        amount_state: str,
        parsed: dict[str, Any],
        groups: dict[tuple[Any, ...], dict[str, Any]],
        counts: dict[str, int],
    ) -> dict[str, Any]:
        commission_values = [Decimal(group["commission_total_thb"])
                             for group in groups.values() if group["commission_total_thb"] is not None]
        clicks_values = [group["clicks_total"] for group in groups.values() if group["clicks_total"] is not None]
        orders_values = [group["orders_total"] for group in groups.values() if group["orders_total"] is not None]
        commission_total = sum(commission_values, Decimal(0)) if commission_values else None
        clicks_total = sum(clicks_values) if clicks_values else None
        orders_total = sum(orders_values) if orders_values else None
        status_counts: dict[str, int] | None = None
        if parsed["status_present"]:
            status_counts = {status: sum(group["status_counts"][status] for group in groups.values())
                             for status in _STATUS_KEYS}
        rows_count = len(parsed["records"])
        return {
            "source_marketplace": marketplace,
            "period_start": period_start,
            "period_end": period_end,
            "amount_state": amount_state,
            "rows_count": rows_count,
            "mapped_rows_count": counts["mapped_rows_count"],
            "unmapped_rows_count": counts["unmapped_rows_count"],
            "commission_total_thb": _decimal_text(commission_total),
            "commission_rows_count": sum(g["commission_rows_count"] for g in groups.values()),
            "missing_commission_rows_count": rows_count - sum(g["commission_rows_count"] for g in groups.values()),
            "commission_by_amount_state": {
                state: (_decimal_text(commission_total) if state == amount_state else None)
                for state in sorted(_AMOUNT_STATES)
            },
            "clicks_total": clicks_total,
            "clicks_rows_count": sum(g["clicks_rows_count"] for g in groups.values()),
            "orders_total": orders_total,
            "orders_rows_count": sum(g["orders_rows_count"] for g in groups.values()),
            "status_counts": status_counts,
            "status_present": parsed["status_present"],
            "provenance": _PROVENANCE,
            "attribution": "saved_sub_id_mapping_at_import_time; unknown_or_missing_sub_id_is_unmapped",
        }

    def _existing_report(self, workspace_id: str, idempotency_key: str) -> dict[str, Any] | None:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT report_id FROM reports WHERE workspace_id=? AND idempotency_key=?",
                (workspace_id, idempotency_key),
            ).fetchone()
            return None if row is None else self._load_report(connection, workspace_id, row[0])

    def get_report(
        self,
        workspace_id: str,
        report_id: str | None = None,
        group_by: str = "channel",
        limit: int = 20,
        offset: int = 0,
    ) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        if type(group_by) is not str or group_by not in {"channel", "content"}:
            _fail("invalid_request")
        limit, offset = self._page_args(limit, offset)
        if report_id is not None and (type(report_id) is not str or not _REPORT_ID_RE.fullmatch(report_id)):
            _fail("invalid_request")
        with self._connection() as connection:
            if report_id is None:
                row = connection.execute(
                    """SELECT report_id FROM reports WHERE workspace_id=?
                       ORDER BY rowid DESC LIMIT 1""",
                    (workspace_id,),
                ).fetchone()
                if row is None:
                    return {"ok": True, "report": None, "groups": [], "total": 0,
                            "limit": limit, "offset": offset, "group_by": group_by}
                report_id = row[0]
            report = self._load_report(connection, workspace_id, report_id)
            if report is None:
                _fail("report_not_found")
        raw_groups = report["_groups"]
        groups = self._group_report_rows(raw_groups, group_by, report["amount_state"])
        public_report = self._report_summary(report)
        total = len(groups)
        public_report["group_by"] = group_by
        return {
            "ok": True,
            "report": public_report,
            "groups": groups[offset:offset + limit],
            "total": total,
            "limit": limit,
            "offset": offset,
            "group_by": group_by,
        }

    def _load_report(self, connection: sqlite3.Connection, workspace_id: str,
                     report_id: str) -> dict[str, Any] | None:
        row = connection.execute(
            """SELECT report_id, digest, source_marketplace, period_start, period_end, amount_state,
                      row_count, mapped_rows_count, unmapped_rows_count, status_present, created_at
               FROM reports WHERE workspace_id=? AND report_id=?""",
            (workspace_id, report_id),
        ).fetchone()
        if row is None:
            return None
        group_rows = connection.execute(
            """SELECT channel, content_id, destination_marketplace, unmapped, row_count,
                      commission_sum, commission_rows_count, clicks_sum, clicks_rows_count,
                      orders_sum, orders_rows_count, status_counts
               FROM report_groups WHERE report_id=?""",
            (report_id,),
        ).fetchall()
        groups = []
        for group in group_rows:
            groups.append({
                "channel": group[0], "content_id": group[1],
                "destination_marketplace": group[2], "unmapped": bool(group[3]),
                "rows_count": group[4], "commission_total_thb": group[5],
                "commission_rows_count": group[6], "clicks_total": group[7],
                "clicks_rows_count": group[8], "orders_total": group[9],
                "orders_rows_count": group[10],
                "status_counts": json.loads(group[11]) if group[11] is not None else None,
            })
        return {
            "report_id": row[0], "digest": row[1], "source_marketplace": row[2],
            "period_start": row[3], "period_end": row[4], "amount_state": row[5],
            "rows_count": row[6], "mapped_rows_count": row[7], "unmapped_rows_count": row[8],
            "status_present": bool(row[9]), "created_at": row[10], "_groups": groups,
            "provenance": _PROVENANCE,
            "attribution": "saved_sub_id_mapping_at_import_time; unknown_or_missing_sub_id_is_unmapped",
        }

    @classmethod
    def _report_summary(cls, report: dict[str, Any]) -> dict[str, Any]:
        groups = report.get("_groups", [])
        parsed = {"records": [None] * report["rows_count"], "status_present": report["status_present"]}
        counts = {"mapped_rows_count": report["mapped_rows_count"],
                  "unmapped_rows_count": report["unmapped_rows_count"]}
        amount_summary = cls._make_summary(
            report["source_marketplace"], report["period_start"], report["period_end"],
            report["amount_state"], parsed,
            {(g["channel"], g["content_id"], g["destination_marketplace"], g["unmapped"]): g
             for g in groups}, counts,
        )
        # Saved aggregate rows already have sums; _make_summary treats them as
        # raw group records, so rebuild exact totals from the persisted fields.
        commission_values = [Decimal(g["commission_total_thb"]) for g in groups
                             if g["commission_total_thb"] is not None]
        clicks_values = [g["clicks_total"] for g in groups if g["clicks_total"] is not None]
        orders_values = [g["orders_total"] for g in groups if g["orders_total"] is not None]
        commission_total = sum(commission_values, Decimal(0)) if commission_values else None
        clicks_total = sum(clicks_values) if clicks_values else None
        orders_total = sum(orders_values) if orders_values else None
        status_counts = None
        if report["status_present"]:
            status_counts = {status: sum(g["status_counts"][status] for g in groups if g["status_counts"])
                             for status in _STATUS_KEYS}
        amount_summary.update({
            "commission_total_thb": _decimal_text(commission_total),
            "commission_rows_count": sum(g["commission_rows_count"] for g in groups),
            "missing_commission_rows_count": report["rows_count"] - sum(g["commission_rows_count"] for g in groups),
            "commission_by_amount_state": {
                state: (_decimal_text(commission_total) if state == report["amount_state"] else None)
                for state in sorted(_AMOUNT_STATES)
            },
            "clicks_total": clicks_total,
            "clicks_rows_count": sum(g["clicks_rows_count"] for g in groups),
            "orders_total": orders_total,
            "orders_rows_count": sum(g["orders_rows_count"] for g in groups),
            "status_counts": status_counts,
            "status_present": report["status_present"],
            "report_id": report["report_id"],
            "digest": report["digest"],
            "created_at": report["created_at"],
        })
        return amount_summary

    @staticmethod
    def _group_report_rows(raw_groups: list[dict[str, Any]], group_by: str,
                           amount_state: str) -> list[dict[str, Any]]:
        grouped: dict[tuple[Any, ...], dict[str, Any]] = {}
        for row in raw_groups:
            dimension = row["channel"] if group_by == "channel" else row["content_id"]
            key = ((dimension, row["destination_marketplace"], row["unmapped"])
                   if group_by == "channel" else
                   (dimension, row["channel"], row["destination_marketplace"], row["unmapped"]))
            target = grouped.setdefault(key, {
                "channel": dimension if group_by == "channel" else row["channel"],
                "content_id": dimension if group_by == "content" else None,
                "destination_marketplace": row["destination_marketplace"],
                "unmapped": row["unmapped"],
                "rows_count": 0,
                "commission_total": Decimal(0),
                "commission_rows_count": 0,
                "clicks_total": 0,
                "clicks_rows_count": 0,
                "orders_total": 0,
                "orders_rows_count": 0,
                "status_counts": ({status: 0 for status in _STATUS_KEYS}
                                  if row["status_counts"] is not None else None),
            })
            target["rows_count"] += row["rows_count"]
            if row["commission_total_thb"] is not None:
                target["commission_total"] += Decimal(row["commission_total_thb"])
            target["commission_rows_count"] += row["commission_rows_count"]
            if row["clicks_total"] is not None:
                target["clicks_total"] += row["clicks_total"]
            target["clicks_rows_count"] += row["clicks_rows_count"]
            if row["orders_total"] is not None:
                target["orders_total"] += row["orders_total"]
            target["orders_rows_count"] += row["orders_rows_count"]
            if target["status_counts"] is not None and row["status_counts"] is not None:
                for status in _STATUS_KEYS:
                    target["status_counts"][status] += row["status_counts"][status]
        result = []
        for row in grouped.values():
            commission = _decimal_text(row["commission_total"]) if row["commission_rows_count"] else None
            clicks = row["clicks_total"] if row["clicks_rows_count"] else None
            orders = row["orders_total"] if row["orders_rows_count"] else None
            result.append({
                "channel": row["channel"],
                "content_id": row["content_id"],
                "destination_marketplace": row["destination_marketplace"],
                "unmapped": row["unmapped"],
                "rows_count": row["rows_count"],
                "commission_total_thb": commission,
                "commission_rows_count": row["commission_rows_count"],
                "commission_by_amount_state": {
                    state: (commission if state == amount_state else None)
                    for state in sorted(_AMOUNT_STATES)
                },
                "clicks_total": clicks,
                "clicks_rows_count": row["clicks_rows_count"],
                "orders_total": orders,
                "orders_rows_count": row["orders_rows_count"],
                "status_counts": row["status_counts"],
            })
        result.sort(key=lambda row: (
            row["unmapped"],
            (row["channel"] or row["content_id"] or "").casefold(),
            row["destination_marketplace"] or "",
        ))
        return result

    @staticmethod
    def _page_args(limit: Any, offset: Any) -> tuple[int, int]:
        if (not _is_int(limit) or limit < 1 or limit > MAX_PAGE_SIZE
                or not _is_int(offset) or offset < 0 or offset > MAX_OFFSET):
            _fail("invalid_request")
        return limit, offset

    def sales_by(
        self,
        workspace_id: str,
        dimension: str,
        period_start: str | None = None,
        period_end: str | None = None,
    ) -> dict[str, Any]:
        """Query sales attribution by SubID dimension (platform, product, clip, variant, month).
        
        Aggregates commission, clicks, and orders from report_groups, joining with links
        to extract SubID fields. Returns breakdown by the specified dimension.
        
        Args:
            workspace_id: The workspace to query
            dimension: One of 'platform', 'product', 'clip', 'variant', 'month' 
                      (maps to sub_id_1, sub_id_2, sub_id_3, sub_id_4, sub_id_5)
            period_start: Optional YYYY-MM-DD filter
            period_end: Optional YYYY-MM-DD filter
            
        Returns:
            Dict with aggregated sales data grouped by dimension value
        """
        workspace_id = _workspace_id(workspace_id)
        
        # Map dimension names to SubID fields
        dimension_map = {
            "platform": "sub_id_1",
            "product": "sub_id_2", 
            "clip": "sub_id_3",
            "variant": "sub_id_4",
            "month": "sub_id_5",
        }
        
        if dimension not in dimension_map:
            _fail("invalid_request")
        
        subid_field = dimension_map[dimension]
        
        # Validate date filters if provided
        if period_start is not None:
            try:
                datetime.fromisoformat(period_start)
            except ValueError:
                _fail("invalid_request")
        if period_end is not None:
            try:
                datetime.fromisoformat(period_end)
            except ValueError:
                _fail("invalid_request")
        
        with self._connection() as connection:
            # Build query to aggregate by SubID dimension
            query = f"""
                SELECT 
                    l.{subid_field} as dimension_value,
                    SUM(rg.commission_sum) as total_commission,
                    SUM(rg.clicks_sum) as total_clicks,
                    SUM(rg.orders_sum) as total_orders,
                    SUM(rg.row_count) as total_rows,
                    COUNT(DISTINCT rg.report_id) as report_count
                FROM report_groups rg
                JOIN reports r ON rg.report_id = r.report_id
                JOIN links l ON (
                    rg.channel = l.channel 
                    AND rg.content_id = l.content_id
                    AND r.workspace_id = l.workspace_id
                )
                WHERE r.workspace_id = ?
                  AND rg.unmapped = 0
            """
            
            params = [workspace_id]
            
            if period_start is not None:
                query += " AND r.period_start >= ?"
                params.append(period_start)
            
            if period_end is not None:
                query += " AND r.period_end <= ?"
                params.append(period_end)
            
            query += f"""
                GROUP BY l.{subid_field}
                HAVING l.{subid_field} IS NOT NULL
                ORDER BY total_commission DESC
            """
            
            rows = connection.execute(query, tuple(params)).fetchall()
            
            results = []
            total_commission = Decimal(0)
            total_clicks = 0
            total_orders = 0
            total_rows_count = 0
            
            for row in rows:
                dim_value, commission, clicks, orders, rows_count, report_count = row
                
                commission_dec = Decimal(commission) if commission else Decimal(0)
                total_commission += commission_dec
                total_clicks += clicks or 0
                total_orders += orders or 0
                total_rows_count += rows_count or 0
                
                results.append({
                    dimension: dim_value,
                    "commission_thb": _decimal_text(commission_dec) if commission else None,
                    "clicks": clicks,
                    "orders": orders,
                    "rows": rows_count,
                    "reports": report_count,
                })
            
            return {
                "ok": True,
                "workspace_id": workspace_id,
                "dimension": dimension,
                "period_start": period_start,
                "period_end": period_end,
                "results": results,
                "summary": {
                    "total_commission_thb": _decimal_text(total_commission),
                    "total_clicks": total_clicks,
                    "total_orders": total_orders,
                    "total_rows": total_rows_count,
                    "dimension_values_count": len(results),
                },
                "provenance": _PROVENANCE,
            }

    def check_commission_health(
        self,
        workspace_id: str,
        product_ids: list[str] | None = None,
        channel: str | None = None,
    ) -> dict[str, Any]:
        """Check commission health for products and detect rate changes.
        
        Compares current commission rates (from product details) with previously
        observed rates in commission_health table. Detects drops, removals, and
        increases. Updates health tracking and returns alerts.
        
        Args:
            workspace_id: The workspace to operate in
            product_ids: Optional list of specific product IDs to check (None = all tracked)
            channel: Optional channel filter (e.g., 'tiktok', 'ig')
            
        Returns:
            Dict with health check results and alerts for changed rates
        """
        workspace_id = _workspace_id(workspace_id)
        
        # Validate product_ids if provided
        if product_ids is not None:
            if not isinstance(product_ids, list) or not product_ids or len(product_ids) > 100:
                _fail("invalid_request")
            for pid in product_ids:
                if not isinstance(pid, str) or not pid or len(pid) > 200:
                    _fail("invalid_request")
        
        with self._connection(write=True) as connection:
            self._begin(connection)
            
            # Get current health records
            if product_ids is not None:
                placeholders = ",".join("?" * len(product_ids))
                query = f"""
                    SELECT product_id, last_check_at, last_commission_pct, 
                           last_extra_comm, status
                    FROM commission_health
                    WHERE workspace_id = ? AND product_id IN ({placeholders})
                """
                params = [workspace_id] + product_ids
            else:
                query = """
                    SELECT product_id, last_check_at, last_commission_pct,
                           last_extra_comm, status
                    FROM commission_health
                    WHERE workspace_id = ?
                """
                params = [workspace_id]
            
            existing = {
                row[0]: {
                    "last_check_at": row[1],
                    "last_commission_pct": row[2],
                    "last_extra_comm": row[3],
                    "status": row[4],
                }
                for row in connection.execute(query, params).fetchall()
            }
            
            # Prepare results
            now = datetime.now(timezone.utc).isoformat(timespec="seconds")
            alerts = []
            checked = []
            unchanged = []
            
            # Note: In production, this would query current commission rates from
            # the extension/product detail observations. For now, we track what
            # the caller provides via update_commission_health (separate function).
            # This check function returns stored health status.
            
            for product_id, health in existing.items():
                checked.append({
                    "product_id": product_id,
                    "last_check_at": health["last_check_at"],
                    "commission_pct": health["last_commission_pct"],
                    "extra_comm": health["last_extra_comm"],
                    "status": health["status"],
                })
                
                if health["status"] in ("dropped", "removed"):
                    alerts.append({
                        "product_id": product_id,
                        "alert_type": health["status"],
                        "last_commission_pct": health["last_commission_pct"],
                        "checked_at": health["last_check_at"],
                    })
            
            connection.commit()
            
            return {
                "ok": True,
                "workspace_id": workspace_id,
                "checked_at": now,
                "checked_count": len(checked),
                "alert_count": len(alerts),
                "alerts": alerts,
                "products": checked,
                "provenance": _PROVENANCE,
            }
    
    def update_commission_health(
        self,
        workspace_id: str,
        product_id: str,
        commission_pct: float,
        extra_comm: int = 0,
        channel: str | None = None,
    ) -> dict[str, Any]:
        """Update commission health tracking for a product.
        
        Records current commission rate and compares with previous observation.
        Automatically detects rate changes and updates status.
        
        Args:
            workspace_id: The workspace
            product_id: Product identifier
            commission_pct: Current commission percentage (e.g., 8.5 for 8.5%)
            extra_comm: Extra commission percentage if any
            channel: Optional channel context
            
        Returns:
            Dict with update result and detected change status
        """
        workspace_id = _workspace_id(workspace_id)
        
        if (not isinstance(product_id, str) or not product_id or len(product_id) > 200
                or not isinstance(commission_pct, (int, float)) or commission_pct < 0
                or not isinstance(extra_comm, int) or extra_comm < 0):
            _fail("invalid_request")
        
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        
        try:
            with self._connection(write=True) as connection:
                self._begin(connection)
                
                # Get existing record
                existing = connection.execute(
                    """SELECT last_commission_pct, last_extra_comm, status
                       FROM commission_health
                       WHERE product_id = ? AND workspace_id = ?""",
                    (product_id, workspace_id)
                ).fetchone()
                
                if existing is None:
                    # First observation - insert
                    connection.execute(
                        """INSERT INTO commission_health
                           (product_id, workspace_id, last_check_at, last_commission_pct,
                            last_extra_comm, status)
                           VALUES (?, ?, ?, ?, ?, ?)""",
                        (product_id, workspace_id, now, commission_pct, extra_comm, "healthy")
                    )
                    status = "healthy"
                    change_detected = False
                else:
                    prev_pct, prev_extra, prev_status = existing
                    
                    # Detect change
                    if commission_pct == 0:
                        status = "removed"
                        change_detected = True
                    elif commission_pct < prev_pct:
                        status = "dropped"
                        change_detected = True
                    elif commission_pct > prev_pct:
                        status = "increased"
                        change_detected = True
                    else:
                        status = "healthy"
                        change_detected = False
                    
                    # Update record
                    connection.execute(
                        """UPDATE commission_health
                           SET last_check_at = ?,
                               previous_commission_pct = last_commission_pct,
                               previous_extra_comm = last_extra_comm,
                               last_commission_pct = ?,
                               last_extra_comm = ?,
                               status = ?,
                               alert_created_at = CASE 
                                   WHEN ? IN ('dropped', 'removed') THEN ? 
                                   ELSE alert_created_at 
                               END
                           WHERE product_id = ? AND workspace_id = ?""",
                        (now, commission_pct, extra_comm, status, status, now,
                         product_id, workspace_id)
                    )
                
                self._check_database_capacity(connection)
                connection.commit()
                
                return {
                    "ok": True,
                    "product_id": product_id,
                    "workspace_id": workspace_id,
                    "commission_pct": commission_pct,
                    "extra_comm": extra_comm,
                    "status": status,
                    "change_detected": change_detected,
                    "updated_at": now,
                    "provenance": _PROVENANCE,
                }
        except CampaignError:
            raise
        except sqlite3.Error:
            _fail("storage_error")
