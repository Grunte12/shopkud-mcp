(() => {
  "use strict";
  const REPORT_URL = "https://affiliate.shopee.co.th/report/click_report";
  const HEADERS = ["รหัสคลิก", "เวลาคลิก", "ภาคที่คลิก", "Sub_id", "อ้างอิง"];
  const fail = error => ({ok:false, schema_version:1, error});
  const text = node => (node.innerText || node.textContent || "").replace(/\s+/gu," ").trim();
  const visible = node => {
    if(!node.getClientRects().length)return false;
    for(let current=node;current;current=current.parentElement){
      const style=getComputedStyle(current);
      if(current.hidden || current.getAttribute("aria-hidden")==="true" || style.visibility==="hidden" || style.display==="none" || style.opacity==="0")return false;
    }
    return true;
  };
  function date(value) {
    const match=/^(\d{2})-(\d{2})-(\d{4})$/u.exec(value);
    if(!match)return null;
    const [,day,month,year]=match, iso=`${year}-${month}-${day}`;
    const parsed=new Date(`${iso}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(iso)?iso:null;
  }
  function read() {
    if(location.href!==REPORT_URL)return fail("unsupported_report_route");
    if([...document.querySelectorAll('input[type="password"],iframe[src*="captcha"],.captcha,#captcha,[data-testid="captcha"]')].some(visible))return fail("report_requires_owner_action");
    if([...document.querySelectorAll('[aria-busy="true"],.ant-spin-spinning,.el-loading-mask')].some(visible))return fail("report_loading");
    const tables=[...document.querySelectorAll("table")].filter(visible).filter(table=>[...table.querySelectorAll("thead th")].some(cell=>visible(cell) && text(cell)==="Sub_id"));
    if(tables.length!==1)return fail("unsupported_report_layout");
    const table=tables[0], headers=[...table.querySelectorAll("thead th")].filter(visible).map(text);
    if(headers.length!==HEADERS.length || HEADERS.some(header=>headers.filter(value=>value===header).length!==1))return fail("unsupported_report_headers");
    const inputs=[...document.querySelectorAll("input")].filter(visible).map(input=>date(input.value || "")).filter(Boolean);
    if(inputs.length!==2 || inputs[0]>inputs[1])return fail("report_period_unknown");
    const rows=[...table.querySelectorAll("tbody tr")].filter(visible);
    if(rows.length>500)return fail("report_row_limit");
    const groups=new Map();let count=0;
    for(const row of rows){
      const cells=[...row.children].filter(cell=>cell.tagName==="TD" && visible(cell));
      if(cells.length===1 && cells[0].colSpan===HEADERS.length && /^(?:ไม่มีข้อมูล|ไม่พบข้อมูล|No data|No Data)$/u.test(text(cells[0])))continue;
      if(cells.length!==headers.length || cells.some(cell=>cell.colSpan!==1 || cell.rowSpan!==1))return fail("malformed_report_row");
      const sub_id=text(cells[headers.indexOf("Sub_id")]);
      let referrer=text(cells[headers.indexOf("อ้างอิง")]);
      if(!sub_id || !referrer || sub_id.length>128 || referrer.length>512 || /[\u0000-\u001f\u007f@]/u.test(sub_id+referrer))return fail("malformed_report_group");
      if(/^https?:\/\//iu.test(referrer)){
        try{const url=new URL(referrer);if(url.username || url.password)return fail("malformed_report_group");referrer=url.origin;}catch{return fail("malformed_report_group");}
      }
      const key=JSON.stringify([sub_id,referrer]);
      const group=groups.get(key) || {sub_id,referrer,clicks:0};group.clicks++;groups.set(key,group);count++;
    }
    if(!count && ![...table.querySelectorAll("td,.ant-empty-description")].some(node=>visible(node) && /^(?:ไม่มีข้อมูล|ไม่พบข้อมูล|No data|No Data)$/u.test(text(node))))return fail("report_empty_unconfirmed");
    const totals=new Set();
    for(const node of document.querySelectorAll("span,div,p")){
      if(!visible(node) || node.children.length)continue;
      const match=/^ยอดรวม\s+([\d,]+)(?:\s+(?:รายการ|แถว))?$/u.exec(text(node));
      if(match){const total=Number(match[1].replace(/,/gu,""));if(Number.isSafeInteger(total) && total>=count)totals.add(total);}
    }
    if(location.href!==REPORT_URL)return fail("report_context_changed");
    return {ok:true,schema_version:1,source_url:REPORT_URL,observed_at:new Date().toISOString(),period_start:inputs[0],period_end:inputs[1],groups:[...groups.values()],visible_rows:count,total_rows:totals.size===1?[...totals][0]:null,coverage:"visible_page_only"};
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message?.type!=="shopkud-read-click-report" || sender.id!==chrome.runtime.id || sender.url!==chrome.runtime.getURL("dashboard.html") || window.top!==window)return false;
    try{respond(read());}catch{respond(fail("report_read_failed"));}
    return false;
  });
})();
