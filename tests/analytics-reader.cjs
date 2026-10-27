"use strict";
// Isolated synthetic DOM only: no account, live Shopee requests, or user profile.
const assert=require("node:assert/strict");
const path=require("node:path");
const {chromium}=require("playwright");
const URL_REPORT="https://affiliate.shopee.co.th/report/click_report";
const headers=["รหัสคลิก","เวลาคลิก","ภาคที่คลิก","Sub_id","อ้างอิง"];
const row=(sub="campaign",ref="Facebook",extra="")=>`<tr ${extra}><td>PRIVATE-CLICK-ID</td><td>PRIVATE-TIME</td><td>PRIVATE-REGION</td><td>${sub}</td><td>${ref}</td></tr>`;
function html(rows,options={}){
  return `<input value="01-10-2026"><input value="27-10-2026"><div>ยอดรวม ${options.total??100}</div><table><thead><tr>${(options.headers||headers).map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table><button onclick="window.actions++">Next</button>${options.extra||""}`;
}
async function main(){
  const browser=await chromium.launch({headless:true,executablePath:process.env.SHOPEE_TEST_CHROMIUM});
  const context=await browser.newContext();
  await context.route("**/*",route=>route.fulfill({contentType:"text/html",body:"<html><body></body></html>"}));
  const page=await context.newPage();
  try{
    await page.goto(URL_REPORT);
    await page.evaluate(()=>{window.actions=0;window.chrome={runtime:{id:"fixture",getURL:p=>`chrome-extension://fixture/${p}`,onMessage:{addListener:fn=>window.readListener=fn}}};});
    await page.addScriptTag({path:path.resolve(__dirname,"../extension/analytics.js")});
    const read=()=>page.evaluate(()=>{let result=null;window.readListener({type:"shopkud-read-click-report"},{id:"fixture",url:"chrome-extension://fixture/dashboard.html"},value=>result=value);return result;});
    const set=markup=>page.evaluate(markup=>{document.body.innerHTML=markup;},markup);
    await set(html(row()+row()+row("other","https://example.com/path?buyer=secret#private")+row("hidden","PRIVATE-HIDDEN",'style="display:none"')));
    let result=await read();assert.equal(result.ok,true);assert.equal(result.visible_rows,3);assert.equal(result.total_rows,100);assert.equal(result.coverage,"visible_page_only");
    assert.deepEqual(result.groups,[{sub_id:"campaign",referrer:"Facebook",clicks:2},{sub_id:"other",referrer:"https://example.com",clicks:1}]);
    assert.equal(result.period_start,"2026-10-01");assert.equal(result.period_end,"2026-10-27");
    assert.ok(!/PRIVATE|buyer|secret/u.test(JSON.stringify(result)),"private source fields never leave parser");
    assert.equal(await page.evaluate(()=>window.actions),0,"pagination is never clicked");
    await set(html(row(),{headers:[...headers.slice(0,4),"Sub_id"]}));assert.equal((await read()).ok,false);
    await set(html(row(),{headers:[...headers,"Buyer"]}));assert.equal((await read()).ok,false);
    await set(html('<tr><td colspan="5">ไม่มีข้อมูล</td></tr>',{total:0}));result=await read();assert.equal(result.ok,true);assert.equal(result.visible_rows,0);assert.deepEqual(result.groups,[]);
    await set(html(""));assert.equal((await read()).error,"report_empty_unconfirmed");
    await set(html(row(),{extra:'<div class="ant-spin-spinning">loading</div>'}));assert.equal((await read()).error,"report_loading");
    await set(html(row(),{extra:'<input type="password">'}));assert.equal((await read()).error,"report_requires_owner_action");
    await set(html(row(),{extra:'<span>ยอดรวม 200</span>'}));assert.equal((await read()).total_rows,null);
    await set(html('<tr><td>broken</td></tr>'));assert.equal((await read()).error,"malformed_report_row");
    await set(html(row()));await page.evaluate(()=>document.querySelector("input").value="31-02-2026");assert.equal((await read()).error,"report_period_unknown");
    for(const sender of [{id:"other",url:"chrome-extension://fixture/dashboard.html"},{id:"fixture",url:"https://affiliate.shopee.co.th/report/click_report"},{id:"fixture",url:"chrome-extension://fixture/dashboard.html?spoof=1"}]){
      assert.equal(await page.evaluate(sender=>{let replied=false;window.readListener({type:"shopkud-read-click-report"},sender,()=>replied=true);return replied;},sender),false);
    }
    await page.evaluate(()=>history.pushState({},"","/report/conversion_report"));assert.equal((await read()).error,"unsupported_report_route");
    console.log("analytics-reader: privacy, partial coverage, headers, empty, loading, dates, sender and route checks passed");
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
