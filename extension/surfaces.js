(() => {
  "use strict";
  // Selectors and labels are assumptions until the owner verifies the live UI.
  const DEFAULT_LABELS = {
    pending: ["รอดำเนินการ", "Pending"],
    validated: ["ตรวจสอบแล้ว", "Validated"],
    paid: ["จ่ายแล้ว", "Paid"],
    kyc: ["KYC", "การยืนยันตัวตน"],
    next_payout: ["วันจ่ายถัดไป", "Next payout"],
    level: ["เลเวล", "Level"],
    active_days: ["วันใช้งาน", "Active days"],
    qualifying_clips: ["คลิปผ่านเกณฑ์", "Qualifying clips"],
  };

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function readLabeledAmounts(text, labels) {
    const source = String(text || "");
    const found = {};
    for (const [key, names] of Object.entries(labels || {})) {
      for (const name of names) {
        const pattern = new RegExp(escapeRegExp(name) + "\\s*[:：]?\\s*([0-9,]+(?:\\.[0-9]{1,2})?)", "u");
        const match = source.match(pattern);
        if (match) {
          found[key] = match[1].replace(/,/g, "");
          break;
        }
      }
    }
    return found;
  }

  function readEarnings(text, labels) {
    const found = readLabeledAmounts(text, labels || DEFAULT_LABELS);
    const kycRaw = found.kyc;
    return {
      ok: true,
      pending: found.pending || null,
      validated: found.validated || null,
      paid: found.paid || null,
      next_payout: null,
      kyc_status: kycRaw ? "unknown" : "unknown",
      source: "ext",
      opens_links: false,
      assumptions: ["earnings_labels"],
    };
  }

  function readVideoLevel(text, labels) {
    const found = readLabeledAmounts(text, labels || DEFAULT_LABELS);
    return {
      ok: true,
      level: found.level ? Number(found.level) : null,
      active_days: found.active_days ? Number(found.active_days) : 0,
      qualifying_clips: found.qualifying_clips ? Number(found.qualifying_clips) : 0,
      source: "ext",
      assumptions: ["video_level_labels", "refresh_day_tuesday"],
    };
  }

  function planVideoDraft(doc, plan) {
    const buttons = doc && doc.querySelectorAll ? [...doc.querySelectorAll("button")] : [];
    const publish = buttons.find(button => /publish|เผยแพร่/iu.test(button.textContent || button.innerText || ""));
    return {
      ok: true,
      file_name: plan && plan.file_name,
      would_fill: ["caption", "hashtags", "cart"],
      publish_control_present: Boolean(publish),
      clicked_publish: false,
      publish_allowed: false,
      status: "draft_only",
      source: "ext",
    };
  }

  function planCartSwap(doc) {
    const buttons = doc && doc.querySelectorAll ? [...doc.querySelectorAll("button")] : [];
    const save = buttons.find(button => /save|บันทึก|ยืนยัน/iu.test(button.textContent || button.innerText || ""));
    return {
      ok: true,
      confirm_required: true,
      clicked_save: false,
      save_control_present: Boolean(save),
      submitted_to_shopee: false,
      source: "ext",
    };
  }

  const api = {DEFAULT_LABELS, readLabeledAmounts, readEarnings, readVideoLevel, planVideoDraft, planCartSwap};
  if (typeof window !== "undefined") window.ShopKudSurfaces = api;
  if (typeof module !== "undefined") module.exports = api;
})();
