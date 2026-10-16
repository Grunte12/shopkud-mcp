/* Pure parsing and ranking helpers. No page access, storage, or network calls. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ShopeePickerCore = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

  function normalizeDigits(value) {
    return String(value ?? "").replace(/[๐-๙]/g, (digit) => String(THAI_DIGITS.indexOf(digit)));
  }

  function numberFrom(value) {
    const normalized = normalizeDigits(value).replace(/,/g, "").trim();
    if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }

  function parsePriceTHB(text) {
    const normalized = normalizeDigits(text);
    const match = normalized.match(/฿\s*(\d[\d,]*(?:\.\d+)?)(?:\s*(?:-|–|—|ถึง)\s*(?:฿\s*)?(\d[\d,]*(?:\.\d+)?))?/u);
    if (!match) return null;
    const min = numberFrom(match[1]);
    const max = match[2] ? numberFrom(match[2]) : min;
    if (min === null || max === null || max < min) return null;
    return { min, max, isRange: max !== min };
  }

  // Used only with the observed `.ItemCardPrice__wrap .price` value node; its
  // semantic scope keeps discount percentages and unrelated product numbers out.
  function parsePriceValue(text) {
    const normalized = normalizeDigits(text).trim();
    const match = normalized.match(/^(\d[\d,]*(?:\.\d+)?)(?:\s*(?:-|–|—|ถึง)\s*(\d[\d,]*(?:\.\d+)?))?$/u);
    if (!match) return null;
    const min = numberFrom(match[1]);
    const max = match[2] ? numberFrom(match[2]) : min;
    if (min === null || max === null || max < min) return null;
    return { min, max, isRange: max !== min };
  }

  function parseSinglePct(text) {
    const normalized = normalizeDigits(text);
    // Ranges and multiple rates are ambiguous: omit rather than guess.
    if (/(?:-|–|—|ถึง)\s*\d/u.test(normalized)) return null;
    const matches = [...normalized.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/gu)];
    if (matches.length !== 1) return null;
    const pct = Number(matches[0][1]);
    return Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : null;
  }

  function parseCommissionPct(text, trustedCommissionNode = false) {
    const normalized = normalizeDigits(text);
    const label = /(?:อัตราค่าคอมมิ|ค่าคอมมิ|commission\s*(?:rate)?|commission)/iu;
    const found = label.exec(normalized);
    if (!found) return trustedCommissionNode ? parseSinglePct(normalized) : null;
    const rest = normalized.slice(found.index + found[0].length).split(/\r?\n/u, 1)[0];
    return parseSinglePct(rest.replace(/^\s*[:：]?\s*/u, ""));
  }

  function multiplierFor(unit) {
    switch (String(unit || "").toLocaleLowerCase()) {
      case "k": case "พัน": return 1_000;
      case "m": case "ล้าน": return 1_000_000;
      case "หมื่น": return 10_000;
      default: return 1;
    }
  }

  function parseSold(text) {
    const normalized = normalizeDigits(text);
    const labeled = /(?:ขายได้|ขายแล้ว|sold)\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*(k|m|พัน|หมื่น|ล้าน)?\s*\+?/iu.exec(normalized);
    if (!labeled) return null;
    const raw = numberFrom(labeled[1]);
    if (raw === null) return null;
    return Math.round(raw * multiplierFor(labeled[2]));
  }

  function parseProductText(text) {
    const value = String(text ?? "");
    const priceRange = parsePriceTHB(value);
    const commissionPct = parseCommissionPct(value);
    const sold = parseSold(value);
    const name = value.split(/\r?\n/u).map((line) => line.trim()).find((line) =>
      line.length > 2 && !/฿|ขายได้|ขายแล้ว|commission|อัตราค่าคอมมิ|ขายบน|Mall|EXTRA COMM|เอาลิงก์/iu.test(line)
        && !/^\d{1,3}(?:\.\d+)?%$/u.test(line)
    ) || "";
    return {
      name,
      priceMinTHB: priceRange?.min ?? null,
      priceMaxTHB: priceRange?.max ?? null,
      hasPriceRange: priceRange?.isRange ?? false,
      commissionPct,
      sold,
      bahtPerOrder: priceRange && commissionPct !== null
        ? priceRange.min * commissionPct / 100
        : null,
      isMall: /(?:^|\s)Mall(?:\s|$)/imu.test(value),
      isExtraComm: /EXTRA\s+COMM/iu.test(value)
    };
  }

  function canonicalProductUrl(value, expectedOrigin) {
    try {
      const url = new URL(value, expectedOrigin);
      if (url.origin !== expectedOrigin) return null;
      const canonical = `${expectedOrigin}${url.pathname}`;
      return canonical.length <= 300 && /^\/offer\/product_offer\/[^/?#]+$/u.test(url.pathname)
        ? canonical
        : null;
    } catch {
      return null;
    }
  }

  function resolveCheckboxState({ nativeChecked, wrapperChecked, visualChecked }) {
    let siteChecked;
    if (typeof wrapperChecked === "boolean" && typeof visualChecked === "boolean") {
      siteChecked = wrapperChecked === visualChecked ? wrapperChecked : null;
    } else if (typeof wrapperChecked === "boolean") {
      siteChecked = wrapperChecked;
    } else if (typeof visualChecked === "boolean") {
      siteChecked = visualChecked;
    } else {
      siteChecked = Boolean(nativeChecked);
    }
    return {
      siteChecked,
      nativeChecked: Boolean(nativeChecked),
      nativeConsistent: siteChecked !== null && Boolean(nativeChecked) === siteChecked
    };
  }

  function boundedString(value, maxLength, required = true) {
    if (typeof value !== "string" || value.length > maxLength) return false;
    return required ? value.trim().length > 0 : true;
  }

  function boundedCorrelationId(value) {
    return boundedString(value, 200) && !/[\u0000-\u001f\u007f]/u.test(value);
  }

  const NATIVE_ERRORS = new Map([
    ["native_configuration", "Muse native host configuration needs attention."],
    ["native_input", "Muse native host rejected the input before a confirmed request."],
    ["native_transport_unconfirmed", "Muse transport outcome is unknown. Do not submit again until the original request is reconciled."],
    ["native_reply_invalid", "Muse native reply did not pass validation."],
    ["native_state", "Muse native batch state needs operator attention."]
  ]);
  const NATIVE_PHASES = new Set(["pre_send", "transport_unknown", "request_held", "reply_validation", "status_check"]);
  const NATIVE_DETAILS = new Set(["source_rejected", "payload_rejected", "host_not_found", "host_forbidden",
    "host_exited", "host_communication_failed", "host_unknown_failure", "host_reply_invalid", "host_reply_too_large"]);

  function nativeFailure(reply, fallback) {
    if (!plainObject(reply) || reply.ok !== false || !NATIVE_ERRORS.has(reply.error_code)) return fallback;
    const phase = NATIVE_PHASES.has(reply.phase) ? ` / ${reply.phase}` : "";
    const detail = NATIVE_DETAILS.has(reply.detail_code) ? ` / ${reply.detail_code}` : "";
    return `${NATIVE_ERRORS.get(reply.error_code)} [${reply.error_code}${phase}${detail}] No automatic retry.`;
  }

  function extensionChannelError(error) {
    const codes = new Map([
      ["Extension context invalidated.", "extension_context_invalidated"],
      ["Could not establish connection. Receiving end does not exist.", "extension_receiver_missing"],
      ["The message port closed before a response was received.", "extension_channel_closed"],
      ["A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received", "extension_channel_closed"]
    ]);
    return codes.get(error?.message) || "extension_channel_unconfirmed";
  }

  function validateMuseSubmitReply(reply) {
    if (!reply || typeof reply !== "object" || Array.isArray(reply) || reply.ok !== true
        || reply.status !== "pending"
        || !boundedCorrelationId(reply.request_id)
        || !boundedCorrelationId(reply.batch_id)) {
      const knownPreSend = plainObject(reply) && reply.ok === false && reply.phase === "pre_send"
        && ["native_configuration", "native_input", "native_state"].includes(reply.error_code);
      const result = { ok: false, unconfirmed: !knownPreSend,
        error: nativeFailure(reply, "Muse did not return a valid pending request. Outcome unconfirmed; do not submit again before checking the original attempt.") };
      if (plainObject(reply) && reply.ok === false && reply.error_code === "native_transport_unconfirmed"
          && typeof reply.request_id === "string" && /^[0-9a-f]{20,64}$/u.test(reply.request_id)
          && typeof reply.batch_id === "string" && /^[0-9a-f]{32}$/u.test(reply.batch_id)) {
        result.correlation = { request_id: reply.request_id, batch_id: reply.batch_id };
      }
      return result;
    }
    return { ok: true, request_id: reply.request_id, batch_id: reply.batch_id, status: "pending" };
  }

  const PICK_FIELDS = new Set(["product_url", "decision", "reason", "content_angle", "strategy", "risks", "evidence", "confidence"]);
  const EVIDENCE_FIELDS = new Set(["url", "title"]);
  const DECISIONS = new Set(["recommend", "review", "reject"]);

  function plainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function exactKeys(value, allowed) {
    return Object.keys(value).every((key) => allowed.has(key));
  }

  function isHttpsSource(value) {
    if (!boundedString(value, 2048)) return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  function validateMuseReviewReply(reply, { batchId, snapshotRecords, maxPicks }) {
    if (!plainObject(reply) || reply.ok !== true) {
      return { ok: false, error: nativeFailure(reply, "Muse did not return a review. No products were selected.") };
    }
    if (reply.status === "pending") return { ok: true, status: "pending" };
    if (reply.status !== "ready" || !plainObject(reply.review)) {
      return { ok: false, error: "Muse returned an invalid review status." };
    }
    const review = reply.review;
    if (review.batch_id !== batchId || !boundedCorrelationId(batchId)
        || !Array.isArray(snapshotRecords) || snapshotRecords.length > 50
        || !Number.isInteger(maxPicks) || maxPicks < 1 || maxPicks > 50
        || !Array.isArray(review.picks) || review.picks.length > maxPicks) {
      return { ok: false, error: "Muse's response does not match the submitted batch or pick limit." };
    }

    const submitted = new Map();
    for (const record of snapshotRecords || []) {
      if (!plainObject(record) || !boundedString(record.product_url, 300)) {
        return { ok: false, error: "The submitted snapshot is invalid." };
      }
      const canonical = canonicalProductUrl(record.product_url, "https://affiliate.shopee.co.th");
      if (canonical !== record.product_url || submitted.has(canonical)) {
        return { ok: false, error: "The submitted product identities are not unique canonical URLs." };
      }
      submitted.set(canonical, record);
    }

    const seen = new Set();
    const picks = [];
    for (const raw of review.picks) {
      if (!plainObject(raw) || !exactKeys(raw, PICK_FIELDS)
          || !boundedString(raw.product_url, 300)
          || raw.product_url !== canonicalProductUrl(raw.product_url, "https://affiliate.shopee.co.th")
          || !submitted.has(raw.product_url)
          || seen.has(raw.product_url)
          || !DECISIONS.has(raw.decision)
          || !boundedString(raw.reason, 1200)
          || !boundedString(raw.content_angle, 1000, false)
          || !boundedString(raw.strategy, 1000)
          || !Array.isArray(raw.risks) || raw.risks.length > 8
          || !raw.risks.every((risk) => boundedString(risk, 400))
          || !Array.isArray(raw.evidence) || raw.evidence.length > 6
          || !raw.evidence.every((entry) => plainObject(entry) && exactKeys(entry, EVIDENCE_FIELDS)
            && isHttpsSource(entry.url) && boundedString(entry.title, 240))
          || !["low", "medium", "high"].includes(raw.confidence)) {
        return { ok: false, error: "Muse returned an unknown, duplicate, or malformed product pick." };
      }
      seen.add(raw.product_url);
      picks.push({
        product_url: raw.product_url,
        decision: raw.decision,
        reason: raw.reason.trim(),
        content_angle: raw.content_angle.trim(),
        strategy: raw.strategy.trim(),
        risks: raw.risks.map((risk) => risk.trim()),
        evidence: raw.evidence.map((entry) => ({ url: entry.url, title: entry.title.trim() })),
        confidence: raw.confidence
      });
    }
    return { ok: true, status: "ready", review: { batch_id: review.batch_id, picks } };
  }

  function validateReviewApply({ picks, snapshotRecords, currentRecords }) {
    const snapshot = new Map();
    const duplicateSnapshotUrls = new Set();
    for (const record of snapshotRecords || []) {
      if (snapshot.has(record.product_url)) duplicateSnapshotUrls.add(record.product_url);
      else snapshot.set(record.product_url, record);
    }
    const current = new Map();
    const duplicates = new Set();
    for (const record of currentRecords || []) {
      if (current.has(record.product_url)) duplicates.add(record.product_url);
      else current.set(record.product_url, record);
    }
    const targets = [];
    const stale = [];
    const seen = new Set();
    for (const pick of picks || []) {
      if (pick?.decision !== "recommend") continue;
      const url = pick.product_url;
      if (seen.has(url)) {
        stale.push(url);
        continue;
      }
      seen.add(url);
      const before = snapshot.get(url);
      const now = current.get(url);
      if (!before || !now || duplicates.has(url) || duplicateSnapshotUrls.has(url)
          || canonicalProductUrl(url, "https://affiliate.shopee.co.th") !== url
          || before.name !== now.name
          || before.price_min_thb !== now.price_min_thb
          || before.price_max_thb !== now.price_max_thb
          || before.commission_pct !== now.commission_pct) {
        stale.push(url);
      } else targets.push(now);
    }
    return stale.length ? { ok: false, stale_urls: stale, targets: [] } : { ok: true, stale_urls: [], targets };
  }

  function prepareMuseRecords(records, limit = 50) {
    const seen = new Set();
    const unique = [];
    for (const record of records || []) {
      if (!record || typeof record.product_url !== "string"
          || canonicalProductUrl(record.product_url, "https://affiliate.shopee.co.th") !== record.product_url
          || seen.has(record.product_url)) continue;
      seen.add(record.product_url);
      unique.push(record);
    }
    const boundedLimit = Number.isInteger(limit) ? Math.max(0, Math.min(50, limit)) : 50;
    return { records: unique.slice(0, boundedLimit), total: unique.length, omitted: Math.max(0, unique.length - boundedLimit) };
  }

  function uniqueNodes(nodes) {
    const seen = new Set();
    const result = [];
    for (const node of nodes || []) {
      if (!node || seen.has(node)) continue;
      seen.add(node);
      result.push(node);
    }
    return result;
  }

  function rankProducts(products, sortKey = "order") {
    const key = sortKey === "percent" ? "commissionPct"
      : sortKey === "sold" ? "sold"
      : sortKey === "price" ? "priceMinTHB"
      : "bahtPerOrder";
    return [...products].sort((a, b) => {
      const left = a[key] ?? -Infinity;
      const right = b[key] ?? -Infinity;
      return right - left;
    });
  }

  return { normalizeDigits, parsePriceTHB, parsePriceValue, parseCommissionPct, parseSold, parseProductText, canonicalProductUrl, resolveCheckboxState, extensionChannelError, validateMuseSubmitReply, validateMuseReviewReply, validateReviewApply, prepareMuseRecords, uniqueNodes, rankProducts };
});
