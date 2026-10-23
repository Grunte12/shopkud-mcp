"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {chromium} = require("playwright");
async function run(){
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.addInitScript(()=>{
    const listeners=[];
    const now=Date.now();
    const snapshot={ok:true,connected:true,extension_version:"0.10.3",runs:[
      {trace_id:"a".repeat(16),swarm_id:"b".repeat(16),invocation_number:1,query:"ทีวี",stage:"completed",status:"completed",updated_at_unix_ms:now-1000,elapsed_ms:1200,success:true,effective:true,cache_hit:false,response_tokens_estimate:480,latency_ms:{total:1200,queue_wait_ms:3},browser_operations:{scan:1,scan_read:1,detail:2}},
      {trace_id:"c".repeat(16),swarm_id:"b".repeat(16),invocation_number:2,query:"ทีวี",stage:"detail_check",status:"running",updated_at_unix_ms:now,elapsed_ms:340,candidate_index:2,candidate_count:5,product_name:"Smart TV",browser_operations:{scan:1}},
    ]};
    globalThis.chrome={runtime:{getManifest:()=>({version:"0.10.3"}),onMessage:{addListener(fn){listeners.push(fn);}},async sendMessage(message){if(message.type==="shopkud-live-clear"){snapshot.runs=snapshot.runs.filter(run=>run.status==="running");}return snapshot;}}};
  });
  await page.goto(pathToFileURL(path.join(__dirname,"../extension/sidepanel.html")).href);
  await page.waitForSelector("#now-content:not([hidden])");
  assert.equal(await page.locator("#connection").getAttribute("data-state"),"online");
  assert.equal(await page.locator("#now-query").textContent(),"ทีวี");
  assert.match(await page.locator("#now-stage").textContent(),/ตรวจสินค้ารายตัว/u);
  assert.equal(await page.locator('#journey li[data-key="detail"]').getAttribute("data-state"),"active");
  assert.equal(await page.locator("#now-percent").textContent(),"68%");
  assert.equal(await page.locator("#success-rate").textContent(),"100%");
  assert.equal(await page.locator("#success-gauge").evaluate(node=>node.style.getPropertyValue("--score")),"100");
  assert.equal(await page.locator("#effective-gauge").evaluate(node=>node.style.getPropertyValue("--score")),"100");
  assert.equal(await page.locator("#cache-gauge").evaluate(node=>node.style.getPropertyValue("--score")),"0");
  assert.equal(await page.locator("#p95-bar").evaluate(node=>node.style.width),"100%");
  assert.notEqual(await page.locator("#latency-line").getAttribute("points"),"");
  assert.equal(await page.locator(".run-item").count(),2);
  assert.match(await page.locator(".run-item").nth(1).locator(".run-facts").textContent(),/ผล สำเร็จ.*ผู้ชนะ ได้/u);
  assert.match(await page.locator(".run-item").nth(1).locator(".operation-legend").textContent(),/สแกน 1.*อ่าน 1.*ตรวจจริง 2/u);
  assert.equal(await page.locator("#latency-single").isVisible(),true);
  assert.equal(await page.locator(".latency-viz svg").isVisible(),false);
  assert.equal(await page.locator("body").evaluate(node=>node.scrollWidth<=node.clientWidth),true,"no horizontal overflow at side-panel width");
  const reviewDir=path.join(__dirname,"../.impeccable/review");fs.mkdirSync(reviewDir,{recursive:true});
  await page.screenshot({path:path.join(reviewDir,"live-sidepanel.png"),fullPage:true});
  await page.emulateMedia({colorScheme:"dark"});
  await page.screenshot({path:path.join(reviewDir,"live-sidepanel-dark.png"),fullPage:true});
  await page.emulateMedia({colorScheme:"light"});
  await page.locator("#clear-completed").click();
  assert.equal(await page.locator(".run-item").count(),1);
  await browser.close();
  console.log(JSON.stringify({ok:true,checks:["live state and metrics render","side-panel viewport has no horizontal overflow","completed traces can be cleared"]}));
}
run().catch(error=>{console.error(error);process.exitCode=1;});
