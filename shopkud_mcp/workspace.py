"""Private, local storage for ShopKud analysis workspaces and observations.

This module stores caller-authored analysis separately from native product
records. Nothing returned by this module is a live selection snapshot or
authority to apply a selection.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import stat
import secrets
from typing import Iterator
from urllib.parse import urlsplit

from .platform_security import fchmod_private, has_private_mode, owned_by_current_user


_ID_RE = re.compile(r"[0-9a-f]{32}\Z")
_PRODUCT_ID_RE = re.compile(r"(?:[A-Za-z0-9._~!$&'()*+,;=:@-]|%[0-9a-fA-F]{2})+\Z")
_SAFE_FIELDS = {
    "selection_snapshot": False,
    "requires_fresh_page_snapshot_before_selection": True,
    "reusable_apply_authority": False,
}

_MAX_WORKSPACES = 100
_MAX_WORKSPACE_RECORDS = 1000  # total saved records, across all workspaces
_MAX_PRODUCTS = 5000
_MAX_HISTORY_ROWS = 20000
_MAX_OBSERVATION_STATES = 20000
_MAX_INPUT_RECORDS = 1000
_MAX_RECORD_BYTES = 16384
_MAX_BATCH_BYTES = 2 * 1024 * 1024
_MAX_BRIEF_BYTES = 65536
_MAX_DATABASE_BYTES = 128 * 1024 * 1024


class _StoreError(Exception):
    def __init__(self, code: str, **details: object) -> None:
        super().__init__(code)
        self.code = code
        self.details = details


def _error(code: str, **details: object) -> dict:
    return {"ok": False, "error": code, **details}


def _valid_product_id(value: object) -> bool:
    return type(value) is str and 1 <= len(value) <= 200 and _PRODUCT_ID_RE.fullmatch(value) is not None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _timestamp(value: object) -> tuple[str, float] | None:
    if not isinstance(value, str) or not 1 <= len(value) <= 64:
        return None
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            return None
        sort_value = parsed.timestamp()
    except (OverflowError, TypeError, ValueError):
        return None
    if not math.isfinite(sort_value):
        return None
    return value, sort_value


def _json_value(value: object, *, depth: int = 0, active: set[int] | None = None) -> bool:
    if depth > 64:
        return False
    if value is None or type(value) in {str, bool, int}:
        return True
    if type(value) is float:
        return math.isfinite(value)
    if active is None:
        active = set()
    if type(value) not in {dict, list} or id(value) in active:
        return False
    active.add(id(value))
    try:
        if type(value) is dict:
            return all(type(key) is str and _json_value(item, depth=depth + 1, active=active)
                       for key, item in value.items())
        return all(_json_value(item, depth=depth + 1, active=active) for item in value)
    finally:
        active.remove(id(value))


def _json_bytes(value: object, *, sort_keys: bool = False) -> bytes | None:
    if not _json_value(value):
        return None
    try:
        rendered = json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=sort_keys,
        )
        return rendered.encode("utf-8")
    except (TypeError, ValueError, RecursionError, UnicodeEncodeError):
        return None


def _valid_record(
    record: object, *, allow_workspace_metadata: bool = False
) -> tuple[str, bytes, dict, str | None, int | None] | None:
    if not isinstance(record, dict) or any(not isinstance(key, str) for key in record):
        return None
    has_analysis = "agent_analysis" in record
    has_kept = "human_kept" in record
    if not allow_workspace_metadata and (has_analysis or has_kept):
        return None
    if has_analysis:
        analysis = record["agent_analysis"]
        analysis_payload = _json_bytes(analysis)
        if (not isinstance(analysis, dict) or any(not isinstance(key, str) for key in analysis)
                or analysis_payload is None or len(analysis_payload) > 8192):
            return None
    else:
        analysis_payload = None
    if has_kept and type(record["human_kept"]) is not bool:
        return None
    if "observed_at" in record and _timestamp(record["observed_at"]) is None:
        return None
    product_id = record.get("product_id")
    product_url = record.get("product_url")
    commission_pct = record.get("commission_pct")
    extra_comm = record.get("extra_comm")
    if not _valid_product_id(product_id):
        return None
    if type(product_url) is not str or len(product_url) > 300:
        return None
    try:
        parsed = urlsplit(product_url)
    except ValueError:
        return None
    expected_path = f"/offer/product_offer/{product_id}"
    if (parsed.scheme != "https" or parsed.netloc != "affiliate.shopee.co.th"
            or parsed.path != expected_path or parsed.query or parsed.fragment
            or product_url != "https://affiliate.shopee.co.th" + expected_path):
        return None
    if isinstance(commission_pct, bool) or not isinstance(commission_pct, (int, float)) or type(extra_comm) is not bool:
        return None
    try:
        commission_number = float(commission_pct)
    except (OverflowError, ValueError):
        return None
    if not math.isfinite(commission_number) or not 0 <= commission_number <= 100:
        return None
    full_payload = _json_bytes(record)
    native_record = {key: value for key, value in record.items()
                     if key not in {"agent_analysis", "human_kept"}}
    payload = _json_bytes(native_record)
    if (full_payload is None or not 1 <= len(full_payload) <= _MAX_RECORD_BYTES
            or payload is None or not 1 <= len(payload) <= _MAX_RECORD_BYTES):
        return None
    return (product_id, payload, native_record,
            analysis_payload.decode("utf-8") if analysis_payload is not None else None,
            int(record["human_kept"]) if has_kept else None)


def _records(
    records: object, *, allow_workspace_metadata: bool = False, allow_empty: bool = False
) -> tuple[list[tuple[str, bytes, dict, str | None, int | None]], bytes] | None:
    minimum = 0 if allow_empty else 1
    if not isinstance(records, list) or not minimum <= len(records) <= _MAX_INPUT_RECORDS:
        return None
    prepared: list[tuple[str, bytes, dict, str | None, int | None]] = []
    seen: set[str] = set()
    total = 0
    for record in records:
        valid = _valid_record(record, allow_workspace_metadata=allow_workspace_metadata)
        if valid is None:
            return None
        product_id, payload, native_record, analysis_json, human_kept = valid
        if product_id in seen:
            return None
        seen.add(product_id)
        full_payload = _json_bytes(record)
        if full_payload is None:
            return None
        total += len(full_payload)
        if total > _MAX_BATCH_BYTES:
            return None
        prepared.append((product_id, payload, native_record, analysis_json, human_kept))
    digest_payload = _json_bytes(records, sort_keys=True)
    if digest_payload is None:
        return None
    return prepared, digest_payload


def _safe_path_info(path: Path, *, directory: bool = False) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError as error:
        raise ValueError("unsafe_workspace_store") from error
    expected_type = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
    expected_mode = 0o700 if directory else 0o600
    if (not expected_type or not owned_by_current_user(info)
            or not has_private_mode(info,expected_mode)
            or (not directory and info.st_nlink != 1)):
        raise ValueError("unsafe_workspace_store")
    return info


class AnalysisStore:
    """A bounded local SQLite store for authored briefs and observed records."""

    def __init__(self, root: Path):
        raw_root = Path(root).expanduser().absolute()
        self.root = raw_root
        self.path = self.root / "workspace.sqlite3"
        self._ensure_root(create=True)
        with self._connection() as connection:
            had_retention_metadata = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'store_metadata'"
            ).fetchone() is not None
            had_pruned_marker = (had_retention_metadata and connection.execute(
                "SELECT 1 FROM store_metadata WHERE key = 'history_retention_pruned_count'"
            ).fetchone() is not None)
            had_history_table = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'commission_history'"
            ).fetchone() is not None
            previous_history_rows = (connection.execute(
                "SELECT COUNT(*) FROM commission_history"
            ).fetchone()[0] if had_history_table else 0)
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS workspaces (
                    workspace_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    brief_json TEXT NOT NULL,
                    digest TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    version INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS workspace_records (
                    workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
                    product_id TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    record_json TEXT NOT NULL,
                    observed_at TEXT,
                    timestamp_source TEXT,
                    agent_analysis_json TEXT,
                    human_kept INTEGER,
                    PRIMARY KEY (workspace_id, product_id)
                );
                CREATE INDEX IF NOT EXISTS workspace_records_order
                    ON workspace_records(workspace_id, position);
                CREATE TABLE IF NOT EXISTS products (
                    product_id TEXT PRIMARY KEY,
                    record_json TEXT NOT NULL,
                    observed_at TEXT NOT NULL,
                    timestamp_source TEXT NOT NULL,
                    observed_sort REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS products_age ON products(observed_sort, product_id);
                CREATE TABLE IF NOT EXISTS product_states (
                    product_id TEXT PRIMARY KEY,
                    observed_at TEXT NOT NULL,
                    timestamp_source TEXT NOT NULL,
                    observed_sort REAL NOT NULL,
                    commission_pct REAL NOT NULL,
                    extra_comm INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS product_states_age
                    ON product_states(observed_sort, product_id);
                CREATE TABLE IF NOT EXISTS commission_history (
                    history_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    product_id TEXT NOT NULL,
                    observed_at TEXT NOT NULL,
                    timestamp_source TEXT NOT NULL,
                    observed_sort REAL NOT NULL,
                    commission_pct REAL NOT NULL,
                    extra_comm INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS commission_history_product_time
                    ON commission_history(product_id, observed_sort, history_id);
                CREATE INDEX IF NOT EXISTS commission_history_age
                    ON commission_history(observed_sort, history_id);
                CREATE TABLE IF NOT EXISTS store_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                PRAGMA user_version = 1;
                """
            )
            # Additive migrations preserve a locally-created 0.7 database if a
            # developer reruns an early build of this module.
            additions = {
                "workspace_records": {
                    "timestamp_source": "TEXT",
                    "agent_analysis_json": "TEXT",
                    "human_kept": "INTEGER",
                },
                "products": {"timestamp_source": "TEXT NOT NULL DEFAULT 'received_at_not_original_freshness'"},
                "product_states": {"timestamp_source": "TEXT NOT NULL DEFAULT 'received_at_not_original_freshness'"},
                "commission_history": {"timestamp_source": "TEXT NOT NULL DEFAULT 'received_at_not_original_freshness'"},
            }
            for table, columns in additions.items():
                present = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
                for column, declaration in columns.items():
                    if column not in present:
                        connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")
            connection.execute(
                "INSERT OR IGNORE INTO store_metadata(key, value) VALUES ('history_retention_pruned_count', '0')"
            )
            connection.execute(
                "INSERT OR IGNORE INTO store_metadata(key, value) VALUES ('retention_tracking_started_at', ?)",
                (_now(),),
            )
            count_known = "false" if previous_history_rows and not had_pruned_marker else "true"
            connection.execute(
                "INSERT OR IGNORE INTO store_metadata(key, value) "
                "VALUES ('history_retention_count_complete', ?)",
                (count_known,),
            )

    def _ensure_root(self, *, create: bool) -> None:
        try:
            info = self.root.lstat()
        except FileNotFoundError:
            if not create:
                raise ValueError("unsafe_workspace_store")
            try:
                self.root.mkdir(mode=0o700, parents=True, exist_ok=False)
            except FileExistsError:
                pass
            except OSError as error:
                raise ValueError("unsafe_workspace_store") from error
            else:
                try:
                    if os.name!="nt":os.chmod(self.root, 0o700, follow_symlinks=False)
                except OSError as error:
                    raise ValueError("unsafe_workspace_store") from error
            try:
                info = self.root.lstat()
            except OSError as error:
                raise ValueError("unsafe_workspace_store") from error
        if (not stat.S_ISDIR(info.st_mode) or not owned_by_current_user(info)
                or not has_private_mode(info,0o700)):
            raise ValueError("unsafe_workspace_store")

    def _ensure_database_file(self) -> None:
        self._ensure_root(create=False)
        try:
            info = self.path.lstat()
        except FileNotFoundError:
            flags = os.O_CREAT | os.O_EXCL | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
            try:
                descriptor = os.open(self.path, flags, 0o600)
            except FileExistsError:
                pass
            except OSError as error:
                raise ValueError("unsafe_workspace_store") from error
            else:
                try:
                    fchmod_private(descriptor,0o600)
                except OSError as error:
                    raise ValueError("unsafe_workspace_store") from error
                finally:
                    os.close(descriptor)
        except OSError as error:
            raise ValueError("unsafe_workspace_store") from error
        _safe_path_info(self.path)
        info = self.path.lstat()
        if info.st_size > _MAX_DATABASE_BYTES:
            raise ValueError("unsafe_workspace_store")
        # SQLite sidecars are only ever created in the private directory. Still
        # reject an unsafe pre-existing file before SQLite gets a chance to use it.
        for suffix in ("-journal", "-wal", "-shm"):
            sidecar = Path(str(self.path) + suffix)
            try:
                side_info = sidecar.lstat()
            except FileNotFoundError:
                continue
            except OSError as error:
                raise ValueError("unsafe_workspace_store") from error
            if (not stat.S_ISREG(side_info.st_mode) or not owned_by_current_user(side_info)
                    or not has_private_mode(side_info,0o600) or side_info.st_nlink != 1
                    or side_info.st_size > _MAX_DATABASE_BYTES):
                raise ValueError("unsafe_workspace_store")

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        self._ensure_database_file()
        connection = None
        try:
            connection = sqlite3.connect(str(self.path), timeout=5, isolation_level=None)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute("PRAGMA journal_mode = DELETE")
            connection.execute("PRAGMA synchronous = FULL")
            connection.execute("PRAGMA busy_timeout = 5000")
        except (sqlite3.Error, OSError) as error:
            if connection is not None:
                connection.close()
            raise ValueError("unsafe_workspace_store") from error
        try:
            yield connection
        finally:
            connection.close()
            self._ensure_database_file()

    @staticmethod
    def _begin(connection: sqlite3.Connection) -> None:
        connection.execute("BEGIN IMMEDIATE")

    @staticmethod
    def _finish(connection: sqlite3.Connection, *, commit: bool) -> None:
        if connection.in_transaction:
            connection.commit() if commit else connection.rollback()

    @staticmethod
    def _safe_result(**values: object) -> dict:
        return {"ok": True, **_SAFE_FIELDS, **values}

    @staticmethod
    def _validate_records(
        records: object, *, allow_workspace_metadata: bool = False, allow_empty: bool = False
    ) -> tuple[list[tuple[str, bytes, dict, str | None, int | None]], str] | None:
        prepared = _records(
            records, allow_workspace_metadata=allow_workspace_metadata, allow_empty=allow_empty
        )
        if prepared is None:
            return None
        entries, digest_payload = prepared
        return entries, hashlib.sha256(digest_payload).hexdigest()

    @staticmethod
    def _prune(connection: sqlite3.Connection, table: str, maximum: int) -> int:
        # Table names here are fixed constants, never user input. Every delete is
        # explicitly bounded to the small amount by which a batch can overflow.
        count = connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        excess = max(0, count - maximum)
        if not excess:
            return 0
        if excess > _MAX_INPUT_RECORDS:
            raise _StoreError("storage_limit_exceeded", capacity=table)
        bound = min(excess, _MAX_INPUT_RECORDS)
        if table == "products":
            connection.execute(
                "DELETE FROM products WHERE product_id IN "
                "(SELECT product_id FROM products ORDER BY observed_sort, product_id LIMIT ?)",
                (bound,),
            )
        elif table == "product_states":
            connection.execute(
                "DELETE FROM product_states WHERE product_id IN "
                "(SELECT product_id FROM product_states ORDER BY observed_sort, product_id LIMIT ?)",
                (bound,),
            )
        else:
            connection.execute(
                "DELETE FROM commission_history WHERE history_id IN "
                "(SELECT history_id FROM commission_history ORDER BY observed_sort, history_id LIMIT ?)",
                (bound,),
            )
        return bound

    def observe(self, records: list[dict], observed_at: str | None = None) -> dict:
        """Persist fresh product observations and commission changes only."""
        prepared = self._validate_records(records)
        if prepared is None:
            return _error("invalid_input")
        entries, digest = prepared
        timestamp = _timestamp(_now() if observed_at is None else observed_at)
        if timestamp is None:
            return _error("invalid_input")
        observed_text, observed_sort = timestamp
        timestamp_source = ("source_observed_at" if observed_at is not None
                            else "received_at_not_original_freshness")
        advanced = stale = changes = baselines = 0
        try:
            with self._connection() as connection:
                self._begin(connection)
                try:
                    for product_id, payload, record, _, _ in entries:
                        commission = record["commission_pct"]
                        extra = record["extra_comm"]
                        state = connection.execute(
                            "SELECT observed_sort, commission_pct, extra_comm FROM product_states WHERE product_id = ?",
                            (product_id,),
                        ).fetchone()
                        if state is not None and observed_sort <= state["observed_sort"]:
                            stale += 1
                            continue
                        if state is None:
                            connection.execute(
                                "INSERT INTO commission_history(product_id, observed_at, timestamp_source, observed_sort, commission_pct, extra_comm) "
                                "VALUES (?, ?, ?, ?, ?, ?)",
                                (product_id, observed_text, timestamp_source, observed_sort, commission, int(extra)),
                            )
                            baselines += 1
                        elif (state["commission_pct"] != commission
                              or bool(state["extra_comm"]) != extra):
                            connection.execute(
                                "INSERT INTO commission_history(product_id, observed_at, timestamp_source, observed_sort, commission_pct, extra_comm) "
                                "VALUES (?, ?, ?, ?, ?, ?)",
                                (product_id, observed_text, timestamp_source, observed_sort, commission, int(extra)),
                            )
                            changes += 1
                        connection.execute(
                            "INSERT INTO product_states(product_id, observed_at, timestamp_source, observed_sort, commission_pct, extra_comm) "
                            "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(product_id) DO UPDATE SET "
                            "observed_at = excluded.observed_at, timestamp_source = excluded.timestamp_source, observed_sort = excluded.observed_sort, "
                            "commission_pct = excluded.commission_pct, extra_comm = excluded.extra_comm",
                            (product_id, observed_text, timestamp_source, observed_sort, commission, int(extra)),
                        )
                        connection.execute(
                            "INSERT INTO products(product_id, record_json, observed_at, timestamp_source, observed_sort) "
                            "VALUES (?, ?, ?, ?, ?) ON CONFLICT(product_id) DO UPDATE SET "
                            "record_json = excluded.record_json, observed_at = excluded.observed_at, timestamp_source = excluded.timestamp_source, "
                            "observed_sort = excluded.observed_sort",
                            (product_id, payload.decode("utf-8"), observed_text, timestamp_source, observed_sort),
                        )
                        advanced += 1
                    pruned_products = self._prune(connection, "products", _MAX_PRODUCTS)
                    pruned_states = self._prune(connection, "product_states", _MAX_OBSERVATION_STATES)
                    pruned_history = self._prune(connection, "commission_history", _MAX_HISTORY_ROWS)
                    if pruned_history:
                        connection.execute(
                            "UPDATE store_metadata SET value = CAST(value AS INTEGER) + ? "
                            "WHERE key = 'history_retention_pruned_count'",
                            (pruned_history,),
                        )
                    retention_pruned_count = int(connection.execute(
                        "SELECT value FROM store_metadata WHERE key = 'history_retention_pruned_count'"
                    ).fetchone()[0])
                    self._finish(connection, commit=True)
                except Exception:
                    self._finish(connection, commit=False)
                    raise
        except _StoreError as error:
            return _error(error.code, **error.details)
        except sqlite3.Error:
            return _error("storage_error")
        return self._safe_result(
            observation_time=observed_text,
            timestamp_source=timestamp_source,
            digest=digest,
            received=len(entries),
            updated=advanced,
            stale=stale,
            rate_changes=changes,
            initial_rate_states=baselines,
            pruned={"products": pruned_products, "observation_states": pruned_states,
                    "history_rows": pruned_history},
            retention_pruned_count=retention_pruned_count,
        )

    def save_workspace(
        self,
        workspace_id: str | None,
        name: str,
        brief: dict,
        records: list[dict] | None,
        expected_version: int | None = None,
    ) -> dict:
        """Create or update a brief; ``records=None`` retains existing records."""
        if (workspace_id is not None and (type(workspace_id) is not str or not _ID_RE.fullmatch(workspace_id))
                or type(name) is not str or not name.strip() or len(name) > 160
                or any(ord(character) < 32 for character in name)
                or not isinstance(brief, dict)
                or expected_version is not None
                and (type(expected_version) is not int or not 0 <= expected_version <= 1000000)
                or workspace_id is None and expected_version is not None):
            return _error("invalid_input")
        brief_payload = _json_bytes(brief)
        if brief_payload is None or len(brief_payload) > _MAX_BRIEF_BYTES:
            return _error("invalid_input")
        brief_json = brief_payload.decode("utf-8")
        new_id = workspace_id is None
        target_id = secrets.token_hex(16) if new_id else workspace_id
        now = _now()
        version = 1
        try:
            with self._connection() as connection:
                self._begin(connection)
                try:
                    existing = connection.execute(
                        "SELECT name, brief_json, digest, created_at, updated_at, version "
                        "FROM workspaces WHERE workspace_id = ?",
                        (target_id,),
                    ).fetchone()
                    if new_id:
                        workspace_count = connection.execute("SELECT COUNT(*) FROM workspaces").fetchone()[0]
                        if workspace_count >= _MAX_WORKSPACES:
                            raise _StoreError("capacity_exceeded", capacity="workspaces")
                    elif existing is None:
                        raise _StoreError("unknown_workspace")
                    elif expected_version is not None and expected_version != existing["version"]:
                        raise _StoreError("version_conflict", current_version=existing["version"])

                    if records is None:
                        if existing is None:
                            entries = []
                            digest_records = []
                        else:
                            saved_rows = connection.execute(
                                "SELECT record_json, agent_analysis_json, human_kept "
                                "FROM workspace_records WHERE workspace_id = ? ORDER BY position",
                                (target_id,),
                            ).fetchall()
                            digest_records = []
                            for saved in saved_rows:
                                item = json.loads(saved["record_json"])
                                if saved["agent_analysis_json"] is not None:
                                    item["agent_analysis"] = json.loads(saved["agent_analysis_json"])
                                if saved["human_kept"] is not None:
                                    item["human_kept"] = bool(saved["human_kept"])
                                digest_records.append(item)
                            validated = self._validate_records(
                                digest_records, allow_workspace_metadata=True, allow_empty=True
                            )
                            if validated is None:
                                raise _StoreError("storage_error")
                            entries, _ = validated
                    else:
                        validated = self._validate_records(
                            records, allow_workspace_metadata=True, allow_empty=True
                        )
                        if validated is None:
                            raise _StoreError("invalid_input")
                        entries, _ = validated
                        digest_records = records

                    canonical = _json_bytes(
                        {"name": name, "brief": brief, "records": digest_records}, sort_keys=True
                    )
                    if canonical is None:
                        raise _StoreError("invalid_input")
                    digest = hashlib.sha256(canonical).hexdigest()

                    if existing is None:
                        connection.execute(
                            "INSERT INTO workspaces(workspace_id, name, brief_json, digest, created_at, updated_at, version) "
                            "VALUES (?, ?, ?, ?, ?, ?, 1)",
                            (target_id, name, brief_json, digest, now, now),
                        )
                    else:
                        version = existing["version"] + (existing["digest"] != digest)
                        updated_at = now if existing["digest"] != digest else existing["updated_at"]
                        connection.execute(
                            "UPDATE workspaces SET name = ?, brief_json = ?, digest = ?, updated_at = ?, version = ? "
                            "WHERE workspace_id = ?",
                            (name, brief_json, digest, updated_at, version, target_id),
                        )
                    if records is not None:
                        connection.execute("DELETE FROM workspace_records WHERE workspace_id = ?", (target_id,))
                        existing_record_count = connection.execute("SELECT COUNT(*) FROM workspace_records").fetchone()[0]
                        if existing_record_count + len(entries) > _MAX_WORKSPACE_RECORDS:
                            raise _StoreError("capacity_exceeded", capacity="workspace_records")
                        for position, (product_id, payload, record, analysis_json, human_kept) in enumerate(entries):
                            # Reuse a known observation timestamp only when the exact
                            # native record matches; otherwise do not invent one.
                            cached = connection.execute(
                                "SELECT record_json, observed_at, timestamp_source FROM products WHERE product_id = ?",
                                (product_id,),
                            ).fetchone()
                            observed_text = None
                            timestamp_source = None
                            if cached is not None and cached["record_json"] == payload.decode("utf-8"):
                                observed_text = cached["observed_at"]
                                timestamp_source = cached["timestamp_source"]
                            elif "observed_at" in record:
                                supplied = _timestamp(record["observed_at"])
                                if supplied is not None:
                                    observed_text = supplied[0]
                                    timestamp_source = "source_observed_at"
                            connection.execute(
                                "INSERT INTO workspace_records(workspace_id, product_id, position, record_json, observed_at, "
                                "timestamp_source, agent_analysis_json, human_kept) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                                (target_id, product_id, position, payload.decode("utf-8"), observed_text,
                                 timestamp_source, analysis_json, human_kept),
                            )
                    record_count = connection.execute(
                        "SELECT COUNT(*) FROM workspace_records WHERE workspace_id = ?", (target_id,)
                    ).fetchone()[0]
                    self._finish(connection, commit=True)
                except Exception:
                    self._finish(connection, commit=False)
                    raise
        except _StoreError as error:
            return _error(error.code, **error.details)
        except sqlite3.Error:
            return _error("storage_error")
        return self._safe_result(
            workspace_id=target_id,
            name=name,
            version=version,
            digest=digest,
            record_count=record_count,
            created_at=now if existing is None else existing["created_at"],
            updated_at=now if existing is None or existing["digest"] != digest else existing["updated_at"],
        )

    @staticmethod
    def _validate_read(
        workspace_id: str | None,
        view: str,
        product_ids: list[str] | None,
        limit: int,
        offset: int,
    ) -> bool:
        if workspace_id is not None and (type(workspace_id) is not str or not _ID_RE.fullmatch(workspace_id)):
            return False
        if type(view) is not str or view not in {"brief", "products", "history"}:
            return False
        if type(limit) is not int or not 1 <= limit <= 50 or type(offset) is not int or not 0 <= offset <= 999:
            return False
        if product_ids is not None:
            if (not isinstance(product_ids, list) or not 1 <= len(product_ids) <= 50
                    or any(not _valid_product_id(product_id) for product_id in product_ids)
                    or len(set(product_ids)) != len(product_ids)):
                return False
        if view == "brief" and product_ids is not None:
            return False
        if workspace_id is None:
            if view == "brief":
                return product_ids is None
            return product_ids is not None
        return True

    @staticmethod
    def _records_found(rows: list[sqlite3.Row]) -> tuple[list[dict], list[dict], list[dict]]:
        records: list[dict] = []
        observations: list[dict] = []
        analysis: list[dict] = []
        for row in rows:
            record = json.loads(row["record_json"])
            records.append(record)
            observations.append({"product_id": row["product_id"], "observed_at": row["observed_at"],
                                 "timestamp_source": row["timestamp_source"]})
            keys = row.keys()
            analysis.append({
                "product_id": row["product_id"],
                "agent_analysis": json.loads(row["agent_analysis_json"])
                if "agent_analysis_json" in keys and row["agent_analysis_json"] is not None else None,
                "human_kept": bool(row["human_kept"])
                if "human_kept" in keys and row["human_kept"] is not None else None,
            })
        return records, observations, analysis

    def get_workspace(
        self,
        workspace_id: str | None = None,
        view: str = "brief",
        product_ids: list[str] | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> dict:
        """Read a saved workspace, a bounded cached-product chunk, or history."""
        if not self._validate_read(workspace_id, view, product_ids, limit, offset):
            return _error("invalid_input")
        try:
            with self._connection() as connection:
                if workspace_id is None and view == "brief":
                    total = connection.execute("SELECT COUNT(*) FROM workspaces").fetchone()[0]
                    rows = connection.execute(
                        "SELECT workspace_id, name, digest, created_at, updated_at, version "
                        "FROM workspaces ORDER BY updated_at DESC, workspace_id LIMIT ? OFFSET ?",
                        (limit, offset),
                    ).fetchall()
                    workspaces = [dict(row) for row in rows]
                    return self._safe_result(view="brief", total=total, limit=limit, offset=offset,
                                             workspaces=workspaces, next_offset=offset + len(workspaces)
                                             if offset + len(workspaces) < total else None)

                workspace = None
                if workspace_id is not None:
                    workspace = connection.execute(
                        "SELECT workspace_id, name, brief_json, digest, created_at, updated_at, version "
                        "FROM workspaces WHERE workspace_id = ?",
                        (workspace_id,),
                    ).fetchone()
                    if workspace is None:
                        return _error("unknown_workspace")

                if view == "brief":
                    return self._safe_result(
                        view="brief",
                        workspace_id=workspace["workspace_id"],
                        name=workspace["name"],
                        brief=json.loads(workspace["brief_json"]),
                        digest=workspace["digest"],
                        version=workspace["version"],
                        created_at=workspace["created_at"],
                        updated_at=workspace["updated_at"],
                    )

                if view == "products":
                    if workspace_id is None:
                        ids = product_ids or []
                        placeholders = ",".join("?" for _ in ids)
                        found_rows = connection.execute(
                            f"SELECT product_id, record_json, observed_at, timestamp_source "
                            f"FROM products WHERE product_id IN ({placeholders})",
                            ids,
                        ).fetchall()
                        by_id = {row["product_id"]: row for row in found_rows}
                    else:
                        if product_ids is None:
                            total = connection.execute(
                                "SELECT COUNT(*) FROM workspace_records WHERE workspace_id = ?", (workspace_id,)
                            ).fetchone()[0]
                            rows = connection.execute(
                                "SELECT product_id, record_json, observed_at, timestamp_source, "
                                "agent_analysis_json, human_kept FROM workspace_records "
                                "WHERE workspace_id = ? ORDER BY position LIMIT ? OFFSET ?",
                                (workspace_id, limit, offset),
                            ).fetchall()
                            records, observations, analysis = self._records_found(rows)
                            return self._safe_result(
                                view="products", workspace_id=workspace_id, name=workspace["name"],
                                source="saved_workspace_records", total=total, limit=limit, offset=offset,
                                records=records, observations=observations, analysis=analysis,
                                next_offset=offset + len(records) if offset + len(records) < total else None,
                            )
                        ids = product_ids
                        placeholders = ",".join("?" for _ in ids)
                        found_rows = connection.execute(
                            f"SELECT product_id, record_json, observed_at, timestamp_source, "
                            f"agent_analysis_json, human_kept FROM workspace_records "
                            f"WHERE workspace_id = ? AND product_id IN ({placeholders})",
                            [workspace_id, *ids],
                        ).fetchall()
                        by_id = {row["product_id"]: row for row in found_rows}
                    missing = [product_id for product_id in ids if product_id not in by_id]
                    if missing:
                        return _error("unknown_products", product_ids=missing)
                    total = len(ids)
                    selected_ids = ids[offset:offset + limit]
                    rows = [by_id[product_id] for product_id in selected_ids]
                    records, observations, analysis = self._records_found(rows)
                    return self._safe_result(
                        view="products", workspace_id=workspace_id,
                        name=workspace["name"] if workspace is not None else None,
                        source="observed_product_cache" if workspace_id is None else "saved_workspace_records",
                        total=total, limit=limit, offset=offset, records=records, observations=observations,
                        analysis=analysis,
                        next_offset=offset + len(records) if offset + len(records) < total else None,
                    )

                # history view: workspace scope is the saved record set; global
                # scope requires explicit IDs. Rate history rows are changes,
                # not polling samples or payment/locked-rate evidence.
                if workspace_id is None:
                    ids = product_ids or []
                    placeholders = ",".join("?" for _ in ids)
                    known_rows = connection.execute(
                        f"SELECT product_id FROM product_states WHERE product_id IN ({placeholders}) "
                        f"UNION SELECT product_id FROM commission_history WHERE product_id IN ({placeholders})",
                        [*ids, *ids],
                    ).fetchall()
                    known = {row["product_id"] for row in known_rows}
                    missing = [product_id for product_id in ids if product_id not in known]
                    if missing:
                        return _error("unknown_products", product_ids=missing)
                    where = f"h.product_id IN ({placeholders})"
                    params: list[object] = list(ids)
                    scope_from = "commission_history h"
                else:
                    if product_ids is not None:
                        placeholders = ",".join("?" for _ in product_ids)
                        known_rows = connection.execute(
                            f"SELECT product_id FROM workspace_records WHERE workspace_id = ? "
                            f"AND product_id IN ({placeholders})",
                            [workspace_id, *product_ids],
                        ).fetchall()
                        known = {row["product_id"] for row in known_rows}
                        missing = [product_id for product_id in product_ids if product_id not in known]
                        if missing:
                            return _error("unknown_products", product_ids=missing)
                        product_filter = f" AND h.product_id IN ({placeholders})"
                        filter_params: list[object] = list(product_ids)
                    else:
                        product_filter = ""
                        filter_params = []
                    where = "wr.workspace_id = ?" + product_filter
                    params = [workspace_id, *filter_params]
                    scope_from = "commission_history h JOIN workspace_records wr ON wr.product_id = h.product_id"

                count = connection.execute(
                    f"SELECT COUNT(*) FROM {scope_from} WHERE {where}", params
                ).fetchone()[0]
                retained_row = connection.execute(
                    f"SELECT h.observed_at FROM {scope_from} WHERE {where} "
                    "ORDER BY h.observed_sort, h.history_id LIMIT 1",
                    params,
                ).fetchone()
                retention_tracking_started_at = connection.execute(
                    "SELECT value FROM store_metadata WHERE key = 'retention_tracking_started_at'"
                ).fetchone()[0]
                retention_pruned_count = int(connection.execute(
                    "SELECT value FROM store_metadata WHERE key = 'history_retention_pruned_count'"
                ).fetchone()[0])
                retention_pruned_count_complete = connection.execute(
                    "SELECT value FROM store_metadata WHERE key = 'history_retention_count_complete'"
                ).fetchone()[0] == "true"
                history_limit = min(limit, max(0, 1000 - offset))
                rows = connection.execute(
                    f"SELECT h.product_id, h.observed_at, h.timestamp_source, h.commission_pct, h.extra_comm "
                    f"FROM {scope_from} WHERE {where} "
                    "ORDER BY h.observed_sort DESC, h.history_id DESC LIMIT ? OFFSET ?",
                    [*params, history_limit, offset],
                ).fetchall()
                history = [
                    {"product_id": row["product_id"], "observed_at": row["observed_at"],
                     "timestamp_source": row["timestamp_source"],
                     "commission_pct": row["commission_pct"], "extra_comm": bool(row["extra_comm"])}
                    for row in rows
                ]
                accessible_total = min(count, 1000)
                return self._safe_result(
                    view="history", workspace_id=workspace_id,
                    name=workspace["name"] if workspace is not None else None,
                    source="observed_commission_changes", total=count, limit=limit, offset=offset,
                    pageable_total=accessible_total, page_truncated=count > accessible_total,
                    history=history,
                    next_offset=offset + len(history) if offset + len(history) < accessible_total else None,
                    history_incomplete=True,
                    history_coverage="opt_in_observations_only",
                    retention_tracking_started_at=retention_tracking_started_at,
                    retention_pruned_count=retention_pruned_count,
                    retention_pruned_count_complete=retention_pruned_count_complete,
                    retained_from=retained_row["observed_at"] if retained_row is not None else None,
                    history_semantics="observed commission_pct/extra_comm changes only; not paid or locked rates",
                )
        except sqlite3.Error:
            return _error("storage_error")
