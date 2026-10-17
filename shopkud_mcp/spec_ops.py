"""Extension-only P0/P1/P2 operations on the local campaign database.

Observations are stored only after an extension read or an owner-supplied
aggregate import. Nothing here calls the Affiliate Open API, follows an
affiliate redirect, or stores buyer or order identifiers.
"""

from __future__ import annotations

import csv
import io
import json
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from urllib.parse import urlsplit

from .campaigns import CampaignError, _PROVENANCE, _decimal_text, _fail, _workspace_id

# Cited prohibited-category phrases from Shopee Affiliate TH help.
# https://help.shopee.co.th/portal/10/article/132895
# Promoting these earns no commission. The article spells the utilities row "Utilites".
OFFICIAL_EXCLUDED_CATEGORIES = (
    "เครื่องประดับ",
    "โลหะมีค่าเพื่อการลงทุน",
    "แหวน",
    "ต่างหู",
    "กำไลข้อมือ",
    "กำไลข้อเท้า",
    "ชาร์ม & จี้",
    "ชาร์ม",
    "จี้",
    "อาวุธ",
    "บุหรี่",
    "ยาสูบ",
    "สิ่งมีชีวิตและซากสัตว์",
    "การบริการ",
    "utilites",
    "donation",
    "local service",
    "investment",
    "นมผง",
)
EXCLUDED_CATEGORY_CITATION = "https://help.shopee.co.th/portal/10/article/132895"
# Older local guesses. Article 132895 does not list them, so they are not applied.
UNVERIFIED_CATEGORY_GUESSES = (
    "voucher",
    "vouchers",
    "e-voucher",
    "gift card",
    "giftcard",
    "digital code",
    "คูปอง",
    "บัตรกำนัล",
    "ตั๋ว",
)
DEFAULT_EXCLUDED_CATEGORIES = OFFICIAL_EXCLUDED_CATEGORIES
# Local pacing only. No public Shopee page states these daily caps.
DEFAULT_POSTING_CAPS = {
    "tiktok": 50,
    "ig": 30,
    "fb": 40,
    "x": 100,
    "yt": 20,
    "spv": 20,
}
# TH Creator Level help lists levels 0, 1, and 2, refreshed every Tuesday from the
# prior 28 days. The quantitative cells did not extract as reliable numbers.
# https://help.shopee.co.th/portal/10/article/203761
# Singapore publishes different numbers and is not applied:
# https://help.shopee.sg/10/article/199073-Guidelines-on-Creator-Levelling-as-a-Shopee-Video-Live-Creator
VIDEO_LEVEL_CITATION = "https://help.shopee.co.th/portal/10/article/203761"
VIDEO_LEVEL_SG_CITATION = "https://help.shopee.sg/10/article/199073-Guidelines-on-Creator-Levelling-as-a-Shopee-Video-Live-Creator"
VIDEO_LEVEL_RULES = (
    {"level": 1, "active_days": None, "qualifying_clips": None, "min_clip_seconds": None, "quantitative_thresholds": "unverified", "market": "TH"},
    {"level": 2, "active_days": None, "qualifying_clips": None, "min_clip_seconds": None, "quantitative_thresholds": "unverified", "market": "TH"},
)
VIDEO_REFRESH_DAY = "tuesday"
# Not found in the 2026 TH payout article. The warning stays local.
# https://help.shopee.co.th/portal/10/article/142437
EARNINGS_EXPIRY_DAYS = 180
EARNINGS_WARN_DAYS = 30
PAYOUT_CITATION = "https://help.shopee.co.th/portal/10/article/142437"
PAYOUT_FACTS = {
    "citation": PAYOUT_CITATION,
    "kyc_verified_label": "ยืนยัน (Valid)",
    "minimum_accumulated_thb": 100,
    "non_vat_individual": "twice_a_week_new_bills_only",
    "vat_or_juristic": "twice_a_month_including_historical_bills",
    "next_cycle_phrase": "รอบการจ่ายถัดไป",
    "expiry_days": None,
    "expiry_evidence": "unverified",
}
ASSUMPTIONS = {
    "excluded_categories": {"evidence": "cited", "citation": EXCLUDED_CATEGORY_CITATION, "applied": list(OFFICIAL_EXCLUDED_CATEGORIES)},
    "category_guesses": {"evidence": "unverified", "applied": False, "labels": list(UNVERIFIED_CATEGORY_GUESSES)},
    "video_levels": {
        "evidence": "partial",
        "citation": VIDEO_LEVEL_CITATION,
        "levels": [0, 1, 2],
        "refresh_day": VIDEO_REFRESH_DAY,
        "refresh_day_evidence": "cited",
        "quantitative_thresholds": "unverified",
        "min_clip_seconds": None,
        "sg_not_applied": VIDEO_LEVEL_SG_CITATION,
    },
    "earnings_expiry": {"evidence": "unverified", "assumed_days": EARNINGS_EXPIRY_DAYS, "citation_checked": PAYOUT_CITATION},
    "payout_schedule": {"evidence": "cited", **PAYOUT_FACTS},
    "posting_caps": {"evidence": "unverified", "caps": dict(DEFAULT_POSTING_CAPS)},
}
REASON_HINTS = frozenset({
    "cancelled", "returned", "self", "household", "another_link", "voucher",
    "excluded_category", "indirect", "shop_cancel", "seller_cancel",
    "payment_failed", "buyer_cancel", "unknown", "unrecognized",
})
BUYER_CLASSES = frozenset({"self", "household", "other", "unknown"})
KYC_STATUSES = frozenset({"unknown", "unverified", "pending", "verified"})
STOCK_STATUSES = frozenset({"in_stock", "out_of_stock", "unknown"})

_ITEM_RE = re.compile(r"[1-9][0-9]{0,19}\Z")
_ACCOUNT_RE = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")
_IMAGE_HOST_RE = re.compile(r"(?:[a-z0-9-]+\.)*(?:susercontent|shopeemobile)\.com\Z")
_PRODUCT_URL_RE = re.compile(
    r"https://shopee\.co\.th/(?:product/([1-9][0-9]{0,19})/([1-9][0-9]{0,19})|[^/\s]*-i\.([1-9][0-9]{0,19})\.([1-9][0-9]{0,19}))(?:[/?#][^\s]*)?"
)
_SHORT_URL_RE = re.compile(r"https://s\.shopee\.co\.th/[A-Za-z0-9]+")
_URL_RE = re.compile(r"https://(?:shopee\.co\.th|s\.shopee\.co\.th)/[^\s]+")


