(() => {
  "use strict";

  function canonicalAffiliate(value) {
    if (typeof value !== "string" || value.length > 2048) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== "s.shopee.co.th" || url.username || url.password || url.port) return null;
      if (!/^\/[A-Za-z0-9]+$/u.test(url.pathname)) return null;
      return `https://s.shopee.co.th${url.pathname}`;
    } catch {
      return null;
    }
  }

  function parseShortLink(url) {
    const canonical = canonicalAffiliate(url);
    if (!canonical) return {ok: false, error: "not_shopee_short_link"};
    const code = canonical.slice("https://s.shopee.co.th/".length);
    return {
      ok: true,
      short_code: code,
      base_url: canonical,
      has_params: typeof url === "string" && url.includes("?")
    };
  }

  function pageText(doc) {
    const nodes = doc.querySelectorAll ? [...doc.querySelectorAll("h1,h2,h3,h4,[role=heading]")] : [];
    return nodes.map(node => (node.textContent || "").replace(/\s+/gu, " ").trim()).filter(text => text && text.length <= 80).join("\n");
  }

  function ownershipSurface(doc) {
    const path = doc.location && doc.location.pathname || "";
    const heading = pageText(doc);
    const recognized = /(?:^|\/)(?:my-links?|custom-link|conversion-report)(?:\/|$)/iu.test(path)
      || /custom\s*link|my\s*links|conversion\s*report|ลิงก์ของฉัน|ลิงก์กำหนดเอง|รายงานการแปลง/iu.test(heading);
    const controls = doc.querySelectorAll ? [...doc.querySelectorAll("a,button,[aria-label]")] : [];
    const paginated = controls.some(node => /^(?:next|ถัดไป|>|›)$/iu.test((node.innerText || node.textContent || node.getAttribute?.("aria-label") || "").trim())
      && node.getAttribute?.("aria-disabled") !== "true" && !node.disabled);
    if (!recognized) return {kind: "unsupported", paginated: false};
    return {kind: paginated ? "paginated" : "recognized_complete", paginated};
  }

  function elementUrl(element) {
    const raw = (element.getAttribute && (element.getAttribute("href") || element.getAttribute("data-affiliate-url")))
      || (typeof element.value === "string" && element.value.startsWith("https://") ? element.value : "");
    return canonicalAffiliate(raw);
  }

  function inOwnershipRow(element) {
    let node = element;
    while (node) {
      const tag = (node.tagName || "").toUpperCase();
      if (tag === "TR" || (node.getAttribute && (node.getAttribute("role") === "row" || node.getAttribute("data-link-row") === "true"))) return true;
      node = node.parentElement;
    }
    return false;
  }

  function verifyOwnershipFromMyLinks(doc, affiliateUrl) {
    const expected = canonicalAffiliate(affiliateUrl);
    if (!expected) return {ok: false, error: "not_shopee_short_link"};
    const surface = ownershipSurface(doc);
    if (surface.kind === "unsupported") {
      return {ok: true, ownership_verified: "unknown", method: "none", evidence: "unsupported_page"};
    }
    const nodes = [...doc.querySelectorAll("a, input, textarea, [data-affiliate-url]")];
    const exact = nodes.filter(node => elementUrl(node) === expected && inOwnershipRow(node));
    if (exact.length === 1) {
      return {ok: true, ownership_verified: true, method: "exact_row", evidence: "exact_url_in_ownership_row"};
    }
    if (exact.length > 1) {
      return {ok: true, ownership_verified: "unknown", method: "exact_row", evidence: "ambiguous_exact_rows"};
    }
    if (surface.paginated) {
      return {ok: true, ownership_verified: "unknown", method: "exact_row", evidence: "paginated_list_incomplete"};
    }
    return {ok: true, ownership_verified: false, method: "exact_row", evidence: "exact_url_absent"};
  }

  function verifyTargetFromReceipt(receipt, expectedProductId) {
    if (!receipt || typeof receipt !== "object") return {ok: false, error: "invalid_receipt"};
    const attested = receipt.product_attested === true && receipt.status === "confirmed" && typeof receipt.product_id === "string";
    if (!attested) {
      return {ok: true, target_verified: "unknown", method: "receipt", evidence: "receipt_not_attested"};
    }
    if (!expectedProductId) {
      return {
        ok: true,
        target_verified: "unknown",
        method: "receipt",
        resolved_item_id: receipt.product_id,
        evidence: "expected_product_missing"
      };
    }
    const matches = receipt.product_id === expectedProductId;
    return {
      ok: true,
      target_verified: matches,
      method: "receipt",
      resolved_item_id: receipt.product_id,
      evidence: matches ? "attested_product_match" : "attested_product_mismatch"
    };
  }

  function verifyFromDashboard() {
    return {ok: true, ownership_verified: "unknown", method: "dashboard_search", evidence: "dashboard_is_not_ownership_proof"};
  }

  async function verifyLink(doc, affiliateUrl, options = {}) {
    const {
      expected_product_id = null,
      link_receipt = null,
      check_ownership = true,
      check_target = true,
      try_my_links = true
    } = options;
    const linkParse = parseShortLink(affiliateUrl);
    if (!linkParse.ok) return {...linkParse, affiliate_url: affiliateUrl, opens_links: false};
    const result = {
      ok: true,
      affiliate_url: linkParse.base_url,
      verified_at: new Date().toISOString(),
      target_verified: "unknown",
      ownership_verified: "unknown",
      opens_links: false,
      warnings: []
    };
    if (check_target) {
      if (link_receipt) {
        const receiptVerify = verifyTargetFromReceipt(link_receipt, expected_product_id);
        if (receiptVerify.ok) {
          result.target_verified = receiptVerify.target_verified;
          result.resolved_item_id = receiptVerify.resolved_item_id || null;
          result.target_verification_evidence = receiptVerify.evidence;
        }
      } else {
        result.target_verification_evidence = "no_receipt_provided";
      }
    }
    if (check_ownership) {
      const ownership = try_my_links ? verifyOwnershipFromMyLinks(doc, affiliateUrl) : verifyFromDashboard();
      if (ownership.ok) {
        result.ownership_verified = ownership.ownership_verified;
        result.ownership_verification_evidence = ownership.evidence;
      }
    }
    return result;
  }

  const api = {
    parseShortLink,
    canonicalAffiliate,
    verifyLink,
    verifyOwnershipFromMyLinks,
    verifyTargetFromReceipt,
    verifyFromDashboard
  };
  if (typeof window !== "undefined") window.ShopKudVerify = api;
  if (typeof module !== "undefined") module.exports = api;
})();
