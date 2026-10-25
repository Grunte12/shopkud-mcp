(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const api = globalThis.chrome;
  const savedKey = "shopkudSavedProducts";
  const historyKey = "shopkudResearchHistory";
  const linkReceiptsKey = "shopkudLinkReceipts";
  const historyLimit = 20;
  const linkReceiptLimit = 100;
  const state = {runs: [], developer_logs: [], research_reports: [], connected: false, saved: [], history: [], linkReceipts: [], selectedProjectId: null};
  let view = "research";
  let followLogs = true;
  let saving = false;
  let historyReady = false;
  let historyWritable = false;
  let queuedHistory = [];
  const historyQueued = new Map();
  let historyWrites = Promise.resolve();
  let historyStorageWarned = false;
  let current = {dashboard: null, report: null, run: null, query: ""};
  let renderedResearch = "";
  let renderedLogs = "";
  let renderedRuns = "";
  let renderedWorkspace = "";
  const text = value => typeof value === "string" ? value : "";
  const array = value => Array.isArray(value) ? value : [];
  const finite = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const number = value => finite(value) ? value : 0;
  const date = value => {
    if(value === null || value === undefined || value === "") return null;
    const result = new Date(value);
    return Number.isFinite(result.getTime()) ? result : null;
  };
  const timestamp = value => date(value)?.getTime() || 0;
  const clock = value => date(value) ? new Intl.DateTimeFormat("th-TH", {hour:"2-digit", minute:"2-digit"}).format(date(value)) : "ไม่ทราบเวลา";
  const observed = value => date(value) ? new Intl.DateTimeFormat("th-TH", {day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"}).format(date(value)) : "ไม่ทราบเวลาตรวจ";
  const money = value => finite(value) ? new Intl.NumberFormat("th-TH", {style:"currency", currency:"THB", minimumFractionDigits:0, maximumFractionDigits:2}).format(value) : "ไม่ทราบ";
  const count = value => finite(value) ? new Intl.NumberFormat("th-TH", {notation:"compact", maximumFractionDigits:1}).format(value) : "ไม่ทราบ";
  const percent = value => finite(value) ? `${value.toLocaleString("th-TH", {maximumFractionDigits:2})}%` : "ไม่ทราบ";
  const duration = value => !finite(value) ? "—" : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`;
  const normalizeQuery = value => text(value).trim().toLocaleLowerCase("th-TH");
  const stages = {
    queued: ["รอคิวค้น Shopee", "scan"], lane_started: ["เริ่มค้น Shopee", "scan"],
    scan_started: ["กำลังสแกนตลาด Shopee", "scan"], scan_completed: ["สแกน Shopee แล้ว", "scan"],
    candidates_loaded: ["กำลังกรองสินค้า", "scan"], detail_checks_started: ["เริ่มตรวจรายละเอียด", "detail"],
    detail_check: ["กำลังตรวจสินค้ารายตัว", "detail"], ranking: ["กำลังจัดอันดับสินค้า", "recommendation"],
    cache_hit: ["ใช้ผลที่เคยตรวจไว้", "recommendation"], completed: ["ตรวจและจัดอันดับแล้ว", "recommendation"],
    failed: ["งานหยุดเพราะพบปัญหา", "scan"]
  };
  const reportStages = {niche:"กำลังหากลุ่มตลาด", trend:"กำลังอ่านเทรนด์", purchase_intent:"กำลังตรวจความต้องการซื้อ", store_research:"กำลังตรวจบริบทร้าน", recommendation:"กำลังสรุปคำแนะนำ"};
  const goals = {balanced:"สมดุลค่าคอมกับยอดขาย", commission_value:"ค่าคอมต่อออเดอร์", commission_rate:"อัตราค่าคอม", sales_volume:"ยอดขายที่เห็น"};
  const channels = {social:"Social", shopee_live:"Shopee Live", shopee_video:"Shopee Video"};
  const exclusions = {not_mall:"ไม่ใช่ Mall", mall_excluded:"ตัด Mall", sold_below_minimum:"ยอดขายต่ำกว่าเกณฑ์", price_above_maximum:"ราคาเกินงบ", commission_thb_below_minimum:"ค่าคอมต่ำกว่าเกณฑ์", commission_pct_below_minimum:"อัตราคอมต่ำกว่าเกณฑ์", preorder:"พรีออเดอร์", missing_fields:"ข้อมูลไม่ครบ"};

  function node(tag, className, value) {
    const element = document.createElement(tag);
    if(className) element.className = className;
    if(value !== undefined) element.textContent = String(value);
    return element;
  }
  function safeURL(value, kind = "citation") {
    if(typeof value !== "string") return null;
    try {
      const url = new URL(value);
      if(url.protocol !== "https:" || url.username || url.password) return null;
      if(kind === "offer" && (url.origin !== "https://affiliate.shopee.co.th" || url.search || url.hash || !/^\/offer\/product_offer\/[1-9][0-9]{0,19}$/u.test(url.pathname))) return null;
      if(kind === "image" && !/(?:^|\.)(?:susercontent|shopeemobile)\.com$/u.test(url.hostname)) return null;
      return url;
    } catch { return null; }
  }
  function setLink(anchor, value, kind = "offer") {
    const url = safeURL(value, kind);
    if(url) { anchor.href = url.href; anchor.removeAttribute("aria-disabled"); anchor.removeAttribute("tabindex"); }
    else { anchor.removeAttribute("href"); anchor.setAttribute("aria-disabled", "true"); anchor.setAttribute("tabindex", "-1"); }
  }
  function setImage(image, fallback, url, name) {
    const safe = safeURL(url, "image");
    image.hidden = true;
    image.removeAttribute("src");
    fallback.hidden = false;
    image.alt = text(name);
    image.referrerPolicy = "no-referrer";
    image.onload = () => { image.hidden = false; fallback.hidden = true; };
    image.onerror = () => { image.hidden = true; fallback.hidden = false; };
    if(safe) image.src = safe.href;
  }
  function announce(message) {
    $("#notice").textContent = message;
    $("#notice").hidden = !message;
  }
  function validProducts(value) {
    return array(value).filter(product => product && typeof product.product_id === "string" && /^[1-9][0-9]{0,19}$/u.test(product.product_id) && text(product.name)).slice(0,50);
  }
  function validSubIds(value) {
    const values = Array.isArray(value) ? value : value && typeof value === "object" ? [1,2,3,4,5].map(index => value[`sub_id_${index}`]) : [];
    return values.filter(item => typeof item === "string" && item.trim()).slice(0,5).map(item => item.trim().slice(0,100));
  }
  function safeAffiliateURL(value) {
    if(typeof value !== "string" || value.length > 2048 || /[\s\\]/u.test(value)) return null;
    const url = safeURL(value);
    return url && /^https:\/\/s\.shopee\.co\.th\//iu.test(value) && url.hostname === "s.shopee.co.th" && !url.port && !url.search && !url.hash && url.pathname !== "/" ? url : null;
  }
  function validHistory(value) {
    return array(value).filter(item => item && typeof item === "object" && text(item.id) && text(item.query) && item.dashboard?.schema_version === 1 && text(item.dashboard.query) && Array.isArray(item.dashboard.results)).slice(0,historyLimit);
  }
  function validLinkReceipts(value) {
    const records = Array.isArray(value) ? value : Array.isArray(value?.receipts) ? value.receipts : value?.product_id ? [value] : value && typeof value === "object" ? Object.values(value) : [];
    return records.filter(item => item && typeof item === "object" && item.status === "confirmed" && typeof item.product_id === "string" && /^[1-9][0-9]{0,19}$/u.test(item.product_id) &&
      safeAffiliateURL(item.affiliate_url) && date(item.created_at))
      .map(item => ({product_id:item.product_id,affiliate_url:safeAffiliateURL(item.affiliate_url).href,sub_ids:validSubIds(item.sub_ids),created_at:date(item.created_at).toISOString(),status:"confirmed"}))
      .sort((a,b) => timestamp(b.created_at)-timestamp(a.created_at)).slice(0,linkReceiptLimit);
  }
  function workspaceReady() {
    return ["workspace-project-count","workspace-product-count","workspace-link-count","workspace-history-list","workspace-history-empty","workspace-product-grid","workspace-product-empty"].every(id => $(`#${id}`));
  }
  function projectIdentity(item) {
    const trace = text(item?.trace_id).trim();
    if(trace) return `trace:${trace.slice(0,200)}`;
    const query = normalizeQuery(item?.query || item?.dashboard?.query);
    const updated = number(item?.updated_at_unix_ms) || timestamp(item?.dashboard?.observed_at);
    return `fallback:${query}:${updated}`;
  }
  function mergeHistory(history, entry) {
    const identity = projectIdentity(entry), previous = history.find(item => projectIdentity(item) === identity);
    return [{...previous,...entry,saved_at:previous?.saved_at || entry.saved_at},...history.filter(item => projectIdentity(item) !== identity)].slice(0,historyLimit);
  }
  function projectForRun(run) {
    const dashboard = run?.dashboard;
    if(run?.status !== "completed" || dashboard?.schema_version !== 1 || !text(dashboard.query)) return null;
    try {
      const savedDashboard = JSON.parse(JSON.stringify(dashboard));
      savedDashboard.results = validProducts(savedDashboard.results);
      const report = state.research_reports.find(item => normalizeQuery(item.query) === normalizeQuery(dashboard.query));
      let savedReport = null;
      try { if(report) savedReport = JSON.parse(JSON.stringify(report)); } catch {}
      return {id:projectIdentity({trace_id:run.trace_id,query:dashboard.query,updated_at_unix_ms:run.updated_at_unix_ms,dashboard}),trace_id:text(run.trace_id),query:dashboard.query,
        updated_at_unix_ms:number(run.updated_at_unix_ms) || timestamp(dashboard.observed_at),saved_at:new Date().toISOString(),dashboard:savedDashboard,
        report:savedReport && normalizeQuery(savedReport.query) === normalizeQuery(dashboard.query) ? savedReport : null};
    } catch { return null; }
  }
  function recordCompletedProjects() {
    for(const run of [...state.runs].sort((a,b) => number(a.updated_at_unix_ms)-number(b.updated_at_unix_ms))) {
      const entry = projectForRun(run);
      if(!entry) continue;
      const identity = projectIdentity(entry), signature = JSON.stringify([entry.dashboard,entry.report]);
      const existing = state.history.find(item => projectIdentity(item) === identity);
      if(existing && JSON.stringify([existing.dashboard,existing.report]) === signature) continue;
      if(historyQueued.get(identity) === signature) continue;
      historyQueued.set(identity,signature);
      if(!historyReady) queuedHistory.push(entry);
      else persistHistory(entry);
    }
  }
  function persistHistory(entry) {
    const identity = projectIdentity(entry), signature = JSON.stringify([entry.dashboard,entry.report]);
    historyWrites = historyWrites.then(async () => {
      if(!historyWritable) {
        state.history = mergeHistory(state.history,entry);
        if(historyQueued.get(identity) === signature) historyQueued.delete(identity);
        renderWorkspace();
        return;
      }
      const stored = await api.storage.local.get(historyKey);
      const existing = stored?.[historyKey];
      if(existing !== undefined && !Array.isArray(existing)) throw new Error("invalid_history_storage");
      const next = mergeHistory(validHistory(existing),entry);
      await api.storage.local.set({[historyKey]:next});
      state.history = next;
      state.selectedProjectId = entry.id;
      if(historyQueued.get(identity) === signature) historyQueued.delete(identity);
      renderWorkspace();
    }).catch(() => {
      historyWritable = false;
      state.history = mergeHistory(state.history,entry);
      if(historyQueued.get(identity) === signature) historyQueued.delete(identity);
      renderWorkspace();
      if(!historyStorageWarned) { historyStorageWarned = true; announce("ประวัติโครงการเก็บไม่ได้ใน Chrome ตอนนี้ แต่ผลวิจัยปัจจุบันยังใช้งานได้"); }
    });
  }
  async function loadHistory() {
    try {
      if(!api?.storage?.local?.get) throw new Error("storage_unavailable");
      const stored = await api.storage.local.get(historyKey), value = stored?.[historyKey];
      if(value !== undefined && !Array.isArray(value)) throw new Error("invalid_history_storage");
      state.history = validHistory(value);
      historyWritable = true;
    } catch { historyWritable = false; }
    historyReady = true;
    for(const entry of queuedHistory.splice(0)) persistHistory(entry);
    renderWorkspace();
  }
  function linkInfo(product) {
    const receipt = state.linkReceipts.find(item => item.product_id === product.product_id);
    const url = safeAffiliateURL(receipt?.affiliate_url || product.affiliate_url);
    const receiptSubIds = validSubIds(receipt?.sub_ids), subIds = receiptSubIds.length ? receiptSubIds : validSubIds(product.sub_ids);
    return url ? {url,subIds,confirmed:Boolean(receipt)} : null;
  }
  function appendWorkspaceLinks(card, product) {
    const body = card.querySelector(".product-card-body"), links = node("div","workspace-product-links"), seen = new Set();
    for(const [label,value] of [["ดูหน้าสินค้า",product.product_url],["ดูหน้าร้าน",product.store_url || product.shop_url]]) {
      const url = safeURL(value);
      if(!url || seen.has(url.href)) continue;
      seen.add(url.href);
      const anchor = node("a","",label); anchor.href = url.href; anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; links.append(anchor);
    }
    const info = linkInfo(product);
    if(info) {
      const anchor = node("a","workspace-affiliate-link",info.confirmed ? "ลิงก์ Affiliate ที่ยืนยันแล้ว" : "ลิงก์ Affiliate ที่มีอยู่");
      anchor.href = info.url.href; anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; anchor.dataset.affiliateLink = ""; links.append(anchor);
      if(info.subIds.length) links.append(node("p","product-subids",`Sub IDs: ${info.subIds.join(" · ")}`));
    }
    if(links.childElementCount) body.append(links);
  }
  function renderWorkspaceReport(report) {
    const summary = $("#workspace-report-summary") || $(`[data-workspace-report-summary]`);
    const sourceList = $("#workspace-report-citations") || $(`[data-workspace-report-citations]`);
    if(summary) { summary.textContent = text(report?.summary); summary.hidden = !text(report?.summary); }
    if(sourceList) { citations(sourceList,report?.citations); sourceList.hidden = !array(report?.citations).some(source => safeURL(source?.url)); }
  }
  function renderWorkspace() {
    if(!workspaceReady()) return;
    const selected = state.history.find(item => item.id === state.selectedProjectId) || state.history[0] || null;
    if(selected && selected.id !== state.selectedProjectId) state.selectedProjectId = selected.id;
    const fingerprint = JSON.stringify([state.history,state.saved,state.linkReceipts,state.selectedProjectId]);
    if(fingerprint === renderedWorkspace) return;
    renderedWorkspace = fingerprint;
    const list = $("#workspace-history-list"), projectCount = $("#workspace-project-count"), productCount = $("#workspace-product-count"), linkCount = $("#workspace-link-count");
    list.replaceChildren();
    for(const item of state.history) {
      const button = node("button","workspace-history-item"); button.type = "button"; button.dataset.historyId = item.id; button.setAttribute("aria-pressed",String(item.id === state.selectedProjectId));
      button.append(node("strong","",item.query),node("small","",`บันทึก ${observed(item.saved_at)}`));
      button.onclick = () => {
        state.selectedProjectId = item.id; renderWorkspace();
        $("#workspace-history-list [aria-pressed='true']")?.focus();
      };
      list.append(button);
    }
    $("#workspace-history-empty").hidden = state.history.length > 0;
    projectCount.textContent = String(state.history.length);
    const products = validProducts(selected?.dashboard?.results);
    const uniqueLinks = new Set(state.linkReceipts.map(item => `${item.product_id}\u0000${item.affiliate_url}`));
    productCount.textContent = String(state.saved.length); linkCount.textContent = String(uniqueLinks.size);
    $("#workspace-product-empty").hidden = products.length > 0;
    const grid = $("#workspace-product-grid");
    grid.replaceChildren(...products.map((product,index) => {
      const card = productCard(product,index+1,selected.dashboard,false,selected.query);
      appendWorkspaceLinks(card,product);
      return card;
    }));
    renderWorkspaceReport(selected?.report);
    updateSavedButtons();
  }
  function isSaved(id) { return state.saved.some(product => product.product_id === id); }
  function price(product) {
    const min = product.price_min_thb, max = product.price_max_thb;
    return finite(min) && finite(max) && min !== max ? `${money(min)}–${money(max)}` : money(finite(min) ? min : max);
  }
  function reason(product, dashboard, winner = false) {
    const goal = dashboard?.criteria?.ranking_goal;
    if(goal === "commission_value") return winner ? "ค่าคอมต่อออเดอร์สูงสุดในชุดสินค้าที่ตรวจและผ่านเกณฑ์" : `ค่าคอมที่ตรวจพบ ${money(product.commission_thb_per_order)} ต่อออเดอร์`;
    if(goal === "commission_rate") return winner ? "อัตราค่าคอมสูงสุดในชุดสินค้าที่ตรวจและผ่านเกณฑ์" : `อัตราค่าคอมที่ตรวจพบ ${percent(product.commission_pct)}`;
    if(goal === "sales_volume") return winner ? "ยอดขายที่เห็นสูงสุดในชุดสินค้าที่ตรวจและผ่านเกณฑ์" : `ยอดขายที่เห็น ${count(product.sold)} · ไม่ระบุช่วงเวลา`;
    if(goal === "balanced") return winner ? "อันดับหนึ่งตามเกณฑ์สมดุลค่าคอมต่อออเดอร์กับยอดขายที่เห็น" : "ผ่านเกณฑ์คัดกรอง · เปรียบเทียบค่าคอมกับยอดขายที่เห็นก่อนเลือก";
    return "ผ่านเงื่อนไขและการจัดอันดับของงานนี้ · ไม่ใช่คำรับรองยอดขาย";
  }
  function trust(element, product) {
    element.textContent = product.mall === true ? "Shopee Mall" : "ยังไม่มีหลักฐาน Mall";
    element.dataset.known = String(product.mall === true);
  }
  function selection() {
    const completed = state.runs.filter(run => run?.status === "completed" && run.dashboard?.schema_version === 1).sort((a,b) => number(b.updated_at_unix_ms) - number(a.updated_at_unix_ms));
    const latestReport = state.research_reports[0] || null;
    let run = completed[0] || null;
    // Never combine evidence for two different research queries into one recommendation.
    if(latestReport && run && normalizeQuery(latestReport.query) !== normalizeQuery(run.dashboard.query) && number(latestReport.updated_at_unix_ms) > number(run.updated_at_unix_ms)) {
      run = completed.find(item => normalizeQuery(item.dashboard.query) === normalizeQuery(latestReport.query)) || null;
    }
    const query = text(run?.dashboard.query) || text(latestReport?.query);
    const report = state.research_reports.find(item => normalizeQuery(item.query) === normalizeQuery(query)) || null;
    return {run, dashboard:run?.dashboard || null, report, query};
  }
  function renderJourney() {
    const running = state.runs.filter(run => run?.status === "running").sort((a,b) => number(b.updated_at_unix_ms) - number(a.updated_at_unix_ms))[0];
    const workingReport = state.research_reports.find(report => report.status === "working");
    const activeReport = workingReport && (!running || number(workingReport.updated_at_unix_ms) > number(running.updated_at_unix_ms)) ? workingReport : null;
    const latestRun = [...state.runs].sort((a,b) => number(b.updated_at_unix_ms)-number(a.updated_at_unix_ms))[0];
    let failed = false;
    let activeStage = null;
    let description = state.connected ? "พร้อมรับงานจาก Agent" : "ไม่ได้เชื่อมต่อ worker · ผลที่เห็นอาจเป็นข้อมูลก่อนหน้า";
    let updated = "";
    if(activeReport) {
      activeStage = activeReport.stage === "purchase_intent" ? "trend" : activeReport.stage;
      description = `${reportStages[activeReport.stage] || "กำลังวิจัย"} · ${text(activeReport.query)}`;
      updated = `อัปเดต ${clock(activeReport.updated_at_unix_ms)}`;
    } else if(running) {
      const stage = stages[running.stage] || ["Agent กำลังทำงาน", "scan"];
      activeStage = stage[1];
      description = `${stage[0]} · ${text(running.query)}`;
      if(running.stage === "detail_check" && finite(running.candidate_index) && finite(running.candidate_count)) description += ` · ${running.candidate_index}/${running.candidate_count} สินค้า`;
      updated = duration(running.elapsed_ms);
    } else if(latestRun?.status === "failed" && number(latestRun.updated_at_unix_ms) >= number(current.report?.updated_at_unix_ms)) {
      failed = true; activeStage = "scan";
      description = `งานล่าสุดหยุดเพราะพบปัญหา · ${text(latestRun.query)} · ดูรายละเอียดใน Agent Live`;
      updated = `อัปเดต ${clock(latestRun.updated_at_unix_ms)}`;
    } else if(current.dashboard || current.report) {
      description = current.dashboard ? "ผลการคัดสินค้าพร้อมให้ตรวจสอบ" : "งานวิจัยพร้อมแล้ว · รอหลักฐานสินค้า Shopee";
      updated = `อัปเดต ${clock(current.run?.updated_at_unix_ms || current.report?.updated_at_unix_ms)}`;
    }
    $("#journey-status").textContent = description;
    $("#journey-time").textContent = updated;
    $("#active-dot").hidden = !(running || workingReport);
    const observedStages = new Set();
    const report = current.report;
    if(report) {
      const hasSource = signal => array(signal.source_indexes).some(index => Number.isInteger(index) && index >= 0 && safeURL(array(report.citations)[index]?.url));
      if(report.stage === "niche" && report.status === "completed") observedStages.add("niche");
      if(array(report.signals).some(signal => ["trend","purchase_intent"].includes(signal.kind) && hasSource(signal))) observedStages.add("trend");
      if(array(report.signals).some(signal => ["trust","marketing_support"].includes(signal.kind) && hasSource(signal))) observedStages.add("store_research");
      if(report.status === "completed" && report.stage === "recommendation") observedStages.add("recommendation");
    }
    if(current.dashboard) {
      if(number(current.dashboard.scan?.pages_scanned) > 0) observedStages.add("scan");
      if(validProducts(current.dashboard.results).length) { observedStages.add("detail"); observedStages.add("recommendation"); }
    }
    for(const item of $$("#journey li")) {
      const status = activeStage === item.dataset.stage ? failed ? "failed" : "active" : observedStages.has(item.dataset.stage) ? "done" : "pending";
      item.dataset.state = status;
      item.setAttribute("aria-label", `${item.querySelector("strong").textContent}: ${status === "active" ? "กำลังทำ" : status === "failed" ? "พบปัญหา" : status === "done" ? "มีข้อมูลแล้ว" : "ยังไม่มีข้อมูล"}`);
    }
  }
  function citations(container, entries) {
    container.replaceChildren();
    const seen = new Set();
    for(const source of array(entries).slice(0,24)) {
      const url = safeURL(source?.url);
      if(!url || seen.has(url.href)) continue;
      seen.add(url.href);
      const anchor = node("a", "citation");
      anchor.href = url.href; anchor.target = "_blank"; anchor.rel = "noopener noreferrer";
      anchor.append(node("span", "", text(source.title) || url.hostname), node("small", "", url.hostname));
      container.append(anchor);
    }
    if(!seen.size) container.append(node("span", "subtle", "ยังไม่มีลิงก์อ้างอิงที่เปิดได้"));
    return seen.size;
  }
  function signalElement(signal, sources) {
    const article = node("article", "signal");
    const top = node("div", "signal-topline");
    const direction = {up:"เพิ่มขึ้น", flat:"ทรงตัว", down:"ลดลง"}[signal.direction];
    const value = text(signal.value) || "ยังไม่สรุป";
    top.append(node("h4", "", text(signal.label) || "สัญญาณจาก Agent"), node("span", "signal-value", direction ? `${value} · ${direction}` : value));
    article.append(top);
    if(finite(signal.score) && signal.score <= 100) {
      const row = node("div", "signal-score");
      row.setAttribute("role", "img"); row.setAttribute("aria-label", `คะแนนประเมินโดย Agent: ${signal.score} จาก 100 ไม่ใช่ค่าที่ ShopKud วัด`);
      const track = node("div", "score-track"), fill = node("div", "score-fill");
      fill.style.width = `${signal.score}%`; track.append(fill);
      row.append(track, node("strong", "", String(signal.score))); article.append(row);
    }
    article.append(node("p", "", text(signal.rationale) || "ยังไม่มีเหตุผลประกอบ"));
    const cited = array(signal.source_indexes).filter(index => Number.isInteger(index) && index >= 0 && index < array(sources).length).map(index => sources[index]);
    const links = node("div", "citation-list"); citations(links, cited); article.append(links);
    return article;
  }
  function renderMarket() {
    const report = current.report;
    $("#market-empty").hidden = Boolean(report); $("#market-content").hidden = !report;
    if(!report) return;
    $("#report-headline").textContent = text(report.headline) || "Agent กำลังรวบรวมงานวิจัย";
    $("#report-summary").textContent = text(report.summary);
    $("#report-confidence").textContent = `Agent ประเมินความมั่นใจ: ${{low:"ต่ำ", medium:"ปานกลาง", high:"สูง"}[report.confidence] || "ไม่ระบุ"}${report.status === "working" ? " · ยังอยู่ระหว่างวิจัย" : ""}`;
    $("#report-time").textContent = `เผยแพร่ ${observed(report.updated_at_unix_ms)}`;
    $("#intent-block").hidden = !text(report.purchase_intent);
    $("#purchase-intent").textContent = text(report.purchase_intent);
    const signals = array(report.signals).filter(signal => signal && typeof signal === "object").slice(0,12);
    $("#signals").replaceChildren(...signals.slice(0,3).map(signal => signalElement(signal, report.citations)));
    $("#additional-signals").replaceChildren(...signals.slice(3).map(signal => signalElement(signal, report.citations)));
    $("#more-signals").hidden = signals.length <= 3;
    $("#signals-empty").hidden = signals.length > 0;
    citations($("#report-citations"), report.citations);
  }
  function updateSavedButtons() {
    $("#saved-count").textContent = String(state.saved.length);
    for(const button of $$("[data-save-id]")) {
      const saved = isSaved(button.dataset.saveId);
      button.setAttribute("aria-pressed", String(saved));
      button.setAttribute("aria-label", `${saved ? "นำออกจากที่บันทึก" : "เก็บสินค้า"} ${button.dataset.productName || ""}`.trim());
      const label = button.querySelector("span");
      if(label) label.textContent = saved ? "เก็บแล้ว" : "เก็บไว้";
    }
  }
  function saveControl(button, product, query) {
    button.dataset.saveId = product.product_id;
    button.dataset.productName = text(product.name);
    button.onclick = () => toggleSaved(product, query);
  }
  function commissionBreakdown(product, metrics) {
    const rows = array(product.commission_channels);
    if(!rows.length) return;
    const details = node("details","commission-breakdown"), list = node("ul","commission-channel-list");
    const ordered = ["social","shopee_live","shopee_video"].map((key,order) => ({key,order,row:rows.find(item => item?.channel === key)})).filter(item => item.row);
    ordered.sort((a,b) => {
      const av = finite(a.row.commission_thb_per_order) ? a.row.commission_thb_per_order : null;
      const bv = finite(b.row.commission_thb_per_order) ? b.row.commission_thb_per_order : null;
      if(av === null) return bv === null ? a.order-b.order : 1;
      if(bv === null) return -1;
      return bv-av || a.order-b.order;
    });
    const best = ordered.findIndex(item => finite(item.row.commission_thb_per_order) && item.row.commission_thb_per_order > 0);
    ordered.forEach(({key,row},index) => {
      const item = node("li","commission-channel"); item.dataset.channel = key; item.dataset.best = String(index === best);
      const heading = node("div","commission-channel-top"); heading.append(node("strong","commission-channel-name",channels[key]));
      if(index === best) heading.append(node("span","commission-channel-best","คุ้มสุด"));
      const primary = node("div","commission-channel-primary");
      primary.append(node("span","commission-channel-total",`รวม ${percent(row.commission_pct)}`),node("strong","commission-channel-estimate",`ประมาณ ${money(row.commission_thb_per_order)}/ออเดอร์`));
      item.append(heading,primary,node("small","commission-channel-components",`ค่าคอมเพิ่ม ${percent(row.extra_commission_pct)} + Shopee ${percent(row.shopee_commission_pct)}`));
      list.append(item);
    });
    if(!list.childElementCount) return;
    const summary = node("summary","commission-summary"), decision = node("span","commission-summary-decision");
    const bestItem = best >= 0 ? ordered[best] : null;
    decision.append(
      node("span","commission-summary-label",bestItem ? `คุ้มสุด · ${channels[bestItem.key]}` : "ค่าคอมแต่ละช่องทาง"),
      node("small","commission-summary-help",`กดเทียบ ${ordered.length} ช่องทาง`)
    );
    summary.append(decision);
    if(bestItem) summary.append(node("strong","commission-summary-value",`${money(bestItem.row.commission_thb_per_order)}/ออเดอร์`));
    details.append(summary,list);
    metrics.after(details);
  }
  function productCard(product, rank, dashboard, saved = false, projectQuery = null) {
    const card = $("#product-template").content.firstElementChild.cloneNode(true);
    const winner = !saved && product.product_id === dashboard?.winner_product_id;
    card.dataset.productId = product.product_id; card.dataset.winner = String(winner);
    card.querySelector(".product-position").textContent = saved ? `จากโจทย์ ${text(product.saved_query) || "ไม่ระบุ"}` : winner ? "อันดับ 1 · ตัวเลือกแนะนำ" : `อันดับ ${rank}`;
    setImage(card.querySelector("img"), card.querySelector(".image-fallback"), product.image_url, product.name);
    trust(card.querySelector(".trust"), product);
    card.querySelector(".product-name").textContent = product.name;
    card.querySelector(".product-shop").textContent = text(product.shop_name) || "ไม่ทราบชื่อร้าน";
    const metrics = card.querySelector(".product-metrics");
    const metricChannel = {social:"Social",shopee_live:"Live",shopee_video:"Video"}[product.channel || dashboard?.channel] || "ช่องทาง";
    for(const [label,value] of [["ราคา",price(product)],[`คอม ${metricChannel}`,money(product.commission_thb_per_order)],["ยอดขายที่เห็น",count(product.sold)],["อัตราคอม",percent(product.commission_pct)]]) {
      const group = node("div"); group.append(node("dt","",label), node("dd","",value)); metrics.append(group);
    }
    commissionBreakdown(product,metrics);
    card.querySelector(".product-reason").textContent = saved ? "ข้อมูล ณ เวลาที่บันทึก · เปิดสินค้าตรวจราคาและค่าคอมอีกครั้ง" : reason(product,dashboard,winner);
    card.querySelector(".product-observed").textContent = `ตรวจ ${observed(product.observed_at || dashboard?.observed_at)}`;
    setLink(card.querySelector(".product-link"), product.offer_url);
    saveControl(card.querySelector(".card-save"), product, saved ? product.saved_query : projectQuery || current.query);
    return card;
  }
  function renderComparison() {
    const dashboard = current.dashboard;
    const products = validProducts(dashboard?.results).slice(0,10);
    const indexed = products.map((product,index) => ({product, rank:index+1}));
    const sort = $("#comparison-sort").value;
    const value = product => sort === "price" ? product.price_min_thb : sort === "sold" ? product.sold : product.commission_thb_per_order;
    if(sort !== "rank") indexed.sort((a,b) => {
      const av = value(a.product), bv = value(b.product);
      if(!finite(av)) return finite(bv) ? 1 : a.rank-b.rank;
      if(!finite(bv)) return -1;
      return (sort === "price" ? av-bv : bv-av) || a.rank-b.rank;
    });
    const container = $("#comparison-grid"), scroll = container.scrollLeft;
    container.replaceChildren(...indexed.map(({product,rank}) => productCard(product,rank,dashboard)));
    container.scrollLeft = scroll;
    $("#comparison-section").hidden = products.length === 0;
    $("#comparison-caption").textContent = `${products.length} สินค้าที่ผ่านเกณฑ์ · ${goals[dashboard?.criteria?.ranking_goal] || "ตามเกณฑ์งานนี้"} · ยอดขายไม่ระบุช่วงเวลา`;
    updateSavedButtons();
  }
  function renderWinner() {
    const dashboard = current.dashboard;
    const products = validProducts(dashboard?.results).slice(0,10);
    const winner = products.find(product => product.product_id === dashboard?.winner_product_id);
    $("#winner").hidden = !winner;
    $("#product-empty").hidden = Boolean(winner);
    $("#product-empty-title").textContent = dashboard ? "ยังไม่มีตัวเลือกที่แนะนำ" : "พร้อมค้นตัวเลือกให้คุณ";
    $("#product-empty-copy").textContent = dashboard ? "ผลล่าสุดยังไม่ได้ระบุผู้ชนะ ตรวจขอบเขตและเงื่อนไขด้านล่าง แล้วให้ Agent วิจัยต่อโดยไม่ผ่อนเกณฑ์เอง" : "บอก Agent ว่าต้องการสินค้าแบบไหน งบเท่าไร และเน้นค่าคอมหรือยอดขาย ผลที่ตรวจแล้วจะมาอยู่ตรงนี้";
    if(!winner) return;
    setImage($("#winner-image"),$("#winner-fallback"),winner.image_url,winner.name);
    trust($("#winner-trust"),winner);
    $("#winner-name").textContent = winner.name;
    $("#winner-shop").textContent = text(winner.shop_name) || "ไม่ทราบชื่อร้าน";
    $("#winner-reason").textContent = reason(winner,dashboard,true);
    $("#winner-price").textContent = price(winner);
    $("#winner-commission").textContent = money(winner.commission_thb_per_order);
    $("#winner-rate").textContent = `อัตราคอม ${percent(winner.commission_pct)}`;
    $("#winner-sold").textContent = count(winner.sold);
    $("#winner-freshness").textContent = dashboard.cache_hit ? `ใช้ผลเก่า · อายุแคช ${duration(dashboard.cache_age_ms)}` : "อ่านจากหน้า Shopee";
    $("#winner-observed").textContent = `ตรวจ ${observed(winner.observed_at || dashboard.observed_at)}`;
    $("#winner-channel").textContent = `ค่าคอมช่องทาง ${channels[winner.channel || dashboard.channel] || "ไม่ระบุ"}`;
    setLink($("#winner-open"),winner.offer_url);
    saveControl($("#winner-save"),winner,current.query);
  }
  function renderEvidence() {
    const dashboard = current.dashboard, report = current.report;
    const products = validProducts(dashboard?.results);
    const badge = $("#coverage-badge");
    badge.textContent = dashboard ? dashboard.partial_market_coverage ? "ครอบคลุมบางส่วน" : "ครบขอบเขตที่ขอ" : "ยังไม่มีผลตรวจ Shopee";
    const facts = $("#coverage-facts"); facts.replaceChildren();
    const rows = dashboard ? [["หน้าที่สแกน",finite(dashboard.scan?.pages_scanned) ? `${dashboard.scan.pages_scanned} หน้า` : "ไม่ทราบ"],["สินค้าที่พบ",finite(dashboard.scan?.unique_products) ? `${dashboard.scan.unique_products} สินค้า` : "ไม่ทราบ"],["ผ่านเกณฑ์",`${products.length} สินค้า`],["เกณฑ์จัดอันดับ",goals[dashboard.criteria?.ranking_goal] || "ตามโจทย์ Agent"],["ที่มาของผล",dashboard.cache_hit ? "ผลจากแคช" : "อ่านจาก Shopee"],["เวลาตรวจ",observed(dashboard.observed_at)]] : [["สถานะ","รอ Agent เรียก workflow คัดสินค้า"]];
    for(const [label,value] of rows) facts.append(node("dt","",label),node("dd","",value));
    const excluded = $("#exclusions"); excluded.replaceChildren();
    for(const [key,value] of Object.entries(dashboard?.exclusions || {}).slice(0,16)) if(finite(value) && value > 0) excluded.append(node("span","",`${exclusions[key] || key} ${value}`));
    const unknowns = ["ยอดขายที่เห็นไม่ระบุช่วงเวลา จึงไม่ใช่ยอดขายรายเดือนหรืออัตราการเติบโต", "Shopee Mall เป็นสถานะร้านที่พบ ไม่ได้ยืนยันคุณภาพสินค้าหรือบริการทุกด้าน"];
    if(!report) unknowns.unshift("Agent ยังไม่ได้เผยแพร่เทรนด์ ความต้องการซื้อ หรือบริบทร้านสำหรับโจทย์นี้");
    else if(!array(report.citations).some(source => safeURL(source?.url))) unknowns.unshift("รายงาน Agent ยังไม่มีแหล่งอ้างอิงที่เปิดได้ ข้อประเมินนี้ยังตรวจย้อนกลับไม่ได้");
    if(products.some(product => !text(product.shop_name))) unknowns.push("บางสินค้ายังไม่มีชื่อร้านในหลักฐานที่ส่งมา");
    if(products.some(product => ["price_min_thb","commission_thb_per_order","sold"].some(key => !finite(product[key])))) unknowns.push("บางสินค้ามีข้อมูลราคา ค่าคอม หรือยอดขายไม่ครบ ช่องที่ไม่ทราบจะไม่ถูกแทนด้วยศูนย์");
    $("#unknowns").replaceChildren(...unknowns.map(value => node("li","",value)));
    $("#coverage-note").textContent = dashboard?.partial_market_coverage ? "สแกนเฉพาะบางหน้า ไม่ใช่การเปรียบเทียบสินค้าทั้งหมดใน Shopee" : "ข้อมูลอาจเปลี่ยนหลังเวลาที่ตรวจ ควรเปิดหน้าสินค้าตรวจอีกครั้งก่อนตัดสินใจ";
  }
  function renderResearch() {
    current = selection();
    $("#query-heading").textContent = current.query || "มาคัดสินค้าที่ใช่กัน";
    $("#query-caption").textContent = current.query ? "งานวิจัยล่าสุดสำหรับโจทย์นี้ · เทียบมุมมองตลาดกับหลักฐานสินค้า แล้วเลือกด้วยตัวคุณเอง" : "ให้ Agent ค้นตลาด แล้วเลือกจากข้อมูลที่ตรวจสอบได้";
    const fingerprint = JSON.stringify([current.dashboard,current.report]);
    if(fingerprint !== renderedResearch) {
      renderedResearch = fingerprint;
      renderMarket(); renderWinner(); renderComparison(); renderEvidence();
    }
    renderJourney(); updateSavedButtons();
  }
  function renderSaved() {
    $("#saved-empty").hidden = state.saved.length > 0;
    $("#saved-grid").replaceChildren(...state.saved.map((product,index) => {
      const card = productCard(product,index+1,null,true);
      appendWorkspaceLinks(card,product);
      return card;
    }));
    updateSavedButtons();
    renderWorkspace();
  }
  async function toggleSaved(product,query) {
    if(saving) return;
    if(!isSaved(product.product_id) && state.saved.length >= 50) { announce("บันทึกครบ 50 สินค้าแล้ว นำรายการที่ไม่ใช้แล้วออกก่อนเพิ่มสินค้าใหม่"); return; }
    const next = isSaved(product.product_id) ? state.saved.filter(item => item.product_id !== product.product_id) : [{...product,saved_query:text(query),saved_at:new Date().toISOString()},...state.saved];
    saving = true;
    try {
      if(!api?.storage?.local?.set) throw new Error("storage_unavailable");
      await api.storage.local.set({[savedKey]:next});
      state.saved = next; renderSaved();
      announce(isSaved(product.product_id) ? `เก็บ “${product.name}” ไว้ใน Chrome เครื่องนี้แล้ว` : `นำ “${product.name}” ออกจากที่บันทึกแล้ว`);
    } catch { announce("บันทึกไม่สำเร็จ พื้นที่เก็บข้อมูล Chrome ไม่พร้อม ลองอีกครั้ง"); }
    finally { saving = false; }
  }
  function renderLogs() {
    const signature = JSON.stringify(state.developer_logs);
    if(signature === renderedLogs) return;
    renderedLogs = signature;
    const entries = [...state.developer_logs].sort((a,b) => number(a.occurred_at_unix_ms)-number(b.occurred_at_unix_ms));
    const list = $("#log-list"); list.replaceChildren();
    for(const entry of entries) {
      const row = node("li","log-line"); row.dataset.actor = entry.actor === "agent" ? "agent" : "code"; row.dataset.status = text(entry.status);
      const operation = node("div","log-operation"); operation.append(node("strong","",entry.actor === "agent" ? "AGENT" : "CODE"),node("span","",text(entry.operation)));
      row.append(node("time","",clock(entry.occurred_at_unix_ms)),operation,node("pre","log-detail",[text(entry.message),text(entry.detail)].filter(Boolean).join("\n")));
      list.append(row);
    }
    $("#logs-empty").hidden = entries.length > 0;
    $("#log-count").textContent = `${entries.length} รายการ`;
    $("#clear-logs").disabled = !entries.length;
    if(followLogs && view === "live") requestAnimationFrame(() => { $("#log-shell").scrollTop = $("#log-shell").scrollHeight; });
  }
  function renderLive() {
    renderLogs();
    const signature = JSON.stringify(state.runs);
    if(signature === renderedRuns) return;
    renderedRuns = signature;
    const finished = state.runs.filter(run => ["completed","failed"].includes(run.status));
    const ratio = key => finished.length ? `${Math.round(finished.filter(run => run[key] === true).length / finished.length * 100)}%` : "—";
    const latencies = finished.map(run => run.latency_ms?.total ?? run.elapsed_ms).filter(finite).sort((a,b) => a-b);
    const median = latencies.length ? latencies[Math.max(0,Math.ceil(latencies.length/2)-1)] : null;
    const metrics = [["งานที่จบ",String(finished.length)],["สำเร็จ",ratio("success")],["ได้ตัวเลือกแนะนำ",ratio("effective")],["ใช้แคช",ratio("cache_hit")],["เวลามัธยฐาน",duration(median)],["Browser actions",String(finished.reduce((sum,run) => sum + Object.values(run.browser_operations || {}).reduce((total,value) => total+number(value),0),0))]];
    $("#live-metrics").replaceChildren(...metrics.map(([label,value]) => { const group=node("div"); group.append(node("dt","",label),node("dd","",value)); return group; }));
    const list = $("#run-list"); list.replaceChildren();
    for(const run of [...state.runs].sort((a,b) => number(b.updated_at_unix_ms)-number(a.updated_at_unix_ms))) {
      const item = node("li","run"); item.dataset.status = text(run.status);
      const top = node("div","run-top"); top.append(node("strong","",`งาน ${number(run.invocation_number) || 1}`),node("span","run-status",stages[run.stage]?.[0] || "ไม่ทราบสถานะ"));
      item.append(top,node("p","",text(run.query) || "ไม่ระบุโจทย์"),node("small","",`${duration(run.elapsed_ms)} · อัปเดต ${clock(run.updated_at_unix_ms)} · trace ${text(run.trace_id).slice(0,8)}`));
      if(run.status === "failed") item.append(node("small","",text(run.error) || "งานไม่สำเร็จ ตรวจรายละเอียดใน Working log"));
      list.append(item);
    }
    $("#run-count").textContent = String(state.runs.length); $("#runs-empty").hidden = state.runs.length > 0; $("#clear-completed").disabled = finished.length === 0;
  }
  function render(snapshot) {
    if(!snapshot || snapshot.ok !== true) { announce("ยังอ่านสถานะ ShopKud ไม่ได้ ข้อมูลที่แสดงอาจเป็นข้อมูลก่อนหน้า"); return; }
    state.connected = snapshot.connected === true;
    state.runs = array(snapshot.runs).filter(item => item && typeof item === "object");
    state.developer_logs = array(snapshot.developer_logs).filter(item => item && typeof item === "object").slice(-500);
    state.research_reports = array(snapshot.research_reports).filter(item => item && typeof item === "object" && text(item.query)).sort((a,b) => number(b.updated_at_unix_ms)-number(a.updated_at_unix_ms));
    $("#connection").dataset.connected = String(state.connected);
    $("#connection span").textContent = state.connected ? "เชื่อมต่อแล้ว" : "ไม่ได้เชื่อมต่อ";
    $("#version").textContent = `ส่วนขยาย ${text(snapshot.extension_version) || "—"}`;
    renderResearch(); renderLive(); recordCompletedProjects(); renderWorkspace();
  }
  function switchView(next, focus = false) {
    if(!["research","saved","live"].includes(next)) return;
    view = next;
    for(const button of $$(".main-nav button")) { const selected = button.dataset.view === next; button.setAttribute("aria-selected",String(selected)); button.tabIndex = selected ? 0 : -1; }
    for(const panel of $$(".view")) panel.hidden = panel.id !== `view-${next}`;
    if(focus) $(`#tab-${next}`).focus();
    if(next === "live" && followLogs) requestAnimationFrame(() => { $("#log-shell").scrollTop = $("#log-shell").scrollHeight; });
  }
  async function refresh() {
    try {
      if(!api?.runtime?.sendMessage) throw new Error("extension_unavailable");
      render(await api.runtime.sendMessage({type:"shopkud-live-snapshot"}));
    } catch { render({ok:true,connected:false,runs:[],developer_logs:[],research_reports:[]}); announce("ยังเชื่อมต่อ ShopKud ไม่ได้ เปิดหน้านี้จากส่วนขยาย Chrome และตรวจว่า worker ทำงานอยู่"); }
  }
  async function clear(type) {
    try { render(await api.runtime.sendMessage({type})); }
    catch { announce("ล้างรายการไม่สำเร็จ ลองอีกครั้งเมื่อ ShopKud เชื่อมต่อแล้ว"); }
  }
  async function loadSaved() {
    try { state.saved = validProducts((await api?.storage?.local?.get?.(savedKey))?.[savedKey]); }
    catch { announce("อ่านรายการที่บันทึกไม่ได้ ลองเปิด Dashboard ใหม่"); }
    renderSaved();
  }
  async function loadLinkReceipts() {
    try { state.linkReceipts = validLinkReceipts((await api?.storage?.local?.get?.(linkReceiptsKey))?.[linkReceiptsKey]); }
    catch { state.linkReceipts = []; }
    renderWorkspace();
  }
  for(const button of $$(".main-nav button")) {
    button.addEventListener("click",() => switchView(button.dataset.view));
    button.addEventListener("keydown",event => {
      const order = ["research","saved","live"], index = order.indexOf(view);
      const target = event.key === "ArrowRight" ? order[(index+1)%3] : event.key === "ArrowLeft" ? order[(index+2)%3] : event.key === "Home" ? order[0] : event.key === "End" ? order[2] : null;
      if(target) { event.preventDefault(); switchView(target,true); }
    });
  }
  $("#comparison-sort").addEventListener("change",renderComparison);
  $("#clear-completed").addEventListener("click",() => clear("shopkud-live-clear"));
  $("#clear-logs").addEventListener("click",() => clear("shopkud-live-clear-logs"));
  $("#follow-logs").addEventListener("click",() => { followLogs = !followLogs; $("#follow-logs").setAttribute("aria-pressed",String(followLogs)); if(followLogs) $("#log-shell").scrollTop = $("#log-shell").scrollHeight; });
  $("#open-tracker").addEventListener("click",async () => {
    const button = $("#open-tracker"); button.disabled = true;
    try {
      const result = await api?.runtime?.sendMessage?.({type:"shopkud-open-tracker"});
      announce(result?.ok === true ? "เปิดตัวติดตามด้านข้างแล้ว" : "เปิดตัวติดตามอัตโนมัติไม่ได้ ลองเปิด Side Panel จากเมนูส่วนขยาย ShopKud ใน Chrome");
    } catch { announce("Chrome ยังเปิดตัวติดตามให้ไม่ได้ ลองเปิด Side Panel จากเมนูส่วนขยาย ShopKud"); }
    finally { button.disabled = false; }
  });
  api?.runtime?.onMessage?.addListener(message => { if(message?.type === "shopkud-live-update") render(message.snapshot); });
  api?.storage?.onChanged?.addListener((changes,area) => {
    if(area !== "local") return;
    if(changes?.[savedKey]) { state.saved = validProducts(changes[savedKey].newValue); renderSaved(); }
    if(changes?.[historyKey]) {
      const value = changes[historyKey].newValue;
      const priorFirst = state.history[0]?.id || null;
      historyWritable = value === undefined || Array.isArray(value);
      state.history = validHistory(value);
      if(!state.history.some(item => item.id === state.selectedProjectId) || state.selectedProjectId === priorFirst) state.selectedProjectId = state.history[0]?.id || null;
      renderWorkspace();
    }
    if(changes?.[linkReceiptsKey]) { state.linkReceipts = validLinkReceipts(changes[linkReceiptsKey].newValue); renderWorkspace(); }
  });
  render({ok:true,connected:false,runs:[],developer_logs:[],research_reports:[]});
  Promise.all([loadSaved(),loadHistory(),loadLinkReceipts()]).then(refresh);
})();
