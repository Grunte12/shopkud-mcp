(() => {
  "use strict";

  // Words confirmed on a public help page. Numbered DOM attributes are not.
  const SG_LINK = "https://help.shopee.sg/10/article/191696-Affiliate-Link-Generation";
  const TH_PAYOUT = "https://help.shopee.co.th/portal/10/article/142437";
  const TH_VIDEO = "https://help.shopee.co.th/4/article/147479";

  function rule(id, source, evidence, citation) {
    return {id, source, evidence, citation: citation || null};
  }

  const CATALOG = {
    dialog_title: [
      rule("repo_th_offer_dialog", /^ลิงก์ข้อเสนอสินค้า$/u, "repo_fixture"),
      rule("sg_get_link", /^get\s*link$/iu, "cited", SG_LINK),
      rule("sg_custom_link", /^custom\s*link$/iu, "cited", SG_LINK),
      rule("unverified_th_receive_link", /^รับลิงก์$/u, "unverified"),
      rule("unverified_th_custom_link", /^ลิงก์กำหนดเอง$/u, "unverified")
    ],
    create_button: [
      rule("sg_get_link", /^get\s*link$/iu, "cited", SG_LINK),
      rule("sg_convert", /^convert$/iu, "cited", SG_LINK),
      rule("sg_copy_link", /^copy(?:\s+the)?\s*link$/iu, "cited", SG_LINK),
      rule("repo_th_receive_link", /^(?:รับลิงก์|เอา\s*ลิงก์)$/u, "repo_fixture"),
      rule("unverified_create_link", /^(?:สร้างลิงก์|create\s*link|คัดลอกลิงก์)$/iu, "unverified")
    ],
    subid_slot: [
      rule("sg_sub_id_words", /(?:sub[\s_-]*id|subid)\s*([1-5])\b/iu, "mixed", SG_LINK),
      rule("unverified_th_sub_id_slot", /รหัสย่อย\s*([1-5])\b/u, "unverified")
    ],
    commission_header: [
      rule("repo_channel_type", /^ประเภทช่องทาง$/u, "repo_fixture"),
      rule("repo_shopee_commission", /^ค่าคอมช้อปปี้$/u, "repo_fixture"),
      rule("repo_estimated", /โดยประมาณ/u, "repo_fixture"),
      rule("unverified_en_channel", /^(?:channel(?:\s*type)?|commission channel)$/iu, "unverified"),
      rule("unverified_en_commission", /^(?:shopee\s*commission|estimated commission)$/iu, "unverified")
    ],
    channel_label: [
      rule("repo_social", /^โซเชียลมีเดีย/u, "repo_fixture"),
      rule("repo_live", /^ช้อปปี้ไลฟ์/u, "repo_fixture"),
      rule("repo_video", /^ช้อปปี้วีดีโอ/u, "repo_fixture"),
      rule("unverified_en_social", /^social(?:\s*media)?$/iu, "unverified"),
      rule("unverified_en_live", /^shopee\s*live$/iu, "unverified"),
      rule("unverified_en_video", /^shopee\s*video$/iu, "unverified")
    ],
    earnings_label: [
      rule("unverified_pending", /^(?:รอดำเนินการ|pending)$/iu, "unverified"),
      rule("unverified_validated", /^(?:ตรวจสอบแล้ว|validated)$/iu, "unverified"),
      rule("unverified_paid", /^(?:จ่ายแล้ว|paid)$/iu, "unverified")
    ],
    kyc_phrase: [
      rule("th_kyc_valid", /ยืนยัน\s*\(\s*valid\s*\)/iu, "cited", TH_PAYOUT)
    ],
    payout_phrase: [
      rule("th_next_cycle", /รอบการจ่ายถัดไป/u, "cited", TH_PAYOUT),
      rule("unverified_next_payout", /^(?:วันจ่ายถัดไป|next payout)$/iu, "unverified")
    ],
    creator_label: [
      rule("creator_center", /^creator center$/iu, "mixed", TH_VIDEO),
      rule("video_mission", /^video mission$/iu, "mixed", TH_VIDEO),
      rule("core_data", /^core data$/iu, "mixed", TH_VIDEO),
      rule("audience_distribution", /^audience distribution$/iu, "mixed", TH_VIDEO),
      rule("weekly_report", /^weekly report$/iu, "mixed", TH_VIDEO),
      rule("creator_leaderboard", /^creator leaderboard$/iu, "mixed", TH_VIDEO),
      rule("weekly_inspiration", /^weekly inspiration$/iu, "mixed", TH_VIDEO)
    ]
  };

  function clean(value) {
    const text = String(value || "").replace(/\s+/gu, " ").trim();
    return text.length > 80 ? "" : text;
  }

  function matchGroup(group, value) {
    const text = clean(value);
    if (!text) return [];
    const hits = [];
    for (const item of CATALOG[group] || []) {
      if (item.source.test(text) && !hits.includes(item.id)) hits.push(item.id);
    }
    return hits;
  }

  function evidenceFor(group, ids) {
    const flags = [];
    for (const id of ids) {
      const item = (CATALOG[group] || []).find(row => row.id === id);
      if (item) flags.push(item.evidence);
    }
    if (!flags.length) return "unverified";
    return flags.every(flag => flag === flags[0]) ? flags[0] : "mixed";
  }

  function slotFromText(value) {
    const text = clean(value);
    if (!text) return null;
    for (const item of CATALOG.subid_slot) {
      const match = item.source.exec(text);
      if (match) return {slot: Number(match[1]), pattern_id: item.id, evidence: item.evidence};
    }
    return null;
  }

  const api = {CATALOG, clean, matchGroup, evidenceFor, slotFromText, SG_LINK, TH_PAYOUT, TH_VIDEO};
  if (typeof window !== "undefined") window.ShopKudSelectors = api;
  if (typeof module !== "undefined") module.exports = api;
})();
