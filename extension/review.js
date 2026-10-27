(() => {
  "use strict";
  // THESIS: review evidence before selecting; never turn commission into a suitability score.
  // OWN-WORLD: incumbent light panel, charcoal system type, restrained orange action, disclosure rows.
  // STORY: inspect -> keep a subset -> once-only Apply -> export observed facts and the actual outcome.
  // FIRST VIEWPORT: compact lower-right status; detail opens inline with a bounded scroll and footer.
  // FORM: scoped extension of the existing panel; no new visual-world seed.
  // FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
  const element = (tag, text, attributes = {}) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  };
  const money = value => typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("th-TH", {style:"currency",currency:"THB",maximumFractionDigits:2}).format(value) : "ยังไม่มีข้อมูลราคา";
  function create({root, onApply, onKeep, onExport}) {
    const style = element("style", `
      :host{position:fixed;bottom:16px;right:16px;z-index:2147483647;font:14px/1.45 system-ui,sans-serif;color:#242628;color-scheme:light}
      *{box-sizing:border-box} [hidden]{display:none!important}
      section{width:min(380px,calc(100vw - 32px));background:#fff;border-radius:14px;box-shadow:0 8px 32px #24262826;overflow:hidden}
      header{padding:16px 18px 10px;display:flex;align-items:baseline;gap:10px}
      h2{font-size:16px;line-height:1.25;margin:0;flex:1} .version{font-size:12px;color:#555b60;font-variant-numeric:tabular-nums}
      p{margin:0;overflow-wrap:anywhere} #status,#detail-help{padding:0 18px 12px;color:#555b60;font-size:13px}
      .toolbar{display:flex;gap:8px;padding:0 18px 16px;flex-wrap:wrap}
      button{font:inherit;font-size:13px;font-weight:600;min-height:36px;padding:7px 12px;background:#f3f4f5;color:#242628;border:1px solid #c9cdd0;border-radius:8px;cursor:pointer}
      button:hover:not(:disabled){background:#e7e9eb}button:active:not(:disabled){background:#dadee1}
      button:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid #175fb3;outline-offset:3px}
      button:disabled{color:#62696e;background:#f4f5f6;cursor:not-allowed}
      .primary{background:#c94122;color:white;border-color:#c94122}.primary:hover:not(:disabled){background:#ae3519}.primary:active:not(:disabled){background:#942b13}
      .review{border-top:1px solid #e0e3e5}.intro{padding:16px 18px 12px}.intro h3{font-size:15px;margin:0 0 6px}.intro p,.empty{font-size:13px;color:#555b60}
      .entries{max-height:min(40vh,360px);overflow:auto;overscroll-behavior:contain;padding:0 18px;min-height:0;flex:1 1 auto}
      .empty{padding:8px 0 18px}details{border-top:1px solid #e0e3e5;padding:12px 0}summary{cursor:pointer;font-weight:600;overflow-wrap:anywhere}
      article{border-top:1px solid #e0e3e5;padding-top:12px}article details{border:0;padding-top:6px}
      .keep{display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer}.keep input{width:18px;height:18px;margin:0;accent-color:#c94122}
      .keep input:focus-visible{outline:2px solid #175fb3;outline-offset:3px}.draft-count{margin-top:8px!important;font-weight:600;color:#242628!important}
      .exports{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
      .facts{font-size:12px;color:#555b60;margin:6px 0 0;font-variant-numeric:tabular-nums}.detail{padding-top:12px}
      h4{font-size:12px;margin:14px 0 4px;color:#555b60}h4:first-child{margin-top:0}.detail p{white-space:pre-wrap}
      ul{margin:4px 0 0;padding-left:18px}li{overflow-wrap:anywhere;margin:4px 0}a{color:#175fb3;text-decoration:underline;text-underline-offset:2px}
      footer{padding:14px 18px 18px;background:#f8f9fa;border-top:1px solid #e0e3e5}footer p{font-size:12px;color:#555b60;margin-bottom:10px}
      #outcome{white-space:pre-wrap}section.expanded{max-height:calc(100dvh - 32px);display:flex;flex-direction:column}section.expanded .review{display:flex;flex-direction:column;min-height:0}.intro,footer{flex:none}
      @media(max-width:420px){:host{right:8px;bottom:8px}section{width:calc(100vw - 16px)}header,.toolbar{padding-left:14px;padding-right:14px}.entries{padding:0 14px}}
    `);
    const panel = element("section", undefined, {"aria-label":"พื้นที่ทำงาน ShopKud",lang:"th"});
    const header = element("header");
    const version = globalThis.chrome?.runtime?.getManifest?.().version || "—";
    header.append(element("h2","ShopKud MCP"),element("span",version,{class:"version"}));
    const status = element("p","กำลังเชื่อมต่อกับเครื่องมือคัดสินค้า…",{id:"status",role:"status","aria-live":"polite"});
    const toolbar = element("div",undefined,{class:"toolbar"});
    const detailHelp=element("p","หน้ารายละเอียดสินค้า: เอเจนต์อ่านสินค้าและลิงก์ที่แสดงอยู่ได้ สั่งเอเจนต์บันทึกเพื่อค้นย้อนหลัง ไม่เก็บประวัติการท่องเว็บ",{id:"detail-help",hidden:""});
    const reconnect = element("button","เชื่อมต่อ",{type:"button"});
    const toggle = element("button","ดูแผนคัดสินค้า",{type:"button","aria-expanded":"false","aria-controls":"review"});
    toolbar.append(toggle,reconnect);
    const review = element("div",undefined,{id:"review",class:"review",hidden:""});
    const intro = element("div",undefined,{class:"intro"});
    intro.append(element("h3","ตรวจแผนก่อนเลือกสินค้า"),element("p","เหตุผล ความมั่นใจ และแหล่งข้อมูลมาจากเอเจนต์ ยังไม่ได้ตรวจสอบยืนยัน เครื่องมือนี้ไม่ซื้อสินค้าหรือโพสต์งาน"));
    const count=element("p","",{class:"draft-count",role:"status","aria-live":"polite"});intro.append(count);
    const entries = element("div",undefined,{class:"entries"});
    const footer = element("footer");
    const outcome = element("p","ยังไม่ได้เลือกสินค้า",{id:"outcome",role:"status","aria-live":"polite"});
    const apply = element("button","เลือกสินค้าตามแผน",{class:"primary",type:"button",disabled:""});
    const exports=element("div",undefined,{class:"exports"});
    const exportJSON=element("button","บันทึกชุดข้อมูล",{type:"button",disabled:""}),exportText=element("button","บันทึกสรุปไทย",{type:"button",disabled:""});exports.append(exportJSON,exportText);
    footer.append(outcome,apply,exports);review.append(intro,entries,footer);panel.append(header,status,toolbar,detailHelp,review);root.append(style,panel);
    let hasPlan=false,available=false,running=false,connected=false,expiry=null,kept=new Set();
    function controls(){apply.disabled=!hasPlan || !available || !kept.size || running || !connected;reconnect.disabled=running;toggle.textContent=hasPlan?`ดูแผนคัดสินค้า (${entries.childElementCount})`:"ดูแผนคัดสินค้า";count.textContent=hasPlan?`เก็บไว้ในแผน ${kept.size} จาก ${entries.childElementCount} ชิ้น — ยังไม่ใช่การติ๊กบนหน้าเว็บ`:"";for(const input of entries.querySelectorAll('input'))input.disabled=running || !available || !connected;exportJSON.disabled=exportText.disabled=!hasPlan || running;}
    function reset(){clearTimeout(expiry);expiry=null;hasPlan=false;available=false;kept=new Set();entries.replaceChildren(element("p","ให้เอเจนต์ค้นคว้าสินค้าและเตรียมแผนพร้อมเหตุผลก่อน ไม่มีการเลือกสินค้าให้อัตโนมัติ",{class:"empty"}));outcome.textContent="ยังไม่ได้เลือกสินค้า";controls();}
    toggle.onclick=()=>{const open=review.hidden;review.hidden=!open;panel.classList.toggle("expanded",open);toggle.setAttribute("aria-expanded",String(open));};
    apply.onclick=event=>{if(event.isTrusted && !apply.disabled)onApply();};
    exportJSON.onclick=event=>{if(event.isTrusted && !exportJSON.disabled)onExport?.("json");};
    exportText.onclick=event=>{if(event.isTrusted && !exportText.disabled)onExport?.("markdown");};
    function field(parent,label,text){parent.append(element("h4",label),element("p",text));}
    function showPlan(plan){
      clearTimeout(expiry);hasPlan=true;available=true;entries.replaceChildren();kept=new Set(plan.kept_ids || plan.records.map(r=>r.product_id));
      for(let i=0;i<plan.picks.length;i++){
        const pick=plan.picks[i],record=plan.records[i];
        const entry=element("article",undefined,{"data-product-id":record.product_id}),selection=element("label",undefined,{class:"keep"}),input=element("input",undefined,{type:"checkbox","aria-label":`เก็บไว้ในแผน: ${record.name}`});input.checked=kept.has(record.product_id);selection.append(input,element("span","เก็บไว้ในแผน"));
        input.addEventListener("click",event=>{if(!event.isTrusted)event.preventDefault();});
        input.onchange=event=>{
          if(!event.isTrusted || running || !available || !connected){input.checked=kept.has(record.product_id);return;}
          const proposed=new Set(kept);if(input.checked)proposed.add(record.product_id);else proposed.delete(record.product_id);
          if(onKeep && onKeep([...proposed])===false){input.checked=kept.has(record.product_id);return;}
          kept=proposed;controls();
        };
        const row=element("details");
        row.append(element("summary",record.name),element("p",`${money(record.price_min_thb)} · ค่าคอมมิชชันที่แสดง ${record.commission_pct}% · รหัสสินค้า ${record.product_id}`,{class:"facts"}));
        const detail=element("div",undefined,{class:"detail"});
        field(detail,"เหตุผลที่เอเจนต์เสนอ",pick.reason);field(detail,"ฉากคอนเทนต์ที่ทำได้",pick.content_angle);
        field(detail,"ความมั่นใจของเอเจนต์",{low:"ต่ำ",medium:"ปานกลาง",high:"สูง"}[pick.confidence] || "ไม่ได้ระบุ");
        detail.append(element("h4","ความเสี่ยงและข้อมูลที่ยังไม่รู้"));
        if(pick.risks.length){const risks=element("ul");for(const risk of pick.risks)risks.append(element("li",risk));detail.append(risks);}
        else detail.append(element("p","เอเจนต์ไม่ได้ระบุความเสี่ยง ไม่ได้หมายความว่าไม่มีความเสี่ยง"));
        detail.append(element("h4","แหล่งข้อมูลที่ควรตรวจสอบ"));const links=element("ul");
        for(const source of pick.evidence){const li=element("li");li.append(element("a",source.title,{href:source.url,target:"_blank",rel:"noopener noreferrer"}));links.append(li);}
        detail.append(links);row.append(detail);entry.append(selection,row,element("p","",{class:"facts execution",hidden:""}));entries.append(entry);
      }
      outcome.textContent="ตรวจแผนได้แล้ว ปุ่มนี้จะเลือกเฉพาะสินค้าในแผน โดยรักษาสินค้าที่คุณเลือกไว้ก่อน";
      expiry=setTimeout(()=>invalidate("แผนหมดอายุแล้ว ให้เอเจนต์อ่านข้อมูลล่าสุดและเตรียมแผนใหม่"),Math.max(0,plan.created+600000-Date.now()));controls();
    }
    function invalidate(message){if(!hasPlan)return;available=false;outcome.textContent=message;clearTimeout(expiry);controls();}
    function finished(result){
      if(!hasPlan)return;
      available=false;clearTimeout(expiry);
      const categories=[["uncertain","ไม่แน่ชัด ห้ามทำซ้ำ"],["changed","ข้อมูลเปลี่ยน ยังเลือกไม่ได้"],["not_attempted","ยังไม่ได้ลองเลือก"],["applied","เลือกสำเร็จ"],["already_selected","เลือกอยู่ก่อน"]];
      for(const entry of entries.querySelectorAll('article')){
        const id=entry.getAttribute('data-product-id'),label=entry.querySelector('.execution');
        const category=categories.find(([key])=>result[key]?.includes(id));
        const message=category?.[1] || (!kept.has(id)?"ไม่ได้เก็บไว้ในแผน ไม่ดำเนินการ":result.outcome==="unconfirmed"?"ไม่ทราบผล ห้ามทำซ้ำ":result.outcome==="not_applied"?"ยังไม่ได้เลือกจากคำสั่งนี้":"ไม่มีผลรายชิ้นที่ยืนยันได้");
        label.textContent=`ผล ณ เวลาที่ดำเนินการ: ${message} — ไม่ใช่สถานะการติ๊กปัจจุบัน`;label.hidden=false;
      }
      if(result.error){
        outcome.textContent=result.outcome==="unconfirmed"
          ? "ผลลัพธ์ไม่แน่ชัด บางสินค้าอาจถูกเลือกแล้ว ห้ามกดซ้ำ ให้เอเจนต์ตรวจสอบหน้าเว็บก่อนทำต่อ"
          : ({snapshot_stale:"ข้อมูลสินค้าเปลี่ยนไปแล้ว",plan_expired_or_unknown:"แผนหมดอายุหรือหาแผนไม่พบ",plan_already_consumed:"แผนนี้ถูกใช้ไปแล้ว",checkbox_unavailable:"ยังเลือกสินค้านี้ไม่ได้",page_busy:"กำลังทำงานอื่นอยู่"}[result.error] || "ยังดำเนินการตามแผนไม่ได้")+" ยังไม่ได้เลือกสินค้าจากคำสั่งนี้ ให้เอเจนต์ตรวจข้อมูลและเตรียมแผนใหม่";
      }
      else {outcome.textContent=`${{completed:"เสร็จแล้ว",partial:"ทำได้บางส่วน",unconfirmed:"ผลลัพธ์ไม่แน่ชัด"}[result.outcome] || "ผลลัพธ์ไม่แน่ชัด"}: เลือกแล้ว ${result.applied?.length || 0}; เลือกอยู่ก่อน ${result.already_selected?.length || 0}; ไม่แน่ชัด ${result.uncertain?.length || 0}; ข้อมูลเปลี่ยน ${result.changed?.length || 0}; ยังไม่ได้ลองเลือก ${result.not_attempted?.length || 0}${result.cancelled?" · ยกเลิกแล้ว":""} ไม่ทำซ้ำให้อัตโนมัติ`;}
      controls();
    }
    reset();
    return {status,reconnect,showPlan,finished,invalidate,reset,
      setPageMode(kind){const detail=kind==="detail";toggle.hidden=detail;detailHelp.hidden=!detail;review.hidden=true;panel.classList.remove("expanded");toggle.setAttribute("aria-expanded","false");},
      setBusy(value){running=value;apply.textContent=value?"กำลังเลือกสินค้า…":"เลือกสินค้าตามแผน";controls();},
      setConnected(value){connected=value;controls();},isConnected:()=>connected};
  }
  window.ShopKudReview={create};
})();