def ensure_schema(connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS offer_snapshots (
            snapshot_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            account_id TEXT NOT NULL DEFAULT '',
            item_id TEXT NOT NULL,
            shop_id TEXT,
            title TEXT NOT NULL,
            category TEXT,
            official INTEGER NOT NULL DEFAULT 0,
            price REAL,
            rate_social REAL,
            rate_video REAL,
            extra_comm REAL,
            stock TEXT NOT NULL,
            sales INTEGER,
            rating REAL,
            image_urls_json TEXT NOT NULL,
            excluded_category INTEGER NOT NULL DEFAULT 0,
            excluded_reason TEXT,
            source TEXT NOT NULL,
            as_of TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS offer_snapshots_item
            ON offer_snapshots(workspace_id, account_id, item_id, as_of);
        CREATE TABLE IF NOT EXISTS conversion_buckets (
            bucket_id INTEGER PRIMARY KEY AUTOINCREMENT,
            workspace_id TEXT NOT NULL,
            account_id TEXT NOT NULL DEFAULT '',
            period_start TEXT NOT NULL,
            period_end TEXT NOT NULL,
            sub_id TEXT,
            status TEXT,
            reason_hint TEXT,
            category TEXT,
            buyer_class TEXT,
            commission_thb TEXT,
            row_count INTEGER NOT NULL,
            orders INTEGER NOT NULL,
            source TEXT NOT NULL,
            as_of TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS earnings_snapshots (
            snapshot_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            account_id TEXT NOT NULL DEFAULT '',
            pending_thb TEXT,
            validated_thb TEXT,
            paid_thb TEXT,
            next_payout TEXT,
            kyc_status TEXT NOT NULL,
            expiring_json TEXT NOT NULL,
            source TEXT NOT NULL,
            as_of TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS video_level (
            workspace_id TEXT NOT NULL,
            account_id TEXT NOT NULL DEFAULT '',
            level INTEGER,
            active_days INTEGER NOT NULL,
            qualifying_clips INTEGER NOT NULL,
            source TEXT NOT NULL,
            as_of TEXT NOT NULL,
            PRIMARY KEY (workspace_id, account_id)
        );
        CREATE TABLE IF NOT EXISTS video_drafts (
            draft_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            account_id TEXT NOT NULL DEFAULT '',
            file_name TEXT NOT NULL,
            caption TEXT NOT NULL,
            hashtags_json TEXT NOT NULL,
            item_ids_json TEXT NOT NULL,
            status TEXT NOT NULL,
            publish_allowed INTEGER NOT NULL,
            confirm_required INTEGER NOT NULL,
            source TEXT NOT NULL,
            as_of TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS posting_caps (
            workspace_id TEXT NOT NULL,
            account_id TEXT NOT NULL DEFAULT '',
            platform TEXT NOT NULL,
            daily_cap INTEGER NOT NULL,
            PRIMARY KEY (workspace_id, account_id, platform)
        );
        """
    )
    additions = {
        "links": {"account_id": "TEXT NOT NULL DEFAULT ''"},
        "missions": {"account_id": "TEXT NOT NULL DEFAULT ''"},
        "video_clips": {"account_id": "TEXT NOT NULL DEFAULT ''"},
        "commission_health": {"account_id": "TEXT NOT NULL DEFAULT ''"},
        "reports": {"account_id": "TEXT NOT NULL DEFAULT ''"},
    }
    for table, columns in additions.items():
        present = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
        for column, declaration in columns.items():
            if column not in present:
                connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")
    earnings_columns = {row[1] for row in connection.execute("PRAGMA table_info(earnings_snapshots)")}
    if "unpaid_since" not in earnings_columns:
        connection.execute("ALTER TABLE earnings_snapshots ADD COLUMN unpaid_since TEXT")


def account_id(value: Any) -> str:
    if value is None or value == "":
        return ""
    if type(value) is not str or not _ACCOUNT_RE.fullmatch(value):
        _fail("invalid_request")
    return value


_PII_HEADER_RE = re.compile(
    r"(?i)(?:order[\s_-]*id|buyer|customer|phone|e-?mail|address|recipient|"
    r"ชื่อผู้ซื้อ|เบอร์โทร|อีเมล|เลขออเดอร์|เลขที่สั่ง)"
)
_PII_VALUE_RE = re.compile(
    r"(?i)(?:^ord(?:er)?[-_ ]?\d|^order[-_ ]?id\b|@|"
    r"\b(?:buyer|customer|recipient)(?:[-_ ]?(?:name|email|phone|id))?\b|^0\d{8,}$|^\+?\d{10,}$)"
)
_RECEIPT_KEYS = frozenset({
    "affiliate_url", "product_id", "page_url", "created_at", "captured_at",
    "status", "product_attested", "dialog_detection_method", "sub_id_slots",
})
_RECEIPT_STATUS = frozenset({"confirmed", "unconfirmed", "not_attempted"})
_SLOT_METHOD_RE = re.compile(r"[a-z0-9_]{1,40}\Z")
_OFFER_PAGE_RE = re.compile(r"https://affiliate\.shopee\.co\.th/offer/product_offer/[1-9][0-9]{0,19}\Z")


def reject_attribution(value: str) -> str:
    """Reject buyer, order, and contact-shaped attribution. Do not echo the value."""
    if type(value) is not str or not value or len(value) > 128:
        _fail("invalid_request")
    if _PII_VALUE_RE.search(value):
        _fail("pii_rejected")
    return value


def reject_mapping_header(header: str) -> None:
    if type(header) is not str or _PII_HEADER_RE.search(header):
        _fail("pii_rejected")


def sanitize_receipt(receipt: dict[str, Any], *, affiliate_url: str, product_id: str) -> dict[str, Any]:
    """Keep an allowlisted creation receipt. Unknown keys are rejected, not stored."""
    if type(receipt) is not dict:
        _fail("invalid_request")
    if set(receipt) - _RECEIPT_KEYS:
        _fail("pii_rejected")
    clean: dict[str, Any] = {}
    if "affiliate_url" in receipt:
        if receipt["affiliate_url"] != affiliate_url:
            _fail("invalid_request")
        clean["affiliate_url"] = affiliate_url
    if "product_id" in receipt:
        if type(receipt["product_id"]) is not str or receipt["product_id"] != product_id:
            _fail("invalid_request")
        clean["product_id"] = product_id
    if "page_url" in receipt:
        if type(receipt["page_url"]) is not str or not _OFFER_PAGE_RE.fullmatch(receipt["page_url"]):
            _fail("invalid_request")
        if not receipt["page_url"].endswith("/" + product_id):
            _fail("invalid_request")
        clean["page_url"] = receipt["page_url"]
    for stamp in ("created_at", "captured_at"):
        if stamp in receipt:
            if type(receipt[stamp]) is not str or len(receipt[stamp]) > 40:
                _fail("invalid_request")
            try:
                datetime.fromisoformat(receipt[stamp].replace("Z", "+00:00"))
            except ValueError:
                _fail("invalid_request")
            clean[stamp] = receipt[stamp]
    if "status" in receipt:
        if receipt["status"] not in _RECEIPT_STATUS:
            _fail("invalid_request")
        clean["status"] = receipt["status"]
    if "product_attested" in receipt:
        if type(receipt["product_attested"]) is not bool:
            _fail("invalid_request")
        clean["product_attested"] = receipt["product_attested"]
    if "dialog_detection_method" in receipt:
        if type(receipt["dialog_detection_method"]) is not str or not _SLOT_METHOD_RE.fullmatch(receipt["dialog_detection_method"]):
            _fail("invalid_request")
        clean["dialog_detection_method"] = receipt["dialog_detection_method"]
    if "sub_id_slots" in receipt:
        slots = receipt["sub_id_slots"]
        if type(slots) is not list or len(slots) > 5 or any(type(slot) is not int or not 1 <= slot <= 5 for slot in slots):
            _fail("invalid_request")
        clean["sub_id_slots"] = slots
    return clean


def verify_receipt_only(
    affiliate_url: str,
    expected_product_id: str | None,
    link_receipt: dict[str, Any] | None,
    *,
    check_target: bool,
    check_ownership: bool,
) -> dict[str, Any]:
    """Trust only an extension receipt that attests this exact URL and product."""
    result: dict[str, Any] = {
        "ok": True,
        "affiliate_url": affiliate_url,
        "target_verified": "unknown",
        "ownership_verified": "unknown",
        "verification_method": "receipt_only",
        "opens_links": False,
        "verified_at": _now(),
    }
    if not link_receipt:
        result["warnings"] = ["no_receipt"]
        return result
    if type(link_receipt) is not dict:
        return {**result, "ok": False, "error": "invalid_request"}
    if type(link_receipt.get("affiliate_url")) is str and link_receipt["affiliate_url"] != affiliate_url:
        result["target_verified"] = "unknown"
        result["ownership_verified"] = "unknown"
        result["target_evidence"] = "receipt_url_mismatch"
        result["ownership_evidence"] = "receipt_url_mismatch"
        return result
    product_id = link_receipt.get("product_id") if type(link_receipt.get("product_id")) is str else (expected_product_id or "")
    try:
        clean = sanitize_receipt(link_receipt, affiliate_url=affiliate_url, product_id=product_id or "0")
    except CampaignError as error:
        return {**result, "ok": False, "error": error.code}
    attested = (
        clean.get("product_attested") is True
        and clean.get("status") == "confirmed"
        and clean.get("affiliate_url") == affiliate_url
        and type(clean.get("product_id")) is str
    )
    if check_target:
        if not attested:
            result["target_verified"] = "unknown"
            result["target_evidence"] = "receipt_not_attested"
        elif expected_product_id and clean["product_id"] == expected_product_id:
            result["target_verified"] = True
            result["resolved_item_id"] = clean["product_id"]
            result["target_evidence"] = "attested_product_match"
        elif expected_product_id:
            result["target_verified"] = False
            result["resolved_item_id"] = clean["product_id"]
            result["target_evidence"] = "attested_product_mismatch"
        else:
            result["target_verified"] = "unknown"
            result["target_evidence"] = "expected_product_missing"
    if check_ownership:
        if attested and clean.get("created_at"):
            result["ownership_verified"] = True
            result["ownership_evidence"] = "attested_creation_receipt"
        else:
            result["ownership_verified"] = "unknown"
            result["ownership_evidence"] = "receipt_not_attested"
    return result


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _item_id(value: Any) -> str:
    if type(value) is not str or not _ITEM_RE.fullmatch(value):
        _fail("invalid_request")
    return value


def _money_text(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if type(value) is str:
        try:
            number = Decimal(value)
        except Exception:
            _fail("invalid_request")
    elif type(value) in {int, float} and value == value and abs(value) < 1e12:
        number = Decimal(str(value))
    else:
        _fail("invalid_request")
    if number < 0 or number > Decimal("1000000000"):
        _fail("invalid_request")
    return _decimal_text(number)


def sanitize_reason(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if type(value) is not str:
        return "unrecognized"
    token = re.sub(r"[\s-]+", "_", value.strip().casefold())
    return token if token in REASON_HINTS else "unrecognized"


def sanitize_buyer(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if type(value) is not str:
        return "unknown"
    token = value.strip().casefold()
    return token if token in BUYER_CLASSES else "unknown"


def sanitize_category(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if type(value) is not str:
        return None
    text = " ".join(value.split())[:80]
    if not text or "@" in text or re.search(r"\d{6,}", text):
        return None
    return text


def _label_in(folded: str, label: str) -> bool:
    needle = label.casefold()
    if len(needle) <= 2:
        return re.search(rf"(?<!\S){re.escape(needle)}(?!\S)", folded) is not None
    return needle in folded


def excluded_category(category: str | None, extra: tuple[str, ...] = ()) -> str | None:
    """Match the cited TH prohibited-category list. Unverified guesses are not applied."""
    if not category:
        return None
    folded = category.casefold()
    for label in (*DEFAULT_EXCLUDED_CATEGORIES, *extra):
        if _label_in(folded, label):
            return label
    return None


def classify_cancellation(row: dict[str, Any]) -> dict[str, Any]:
    """Classify one aggregate bucket. Never reads an order id or buyer name."""
    status = (row.get("status") or "").casefold()
    reason = row.get("reason_hint") or ""
    category = row.get("category") or ""
    buyer = row.get("buyer_class") or ""
    try:
        commission = Decimal(row.get("commission_thb") or "0")
    except Exception:
        commission = Decimal(0)
    evidence: list[str] = []
    if buyer in {"self", "household"}:
        return _class("self_or_household_purchase", "0.80", ["buyer_class"])
    if reason == "another_link":
        return _class("buyer_clicked_another_link", "0.75", ["reason_hint"])
    if reason == "excluded_category" or excluded_category(category):
        evidence = ["category"] if excluded_category(category) else ["reason_hint"]
        return _class("excluded_category", "0.85", evidence)
    if reason == "indirect":
        return _class("indirect_order", "0.70", ["reason_hint"])
    if reason in {"shop_cancel", "seller_cancel"} or "shop" in status or "seller" in status:
        return _class("shop_cancel", "0.75", ["status" if "shop" in status or "seller" in status else "reason_hint"])
    if reason == "voucher" or (commission == 0 and reason == "payment_failed"):
        if reason == "payment_failed":
            return _class("payment_failed", "0.70", ["reason_hint"])
        return _class("voucher_fully_paid", "0.65", ["reason_hint"])
    if reason == "payment_failed":
        return _class("payment_failed", "0.70", ["reason_hint"])
    if reason in {"cancelled", "returned", "buyer_cancel"} or status in {"cancelled", "returned", "refunded"} or "cancel" in status or "return" in status:
        return _class("order_cancelled_or_returned", "0.70", ["status" if status else "reason_hint"])
    if commission == 0 and int(row.get("orders") or row.get("row_count") or 0) > 0:
        return _class("zero_commission_unclassified", "0.30", ["commission"])
    return _class("unknown", "0.20", [])


def _class(reason: str, confidence: str, evidence: list[str]) -> dict[str, Any]:
    return {"likely_reason": reason, "confidence": confidence, "evidence_fields": evidence}


def store_conversion_buckets(
    connection,
    workspace_id: str,
    period_start: str,
    period_end: str,
    records: list[dict[str, Any]],
    *,
    account: str = "",
) -> None:
    grouped: dict[tuple, dict[str, Any]] = {}
    for record in records:
        hint = sanitize_reason(record.get("reason"))
        category = sanitize_category(record.get("category"))
        buyer = sanitize_buyer(record.get("buyer_class"))
        status = record.get("status") if type(record.get("status")) is str else None
        sub_id = record.get("sub_id") if type(record.get("sub_id")) is str else None
        orders = record.get("orders") if type(record.get("orders")) is int else 0
        commission = record.get("commission")
        commission_text = _decimal_text(commission) if isinstance(commission, Decimal) else None
        key = (sub_id, status, hint, category, buyer, commission_text)
        bucket = grouped.setdefault(key, {"row_count": 0, "orders": 0})
        bucket["row_count"] += 1
        bucket["orders"] += orders
    now = _now()
    for key, bucket in grouped.items():
        sub_id, status, hint, category, buyer, commission_text = key
        connection.execute(
            """INSERT INTO conversion_buckets
               (workspace_id, account_id, period_start, period_end, sub_id, status,
                reason_hint, category, buyer_class, commission_thb, row_count, orders, source, as_of)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (workspace_id, account, period_start, period_end, sub_id, status, hint, category,
             buyer, commission_text, bucket["row_count"], bucket["orders"], "imported_aggregate", now),
        )


def project_offer(detail: dict[str, Any]) -> dict[str, Any]:
    """Shape an extension product-detail read into the P0-7 offer contract."""
    channels = detail.get("channels") if type(detail.get("channels")) is list else []
    by_name = {row.get("channel"): row for row in channels if type(row) is dict}
    social = by_name.get("social") or {}
    video = by_name.get("shopee_video") or {}

    def rate(row: dict[str, Any]) -> float | None:
        total = row.get("total_pct")
        if type(total) in {int, float}:
            return float(total)
        shopee = row.get("shopee_commission") or {}
        pct = shopee.get("pct") if type(shopee) is dict else None
        return float(pct) if type(pct) in {int, float} else None

    def extra(row: dict[str, Any]) -> float | None:
        block = row.get("extra_commission") or {}
        pct = block.get("pct") if type(block) is dict else None
        return float(pct) if type(pct) in {int, float} else None

    category = detail.get("category") if type(detail.get("category")) is str else None
    excluded = excluded_category(category)
    social_rate = rate(social)
    video_rate = rate(video)
    extra_values = [value for value in (extra(social), extra(video)) if value is not None]
    warnings = ["excluded_category"] if excluded else []
    if not channels:
        warnings.append("per_channel_split_not_observed")
    return {
        "ok": True,
        "item_id": detail.get("product_id") or detail.get("item_id"),
        "shop_id": detail.get("shop_id"),
        "title": detail.get("name") or detail.get("title"),
        "price": detail.get("price_min_thb", detail.get("price")),
        "commission_rate": social_rate if social_rate is not None else video_rate,
        "extra_comm": extra_values[0] if extra_values else None,
        "per_channel": {"social": social_rate, "video": video_rate},
        "shop": {"official": bool(detail.get("official"))},
        "stock": detail.get("stock") if detail.get("stock") in STOCK_STATUSES else "unknown",
        "category": category,
        "excluded_category": bool(excluded),
        "excluded_match": excluded,
        "commission_eligible": not bool(excluded),
        "warnings": warnings,
        "images": detail.get("images") if type(detail.get("images")) is list else [],
        "source": "ext",
        "as_of": detail.get("observed_at") or _now(),
        "provenance": _PROVENANCE,
    }


class SpecOps:
    def __init__(self, store):
        self.store = store

    def record_offer(
        self,
        workspace_id: str,
        item_id: str,
        title: str,
        *,
        account: Any = None,
        shop_id: str | None = None,
        category: str | None = None,
        official: bool = False,
        price: Any = None,
        rate_social: Any = None,
        rate_video: Any = None,
        extra_comm: Any = None,
        stock: str = "unknown",
        sales: int | None = None,
        rating: float | None = None,
        image_urls: list[str] | None = None,
        as_of: str | None = None,
    ) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        item_id = _item_id(item_id)
        account = account_id(account)
        if type(title) is not str or not title.strip() or len(title) > 500:
            _fail("invalid_request")
        if stock not in STOCK_STATUSES or type(official) is not bool:
            _fail("invalid_request")
        category = sanitize_category(category)
        shop_id = shop_id if shop_id is None else _item_id(shop_id) if _ITEM_RE.fullmatch(shop_id or "") else _fail("invalid_request")
        images = []
        for url in image_urls or []:
            safe = _image_url(url)
            if safe:
                images.append(safe)
            if len(images) >= 30:
                break
        rates = {
            "price": _optional_number(price, minimum=0, maximum=1_000_000_000),
            "rate_social": _optional_number(rate_social, minimum=0, maximum=100),
            "rate_video": _optional_number(rate_video, minimum=0, maximum=100),
            "extra_comm": _optional_number(extra_comm, minimum=0, maximum=100),
            "rating": _optional_number(rating, minimum=0, maximum=5),
        }
        if sales is not None and (type(sales) is not int or sales < 0 or sales > 1_000_000_000):
            _fail("invalid_request")
        stamp = _timestamp(as_of)
        match = excluded_category(category)
        snapshot_id = _token()
        with self.store._connection(write=True) as connection:
            self.store._begin(connection)
            connection.execute(
                """INSERT INTO offer_snapshots
                   (snapshot_id, workspace_id, account_id, item_id, shop_id, title, category,
                    official, price, rate_social, rate_video, extra_comm, stock, sales, rating,
                    image_urls_json, excluded_category, excluded_reason, source, as_of)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (snapshot_id, workspace_id, account, item_id, shop_id, title.strip(), category,
                 int(official), rates["price"], rates["rate_social"], rates["rate_video"],
                 rates["extra_comm"], stock, sales, rates["rating"],
                 json.dumps(images, separators=(",", ":")), int(bool(match)), match,
                 "ext", stamp),
            )
            self.store._check_database_capacity(connection)
            connection.commit()
        offer = self.get_offer(workspace_id, item_id, account=account or None)
        offer["snapshot_id"] = snapshot_id
        return offer

    def get_offer(self, workspace_id: str, item_id: str, account: Any = None) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        item_id = _item_id(item_id)
        account = account_id(account) if account else None
        with self.store._connection() as connection:
            row = self._latest_offer(connection, workspace_id, item_id, account)
        if row is None:
            _fail("offer_not_found")
        return _offer_row(row)

    def search_offers(
        self,
        workspace_id: str,
        keyword: str | None = None,
        sort: str = "commission",
        *,
        official: bool | None = None,
        extra_comm: bool | None = None,
        min_rate: float | None = None,
        limit: int = 20,
        account: Any = None,
    ) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        account = account_id(account) if account else None
        if sort not in {"commission", "sales", "price", "rating"}:
            _fail("invalid_request")
        if type(limit) is not int or not 1 <= limit <= 100:
            _fail("invalid_request")
        if keyword is not None and (type(keyword) is not str or len(keyword) > 200):
            _fail("invalid_request")
        min_rate_value = _optional_number(min_rate, minimum=0, maximum=100)
        with self.store._connection() as connection:
            rows = self._latest_offers(connection, workspace_id, account)
        items = []
        needle = (keyword or "").casefold().strip()
        for row in rows:
            offer = _offer_row(row)
            if needle and needle not in (offer["title"] or "").casefold() and needle not in (offer["category"] or "").casefold():
                continue
            if official is True and not offer["shop"]["official"]:
                continue
            if extra_comm is True and not offer["extra_comm"]:
                continue
            rate = offer["commission_rate"] or 0
            if min_rate_value is not None and rate < min_rate_value:
                continue
            items.append(offer)
        def sort_key(offer: dict[str, Any]):
            if sort == "sales":
                return offer.get("sales") or 0
            if sort == "price":
                return -(offer["price"] or 0)
            if sort == "rating":
                return offer.get("rating") or 0
            return offer["commission_rate"] or 0
        items.sort(key=sort_key, reverse=sort != "price")
        return {
            "ok": True,
            "workspace_id": workspace_id,
            "account": account,
            "keyword": keyword,
            "sort": sort,
            "items": items[:limit],
            "count": min(len(items), limit),
            "source": "cache",
            "as_of": _now(),
            "provenance": _PROVENANCE,
        }

    def get_price_history(self, workspace_id: str, item_id: str, account: Any = None) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        item_id = _item_id(item_id)
        account = account_id(account) if account else None
        query = """SELECT as_of, price, source FROM offer_snapshots
                   WHERE workspace_id=? AND item_id=?"""
        params: list[Any] = [workspace_id, item_id]
        if account is not None:
            query += " AND account_id=?"
            params.append(account)
        query += " ORDER BY as_of ASC"
        with self.store._connection() as connection:
            rows = connection.execute(query, params).fetchall()
        points = [{"as_of": row[0], "price": row[1], "source": row[2]} for row in rows if row[1] is not None]
        return {
            "ok": True,
            "item_id": item_id,
            "points": points,
            "count": len(points),
            "source": "cache",
            "as_of": points[-1]["as_of"] if points else None,
            "note": "Prices come from extension snapshots stored locally, not a live catalog.",
            "provenance": _PROVENANCE,
        }

    def get_product_media(self, workspace_id: str, item_id: str, account: Any = None) -> dict[str, Any]:
        offer = self.get_offer(workspace_id, item_id, account=account)
        return {
            "ok": True,
            "item_id": item_id,
            "images": offer["images"],
            "source": "cache",
            "as_of": offer["as_of"],
            "provenance": _PROVENANCE,
        }

    def suggest_replacement(self, workspace_id: str, item_id: str, k: int = 5, account: Any = None) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        item_id = _item_id(item_id)
        if type(k) is not int or not 1 <= k <= 20:
            _fail("invalid_request")
        current = self.get_offer(workspace_id, item_id, account=account)
        others = self.search_offers(workspace_id, sort="commission", limit=100, account=account)["items"]
        current_tokens = _tokens(current["title"])
        ranked = []
        for candidate in others:
            if candidate["item_id"] == item_id:
                continue
            if candidate["excluded_category"]:
                continue
            overlap = _tokens(candidate["title"])
            union = current_tokens | overlap
            similarity = (len(current_tokens & overlap) / len(union)) if union else 0
            same_category = bool(current["category"] and current["category"] == candidate["category"])
            if similarity < 0.2 and not same_category:
                continue
            score = similarity * 50
            reasons = []
            if same_category:
                score += 30
                reasons.append("same_category")
            if similarity:
                reasons.append("title_overlap")
            if candidate["shop"]["official"]:
                score += 10
                reasons.append("official_shop")
            if candidate["extra_comm"]:
                score += 10
                reasons.append("extra_commission")
            if candidate["stock"] == "in_stock":
                score += 10
                reasons.append("in_stock")
            elif candidate["stock"] == "out_of_stock":
                score -= 20
            score += candidate["commission_rate"] or 0
            ranked.append({
                "item_id": candidate["item_id"],
                "shop": candidate["shop"],
                "title": candidate["title"],
                "rate": candidate["commission_rate"],
                "extra_comm": candidate["extra_comm"],
                "price": candidate["price"],
                "stock": candidate["stock"],
                "similarity": round(similarity, 3),
                "score": round(score, 3),
                "reason": reasons,
                "source": "cache",
                "as_of": candidate["as_of"],
            })
        ranked.sort(key=lambda row: row["score"], reverse=True)
        return {
            "ok": True,
            "item_id": item_id,
            "candidates": ranked[:k],
            "count": min(len(ranked), k),
            "source": "cache",
            "as_of": _now(),
            "provenance": _PROVENANCE,
        }

    def commission_health_from_snapshots(
        self,
        workspace_id: str,
        *,
        scope: Any = "all",
        account: Any = None,
    ) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        account = account_id(account) if account else None
        clip_filter = _scope_clips(scope)
        with self.store._connection() as connection:
            query = """SELECT item_id, as_of, rate_social, rate_video, extra_comm, stock, title, account_id
                       FROM offer_snapshots WHERE workspace_id=?"""
            params: list[Any] = [workspace_id]
            if account is not None:
                query += " AND account_id=?"
                params.append(account)
            query += " ORDER BY account_id, item_id, as_of"
            rows = connection.execute(query, params).fetchall()
            clip_items = None
            if clip_filter is not None:
                marks = ",".join("?" * len(clip_filter))
                clip_query = f"""SELECT DISTINCT product_id FROM links
                        WHERE workspace_id=? AND clip_id IN ({marks})"""
                clip_params: list[Any] = [workspace_id, *clip_filter]
                if account is not None:
                    clip_query += " AND account_id=?"
                    clip_params.append(account)
                found = connection.execute(clip_query, clip_params).fetchall()
                clip_items = {row[0] for row in found}
        grouped: dict[tuple[str, str], list] = {}
        for row in rows:
            if clip_items is not None and row[0] not in clip_items:
                continue
            grouped.setdefault((row[7], row[0]), []).append(row)
        results = []
        for (row_account, item), observations in grouped.items():
            latest = observations[-1]
            previous = observations[-2] if len(observations) > 1 else None
            new_rate = _best_rate(latest[2], latest[3])
            old_rate = _best_rate(previous[2], previous[3]) if previous else None
            stock = latest[5]
            if stock == "out_of_stock":
                status = "oos"
            elif new_rate is None or new_rate == 0:
                status = "removed"
            elif old_rate is not None and new_rate < old_rate:
                status = "dropped"
            else:
                status = "ok"
            clip_id = None
            results.append({
                "clip_id": clip_id,
                "item_id": item,
                "account": row_account or None,
                "title": latest[6],
                "old_rate": old_rate,
                "new_rate": new_rate,
                "status": status,
                "as_of": latest[1],
                "source": "cache",
            })
        if clip_filter is not None:
            with self.store._connection() as connection:
                marks = ",".join("?" * len(clip_filter))
                link_query = f"""SELECT clip_id, product_id, account_id FROM links
                        WHERE workspace_id=? AND clip_id IN ({marks})"""
                link_params: list[Any] = [workspace_id, *clip_filter]
                if account is not None:
                    link_query += " AND account_id=?"
                    link_params.append(account)
                link_rows = connection.execute(link_query, link_params).fetchall()
            by_item = {(row.get("account") or "", row["item_id"]): row for row in results}
            scoped = []
            for clip_id, product_id, link_account in link_rows:
                row = by_item.get((link_account or "", product_id))
                if row:
                    scoped.append({**row, "clip_id": clip_id})
            results = scoped
        alerts = [row for row in results if row["status"] != "ok"]
        return {
            "ok": True,
            "workspace_id": workspace_id,
            "scope": "all" if clip_filter is None else clip_filter,
            "checked_count": len(results),
            "alert_count": len(alerts),
            "results": results,
            "alerts": alerts,
            "source": "cache",
            "as_of": _now(),
            "provenance": _PROVENANCE,
        }

    def explain_cancellations(self, workspace_id: str, period_start: str, period_end: str, account: Any = None) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        period_start = _date(period_start)
        period_end = _date(period_end)
        if period_start > period_end:
            _fail("invalid_period")
        account = account_id(account) if account else None
        with self.store._connection() as connection:
            query = """SELECT status, reason_hint, category, buyer_class, commission_thb, row_count, orders
                       FROM conversion_buckets
                       WHERE workspace_id=? AND period_start>=? AND period_end<=?"""
            params: list[Any] = [workspace_id, period_start, period_end]
            if account is not None:
                query += " AND account_id=?"
                params.append(account)
            buckets = connection.execute(query, params).fetchall()
            status_query = """SELECT rg.status_counts FROM report_groups rg
                   JOIN reports r ON r.report_id=rg.report_id
                   WHERE r.workspace_id=? AND r.period_start>=? AND r.period_end<=? AND r.status_present=1"""
            status_params: list[Any] = [workspace_id, period_start, period_end]
            if account is not None:
                status_query += " AND r.account_id=?"
                status_params.append(account)
            status_rows = connection.execute(status_query, status_params).fetchall()
        totals: dict[str, dict[str, Any]] = {}
        total_rows = 0
        zero_rows = 0
        for status, hint, category, buyer, commission, row_count, orders in buckets:
            row = {
                "status": status,
                "reason_hint": hint,
                "category": category,
                "buyer_class": buyer,
                "commission_thb": commission,
                "orders": orders,
                "row_count": row_count,
            }
            classified = classify_cancellation(row)
            if classified["likely_reason"] == "unknown" and (status or "") not in {"cancelled", "returned"} and not hint and not buyer:
                continue
            count = row_count or 0
            total_rows += count
            if classified["likely_reason"] in {"voucher_fully_paid", "zero_commission_unclassified"}:
                zero_rows += count
            slot = totals.setdefault(classified["likely_reason"], {
                "likely_reason": classified["likely_reason"],
                "count": 0,
                "confidence": classified["confidence"],
                "evidence_fields": classified["evidence_fields"],
                "commission_thb": Decimal(0),
            })
            slot["count"] += count
            if commission:
                slot["commission_thb"] += Decimal(commission) * count
        if not totals:
            for (raw,) in status_rows:
                try:
                    counts = json.loads(raw) if raw else {}
                except json.JSONDecodeError:
                    continue
                cancelled = int(counts.get("cancelled") or 0)
                if cancelled:
                    slot = totals.setdefault("order_cancelled_or_returned", {
                        "likely_reason": "order_cancelled_or_returned",
                        "count": 0,
                        "confidence": "0.50",
                        "evidence_fields": ["status"],
                        "commission_thb": Decimal(0),
                    })
                    slot["count"] += cancelled
                    total_rows += cancelled
        classifications = []
        for slot in totals.values():
            slot["commission_thb"] = _decimal_text(slot["commission_thb"])
            classifications.append(slot)
        classifications.sort(key=lambda row: row["count"], reverse=True)
        return {
            "ok": True,
            "workspace_id": workspace_id,
            "period_start": period_start,
            "period_end": period_end,
            "classifications": classifications,
            "summary": {"rows": total_rows, "zero_commission_rows": zero_rows},
            "order_level_data": "omitted",
            "source": "imported_aggregate",
            "as_of": _now(),
            "note": "Buyer and order identifiers are not stored. Reasons come from aggregate status, category, and a closed hint vocabulary.",
            "provenance": _PROVENANCE,
        }

    def get_conversions(self, workspace_id: str, period_start: str, period_end: str, status: str | None = None, account: Any = None) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        period_start = _date(period_start)
        period_end = _date(period_end)
        account = account_id(account) if account else None
        if status is not None and (type(status) is not str or len(status) > 40):
            _fail("invalid_request")
        query = """SELECT sub_id, status, reason_hint, category, SUM(row_count), SUM(orders), commission_thb
                   FROM conversion_buckets
                   WHERE workspace_id=? AND period_start>=? AND period_end<=?"""
        params: list[Any] = [workspace_id, period_start, period_end]
        if account is not None:
            query += " AND account_id=?"
            params.append(account)
        if status is not None:
            query += " AND status=?"
            params.append(status)
        query += " GROUP BY sub_id, status, reason_hint, category, commission_thb ORDER BY sub_id"
        with self.store._connection() as connection:
            rows = connection.execute(query, params).fetchall()
        return {
            "ok": True,
            "rows": [
                {
                    "sub_id": row[0],
                    "status": row[1],
                    "reason_hint": row[2],
                    "category": row[3],
                    "rows": row[4],
                    "orders": row[5],
                    "commission_thb": row[6],
                }
                for row in rows
            ],
            "source": "imported_aggregate",
            "as_of": _now(),
            "order_level_data": "omitted",
            "provenance": _PROVENANCE,
        }

    def check_post_compliance(self, workspace_id: str, mission_id: str, caption: str, link: str | None = None) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        if type(mission_id) is not str or not mission_id or len(mission_id) > 200:
            _fail("invalid_request")
        if type(caption) is not str or len(caption) > 5000:
            _fail("invalid_request")
        with self.store._connection() as connection:
            stored_account = account_id(None)
            row = connection.execute(
                """SELECT requirements_json, enrolled FROM missions
                   WHERE mission_id=? AND workspace_id=? AND account_id=?""",
                (mission_id, workspace_id, stored_account),
            ).fetchone()
            saved = None
            if link:
                saved = connection.execute(
                    """SELECT affiliate_url, sub_id_1, sub_id_2, sub_id_3, channel
                       FROM links WHERE workspace_id=? AND account_id=? AND affiliate_url=?""",
                    (workspace_id, stored_account, link),
                ).fetchone()
        if row is None:
            _fail("mission_not_enrolled")
        try:
            requirements = json.loads(row[0]) if row[0] else {}
        except json.JSONDecodeError:
            requirements = {}
        missing = []
        keywords = requirements.get("keywords") if type(requirements.get("keywords")) is list else []
        folded = caption.casefold()
        for keyword in keywords:
            if type(keyword) is str and keyword.casefold() not in folded:
                missing.append({"kind": "keyword", "value": keyword[:80]})
        forbidden = requirements.get("forbidden") if type(requirements.get("forbidden")) is list else []
        blocked = [word for word in forbidden if type(word) is str and word.casefold() in folded]
        if requirements.get("require_link") and not link:
            missing.append({"kind": "link", "value": "required"})
        link_report = {"provided": bool(link), "in_registry": saved is not None}
        if requirements.get("require_sub_id") and (saved is None or not saved[1]):
            missing.append({"kind": "sub_id", "value": "registry_link_with_sub_id"})
        return {
            "ok": True,
            "mission_id": mission_id,
            "enrolled": bool(row[1]),
            "compliant": not missing and not blocked,
            "missing": missing,
            "forbidden_hits": blocked[:20],
            "link": link_report,
            "confirm_required": True,
            "publishes": False,
            "source": "cache",
            "as_of": _now(),
            "provenance": _PROVENANCE,
        }

    def list_video_clips(self, workspace_id: str, account: Any = None) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        account = account_id(account) if account else None
        query = """SELECT video_id, title, status, cart_items_json, commission_flag, observed_at, account_id
                   FROM video_clips WHERE workspace_id=?"""
        params: list[Any] = [workspace_id]
        if account is not None:
            query += " AND account_id=?"
            params.append(account)
        query += " ORDER BY observed_at DESC"
        with self.store._connection() as connection:
            rows = connection.execute(query, params).fetchall()
            health_query = "SELECT account_id, product_id, status FROM commission_health WHERE workspace_id=?"
            health_params: list[Any] = [workspace_id]
            if account is not None:
                health_query += " AND account_id=?"
                health_params.append(account)
            health = {
                (row[0], row[1]): row[2]
                for row in connection.execute(health_query, health_params)
            }
        clips = []
        for video_id, title, status, cart_json, flag, observed_at, clip_account in rows:
            try:
                items = json.loads(cart_json) if cart_json else []
            except json.JSONDecodeError:
                items = []
            flagged = flag
            if flagged is None:
                flagged = any(health.get((clip_account, str(item.get("product_id")))) in {"dropped", "removed"} for item in items if type(item) is dict)
            clips.append({
                "video_id": video_id,
                "title": title,
                "status": status,
                "items": items,
                "commission_flag": bool(flagged),
                "as_of": observed_at,
            })
        return {"ok": True, "clips": clips, "count": len(clips), "source": "cache", "as_of": _now(), "provenance": _PROVENANCE}

    def record_earnings(
        self,
        workspace_id: str,
        *,
        pending: Any = None,
        validated: Any = None,
        paid: Any = None,
        next_payout: str | None = None,
        kyc_status: str = "unknown",
        account: Any = None,
        as_of: str | None = None,
    ) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        account = account_id(account)
        if kyc_status not in KYC_STATUSES:
            _fail("invalid_request")
        if next_payout is not None:
            next_payout = _date(next_payout)
        stamp = _timestamp(as_of)
        pending_text = _money_text(pending)
        validated_text = _money_text(validated)
        snapshot_id = _token()
        with self.store._connection(write=True) as connection:
            self.store._begin(connection)
            previous = connection.execute(
                """SELECT pending_thb, validated_thb, unpaid_since, as_of
                   FROM earnings_snapshots
                   WHERE workspace_id=? AND account_id=?
                   ORDER BY as_of DESC, rowid DESC LIMIT 1""",
                (workspace_id, account),
            ).fetchone()
            if previous and previous[0] == pending_text and previous[1] == validated_text:
                unpaid_since = previous[2] or previous[3]
            else:
                unpaid_since = stamp
            connection.execute(
                """INSERT INTO earnings_snapshots
                   (snapshot_id, workspace_id, account_id, pending_thb, validated_thb, paid_thb,
                    next_payout, kyc_status, expiring_json, source, as_of, unpaid_since)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 'ext', ?, ?)""",
                (snapshot_id, workspace_id, account, pending_text, validated_text,
                 _money_text(paid), next_payout, kyc_status, stamp, unpaid_since),
            )
            connection.commit()
        return self.get_earnings_summary(workspace_id, account=account or None)

    def get_earnings_summary(self, workspace_id: str, account: Any = None) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        account = account_id(account) if account else None
        query = """SELECT pending_thb, validated_thb, paid_thb, next_payout, kyc_status, as_of, unpaid_since
                   FROM earnings_snapshots WHERE workspace_id=?"""
        params: list[Any] = [workspace_id]
        if account is not None:
            query += " AND account_id=?"
            params.append(account)
        query += " ORDER BY as_of DESC, rowid DESC LIMIT 1"
        with self.store._connection() as connection:
            row = connection.execute(query, params).fetchone()
        if row is None:
            return {
                "ok": True,
                "pending": None,
                "validated": None,
                "paid": None,
                "next_payout": None,
                "kyc_status": "unknown",
                "expiring": [],
                "source": "cache",
                "as_of": None,
                "note": "No extension earnings snapshot has been recorded.",
                "provenance": _PROVENANCE,
            }
        expiring = []
        balance_since = row[6] or row[5]
        observed = datetime.fromisoformat(balance_since)
        age = datetime.now(timezone.utc) - observed
        unpaid = Decimal(row[0] or "0") + Decimal(row[1] or "0")
        if unpaid > 0 and age >= timedelta(days=EARNINGS_EXPIRY_DAYS - EARNINGS_WARN_DAYS):
            expiring.append({
                "kind": "six_month_window",
                "unpaid_thb": _decimal_text(unpaid),
                "snapshot_age_days": age.days,
                "balance_since": balance_since,
                "warn_within_days": EARNINGS_WARN_DAYS,
                "assumed_expiry_days": EARNINGS_EXPIRY_DAYS,
            })
        return {
            "ok": True,
            "pending": row[0],
            "validated": row[1],
            "paid": row[2],
            "next_payout": row[3],
            "kyc_status": row[4],
            "expiring": expiring,
            "source": "ext" if row else "cache",
            "as_of": row[5],
            "balance_since": balance_since,
            "expiry_rule": "local_assumption_180_days",
            "expiry_evidence": "unverified",
            "payout_citation": PAYOUT_CITATION,
            "payout_facts": PAYOUT_FACTS,
            "provenance": _PROVENANCE,
        }

    def record_video_level(
        self,
        workspace_id: str,
        *,
        level: int | None = None,
        active_days: int = 0,
        qualifying_clips: int = 0,
        account: Any = None,
        as_of: str | None = None,
    ) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        account = account_id(account)
        if level is not None and (type(level) is not int or not 0 <= level <= 50):
            _fail("invalid_request")
        if type(active_days) is not int or type(qualifying_clips) is not int or active_days < 0 or qualifying_clips < 0:
            _fail("invalid_request")
        stamp = _timestamp(as_of)
        with self.store._connection(write=True) as connection:
            self.store._begin(connection)
            connection.execute(
                """INSERT INTO video_level
                   (workspace_id, account_id, level, active_days, qualifying_clips, source, as_of)
                   VALUES (?, ?, ?, ?, ?, 'ext', ?)
                   ON CONFLICT(workspace_id, account_id) DO UPDATE SET
                     level=excluded.level, active_days=excluded.active_days,
                     qualifying_clips=excluded.qualifying_clips, as_of=excluded.as_of""",
                (workspace_id, account, level, active_days, qualifying_clips, stamp),
            )
            connection.commit()
        return self.get_video_level(workspace_id, account=account or None)

    def get_video_level(self, workspace_id: str, account: Any = None) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        stored_account = account_id(account)
        with self.store._connection() as connection:
            row = connection.execute(
                """SELECT level, active_days, qualifying_clips, as_of FROM video_level
                   WHERE workspace_id=? AND account_id=?""",
                (workspace_id, stored_account),
            ).fetchone()
        level = row[0] if row else None
        active_days = row[1] if row else 0
        clips = row[2] if row else 0
        as_of = row[3] if row else None
        next_rule = None
        for rule in VIDEO_LEVEL_RULES:
            day_gap = rule["active_days"] is not None and active_days < rule["active_days"]
            clip_gap = rule["qualifying_clips"] is not None and clips < rule["qualifying_clips"]
            if day_gap or clip_gap or (level or 0) < rule["level"]:
                next_rule = rule
                break
        return {
            "ok": True,
            "level": level,
            "active_days": active_days,
            "qualifying_clips": clips,
            "next_threshold": next_rule,
            "refresh_day": VIDEO_REFRESH_DAY,
            "refresh_day_evidence": "cited",
            "refresh_day_citation": VIDEO_LEVEL_CITATION,
            "min_clip_seconds": None,
            "min_clip_seconds_evidence": "unverified",
            "rules_are_assumptions": True,
            "quantitative_thresholds": "unverified",
            "levels_observed": [0, 1, 2],
            "source": "ext" if row else "cache",
            "as_of": as_of,
            "provenance": _PROVENANCE,
        }

    def create_video_draft(
        self,
        workspace_id: str,
        file_name: str,
        caption: str,
        hashtags: list[str] | None = None,
        item_ids: list[str] | None = None,
        account: Any = None,
    ) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        account = account_id(account)
        if type(file_name) is not str or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(?:mp4|mov)", file_name):
            _fail("invalid_request")
        if type(caption) is not str or not caption.strip() or len(caption) > 2000:
            _fail("invalid_request")
        tags = []
        for tag in hashtags or []:
            if type(tag) is not str or not re.fullmatch(r"#?[A-Za-z0-9_\u0E00-\u0E7E]{1,50}", tag):
                _fail("invalid_request")
            tags.append(tag if tag.startswith("#") else "#" + tag)
            if len(tags) > 30:
                _fail("invalid_request")
        items = []
        for item in item_ids or []:
            items.append(_item_id(item))
            if len(items) > 10:
                _fail("invalid_request")
        draft_id = _token()
        stamp = _now()
        with self.store._connection(write=True) as connection:
            self.store._begin(connection)
            connection.execute(
                """INSERT INTO video_drafts
                   (draft_id, workspace_id, account_id, file_name, caption, hashtags_json,
                    item_ids_json, status, publish_allowed, confirm_required, source, as_of)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 'draft_prepared', 0, 1, 'ext', ?)""",
                (draft_id, workspace_id, account, file_name, caption.strip(),
                 json.dumps(tags, separators=(",", ":")), json.dumps(items, separators=(",", ":")), stamp),
            )
            connection.commit()
        return {
            "ok": True,
            "draft_id": draft_id,
            "file_name": file_name,
            "caption": caption.strip(),
            "hashtags": tags,
            "item_ids": items,
            "status": "draft_prepared",
            "publish_allowed": False,
            "confirm_required": True,
            "clicks_publish": False,
            "uploaded": False,
            "source": "ext",
            "as_of": stamp,
            "note": "Draft plan only. The file is not uploaded and nothing is published.",
            "provenance": _PROVENANCE,
        }

    def posting_budget(self, workspace_id: str, platform: str, account: Any = None, cap: int | None = None) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        if type(platform) is not str or not re.fullmatch(r"[a-z0-9_]{1,32}", platform):
            _fail("invalid_request")
        stored_account = account_id(account)
        today = datetime.now(timezone.utc).date().isoformat()
        with self.store._connection() as connection:
            count = connection.execute(
                """SELECT COUNT(*) FROM links
                   WHERE workspace_id=? AND account_id=? AND substr(created_at,1,10)=?
                     AND (sub_id_1=? OR channel=?)""",
                (workspace_id, stored_account, today, platform, platform),
            ).fetchone()[0]
            saved = connection.execute(
                "SELECT daily_cap FROM posting_caps WHERE workspace_id=? AND account_id=? AND platform=?",
                (workspace_id, stored_account, platform),
            ).fetchone()
        limit = cap if cap is not None else (saved[0] if saved else DEFAULT_POSTING_CAPS.get(platform, 50))
        if type(limit) is not int or not 1 <= limit <= 10000:
            _fail("invalid_request")
        return {
            "ok": True,
            "platform": platform,
            "account": stored_account or None,
            "today": count,
            "cap": limit,
            "ok_to_post": count < limit,
            "remaining": max(0, limit - count),
            "cap_evidence": "owner_set" if cap is not None or saved else "unverified_local",
            "source": "cache",
            "as_of": _now(),
            "provenance": _PROVENANCE,
        }

    def set_posting_cap(self, workspace_id: str, platform: str, daily_cap: int, account: Any = None) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        stored_account = account_id(account)
        if type(platform) is not str or not re.fullmatch(r"[a-z0-9_]{1,32}", platform):
            _fail("invalid_request")
        if type(daily_cap) is not int or not 1 <= daily_cap <= 10000:
            _fail("invalid_request")
        with self.store._connection(write=True) as connection:
            self.store._begin(connection)
            connection.execute(
                """INSERT INTO posting_caps (workspace_id, account_id, platform, daily_cap)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(workspace_id, account_id, platform) DO UPDATE SET daily_cap=excluded.daily_cap""",
                (workspace_id, stored_account, platform, daily_cap),
            )
            connection.commit()
        return self.posting_budget(workspace_id, platform, account=account)

    def convert_links_in_text(self, workspace_id: str, text: str, channel: str, clip_id: str | None = None, account: Any = None) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        if type(text) is not str or not text or len(text) > 10000 or type(channel) is not str or not channel or len(channel) > 80:
            _fail("invalid_request")
        if clip_id is not None and (type(clip_id) is not str or len(clip_id) > 200):
            _fail("invalid_request")
        account = account_id(account) if account else None
        replacements = []

        def lookup_item(item: str) -> str | None:
            query = """SELECT affiliate_url FROM links
                       WHERE workspace_id=? AND product_id=? AND channel=?"""
            params: list[Any] = [workspace_id, item, channel]
            if clip_id is not None:
                query += " AND clip_id=?"
                params.append(clip_id)
            if account is not None:
                query += " AND account_id=?"
                params.append(account)
            query += " ORDER BY updated_at DESC LIMIT 1"
            with self.store._connection() as connection:
                row = connection.execute(query, params).fetchone()
            return None if row is None else row[0]

        def lookup_short(url: str) -> str | None:
            base = url.split("?")[0]
            with self.store._connection() as connection:
                row = connection.execute(
                    """SELECT affiliate_url FROM links
                       WHERE workspace_id=? AND channel=? AND (affiliate_url=? OR affiliate_url=?)
                       ORDER BY updated_at DESC LIMIT 1""",
                    (workspace_id, channel, url, base),
                ).fetchone()
            return None if row is None else row[0]

        def replace(match: re.Match) -> str:
            original = match.group(0)
            item = None
            product = _PRODUCT_URL_RE.fullmatch(original) or _PRODUCT_URL_RE.match(original)
            affiliate = None
            if product:
                item = product.group(2) or product.group(4)
                affiliate = lookup_item(item)
            elif original.startswith("https://s.shopee.co.th/"):
                affiliate = lookup_short(original.split("?")[0])
            if affiliate and affiliate != original:
                replacements.append({"original_url": original, "affiliate_url": affiliate, "item_id": item, "replaced": True})
                return affiliate
            replacements.append({
                "original_url": original,
                "affiliate_url": None,
                "item_id": item,
                "replaced": False,
                "needs_creation": affiliate is None,
            })
            return original

        converted = _URL_RE.sub(replace, text)
        return {
            "ok": True,
            "channel": channel,
            "clip_id": clip_id,
            "text": converted,
            "conversions": replacements,
            "urls_found": len(replacements),
            "replaced": sum(1 for row in replacements if row["replaced"]),
            "opens_links": False,
            "source": "cache",
            "as_of": _now(),
            "provenance": _PROVENANCE,
        }

    def export_data(
        self,
        workspace_id: str,
        kind: str,
        period_start: str | None = None,
        period_end: str | None = None,
        format: str = "json",
        account: Any = None,
    ) -> dict[str, Any]:
        workspace_id = _workspace_id(workspace_id)
        if kind not in {"links", "reports", "commissions", "missions", "videos", "offers", "earnings"}:
            _fail("invalid_request")
        if format not in {"json", "csv"}:
            _fail("invalid_request")
        if period_start:
            period_start = _date(period_start)
        if period_end:
            period_end = _date(period_end)
        account = account_id(account) if account else None
        rows = self._export_rows(workspace_id, kind, period_start, period_end, account)
        body = None
        if format == "csv":
            body = _to_csv(rows)
        return {
            "ok": True,
            "workspace_id": workspace_id,
            "kind": kind,
            "format": format,
            "period_start": period_start,
            "period_end": period_end,
            "rows": rows if format == "json" else None,
            "body": body,
            "count": len(rows),
            "formula_neutralized": format == "csv",
            "source": "cache",
            "as_of": _now(),
            "provenance": _PROVENANCE,
        }

    def _export_rows(self, workspace_id: str, kind: str, period_start: str | None, period_end: str | None, account: str | None) -> list[dict[str, Any]]:
        with self.store._connection() as connection:
            if kind == "links":
                query = """SELECT channel, product_id, clip_id, sub_id, sub_id_1, sub_id_2, sub_id_3,
                                  sub_id_4, sub_id_5, affiliate_url, link_source, created_at, account_id
                           FROM links WHERE workspace_id=?"""
                params: list[Any] = [workspace_id]
                if account is not None:
                    query += " AND account_id=?"
                    params.append(account)
                query += " ORDER BY created_at DESC LIMIT 5000"
                fetched = connection.execute(query, params).fetchall()
                columns = ["channel", "product_id", "clip_id", "sub_id", "sub_id_1", "sub_id_2", "sub_id_3",
                           "sub_id_4", "sub_id_5", "affiliate_url", "link_source", "created_at", "account"]
                return [dict(zip(columns, row)) for row in fetched]
            if kind == "reports":
                query = """SELECT r.period_start, r.period_end, r.amount_state, rg.channel, rg.content_id,
                                  rg.unmapped, rg.row_count, rg.commission_sum, rg.orders_sum, rg.clicks_sum
                           FROM report_groups rg JOIN reports r ON r.report_id=rg.report_id
                           WHERE r.workspace_id=?"""
                params = [workspace_id]
                if period_start:
                    query += " AND r.period_start>=?"
                    params.append(period_start)
                if period_end:
                    query += " AND r.period_end<=?"
                    params.append(period_end)
                if account is not None:
                    query += " AND r.account_id=?"
                    params.append(account)
                query += " ORDER BY r.period_start LIMIT 5000"
                fetched = connection.execute(query, params).fetchall()
                columns = ["period_start", "period_end", "amount_state", "channel", "content_id",
                           "unmapped", "rows", "commission_thb", "orders", "clicks"]
                return [dict(zip(columns, row)) for row in fetched]
            def account_clause(sql: str, params: list[Any], column: str = "account_id") -> tuple[str, list[Any]]:
                if account is None:
                    return sql, params
                return sql + f" AND {column}=?", [*params, account]

            if kind == "commissions":
                sql, bound = account_clause(
                    """SELECT product_id, last_commission_pct, previous_commission_pct, status, last_check_at, account_id
                       FROM commission_health WHERE workspace_id=?""",
                    [workspace_id],
                )
                fetched = connection.execute(sql + " ORDER BY last_check_at DESC LIMIT 5000", bound).fetchall()
                columns = ["product_id", "commission_pct", "previous_commission_pct", "status", "as_of", "account"]
                return [dict(zip(columns, row)) for row in fetched]
            if kind == "missions":
                sql, bound = account_clause(
                    """SELECT mission_id, name, reward, enrolled, deadline, enrolled_at, completed_at, account_id
                       FROM missions WHERE workspace_id=?""",
                    [workspace_id],
                )
                fetched = connection.execute(sql + " LIMIT 5000", bound).fetchall()
                columns = ["mission_id", "name", "reward", "enrolled", "deadline", "enrolled_at", "completed_at", "account"]
                return [dict(zip(columns, row)) for row in fetched]
            if kind == "videos":
                sql, bound = account_clause(
                    """SELECT video_id, title, status, observed_at, account_id FROM video_clips
                       WHERE workspace_id=?""",
                    [workspace_id],
                )
                fetched = connection.execute(sql + " ORDER BY observed_at DESC LIMIT 5000", bound).fetchall()
                columns = ["video_id", "title", "status", "as_of", "account"]
                return [dict(zip(columns, row)) for row in fetched]
            if kind == "offers":
                sql, bound = account_clause(
                    """SELECT item_id, title, category, price, rate_social, rate_video, extra_comm, stock, as_of, account_id
                       FROM offer_snapshots WHERE workspace_id=?""",
                    [workspace_id],
                )
                fetched = connection.execute(sql + " ORDER BY account_id, item_id, as_of DESC LIMIT 5000", bound).fetchall()
                columns = ["item_id", "title", "category", "price", "rate_social", "rate_video", "extra_comm", "stock", "as_of", "account"]
                return [dict(zip(columns, row)) for row in fetched]
            sql, bound = account_clause(
                """SELECT pending_thb, validated_thb, paid_thb, next_payout, kyc_status, as_of, account_id
                   FROM earnings_snapshots WHERE workspace_id=?""",
                [workspace_id],
            )
            fetched = connection.execute(sql + " ORDER BY as_of DESC LIMIT 500", bound).fetchall()
            columns = ["pending", "validated", "paid", "next_payout", "kyc_status", "as_of", "account"]
            return [dict(zip(columns, row)) for row in fetched]

    def _latest_offer(self, connection, workspace_id: str, item_id: str, account: str | None):
        query = """SELECT snapshot_id, item_id, shop_id, title, category, official, price, rate_social,
                          rate_video, extra_comm, stock, sales, rating, image_urls_json, excluded_category,
                          excluded_reason, source, as_of
                   FROM offer_snapshots WHERE workspace_id=? AND item_id=?"""
        params: list[Any] = [workspace_id, item_id]
        if account is not None:
            query += " AND account_id=?"
            params.append(account)
        query += " ORDER BY as_of DESC, rowid DESC LIMIT 1"
        return connection.execute(query, params).fetchone()

    def _latest_offers(self, connection, workspace_id: str, account: str | None) -> list:
        query = """SELECT snapshot_id, item_id, shop_id, title, category, official, price, rate_social,
                          rate_video, extra_comm, stock, sales, rating, image_urls_json, excluded_category,
                          excluded_reason, source, as_of, account_id
                   FROM offer_snapshots WHERE workspace_id=?"""
        params: list[Any] = [workspace_id]
        if account is not None:
            query += " AND account_id=?"
            params.append(account)
        query += " ORDER BY as_of DESC, rowid DESC"
        rows = connection.execute(query, params).fetchall()
        seen = set()
        latest = []
        for row in rows:
            key = (row[1], row[18])
            if key in seen:
                continue
            seen.add(key)
            latest.append(row[:18])
        return latest


def _offer_row(row) -> dict[str, Any]:
    try:
        images = json.loads(row[13]) if row[13] else []
    except json.JSONDecodeError:
        images = []
    social = row[7]
    video = row[8]
    rate = social if social is not None else video
    return {
        "ok": True,
        "item_id": row[1],
        "shop_id": row[2],
        "title": row[3],
        "category": row[4],
        "price": row[6],
        "commission_rate": rate,
        "extra_comm": row[9],
        "per_channel": {"social": social, "video": video},
        "shop": {"official": bool(row[5])},
        "stock": row[10],
        "sales": row[11],
        "rating": row[12],
        "images": images,
        "excluded_category": bool(row[14]),
        "excluded_match": row[15],
        "commission_eligible": not bool(row[14]),
        "warnings": ["excluded_category"] if row[14] else [],
        "source": row[16],
        "as_of": row[17],
        "provenance": _PROVENANCE,
    }


def _optional_number(value: Any, *, minimum: float, maximum: float) -> float | None:
    if value is None:
        return None
    if type(value) is bool or type(value) not in {int, float} or value != value:
        _fail("invalid_request")
    if not minimum <= float(value) <= maximum:
        _fail("invalid_request")
    return float(value)


def _image_url(value: Any) -> str | None:
    if type(value) is not str or len(value) > 2048:
        return None
    parsed = urlsplit(value)
    host = parsed.hostname or ""
    if parsed.scheme != "https" or parsed.username or parsed.password or not _IMAGE_HOST_RE.fullmatch(host):
        return None
    return value


def _tokens(title: str | None) -> set[str]:
    if not title:
        return set()
    return {token for token in re.split(r"[^\w]+", title.casefold()) if len(token) >= 2}


def _best_rate(social, video):
    values = [value for value in (social, video) if value is not None]
    return max(values) if values else None


def _scope_clips(scope: Any) -> list[str] | None:
    if scope is None or scope == "all":
        return None
    if type(scope) is not list or not scope or len(scope) > 100:
        _fail("invalid_request")
    clips = []
    for clip in scope:
        if type(clip) is not str or not clip or len(clip) > 200:
            _fail("invalid_request")
        clips.append(clip)
    return clips


def _date(value: Any) -> str:
    if type(value) is not str or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        _fail("invalid_request")
    datetime.fromisoformat(value)
    return value


def _timestamp(value: Any) -> str:
    if value is None:
        return _now()
    if type(value) is not str:
        _fail("invalid_request")
    datetime.fromisoformat(value)
    return value


def _token() -> str:
    import secrets
    return secrets.token_hex(16)


def _to_csv(rows: list[dict[str, Any]]) -> str:
    buffer = io.StringIO()
    if not rows:
        return ""
    fieldnames = list(rows[0])
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: _neutralize(row.get(key)) for key in fieldnames})
    return buffer.getvalue()


def _neutralize(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    if text[:1] in {"=", "+", "-", "@", "\t", "\r"}:
        return "'" + text
    return text


def shop_id_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    if not _ITEM_RE.fullmatch(value):
        raise CampaignError("invalid_request")
    return value
