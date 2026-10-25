"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {chromium} = require("playwright");
async function run(){
  const browser=await chromium.launch({headless:true,executablePath:process.env.SHOPKUD_TEST_CHROMIUM});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const pageErrors=[];
  page.on("pageerror",error=>pageErrors.push(error.message));
  await page.addInitScript(()=>{
    const listeners=[];
    const now=Date.now();
    const stored={};
    const dashboard={schema_version:1,query:"ทีวี",channel:"shopee_video",freshness:"live",cache_hit:false,cache_age_ms:0,partial_market_coverage:false,
      criteria:{ranking_goal:"balanced",target_kind:"product",mall_only:true,min_sold:500,freshness:"live"},winner_product_id:"26570814201",winner_status:"metric_leader_pending_agent_review",review_required:true,observed_at:new Date(now-1000).toISOString(),
      scan:{pages_scanned:3,unique_products:42,reached_end:true,outcome:"completed"},exclusions:{not_mall:9,sold_below_minimum:6},relaxation_suggestions:[],
      results:[
        {product_id:"26570814201",name:"Philips NA331 Air Fryer",offer_url:"https://affiliate.shopee.co.th/offer/product_offer/26570814201",image_url:"https://down-th.img.susercontent.com/file/result.jpg",mall:true,channel:"shopee_video",price_min_thb:3899,price_max_thb:3899,sold:1200,commission_pct:6.5,commission_thb_per_order:236.02,ranking_score:.92,observed_at:new Date(now-1000).toISOString(),trust_basis:["mall"]},
        {product_id:"29688405992",name:"Anker Power Bank 20K",offer_url:"https://affiliate.shopee.co.th/offer/product_offer/29688405992",image_url:null,mall:true,channel:"shopee_video",price_min_thb:3899,price_max_thb:3999,sold:890,commission_pct:8,commission_thb_per_order:311.92,ranking_score:.87,observed_at:new Date(now-1000).toISOString(),trust_basis:["mall"]},
      ]};
    const snapshot={ok:true,connected:true,extension_version:"0.11.0",runs:[
      {trace_id:"a".repeat(16),swarm_id:"b".repeat(16),invocation_number:1,query:"ทีวี",stage:"completed",status:"completed",updated_at_unix_ms:now-1000,elapsed_ms:1200,success:true,effective:true,cache_hit:false,response_tokens_estimate:480,latency_ms:{total:1200,queue_wait_ms:3},browser_operations:{scan:1,scan_read:1,detail:2},dashboard},
      {trace_id:"c".repeat(16),swarm_id:"b".repeat(16),invocation_number:2,query:"ทีวี",stage:"detail_check",status:"running",updated_at_unix_ms:now,elapsed_ms:340,candidate_index:2,candidate_count:5,product_name:"Smart TV",browser_operations:{scan:1}},
    ],developer_logs:[
      {event_id:"1".repeat(16),trace_id:"a".repeat(16),actor:"agent",source:"mcp.client",operation:"rank_affiliate_products",phase:"started",status:"ok",message:"Agent called an MCP tool",detail:'{"query":"ทีวี","freshness":"live"}',progress_pct:0,occurred_at_unix_ms:now-500,elapsed_ms:0},
      {event_id:"2".repeat(16),trace_id:"a".repeat(16),actor:"code",source:"shopkud_mcp.server",operation:"rank_affiliate_products",phase:"completed",status:"ok",message:"Returned result to Agent",detail:'{"ok":true,"results_count":16,"winner":{"product_id":"26570814201","name":"Philips NA331 Air Fryer","commission_pct":6.5,"commission_thb_per_order":236.02}}',media:["https://down-th.img.susercontent.com/file/result.jpg"],progress_pct:100,occurred_at_unix_ms:now,elapsed_ms:340},
    ]};
    globalThis.chrome={runtime:{getManifest:()=>({version:"0.11.0"}),onMessage:{addListener(fn){listeners.push(fn);}},async sendMessage(message){if(message.type==="shopkud-live-clear"){snapshot.runs=snapshot.runs.filter(run=>run.status==="running");}if(message.type==="shopkud-live-clear-logs")snapshot.developer_logs=[];return snapshot;}},storage:{local:{async get(key){return{[key]:stored[key]};},async set(value){Object.assign(stored,value);}}}};
  });
  await page.goto(pathToFileURL(path.join(__dirname,"../extension/sidepanel.html")).href);
  await page.waitForSelector("#now-content:not([hidden])");
  assert.equal(await page.locator("#now-empty .ready-mascot use").getAttribute("href"),"#shopkud-mascot","idle state uses the recognizable ShopKud mascot instead of an ambiguous placeholder");
  assert.equal(await page.locator("#connection").getAttribute("data-state"),"online");
  assert.equal(await page.locator("#now-query").textContent(),"ทีวี");
  assert.match(await page.locator("#now-stage").textContent(),/ตรวจสินค้ารายตัว/u);
  assert.equal(await page.locator('#journey li[data-key="detail"]').getAttribute("data-state"),"active");
  assert.equal(await page.locator("#now-percent").textContent(),"68%");
  assert.equal(await page.locator("#research-result").isVisible(),true);
  assert.equal(await page.locator("#winner-name").textContent(),"Philips NA331 Air Fryer");
  assert.match(await page.locator("#winner-reason").textContent(),/สมดุลค่าคอม/u);
  assert.match(await page.locator("#winner-reason").textContent(),/รอ Agent ตรวจ/u);
  assert.match(await page.locator(".winner-rank").textContent(),/อันดับ 1 ตามเกณฑ์/u);
  assert.equal(await page.locator("#shortlist-list .product-row").count(),1);
  assert.match(await page.locator("#evidence-chips").textContent(),/อ่านสดจาก Shopee.*3 หน้า.*42 สินค้า/u);
  assert.match(await page.locator("#coverage-summary").textContent(),/ครบขอบเขต/u);
  await page.locator("#winner-save").click();
  assert.equal(await page.locator("#saved-count").textContent(),"1");
  await page.locator('[data-view-target="saved"]').click();
  assert.equal(await page.locator("#saved-list .product-row").count(),1);
  assert.equal(await page.locator("#saved-list .row-name").textContent(),"Philips NA331 Air Fryer");
  await page.locator('[data-view-target="live"]').click();
  assert.equal(await page.locator("#success-rate").textContent(),"100%");
  assert.equal(await page.locator("#success-gauge").evaluate(node=>node.style.getPropertyValue("--score")),"100");
  assert.equal(await page.locator("#effective-gauge").evaluate(node=>node.style.getPropertyValue("--score")),"100");
  assert.equal(await page.locator("#cache-gauge").evaluate(node=>node.style.getPropertyValue("--score")),"0");
  assert.equal(await page.locator("#success-gauge .gauge-ring").evaluate(node=>getComputedStyle(node).getPropertyValue("--score")),"100","gauge ring inherits real metric value");
  assert.equal(await page.locator("#p95-bar").evaluate(node=>node.style.width),"100%");
  assert.notEqual(await page.locator("#latency-line").getAttribute("points"),"");
  assert.equal(await page.locator(".run-item").count(),2);
  assert.equal(await page.locator(".console-line").count(),2);
  assert.match(await page.locator(".console-line").first().textContent(),/AGENT.*rank_affiliate_products.*ทีวี/u);
  assert.match(await page.locator(".console-line").nth(1).textContent(),/CODE.*100%.*rank_affiliate_products.*Returned result to Agent.*Philips NA331 Air Fryer.*commission_pct.*6\.5.*shopkud_mcp\.server/u);
  assert.equal(await page.locator(".console-line").nth(1).locator(".console-media img").count(),1);
  assert.equal(await page.locator("#developer-log-count").textContent(),"2 lines");
  assert.equal(await page.locator("#follow-logs").getAttribute("aria-pressed"),"true");
  assert.match(await page.locator(".run-item").nth(1).locator(".run-facts").textContent(),/ผล สำเร็จ.*ผู้ชนะ ได้/u);
  assert.match(await page.locator(".run-item").nth(1).locator(".operation-legend").textContent(),/สแกน 1.*อ่าน 1.*ตรวจจริง 2/u);
  assert.equal(await page.locator("#latency-single").isVisible(),true);
  assert.equal(await page.locator(".latency-viz svg").isVisible(),false);
  assert.equal(await page.locator("body").evaluate(node=>node.scrollWidth<=node.clientWidth),true,"no horizontal overflow at side-panel width");
  const reviewDir=path.resolve(process.env.SHOPKUD_TEST_OUTPUT_DIR||path.join(__dirname,"../artifacts/tests"));fs.mkdirSync(reviewDir,{recursive:true});
  await page.locator('[data-view-target="research"]').click();
  await page.screenshot({path:path.join(reviewDir,"research-sidepanel.png"),fullPage:true,animations:"disabled"});
  await page.emulateMedia({colorScheme:"dark"});
  await page.screenshot({path:path.join(reviewDir,"research-sidepanel-dark.png"),fullPage:true,animations:"disabled"});
  for(const colorScheme of ["light","dark"]){
    await page.emulateMedia({colorScheme});
    for(const width of [320,390,780]){
      await page.setViewportSize({width,height:844});
      for(const view of ["research","saved","live"]){
        await page.locator(`[data-view-target="${view}"]`).click();
        assert.equal(await page.locator("body").evaluate(node=>node.scrollWidth<=node.clientWidth),true,`${view} has no horizontal overflow at ${width}px in ${colorScheme}`);
      }
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({colorScheme:"light"});
  await page.locator('[data-view-target="live"]').click();
  await page.screenshot({path:path.join(reviewDir,"live-sidepanel.png"),fullPage:true,animations:"disabled"});
  await page.locator("#clear-completed").click();
  assert.equal(await page.locator(".run-item").count(),1);
  await page.locator("#clear-logs").click();
  assert.equal(await page.locator(".console-line").count(),0);
  assert.deepEqual(pageErrors,[],"no runtime errors");
  await browser.close();
  console.log(JSON.stringify({ok:true,checks:["research, save, and live interactions","metric ring inherits real value","all tabs at 320/390/780px in light/dark have no horizontal overflow","completed traces can be cleared","no runtime errors"]}));
}
run().catch(error=>{console.error(error);process.exitCode=1;});
