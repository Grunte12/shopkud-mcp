(() => {
  "use strict";

  const DEFAULT_SUBID_CONFIG = {
    dialog_selector: '[role="dialog"]',
    dialog_title_text: "ลิงก์ข้อเสนอสินค้า",
    subid_input_selectors: [
      'input[name="subId1"], input[placeholder*="Sub ID 1"]',
      'input[name="subId2"], input[placeholder*="Sub ID 2"]',
      'input[name="subId3"], input[placeholder*="Sub ID 3"]',
      'input[name="subId4"], input[placeholder*="Sub ID 4"]',
      'input[name="subId5"], input[placeholder*="Sub ID 5"]'
    ],
    create_button_text: ["สร้างลิงก์", "Create Link", "รับลิงก์", "Get Link", "Convert", "คัดลอกลิงก์"],
    link_output_selector: "textarea, input",
    max_subid_length: 128
  };

  const TITLE_RE = /^(?:ลิงก์ข้อเสนอสินค้า|get\s*link|custom\s*link|รับลิงก์|ลิงก์กำหนดเอง)$/iu;
  const SLOT_RE = /(?:sub[\s_-]*id|subid|รหัสย่อย)\s*([1-5])\b/iu;
  const memoryAttempts = new Map();
  let config = {...DEFAULT_SUBID_CONFIG};

  function configure(newConfig) {
    config = {...DEFAULT_SUBID_CONFIG, ...newConfig};
  }

  function storageKey(intent) {
    return "shopkud-create-attempt:" + intent;
  }

  async function loadAttempt(intent) {
    if (!intent) return null;
    if (memoryAttempts.has(intent)) return memoryAttempts.get(intent);
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        const stored = await chrome.storage.local.get(storageKey(intent));
        const value = stored[storageKey(intent)];
        if (value) memoryAttempts.set(intent, value);
        return value || null;
      }
    } catch {
      return memoryAttempts.get(intent) || null;
    }
    return null;
  }

  async function saveAttempt(intent, value) {
    if (!intent) return;
    memoryAttempts.set(intent, value);
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({[storageKey(intent)]: value});
      }
    } catch {
      /* The in-memory record still blocks a retry in this page. */
    }
  }

  function fieldBlob(input, dialog) {
    const parts = [
      input.getAttribute && input.getAttribute("aria-label"),
      input.getAttribute && input.getAttribute("placeholder"),
      input.getAttribute && input.getAttribute("name"),
      input.getAttribute && input.getAttribute("id")
    ];
    const id = input.getAttribute && input.getAttribute("id");
    const labelledby = new Set(String((input.getAttribute && input.getAttribute("aria-labelledby")) || "").split(/\s+/u).filter(Boolean));
    if (id || labelledby.size) {
      let root = input;
      while (root && root.parentElement) root = root.parentElement;
      const visit = node => {
        for (const child of node && node.children ? [...node.children] : []) {
          const childId = child.getAttribute && child.getAttribute("id");
          const childTag = (child.tagName || "").toUpperCase();
          if (id && childTag === "LABEL" && child.getAttribute && child.getAttribute("for") === id) parts.push(child.textContent || "");
          if (childId && labelledby.has(childId)) parts.push(child.textContent || "");
          visit(child);
        }
      };
      visit(root);
    }
    let node = input.parentElement;
    while (node && node !== dialog && !(node.getAttribute && node.getAttribute("role") === "dialog")) {
      const children = node.children ? [...node.children] : [];
      for (const child of children) {
        const tag = (child.tagName || "").toUpperCase();
        if (tag === "LABEL" || /ant-form-item-label/u.test(child.className || "")) {
          parts.push(child.textContent || "");
        }
      }
      node = node.parentElement;
    }
    return parts.filter(Boolean).join(" ");
  }

  function isTextInput(input) {
    const tag = (input.tagName || "").toUpperCase();
    if (tag !== "INPUT" && tag !== "TEXTAREA") return false;
    const type = (input.getAttribute && input.getAttribute("type") || input.type || "text").toLowerCase();
    return tag === "TEXTAREA" || type === "text" || type === "search" || type === "";
  }

  function detectDialog(doc) {
    const dialogs = [...doc.querySelectorAll(config.dialog_selector)].filter(dialog => {
      if (!dialog.getClientRects().length) return false;
      const titleNode = dialog.querySelector("h4, h3, h2, .ant-modal-title");
      const title = (titleNode && titleNode.textContent || "").trim();
      return TITLE_RE.test(title) || title === config.dialog_title_text;
    });
    if (dialogs.length === 0) return {ok: false, error: "dialog_not_found", status: "not_attempted"};
    if (dialogs.length > 1) return {ok: false, error: "multiple_dialogs_detected", status: "not_attempted"};
    return {ok: true, dialog: dialogs[0]};
  }

  function detectSubIdInputs(dialog) {
    const inputs = [null, null, null, null, null];
    const nodes = [...dialog.querySelectorAll("input, textarea")].filter(isTextInput);
    for (const input of nodes) {
      if (input.disabled || input.readOnly) continue;
      const blob = fieldBlob(input, dialog);
      const match = SLOT_RE.exec(blob);
      if (!match) continue;
      const index = Number(match[1]) - 1;
      if (!inputs[index]) inputs[index] = input;
    }
    const available = inputs.filter(Boolean).length;
    return {
      ok: true,
      inputs,
      available_count: available,
      detection_method: available > 0 ? "specific_selector" : "none",
      requires_manual_verification: available === 0
    };
  }

  function validateSubIds(subIds) {
    if (!Array.isArray(subIds) || subIds.length > 5) {
      return {ok: false, error: "invalid_subid_array", status: "not_attempted", message: "SubIDs must be an array of at most 5 strings"};
    }
    const errors = [];
    subIds.forEach((value, idx) => {
      if (value !== null && value !== undefined && value !== "") {
        if (typeof value !== "string") errors.push(`SubID ${idx + 1}: must be string`);
        else if (value.length > config.max_subid_length) errors.push(`SubID ${idx + 1}: exceeds max length`);
        else if (/[\r\n\t]/u.test(value)) errors.push(`SubID ${idx + 1}: contains invalid whitespace`);
      }
    });
    if (errors.length > 0) return {ok: false, error: "invalid_subid_values", status: "not_attempted", validation_errors: errors};
    return {ok: true};
  }

  function fillSubIds(dialog, subIds) {
    const validation = validateSubIds(subIds);
    if (!validation.ok) return validation;
    const detection = detectSubIdInputs(dialog);
    if (detection.detection_method !== "specific_selector") {
      return {
        ok: false,
        error: "subid_fields_not_identified",
        status: "not_attempted",
        message: "Requested SubID values need a uniquely numbered field."
      };
    }
    const filled = [];
    const missing = [];
    for (let idx = 0; idx < subIds.length; idx += 1) {
      const value = subIds[idx];
      if (value === null || value === undefined || value === "") continue;
      const input = detection.inputs[idx];
      if (!input) {
        missing.push(idx + 1);
        continue;
      }
      try {
        input.value = "";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        input.value = value;
        input.dispatchEvent(new Event("input", {bubbles: true}));
        input.dispatchEvent(new Event("change", {bubbles: true}));
        if (input.value !== value) {
          return {ok: false, error: "fill_readback_mismatch", status: "not_attempted", slot: idx + 1};
        }
        filled.push({slot: idx + 1});
      } catch {
        return {ok: false, error: "fill_failed", status: "not_attempted", slot: idx + 1};
      }
    }
    if (missing.length) {
      return {
        ok: false,
        error: "subid_field_missing",
        status: "not_attempted",
        missing_slots: missing,
        filled
      };
    }
    return {ok: true, filled, missing_slots: [], detection_method: detection.detection_method};
  }

  function findCreateButton(dialog) {
    const buttons = [...dialog.querySelectorAll("button, [role=button]")].filter(button => {
      if (button.disabled || !button.getClientRects().length) return false;
      const named = (button.getAttribute && button.getAttribute("aria-label")) || button.innerText || button.textContent || "";
      const text = String(named).replace(/\s+/gu, " ").trim();
      return config.create_button_text.some(pattern => new RegExp(`^${pattern}$`, "iu").test(text));
    });
    if (buttons.length === 0) return {ok: false, error: "create_button_not_found", status: "not_attempted"};
    if (buttons.length > 1) return {ok: false, error: "multiple_create_buttons", status: "not_attempted", count: buttons.length};
    return {ok: true, button: buttons[0], button_text: (buttons[0].innerText || buttons[0].textContent || "").trim()};
  }

  async function waitForLinkOutput(dialog, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const outputs = [...dialog.querySelectorAll(config.link_output_selector)].filter(el => {
        return el.value && el.getClientRects().length > 0;
      });
      const urls = outputs.map(el => el.value.trim()).filter(url => /^https:\/\/s\.shopee\.co\.th\/[A-Za-z0-9]+$/u.test(url));
      if (urls.length === 1) return {ok: true, affiliate_url: urls[0]};
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return {ok: false, error: "link_output_timeout", status: "unconfirmed", retry_automatically: false, clicked: true};
  }

  function blockedAttempt(prior) {
    return {
      ok: prior.status === "confirmed",
      error: prior.status === "confirmed" ? undefined : "create_not_replayed",
      status: prior.status,
      affiliate_url: prior.affiliate_url || null,
      product_id: prior.product_id || null,
      clicked: false,
      retry_automatically: false,
      link_receipt: prior.receipt || null
    };
  }

  async function createLinkWithSubIds(doc, subIds, options = {}) {
    const {dry_run = false, expected_product_id = null, page_url = null, intent_key = null} = options;
    if (!expected_product_id) {
      return {ok: false, error: "product_unattested", status: "not_attempted", retry_automatically: false, clicked: false};
    }
    const dialogDetection = detectDialog(doc);
    if (!dialogDetection.ok) return {...dialogDetection, clicked: false};
    const dialog = dialogDetection.dialog;
    const fillResult = fillSubIds(dialog, subIds || []);
    if (!fillResult.ok) return {...fillResult, clicked: false, product_id: expected_product_id};
    if (dry_run) {
      return {ok: true, dry_run: true, status: "not_attempted", would_fill: fillResult, product_id: expected_product_id, clicked: false};
    }
    const prior = await loadAttempt(intent_key);
    if (prior && (prior.status === "unconfirmed" || prior.status === "confirmed")) return blockedAttempt(prior);
    const buttonDetection = findCreateButton(dialog);
    if (!buttonDetection.ok) return {...buttonDetection, clicked: false};
    const clickTime = new Date().toISOString();
    await saveAttempt(intent_key, {status: "unconfirmed", product_id: expected_product_id, at: clickTime});
    try {
      buttonDetection.button.click();
    } catch {
      return {ok: false, error: "click_failed", status: "unconfirmed", retry_automatically: false, clicked: true, product_id: expected_product_id};
    }
    const linkResult = await waitForLinkOutput(dialog, options.output_timeout || 10000);
    if (!linkResult.ok) {
      await saveAttempt(intent_key, {status: "unconfirmed", product_id: expected_product_id, at: clickTime});
      return {...linkResult, product_id: expected_product_id, retry_automatically: false};
    }
    const receipt = {
      affiliate_url: linkResult.affiliate_url,
      product_id: expected_product_id,
      product_attested: true,
      page_url: page_url,
      created_at: clickTime,
      captured_at: new Date().toISOString(),
      status: "confirmed",
      dialog_detection_method: "specific_selector",
      sub_id_slots: fillResult.filled.map(item => item.slot)
    };
    await saveAttempt(intent_key, {
      status: "confirmed",
      product_id: expected_product_id,
      affiliate_url: linkResult.affiliate_url,
      receipt
    });
    const subIdsUsed = {};
    (subIds || []).forEach((value, idx) => {
      if (value) subIdsUsed[`sub_id_${idx + 1}`] = value;
    });
    return {
      ok: true,
      status: "confirmed",
      affiliate_url: linkResult.affiliate_url,
      product_id: expected_product_id,
      product_attested: true,
      sub_ids_used: subIdsUsed,
      link_receipt: receipt,
      link_source: "extension_subid_creation",
      clicked: true,
      retry_automatically: false
    };
  }

  async function createBatchLinks(doc, items, options = {}) {
    const {stop_on_error = true, attested_product_id = null, page_url = null} = options;
    const results = [];
    let stopped = false;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (stopped) {
        results.push({ok: false, item_index: i, product_id: item.product_id, error: "batch_stopped", status: "not_attempted", clicked: false});
        continue;
      }
      if (!attested_product_id || item.product_id !== attested_product_id) {
        results.push({
          ok: false,
          item_index: i,
          product_id: item.product_id,
          attested_product_id: attested_product_id,
          error: "product_not_on_page",
          status: "not_attempted",
          clicked: false
        });
        continue;
      }
      const result = await createLinkWithSubIds(doc, item.sub_ids, {
        dry_run: false,
        expected_product_id: attested_product_id,
        page_url,
        intent_key: item.intent_key || null
      });
      const status = result.status || (result.ok ? "confirmed" : "failed");
      results.push({...result, item_index: i, product_id: attested_product_id, status});
      if (status === "unconfirmed" || (stop_on_error && !result.ok)) stopped = true;
    }
    const completed = results.filter(row => row.status === "confirmed").length;
    const failed = results.filter(row => row.status === "failed" || row.status === "unconfirmed").length;
    const notAttempted = results.filter(row => row.status === "not_attempted").length;
    return {
      ok: completed > 0 && failed === 0 && notAttempted === 0,
      total_items: items.length,
      completed_items: completed,
      failed_items: failed,
      not_attempted_items: notAttempted,
      results,
      retry_automatically: false
    };
  }

  const api = {
    configure,
    detectDialog,
    detectSubIdInputs,
    validateSubIds,
    fillSubIds,
    createLinkWithSubIds,
    createBatchLinks,
    DEFAULT_CONFIG: DEFAULT_SUBID_CONFIG,
    _memoryAttempts: memoryAttempts
  };
  if (typeof window !== "undefined") window.ShopKudSubId = api;
  if (typeof module !== "undefined") module.exports = api;
})();
