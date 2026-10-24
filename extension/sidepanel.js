(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const state = {connected:false,extension_version:"",runs:[],developer_logs:[]};
  let followLogs = true;
  const stages = {
    queued:["รอคิว",4],lane_started:["ได้คิวแล้ว",10],cache_hit:["ใช้ผลจาก cache",92],
    scan_started:["กำลังสแกนตลาด",20],scan_completed:["สแกนตลาดเสร็จ",38],
    candidates_loaded:["กำลังกรองผู้สมัคร",50],detail_checks_started:["เริ่มตรวจค่าคอมจริง",58],
    detail_check:["กำลังตรวจสินค้ารายตัว",68],ranking:["กำลังจัดอันดับ",88],
    completed:["เสร็จแล้ว",100],failed:["หยุดเพราะพบปัญหา",100],
  };
  const number = value => Number.isFinite(value) ? value : 0;
  const percent = (part,total) => total ? `${Math.round(part/total*100)}%` : "—";
  const duration = ms => {
    ms=number(ms);
    if(ms<1000)return `${Math.round(ms)} ms`;
    if(ms<60000)return `${(ms/1000).toFixed(ms<10000?1:0)} s`;
    return `${Math.floor(ms/60000)}m ${Math.round(ms%60000/1000)}s`;
  };
  const time = value => new Intl.DateTimeFormat("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date(value));
  const logTime = value => new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit",fractionalSecondDigits:3,hour12:false}).format(new Date(value));
  const quantile = (values,q) => {
    if(!values.length)return null;
    const sorted=[...values].sort((a,b)=>a-b),index=Math.min(sorted.length-1,Math.ceil(q*sorted.length)-1);
    return sorted[Math.max(0,index)];
  };
  const totalOps = run => Object.values(run.browser_operations||{}).reduce((sum,value)=>sum+number(value),0);
  function stageDetail(run) {
    if(run.stage==="queued")return "รอ browser lane เดียว";
    if(run.stage==="lane_started")return `รอคิว ${duration(run.queue_wait_ms)}`;
    if(run.stage==="cache_hit")return `ไม่เปิดหน้าใหม่ · อายุ ${duration(run.cache_age_ms)}`;
    if(run.stage==="scan_started")return `สูงสุด ${run.max_pages||"—"} หน้า`;
    if(run.stage==="scan_completed")return `${run.pages_scanned||0} หน้า · ${run.unique_products||0} สินค้า`;
    if(run.stage==="candidates_loaded")return `${run.records_loaded||0} รายการ`;
    if(run.stage==="detail_checks_started")return `${run.candidate_count||0} ผู้สมัคร`;
    if(run.stage==="detail_check")return `${run.candidate_index||0}/${run.candidate_count||0} · ${run.product_name||run.product_id||"สินค้า"}`;
    if(run.stage==="ranking")return `ยืนยันได้ ${run.verified_count||0} · พลาด ${run.error_count||0}`;
    if(run.stage==="completed")return run.cache_hit?"คืนผลจาก cache":"ผลใหม่จากหน้า Shopee";
    if(run.stage==="failed")return run.error||"งานไม่สำเร็จ";
    return "";
  }
  function renderConnection() {
    const node=$("#connection");
    node.dataset.state=state.connected?"online":"offline";
    node.lastElementChild.textContent=state.connected?"เชื่อมต่อแล้ว":"ไม่ได้เชื่อมต่อ · เปิด worker";
    $("#version").textContent=`ส่วนขยาย ${state.extension_version||"—"}`;
  }
  function renderNow() {
    const active=state.runs.filter(run=>run.status==="running").sort((a,b)=>b.updated_at_unix_ms-a.updated_at_unix_ms)[0];
    $("#now-empty").hidden=Boolean(active);$("#now-content").hidden=!active;$("#live-badge").hidden=!active;
    if(!active){$("#now-caption").textContent=state.connected?"รอ Agent เรียก playbook":"เปิด ShopKud worker แล้วเปิด Side Panel ใหม่";for(const item of document.querySelectorAll("#journey li"))item.removeAttribute("data-state");return;}
    const label=stages[active.stage]||[active.stage,5];
    $("#now-caption").textContent=`งาน ${active.invocation_number||1} · trace ${active.trace_id.slice(0,6)}`;
    $("#now-query").textContent=active.query;
    $("#now-elapsed").textContent=duration(active.elapsed_ms);
    $("#now-progress").style.width=`${label[1]}%`;
    $("#now-dial").style.setProperty("--progress",label[1]);
    $("#now-dial").setAttribute("aria-label",`ความคืบหน้า ${label[1]} เปอร์เซ็นต์`);
    $("#now-percent").textContent=`${label[1]}%`;
    const order=["queue","scan","detail","rank","done"];
    const current=active.stage==="queued"?0:["lane_started","cache_hit","scan_started","scan_completed","candidates_loaded"].includes(active.stage)?1:["detail_checks_started","detail_check"].includes(active.stage)?2:active.stage==="ranking"?3:4;
    for(const [index,item] of [...document.querySelectorAll("#journey li")].entries())item.dataset.state=index<current?"done":index===current?"active":"pending";
    $("#now-stage").textContent=label[0];
    $("#now-detail").textContent=stageDetail(active);
  }
  function renderMetrics() {
    const complete=state.runs.filter(run=>["completed","failed"].includes(run.status));
    const successful=complete.filter(run=>run.success===true),effective=complete.filter(run=>run.effective===true);
    const cached=complete.filter(run=>run.cache_hit===true),latencies=complete.map(run=>number(run.latency_ms?.total||run.elapsed_ms));
    $("#completed-count").textContent=`${complete.length} งาน`;
    $("#success-rate").textContent=percent(successful.length,complete.length);
    $("#effective-rate").textContent=percent(effective.length,complete.length);
    $("#cache-rate").textContent=percent(cached.length,complete.length);
    const p50=quantile(latencies,.5),p95=quantile(latencies,.95);
    $("#p50").textContent=p50===null?"—":duration(p50);
    $("#p95").textContent=p95===null?"—":duration(p95);
    const pMax=Math.max(1,p95||0);
    $("#p50-bar").style.width=p50===null?"0%":`${Math.max(4,p50/pMax*100)}%`;
    $("#p95-bar").style.width=p95===null?"0%":"100%";
    const gauges=[
      ["#success-gauge",successful.length,complete.length,"อัตราสำเร็จ"],
      ["#effective-gauge",effective.length,complete.length,"อัตราได้ผู้ชนะ"],
      ["#cache-gauge",cached.length,complete.length,"อัตราใช้แคช"],
    ];
    for(const [selector,part,total,label] of gauges){const score=total?Math.round(part/total*100):0,node=$(selector);node.style.setProperty("--score",score);node.setAttribute("aria-label",total?`${label} ${score} เปอร์เซ็นต์`:`${label} ยังไม่มีข้อมูล`);}
    $("#browser-ops").textContent=complete.reduce((sum,run)=>sum+totalOps(run),0).toLocaleString("th-TH");
    $("#token-estimate").textContent=complete.reduce((sum,run)=>sum+number(run.response_tokens_estimate),0).toLocaleString("th-TH");
    const recent=complete.slice().sort((a,b)=>a.updated_at_unix_ms-b.updated_at_unix_ms).slice(-12);
    const points=recent.map(run=>number(run.latency_ms?.total||run.elapsed_ms));
    const max=Math.max(1,...points),min=points.length?Math.min(...points):0;
    const coords=points.map((value,index)=>`${points.length===1?160:index/(points.length-1)*320},${56-(value/max*48)}`);
    $("#latency-line").setAttribute("points",coords.join(" "));
    $("#latency-area").setAttribute("d",coords.length?`M${coords.join(" L")} L${coords.at(-1).split(",")[0]},62 L${coords[0].split(",")[0]},62 Z`:"");
    const dots=$("#latency-points");dots.replaceChildren();
    for(const coord of coords){const [cx,cy]=coord.split(",");const dot=document.createElementNS("http://www.w3.org/2000/svg","circle");dot.setAttribute("class","latency-point");dot.setAttribute("cx",cx);dot.setAttribute("cy",cy);dot.setAttribute("r","2.8");dots.append(dot);}
    $("#latency-range").textContent=points.length?`${duration(min)} – ${duration(max)}`:"ยังไม่มีข้อมูล";
    $(".latency-viz svg").toggleAttribute("hidden",points.length<2);
    $("#latency-single").hidden=points.length!==1;
    $("#clear-completed").disabled=complete.length===0;
  }
  function renderRuns() {
    const list=$("#run-list");list.replaceChildren();
    const runs=[...state.runs].sort((a,b)=>b.updated_at_unix_ms-a.updated_at_unix_ms);
    $("#run-empty").hidden=runs.length>0;
    for(const run of runs) {
      const node=$("#run-template").content.firstElementChild.cloneNode(true);
      node.dataset.status=run.status;
      node.querySelector(".run-agent").textContent=`งาน ${run.invocation_number||1}`;
      node.querySelector(".run-state").textContent=(stages[run.stage]||[run.stage])[0];
      node.querySelector(".run-time").dateTime=new Date(run.updated_at_unix_ms).toISOString();
      node.querySelector(".run-time").textContent=time(run.updated_at_unix_ms);
      node.querySelector(".run-query").textContent=run.query;
      node.querySelector(".run-action").textContent=stageDetail(run);
      const opViz=node.querySelector(".operation-viz"),ops=run.browser_operations||{},scan=number(ops.scan),read=number(ops.scan_read),detail=number(ops.detail),opTotal=scan+read+detail;
      opViz.hidden=opTotal===0;
      opViz.setAttribute("aria-label",`Browser actions: สแกน ${scan}, อ่านผล ${read}, ตรวจรายละเอียด ${detail}`);
      opViz.querySelector('[data-op="scan"]').style.flexGrow=scan;
      opViz.querySelector('[data-op="read"]').style.flexGrow=read;
      opViz.querySelector('[data-op="detail"]').style.flexGrow=detail;
      node.querySelector(".operation-legend").textContent=opTotal?`สแกน ${scan} · อ่าน ${read} · ตรวจจริง ${detail}`:"ยังไม่มี browser action";
      const facts=node.querySelector(".run-facts");
      const items=[
        ["เวลา",duration(run.latency_ms?.total||run.elapsed_ms)],
        ["คิว",duration(run.latency_ms?.queue_wait_ms||run.queue_wait_ms)],
        ["Browser",String(totalOps(run))],
        ["Tokens≈",String(number(run.response_tokens_estimate))],
      ];
      if(["completed","failed"].includes(run.status))items.unshift(["ผล",run.success===true?"สำเร็จ":"ล้มเหลว"],["ผู้ชนะ",run.effective===true?"ได้":"ไม่พบ"]);
      if(run.cache_hit===true)items.splice(2,0,["แหล่ง","cache"]);
      for(const [label,value] of items){const span=document.createElement("span");const strong=document.createElement("strong");strong.textContent=value;span.append(`${label} `,strong);facts.append(span);}
      list.append(node);
    }
  }
  function setFollowLogs(value) {
    followLogs=Boolean(value);
    const button=$("#follow-logs");button.setAttribute("aria-pressed",String(followLogs));button.textContent=followLogs?"ตามสด":"หยุดตาม";
    button.classList.toggle("is-following",followLogs);
    if(followLogs){const shell=$("#console-shell");shell.scrollTop=shell.scrollHeight;}
  }
  function renderDeveloperLogs() {
    const list=$("#developer-log"),shell=$("#console-shell");list.replaceChildren();
    const logs=[...state.developer_logs].sort((a,b)=>a.occurred_at_unix_ms-b.occurred_at_unix_ms);
    $("#developer-log-empty").hidden=logs.length>0;$("#clear-logs").disabled=logs.length===0;
    $("#developer-log-count").textContent=`${logs.length.toLocaleString("en-US")} lines`;
    for(const entry of logs) {
      const node=$("#developer-log-template").content.firstElementChild.cloneNode(true);
      node.dataset.actor=entry.actor;node.dataset.status=entry.status;
      const clock=node.querySelector("time");clock.dateTime=new Date(entry.occurred_at_unix_ms).toISOString();clock.textContent=logTime(entry.occurred_at_unix_ms);
      node.querySelector(".console-actor").textContent=entry.actor==="agent"?"AGENT":"CODE";
      node.querySelector(".console-progress").textContent=`${Math.round(number(entry.progress_pct))}%`;
      node.querySelector(".console-operation").textContent=entry.operation;
      node.querySelector(".console-message").textContent=entry.message;
      const detail=node.querySelector(".console-detail");detail.textContent=entry.detail?` ${entry.detail}`:"";
      node.querySelector(".console-source").textContent=` ${entry.source}`;
      const media=node.querySelector(".console-media");
      for(const [index,url] of (Array.isArray(entry.media)?entry.media:[]).entries()){
        const link=document.createElement("a");link.href=url;link.target="_blank";link.rel="noopener noreferrer";link.title=`ภาพที่ส่งให้ Agent ${index+1}`;
        const image=document.createElement("img");image.src=url;image.alt=`ภาพผลลัพธ์ ${index+1}`;image.loading="lazy";image.referrerPolicy="no-referrer";
        link.append(image);media.append(link);
      }
      list.append(node);
    }
    if(followLogs)requestAnimationFrame(()=>{shell.scrollTop=shell.scrollHeight;});
  }
  function render(snapshot) {
    if(!snapshot || snapshot.ok!==true)return;
    state.connected=snapshot.connected===true;state.extension_version=snapshot.extension_version||"";
    state.runs=Array.isArray(snapshot.runs)?snapshot.runs:[];
    state.developer_logs=Array.isArray(snapshot.developer_logs)?snapshot.developer_logs:[];
    renderConnection();renderNow();renderDeveloperLogs();renderMetrics();renderRuns();
  }
  async function refresh() {
    try {render(await chrome.runtime.sendMessage({type:"shopkud-live-snapshot"}));}
    catch {render({ok:true,connected:false,extension_version:chrome.runtime.getManifest?.().version||"",runs:[]});}
  }
  chrome.runtime.onMessage.addListener(message=>{
    if(message?.type==="shopkud-live-update")render(message.snapshot);
  });
  $("#clear-completed").addEventListener("click",async()=>{
    const button=$("#clear-completed");button.disabled=true;
    try {render(await chrome.runtime.sendMessage({type:"shopkud-live-clear"}));} finally {renderMetrics();}
  });
  $("#follow-logs").addEventListener("click",()=>setFollowLogs(!followLogs));
  $("#console-shell").addEventListener("scroll",event=>{
    const node=event.currentTarget,atBottom=node.scrollHeight-node.scrollTop-node.clientHeight<24;
    if(atBottom!==followLogs)setFollowLogs(atBottom);
  });
  $("#clear-logs").addEventListener("click",async()=>{
    const button=$("#clear-logs");button.disabled=true;
    try {render(await chrome.runtime.sendMessage({type:"shopkud-live-clear-logs"}));} finally {button.disabled=state.developer_logs.length===0;}
  });
  setFollowLogs(true);
  refresh();
})();
