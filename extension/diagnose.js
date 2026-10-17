(() => {
  "use strict";

  function tag(node) {
    return String(node && node.tagName || "").toUpperCase();
  }

  function attr(node, name) {
    if (!node || !node.getAttribute) return "";
    return node.getAttribute(name) || "";
  }

  function walk(root, visit) {
    const children = root && root.children ? [...root.children] : [];
    for (const child of children) {
      visit(child);
      walk(child, visit);
    }
  }

  function rootOf(node) {
    let current = node;
    while (current && current.parentElement) current = current.parentElement;
    return current || node;
  }

  function textOf(node) {
    return window.ShopKudSelectors.clean(node && (node.innerText || node.textContent) || "");
  }

  function accessibleName(node) {
    const aria = window.ShopKudSelectors.clean(attr(node, "aria-label"));
    if (aria) return aria;
    const labelledby = attr(node, "aria-labelledby").split(/\s+/u).filter(Boolean);
    if (labelledby.length) {
      const ids = new Set(labelledby);
      const parts = [];
      walk(rootOf(node), candidate => {
        if (ids.has(attr(candidate, "id"))) {
          const text = textOf(candidate);
          if (text) parts.push(text);
        }
      });
      const joined = window.ShopKudSelectors.clean(parts.join(" "));
      if (joined) return joined;
    }
    if (tag(node) === "INPUT" || tag(node) === "TEXTAREA") return "";
    return textOf(node);
  }

  function linkedText(input) {
    const parts = [
      attr(input, "aria-label"),
      attr(input, "placeholder"),
      attr(input, "name"),
      attr(input, "id")
    ];
    const inputId = attr(input, "id");
    const labelledby = new Set(attr(input, "aria-labelledby").split(/\s+/u).filter(Boolean));
    if (inputId || labelledby.size) {
      walk(rootOf(input), node => {
        if (inputId && tag(node) === "LABEL" && attr(node, "for") === inputId) parts.push(textOf(node));
        if (labelledby.size && labelledby.has(attr(node, "id"))) parts.push(textOf(node));
      });
    }
    let parent = input.parentElement;
    for (let depth = 0; parent && depth < 6 && attr(parent, "role") !== "dialog"; depth += 1) {
      const children = parent.children ? [...parent.children] : [];
      for (const child of children) {
        if (tag(child) === "LABEL") parts.push(textOf(child));
      }
      parent = parent.parentElement;
    }
    return parts.filter(Boolean).join(" ");
  }

  function isTextInput(node) {
    const kind = tag(node);
    if (kind !== "INPUT" && kind !== "TEXTAREA") return false;
    const type = (attr(node, "type") || node.type || "text").toLowerCase();
    return kind === "TEXTAREA" || type === "text" || type === "search" || type === "";
  }

  function pageKind(doc) {
    const href = doc && doc.location && doc.location.href || "";
    try {
      const url = new URL(href);
      if (url.origin !== "https://affiliate.shopee.co.th") return "other";
      if (/^\/offer\/product_offer\/[1-9][0-9]{0,19}\/?$/u.test(url.pathname)) return "detail";
      if (/^\/offer\/product_offer\/?$/u.test(url.pathname)) return "list";
      return "affiliate_other";
    } catch {
      return "unknown";
    }
  }

  function shortLinkCount(doc) {
    let count = 0;
    walk(doc, node => {
      const href = attr(node, "href") || attr(node, "data-affiliate-url");
      if (!href || href.length > 2048) return;
      try {
        const url = new URL(href, "https://affiliate.shopee.co.th");
        if (url.protocol === "https:" && url.hostname === "s.shopee.co.th") count += 1;
      } catch {
        /* Ignore unparsable chrome. The address is not returned. */
      }
    });
    return Math.min(count, 1000);
  }

  function check(id, ids, group, method, count) {
    const unique = [...new Set(ids)];
    return {
      id,
      status: unique.length ? "matched" : "missed",
      count: count === undefined ? unique.length : count,
      method,
      evidence: unique.length ? window.ShopKudSelectors.evidenceFor(group, unique) : "unverified",
      pattern_ids: unique.slice(0, 8)
    };
  }

  function diagnose(doc) {
    const selectors = window.ShopKudSelectors;
    const dialogTitles = [];
    const buttons = [];
    const slots = new Map();
    const headers = [];
    const channels = [];
    const earnings = [];
    const kyc = [];
    const payout = [];
    const creator = [];
    walk(doc, node => {
      if (attr(node, "role") === "dialog") {
        walk(node, child => {
          const kind = tag(child);
          if (kind === "H1" || kind === "H2" || kind === "H3" || kind === "H4" || attr(child, "role") === "heading") {
            dialogTitles.push(...selectors.matchGroup("dialog_title", textOf(child)));
          }
        });
        dialogTitles.push(...selectors.matchGroup("dialog_title", attr(node, "aria-label")));
      }
      if (tag(node) === "BUTTON" || attr(node, "role") === "button") {
        buttons.push(...selectors.matchGroup("create_button", accessibleName(node)));
      }
      if (isTextInput(node) && !node.disabled && !node.readOnly) {
        const slot = selectors.slotFromText(linkedText(node));
        if (slot && !slots.has(slot.slot)) slots.set(slot.slot, slot.pattern_id);
      }
      if (tag(node) === "TH" || attr(node, "role") === "columnheader") {
        headers.push(...selectors.matchGroup("commission_header", textOf(node)));
        channels.push(...selectors.matchGroup("channel_label", textOf(node)));
      }
      const own = textOf(node);
      if (own) {
        channels.push(...selectors.matchGroup("channel_label", own));
        earnings.push(...selectors.matchGroup("earnings_label", own));
        kyc.push(...selectors.matchGroup("kyc_phrase", own));
        payout.push(...selectors.matchGroup("payout_phrase", own));
        creator.push(...selectors.matchGroup("creator_label", own));
      }
    });
    const slotIds = [...slots.values(), ...[...slots.keys()].map(slot => "slot_" + slot)];
    return {
      ok: true,
      opens_links: false,
      clicked: false,
      pii: false,
      page_kind: pageKind(doc),
      short_link_count: shortLinkCount(doc),
      checks: [
        check("dialog_title", [...new Set(dialogTitles)], "dialog_title", "heading_or_aria"),
        check("create_button", [...new Set(buttons)], "create_button", "accessible_name"),
        check("subid_slots", slotIds, "subid_slot", "label_or_aria", slots.size),
        check("commission_headers", [...new Set(headers)], "commission_header", "header_text"),
        check("channel_labels", [...new Set(channels)], "channel_label", "visible_label"),
        check("earnings_labels", [...new Set(earnings)], "earnings_label", "visible_label"),
        check("kyc_verified_phrase", [...new Set(kyc)], "kyc_phrase", "visible_label"),
        check("next_payout_phrase", [...new Set(payout)], "payout_phrase", "visible_label"),
        check("creator_center_labels", [...new Set(creator)], "creator_label", "visible_label")
      ]
    };
  }

  const api = {diagnose};
  if (typeof window !== "undefined") window.ShopKudDiagnose = api;
  if (typeof module !== "undefined") module.exports = api;
})();
