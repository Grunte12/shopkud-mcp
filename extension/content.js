(() => {
  "use strict";
  if(window.__shopkudLoaded || location.origin!=="https://affiliate.shopee.co.th") return;
  window.__shopkudLoaded=true;
  const Core=window.ShopeePickerCore;
  const ReviewData=window.ShopKudReviewData;
  const Detail=window.ShopKudDetail;
  const nonce=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,"0")).join("");
  let PAGE_NONCE=nonce();
  let active=false;
  let activeUrl=null;
  const isOfferPage=()=>/^\/offer\/product_offer\/?$/u.test(location.pathname);
  const SELECT={anchor:'a[target="_blank"][href^="/offer/product_offer/"]',card:".AffiliateItemCard",input:'.AffiliateItemCard__gelinkSection label.ant-checkbox-wrapper > span.ant-checkbox > input.ant-checkbox-input[type=checkbox]'};
  const snapshots=new Map();
  const plans=new Map();
  const owned=new Map();
  const TTL=10*60*1000;
  let busy=false;
  let activeCommand=null;
  const host=document.createElement("div"); host.id="shopkud-panel";
  const root=host.attachShadow({mode:"open"});
  let reviewedPlanId=null;
  const UI=window.ShopKudReview.create({root,onApply:applyReviewedPlan,onKeep:keepReviewedSubset,onExport:exportReviewedPlan});
  const {status,reconnect}=UI;
  reconnect.onclick=event=>{
    if(!event.isTrusted)return;
    if(activeCommand){status.textContent="กำลังทำงานอยู่ ยังเชื่อมต่อใหม่ไม่ได้ และจะไม่ทำคำสั่งซ้ำ";return;}
    if(active && Detail.route(location.href))registerPage();
  };

  function checkbox(product) {
    const input=product.card.querySelector(SELECT.input);
    if(!input)return {input:null,siteChecked:null};
    const wrapper=input.closest("label");const visual=wrapper?.querySelector("span.ant-checkbox");
    return {input,...Core.resolveCheckboxState({nativeChecked:input.checked,wrapperChecked:wrapper?.classList.contains("ant-checkbox-wrapper-checked"),visualChecked:visual?.classList.contains("ant-checkbox-checked")})};
  }
  function hasExtraCommission(container) {
    if(/EXTRA\s+COMM/iu.test(container.textContent || ""))return true;
    return [...container.querySelectorAll("img.ItemCard__label")].some(image=>{
      try {
        const asset=new URL(image.getAttribute("src"),location.origin);
        return asset.origin==="https://deo.shopeemobile.com"
          && /^\/shopee\/shopee-affiliate-live-th\/static\/img\/label_xtra_inner_th\.[a-z0-9]+\.svg$/u.test(asset.pathname);
      } catch {return false;}
    });
  }
  function product(card) {
    const anchor=card.querySelector(SELECT.anchor);
    const url=anchor && Core.canonicalProductUrl(anchor.getAttribute("href"),location.origin);
    const container=card.querySelector(".ItemCard__container") || card;
    const name=container.querySelector(".ItemCard__name")?.textContent?.trim();
    const range=Core.parsePriceValue(container.querySelector(".ItemCard__price .ItemCardPrice__wrap .price")?.textContent || "");
    const comm=Core.parseCommissionPct(container.querySelector(".ItemCard__custom .commRate")?.textContent || "",true);
    if(!url || !name || name.length>240 || !range || comm===null || !card.querySelector(SELECT.input))return null;
    const product_id=new URL(url).pathname.split("/").at(-1);
    if(!product_id || product_id.length>200)return null;
    return {card,record:{product_id,name,product_url:url,price_min_thb:range.min,price_max_thb:range.max,commission_pct:comm,
      baht_per_order:range.min*comm/100,sold:Core.parseSold(container.querySelector(".ItemCardSold__wrap > span")?.textContent || ""),
      mall:Boolean(container.querySelector(".ItemCardFlag--mall--th")),extra_comm:hasExtraCommission(container)}};
  }
  function current() {
    const cards=Core.uniqueNodes([...document.querySelectorAll(SELECT.anchor)].map(a=>a.closest(SELECT.card)).filter(Boolean));
    return {total:cards.length,products:cards.slice(0,500).map(product).filter(Boolean)};
  }
  const Pager=window.ShopKudPagination.create({
    records:()=>current().products.map(p=>p.record),
    selectionStates:()=>[...document.querySelectorAll(SELECT.card)].map(card=>checkbox({card}).siteChecked),
    isOffer:isOfferPage,active:()=>active,isOwnUI:event=>event.composedPath().includes(host),
    invalidatePlans:()=>{snapshots.clear();for(const plan of plans.values())if(!plan.used)plan.invalidated="page_context_changed";UI.invalidate("หน้าหรือตัวกรองเปลี่ยนไปแล้ว ให้เอเจนต์อ่านข้อมูลล่าสุดและเตรียมแผนใหม่");}
  });
  const fingerprint=record=>JSON.stringify(record);
  function prune(map) {
    for(const [key,value] of map) if(Date.now()-value.created>TTL)map.delete(key);
    while(map.size>=64)map.delete(map.keys().next().value);
  }
  function fail(error,outcome="not_applied") {return {ok:false,error,outcome};}
  function fetchSnapshot(id) {
    const value=snapshots.get(id);
    return value && Date.now()-value.created<=TTL ? value : null;
  }
  function validateRecords(records) {
    const live=current().products;
    for(const record of records) {
      const matches=live.filter(p=>p.record.product_id===record.product_id);
      if(matches.length!==1 || fingerprint(matches[0].record)!==fingerprint(record))return false;
    }
    return true;
  }
  function validPick(pick) {
    const keys=["product_id","reason","content_angle","risks","confidence","evidence"];
    const text=(value,max)=>typeof value==="string" && value.trim().length>0 && value.length<=max;
    return pick && typeof pick==="object" && !Array.isArray(pick) && Object.keys(pick).length===keys.length && Object.keys(pick).every(k=>keys.includes(k))
      && text(pick.product_id,200) && text(pick.reason,2000) && text(pick.content_angle,2000)
      && ["low","medium","high"].includes(pick.confidence) && Array.isArray(pick.risks) && pick.risks.length<=8 && pick.risks.every(x=>text(x,500))
      && Array.isArray(pick.evidence) && pick.evidence.length>=1 && pick.evidence.length<=3 && pick.evidence.every(e=>{
        if(!e || Object.keys(e).length!==2 || !text(e.title,240) || !text(e.url,2048))return false;
        try{const u=new URL(e.url);return u.protocol==="https:" && u.hostname && !u.username && !u.password;}catch{return false;}
      });
  }
  async function settle(p,expected,command) {
    let stable=0;
    for(let i=0;i<23;i++) {
      if(command.cancelled || !active || !isOfferPage())return false;
      // React can replace/recycle a card during a click. Never verify a detached
      // stale node or attribute the result to a different product/price.
      const matches=current().products.filter(live=>live.record.product_id===p.record.product_id);
      if(matches.length!==1 || !matches[0].card.isConnected || fingerprint(matches[0].record)!==fingerprint(p.record))return false;
      const state=checkbox(matches[0]);
      if(state.siteChecked===expected) {
        stable++;
        if(state.nativeConsistent || stable>=3)return true;
      } else stable=0;
      await new Promise(resolve=>setTimeout(resolve,40));
    }
    return false;
  }
  async function execute(operation,args,command) {
    if(!active || Detail.route(location.href)?.url!==activeUrl)return fail("page_changed");
    if(!args || typeof args!=="object" || Array.isArray(args))return fail("invalid_input");
    if(busy)return fail("page_busy");
    if(operation==="detail") {
      if(Object.keys(args).some(k=>!["wait_ready","open_link_dialog","expected_product_id"].includes(k)) || args.wait_ready!==undefined && args.wait_ready!==true || args.open_link_dialog!==undefined && args.open_link_dialog!==true || args.open_link_dialog && args.expected_product_id!==Detail.route(location.href)?.product_id || !args.open_link_dialog && args.expected_product_id!==undefined)return fail("invalid_input");
      const read=()=>Detail.read(document,location.href,Core);
      let initial=read();
      if(!initial.ok && args.wait_ready && initial.error==="product_detail_unavailable")initial=await new Promise(resolve=>{
        const finish=result=>{observer.disconnect();clearTimeout(timer);resolve(result);};
        const observer=new MutationObserver(()=>{
          if(command.cancelled || !active || Detail.route(location.href)?.url!==activeUrl){finish(fail("page_changed"));return;}
          const result=read();if(result.ok || result.error!=="product_detail_unavailable")finish(result);
        });
        const timer=setTimeout(()=>finish(fail("product_detail_unavailable")),args.open_link_dialog?6000:15000);
        observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
      });
      if(!initial.ok || !args.open_link_dialog)return initial;
      busy=true;
      try{return await Detail.openLink(document,location.href,Core,()=>!command.cancelled && active && Detail.route(location.href)?.url===activeUrl && Detail.route(location.href)?.product_id===args.expected_product_id);}
      finally{busy=false;}
    }
    if(!isOfferPage())return fail("product_list_page_required");
    if(operation==="search_scan") {
      busy=true;
      try{return await window.ShopKudSearch.run({args,records:()=>current().products.map(p=>p.record),
        selectionStates:()=>[...document.querySelectorAll(SELECT.card)].map(card=>checkbox({card}).siteChecked),
        active:()=>active && isOfferPage(),cancelled:()=>command.cancelled,scan:Pager.scan});}
      finally{busy=false;}
    }
    if(operation==="pagination")return Pager.inspect();
    if(operation==="scan_read")return Pager.read(args);
    if(operation==="review")return readReview(args);
    if(operation==="navigate" || operation==="scan") {
      busy=true;
      try{return operation==="navigate"?await Pager.navigate(args.page_number,undefined,undefined,()=>command.cancelled):await Pager.scan(args,()=>command.cancelled);}
      finally{busy=false;}
    }
    if(operation==="snapshot") {
      if(!Number.isInteger(args.limit) || args.limit<1 || args.limit>50 || !Number.isInteger(args.offset) || args.offset<0 || args.offset>450)return fail("invalid_input");
      const live=current();
      const records=live.products.slice(args.offset,args.offset+args.limit).map(p=>p.record);
      if(new Set(records.map(r=>r.product_id)).size!==records.length)return fail("duplicate_product_id");
      prune(snapshots);const snapshot_id=nonce();snapshots.set(snapshot_id,{records,created:Date.now()});
      return {ok:true,snapshot_id,records,observed_at:new Date(snapshots.get(snapshot_id).created).toISOString(),total_discovered:live.total,valid_in_first_500:live.products.length,offset:args.offset,next_offset:args.offset+records.length<live.products.length?args.offset+records.length:null,observations_only:true,expires_in_seconds:600};
    }
    if(operation==="selections")return {ok:true,selections:current().products.map(p=>({product_id:p.record.product_id,selected:checkbox(p).siteChecked,picker_owned:owned.has(p.record.product_id)}))};
    if(operation==="export") {
      const snap=fetchSnapshot(args.snapshot_id);return snap?{ok:true,records:snap.records,observed_at:new Date(snap.created).toISOString(),observations_only:true}:fail("snapshot_expired_or_unknown");
    }
    if(operation==="prepare") {
      const snap=fetchSnapshot(args.snapshot_id);
      if(!snap)return fail("snapshot_expired_or_unknown");
      if(!Array.isArray(args.picks) || args.picks.length<1 || args.picks.length>20 || !args.picks.every(validPick) || new Set(args.picks.map(p=>p.product_id)).size!==args.picks.length)return fail("invalid_analysis_plan");
      const records=args.picks.map(p=>snap.records.find(r=>r.product_id===p.product_id));
      if(records.some(r=>!r))return fail("product_not_in_snapshot");
      if(!validateRecords(records))return fail("snapshot_stale");
      prune(plans);const plan_id=nonce();
      const prepared={created:Date.now(),observed_at:snap.created,records,picks:args.picks,used:false,kept_ids:records.map(r=>r.product_id),decision_source:"initial_plan",decision_version:0,result:null};
      plans.set(plan_id,prepared);reviewedPlanId=plan_id;UI.showPlan(prepared);
      if(UI.isConnected())status.textContent=`เอเจนต์เตรียมแผน ${records.length} สินค้าแล้ว ยังไม่ได้เลือกสินค้า`;
      return {ok:true,plan_id,picks:args.picks,selected_now:records.map(r=>({product_id:r.product_id,selected:checkbox(current().products.find(p=>p.record.product_id===r.product_id)).siteChecked})),requires_explicit_apply:true,evidence_is_not_truth_certification:true};
    }
    if(operation==="apply") {
      const plan=plans.get(args.plan_id);
      if(!plan || Date.now()-plan.created>TTL){if(args.plan_id===reviewedPlanId)UI.invalidate("แผนหมดอายุแล้ว ให้เอเจนต์อ่านข้อมูลล่าสุดและเตรียมแผนใหม่");return fail("plan_expired_or_unknown");}
      if(plan.used)return fail("plan_already_consumed");
      if(plan.invalidated)return fail("snapshot_stale");
      // Freeze this subset before any asynchronous click/settle. Native callers
      // cannot supply new IDs or override a human's draft through arguments.
      const records=plan.records.filter(r=>plan.kept_ids.includes(r.product_id));
      if(!records.length)return fail("empty_selection");
      if(args.expected_decision_version!==undefined && (!Number.isInteger(args.expected_decision_version) || args.expected_decision_version<0 || args.expected_decision_version>1000000))return fail("invalid_input");
      if(plan.decision_source==="human" && args.expected_decision_version===undefined)return fail("review_confirmation_required");
      if(args.expected_decision_version!==undefined && args.expected_decision_version!==plan.decision_version)return fail("review_decision_changed");
      if(!validateRecords(records)){plan.invalidated="snapshot_stale";if(args.plan_id===reviewedPlanId)UI.invalidate("ข้อมูลสินค้าเปลี่ยนไปแล้ว ให้เอเจนต์อ่านข้อมูลล่าสุดและเตรียมแผนใหม่");return fail("snapshot_stale");}
      const initial=current().products;
      if(records.some(r=>{const p=initial.find(p=>p.record.product_id===r.product_id);const c=checkbox(p);return c.siteChecked===null || c.input.disabled;}))return fail("checkbox_unavailable");
      plan.used=true;busy=true;if(args.plan_id===reviewedPlanId)UI.setBusy(true);
      const applied=[],already_selected=[],uncertain=[],changed=[],not_attempted=[];
      try {
        for(const record of records) {
          if(command.cancelled){not_attempted.push(...records.filter(r=>!applied.includes(r.product_id) && !already_selected.includes(r.product_id) && !changed.includes(r.product_id) && !uncertain.includes(r.product_id)).map(r=>r.product_id));break;}
          if(!validateRecords([record])) {changed.push(record.product_id);continue;}
          const p=current().products.find(p=>p.record.product_id===record.product_id);const c=checkbox(p);
          if(c.siteChecked===true) {already_selected.push(record.product_id);continue;}
          if(c.siteChecked!==false || c.input.disabled) {changed.push(record.product_id);continue;}
          c.input.click();
          if(await settle(p,true,command)) {applied.push(record.product_id);owned.set(record.product_id,record);}
          else uncertain.push(record.product_id);
        }
      } finally {busy=false;if(args.plan_id===reviewedPlanId)UI.setBusy(false);}
      if(UI.isConnected())status.textContent=`เลือกแล้ว ${applied.length}; เลือกอยู่ก่อน ${already_selected.length}; ไม่แน่ชัด ${uncertain.length}; ข้อมูลเปลี่ยน ${changed.length} ไม่ทำซ้ำให้อัตโนมัติ`;
      const result={ok:!command.cancelled && !uncertain.length && !changed.length,applied,already_selected,uncertain,changed,plan_consumed:true,retry_automatically:false,outcome:uncertain.length?"unconfirmed":command.cancelled || changed.length?"partial":"completed",...(command.cancelled?{cancelled:true,not_attempted}: {})};
      showApplyResult(args.plan_id,result);return result;
    }
    if(operation==="clear") {
      busy=true;const cleared=[],changed=[],uncertain=[],not_attempted=[];
      try {
        for(const [id,record] of [...owned]) {
          if(command.cancelled){not_attempted.push(...[...owned.keys()].filter(x=>!cleared.includes(x) && !changed.includes(x) && !uncertain.includes(x)));break;}
          if(!validateRecords([record])) {changed.push(id);continue;}
          const p=current().products.find(p=>p.record.product_id===id);const c=checkbox(p);
          if(c.siteChecked===false) {owned.delete(id);continue;}
          if(c.siteChecked!==true || c.input.disabled) {uncertain.push(id);continue;}
          c.input.click();
          if(await settle(p,false,command)) {cleared.push(id);owned.delete(id);}
          else uncertain.push(id);
        }
      } finally {busy=false;}
      if(UI.isConnected())status.textContent=`ยกเลิกการเลือกที่ ShopKud เลือกไว้ ${cleared.length} สินค้า โดยรักษาสินค้าที่คุณเลือกไว้ก่อน ไม่ทำซ้ำให้อัตโนมัติ`;
      return {ok:!command.cancelled && !changed.length && !uncertain.length,cleared,changed,uncertain,retry_automatically:false,outcome:uncertain.length?"unconfirmed":command.cancelled || changed.length?"partial":"completed",...(command.cancelled?{cancelled:true,not_attempted}: {})};
    }
    return fail("unsupported_operation");
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(sender.id===chrome.runtime.id && message?.type==="shopkud-discover") {
      if(activeCommand){respond({state:"busy"});return false;}
      if(/^\/verify(?:\/|$)/u.test(location.pathname) || [...document.querySelectorAll('iframe[src*="captcha"],.captcha,#captcha,[data-testid="captcha"]')].some(e=>e.getClientRects().length)) {
        respond({state:"challenge_detected"});return false;
      }
      syncRoute();
      if(!active){respond({state:"unsupported_affiliate_route"});return false;}
      registerPage(reply=>respond({state:reply?.ok?"registered":"unavailable"}));
      return true;
    }
    if(!active || sender.id!==chrome.runtime.id || message?.nonce!==PAGE_NONCE)return false;
    if(message.type==="shopkud-entry-status") {
      const context=Detail.route(location.href);
      const challenged=[...document.querySelectorAll('iframe[src*="captcha"],.captcha,#captcha,[data-testid="captcha"]')].some(e=>e.getClientRects().length);
      const idle=Boolean(context) && context.url===activeUrl && context.url===message.entry_url && !activeCommand && !busy && !challenged;
      respond({state:idle?"idle":"unavailable",page_url:idle?context.url:null});return false;
    }
    if(message.type==="shopkud-state") {if(!message.connected && activeCommand)activeCommand.cancelled=true;UI.setConnected(Boolean(message.connected));status.textContent=message.connected?"เชื่อมต่อแล้ว เอเจนต์อ่านข้อมูลหน้านี้ได้เมื่อเรียกใช้":"การเชื่อมต่อหลุด ให้เปิดตัวเชื่อมต่อบนเครื่องแล้วกดเชื่อมต่อ ไม่ทำคำสั่งซ้ำให้";return false;}
    if(message.type==="shopkud-cancel") {const matched=activeCommand?.id===message.request_id;if(matched)activeCommand.cancelled=true;respond({ok:matched});return false;}
    if(message.type!=="shopkud-command")return false;
    if(!/^[0-9a-f]{32}$/u.test(message.request_id || "")){respond(fail("invalid_request"));return false;}
    if(activeCommand){respond(fail("page_busy"));return false;}
    const command={id:message.request_id,cancelled:false};activeCommand=command;
    execute(message.operation,message.arguments,command).then(result=>{if(activeCommand===command)activeCommand=null;respond(result);}).catch(()=>{
      if(activeCommand===command)activeCommand=null;
      const result=fail("page_operation_unconfirmed","unconfirmed");
      if(message.operation==="apply")showApplyResult(message.arguments?.plan_id,result);
      respond(result);
    });
    return true;
  });
  function registerPage(done=()=>{}) {
    const registrationNonce=PAGE_NONCE;
    status.textContent="กำลังเชื่อมต่อกับเครื่องมือคัดสินค้า…";
    try {chrome.runtime.sendMessage({type:"shopkud-register",nonce:registrationNonce,page_url:activeUrl},reply=>{
      const error=chrome.runtime.lastError;
      if(!active || PAGE_NONCE!==registrationNonce)return;
      if(error || !reply?.ok){UI.setConnected(false);status.textContent="ลงทะเบียนหน้านี้ไม่ได้ ให้รีเฟรชหน้าเว็บก่อน ไม่ทำคำสั่งซ้ำให้";}
      else {UI.setConnected(Boolean(reply.connected));status.textContent=reply.connected?"เชื่อมต่อแล้ว เอเจนต์อ่านข้อมูลหน้านี้ได้เมื่อเรียกใช้":"รอการเชื่อมต่อ ให้เปิดตัวเชื่อมต่อบนเครื่องแล้วกดเชื่อมต่อ";}
      done(error?null:reply);
    });} catch {
      UI.setConnected(false);
      status.textContent="ส่วนขยายถูกโหลดใหม่ ให้รีเฟรชหน้าเว็บก่อน ไม่ทำคำสั่งซ้ำให้";
      done(null);
    }
  }
  function syncRoute() {
    const context=Detail.route(location.href);
    if(active && activeUrl!==context?.url) {
        active=false;
        activeUrl=null;
        if(activeCommand)activeCommand.cancelled=true;
        chrome.runtime.sendMessage({type:"shopkud-unregister",nonce:PAGE_NONCE},()=>{void chrome.runtime.lastError;});
        snapshots.clear();plans.clear();owned.clear();Pager.reset();UI.reset();reviewedPlanId=null;host.remove();
    }
    if(!context)return;
    if(!document.body)return;
    if(!active) {
      active=true;activeUrl=context.url;PAGE_NONCE=nonce();
      UI.setPageMode(context.kind);
      registerPage();
    }
    // Survive site root replacement without reparsing products or model calls.
    if(!host.isConnected)document.body.append(host);
  }
  const routeObserver=new MutationObserver(syncRoute);
  routeObserver.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener("popstate",syncRoute);
  window.addEventListener("hashchange",syncRoute);
  window.navigation?.addEventListener("navigatesuccess",syncRoute);
  syncRoute();
  function showApplyResult(plan_id,result) {
    const plan=plans.get(plan_id);if(plan?.used){plan.result=result;plan.executed_at=Date.now();}
    if(plan_id!==reviewedPlanId)return;
    if(UI.isConnected() && result.outcome==="unconfirmed")status.textContent="ผลการเลือกยังไม่แน่ชัด ให้ตรวจหน้าเว็บก่อนทำต่อ ห้ามกดซ้ำ";
    UI.finished(result);
  }
  function keepReviewedSubset(ids) {
    const plan=plans.get(reviewedPlanId);
    if(activeCommand || busy || !plan)return false;
    return ReviewData.keep(plan,ids);
  }
  function readReview(args) {
    if(!/^[0-9a-f]{32}$/u.test(args.plan_id || ""))return fail("invalid_input");
    const plan=plans.get(args.plan_id);if(!plan)return fail("plan_expired_or_unknown");
    if(!plan.used && Date.now()-plan.created>TTL && args.plan_id===reviewedPlanId)UI.invalidate("แผนหมดอายุแล้ว ให้เอเจนต์อ่านข้อมูลล่าสุดและเตรียมแผนใหม่");
    if(!plan.used && !plan.invalidated && Date.now()-plan.created<=TTL && !validateRecords(plan.records.filter(r=>plan.kept_ids.includes(r.product_id)))){
      plan.invalidated="snapshot_stale";
      if(args.plan_id===reviewedPlanId)UI.invalidate("ข้อมูลสินค้าเปลี่ยนไปแล้ว ให้เอเจนต์อ่านข้อมูลล่าสุดและเตรียมแผนใหม่");
    }
    const packet=ReviewData.bundle(plan,args.plan_id,args);
    if(packet.ok){packet.connection_available=UI.isConnected();packet.can_apply=packet.can_apply && packet.connection_available;}
    return packet;
  }
  function exportReviewedPlan(format) {
    if(activeCommand || busy || !reviewedPlanId || !["json","markdown"].includes(format))return;
    const packet=readReview({plan_id:reviewedPlanId,limit:20,offset:0,view:"full"});
    if(!packet.ok)return;
    const blob=new Blob([format==="json"?JSON.stringify(packet,null,2):ReviewData.markdown(packet)],{type:format==="json"?"application/json;charset=utf-8":"text/markdown;charset=utf-8"});
    const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`shopkud-review-${reviewedPlanId}.${format==="json"?"json":"md"}`;
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function applyReviewedPlan() {
    if(activeCommand || busy || !reviewedPlanId)return;
    const plan_id=reviewedPlanId,command={id:nonce(),cancelled:false};activeCommand=command;
    try {const result=await execute("apply",{plan_id,expected_decision_version:plans.get(plan_id)?.decision_version},command);showApplyResult(plan_id,result);}
    catch {showApplyResult(plan_id,fail("page_operation_unconfirmed","unconfirmed"));}
    finally {if(activeCommand===command)activeCommand=null;UI.setBusy(false);}
  }
})();
