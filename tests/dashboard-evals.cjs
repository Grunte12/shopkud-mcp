"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {chromium} = require("playwright");

function fixture() {
  const now = Date.now();
  const products = [
    {product_id:"10001",name:"Smart TV 55 นิ้ว · 4K Google TV",shop_name:"Official TV Store",price_min_thb:9990,price_max_thb:9990,sold:2100,commission_pct:6.5,commission_thb_per_order:649.35,mall:true,ranking_score:.93,commission_channels:[
      {channel:"social",commission_pct:0,commission_thb_per_order:0,extra_commission_pct:0,shopee_commission_pct:0},
      {channel:"shopee_live",commission_pct:7.5,commission_thb_per_order:749.25,extra_commission_pct:2.5,shopee_commission_pct:5},
      {channel:"shopee_video",commission_pct:null,commission_thb_per_order:null,extra_commission_pct:null}
    ]},
    {product_id:"10002",name:"Smart TV 50 นิ้ว · จอ 4K HDR",shop_name:"Home Electronics",price_min_thb:7990,price_max_thb:7990,sold:3400,commission_pct:6,commission_thb_per_order:479.4,mall:true,ranking_score:.88},
    {product_id:"10003",name:"QLED TV 55 นิ้ว · สีสันคมชัด",shop_name:null,price_min_thb:12990,price_max_thb:12990,sold:1400,commission_pct:7,commission_thb_per_order:909.3,mall:true,ranking_score:.85},
    {product_id:"10004",name:"Smart TV 43 นิ้ว · สำหรับห้องเล็ก",shop_name:"Everyday Tech",price_min_thb:5990,price_max_thb:5990,sold:5600,commission_pct:5,commission_thb_per_order:299.5,mall:false,ranking_score:.82}
  ].map(product => ({...product,offer_url:`https://affiliate.shopee.co.th/offer/product_offer/${product.product_id}`,image_url:`https://down-th.img.susercontent.com/file/fixture-${product.product_id}`,channel:"social",observed_at:new Date(now-30000).toISOString()}));
  const dashboard = {schema_version:1,query:"ทีวี 4K สำหรับห้องนั่งเล่น",channel:"social",freshness:"live",cache_hit:false,cache_age_ms:0,partial_market_coverage:false,criteria:{ranking_goal:"balanced",min_sold:500},winner_product_id:"10001",observed_at:new Date(now-30000).toISOString(),scan:{pages_scanned:3,unique_products:42,reached_end:true,outcome:"completed"},exclusions:{sold_below_minimum:8,missing_fields:3},results:products};
  const report = {schema_version:1,report_id:"e".repeat(16),query:dashboard.query,status:"completed",stage:"recommendation",headline:"จอใหญ่ ใช้ง่าย เป็นจุดตัดสินใจหลัก",summary:"กลุ่มที่กำลังเปลี่ยนทีวีให้ความสำคัญกับขนาดจอ ระบบที่ใช้ง่าย และความคุ้มค่า ควรเทียบรุ่น 50–55 นิ้วในงบใกล้เคียงกันก่อนเลือก",purchase_intent:"กำลังเปรียบเทียบรุ่นและราคาเพื่อเปลี่ยนทีวีเครื่องเดิม ไม่ใช่แค่ดูไอเดียแต่งห้อง",confidence:"medium",updated_at_unix_ms:now-40000,signals:[
    {kind:"trend",label:"ความสนใจทีวีจอใหญ่",value:"มีสัญญาณบวก",score:78,rationale:"ความสนใจการค้นเพิ่มขึ้นในกลุ่มคำเกี่ยวกับทีวี 55 นิ้ว",source_indexes:[0]},
    {kind:"purchase_intent",label:"ความพร้อมตัดสินใจซื้อ",value:"เน้นเทียบรุ่นและราคา",score:84,rationale:"คำถามเรื่องราคาและรุ่นที่เหมาะกับห้อง บ่งชี้ว่ากำลังเลือกซื้อ",source_indexes:[1]},
    {kind:"competition",label:"การแข่งขันในกลุ่ม",value:"หลายรุ่นใกล้เคียงกัน",score:62,rationale:"ควรดูค่าคอมและยอดขายควบคู่ ไม่เลือกจากขนาดจออย่างเดียว",source_indexes:[1]},
    {kind:"trust",label:"การบริการหลังการขาย",value:"ต้องตรวจเพิ่ม",score:null,rationale:"ยังไม่มีหลักฐานเพียงพอเปรียบเทียบการรับประกันของทุกร้าน",source_indexes:[]}
  ],citations:[{title:"Google Trends · TV 55 นิ้ว",url:"https://trends.google.com/trends/explore?geo=TH&q=TV"},{title:"ข้อมูลพฤติกรรมการเลือกซื้อ",url:"https://www.thinkwithgoogle.com/consumer-insights/consumer-trends/"}]};
  return {ok:true,connected:true,extension_version:"0.11.0",research_reports:[report],runs:[
    {trace_id:"a".repeat(16),invocation_number:1,query:dashboard.query,stage:"completed",status:"completed",updated_at_unix_ms:now-30000,elapsed_ms:4200,success:true,effective:true,cache_hit:false,latency_ms:{total:4200},browser_operations:{scan:3,scan_read:3,detail:4},dashboard},
    {trace_id:"b".repeat(16),invocation_number:2,query:dashboard.query,stage:"detail_check",status:"running",updated_at_unix_ms:now,elapsed_ms:1800,candidate_index:3,candidate_count:4,browser_operations:{scan:1,detail:3}}
  ],developer_logs:[
    {event_id:"1",actor:"agent",operation:"rank_affiliate_products",message:"Agent requested product research",detail:'{"query":"ทีวี 4K","ranking_goal":"balanced"}',occurred_at_unix_ms:now-45000},
    {event_id:"2",actor:"code",operation:"rank_affiliate_products",message:"Returned verified result to Agent",detail:'{"winner_product_id":"10001","products":4,"commission_thb_per_order":649.35}',occurred_at_unix_ms:now-30000}
  ]};
}

async function run() {
  const browser = await chromium.launch({headless:true,executablePath:process.env.SHOPKUD_TEST_CHROMIUM});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1100},colorScheme:"light"});
    const errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    const snapshot=fixture();
    await page.addInitScript(initial => {
      let current=initial;
      const listeners=[],storageListeners=[],stored={};
      globalThis.__messages=[];
      globalThis.__storage=stored;
      globalThis.__trackerOK=true;
      globalThis.__storageFail=false;
      globalThis.__pushSnapshot=value=>{current=value;listeners.forEach(fn=>fn({type:"shopkud-live-update",snapshot:current}));};
      globalThis.__storagePush=value=>{stored.shopkudSavedProducts=value;storageListeners.forEach(fn=>fn({shopkudSavedProducts:{newValue:value}},"local"));};
      globalThis.chrome={runtime:{onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:async message=>{
        globalThis.__messages.push(message);
        if(message.type==="shopkud-open-tracker") return {ok:globalThis.__trackerOK};
        if(message.type==="shopkud-live-clear") current.runs=current.runs.filter(run=>run.status==="running");
        if(message.type==="shopkud-live-clear-logs") current.developer_logs=[];
        return current;
      }},storage:{local:{get:async key=>({[key]:stored[key]}),set:async value=>{if(globalThis.__storageFail)throw new Error("quota");Object.assign(stored,value);}},onChanged:{addListener:fn=>storageListeners.push(fn)}}};
    },snapshot);
    // Deterministic product pictures: synthetic test artwork only, no live network calls.
    await page.route("https://**/*",async route=>{
      if(route.request().url().startsWith("https://down-th.img.susercontent.com/file/fixture-")) {
        const id=route.request().url().slice(-1),colors={1:["#d48255","#7489a1"],2:["#8698c5","#c995b0"],3:["#698c9c","#b4b898"],4:["#e5aa78","#9c9dd3"]}[id]||["#759aad","#d6c3a7"];
        return route.fulfill({contentType:"image/svg+xml",body:`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="300" viewBox="0 0 420 300"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="#f8dec1"/></linearGradient></defs><rect width="420" height="300" fill="#fff"/><rect x="33" y="48" width="354" height="204" rx="5" fill="#24252d"/><rect x="39" y="54" width="342" height="192" fill="url(#sky)"/><path d="M39 182 116 102 173 157 230 80 316 170 381 132v114H39Z" fill="${colors[1]}"/><path d="m181 132 49-52 37 43-28-9-13 15-16-10Z" fill="#f3ece5"/><path d="M39 207q80-27 171-7t171-11v57H39Z" fill="#34494f"/><path d="m95 250-12 24m242-24 12 24" fill="none" stroke="#33343a" stroke-width="7" stroke-linecap="round"/></svg>`});
      }
      return route.abort();
    });
    await page.goto(pathToFileURL(path.join(__dirname,"../extension/dashboard.html")).href);
    await page.waitForSelector("#winner:not([hidden])");
    await page.locator("#winner-image").waitFor({state:"visible"});
    assert.equal(await page.locator("#query-heading").textContent(),snapshot.runs[0].dashboard.query);
    assert.equal(await page.locator("#winner-name").textContent(),snapshot.runs[0].dashboard.results[0].name);
    assert.equal(await page.locator("#winner-shop").textContent(),"Official TV Store");
    assert.equal(await page.locator("#winner-open").getAttribute("href"),"https://affiliate.shopee.co.th/offer/product_offer/10001");
    assert.equal(await page.locator("#comparison-grid .product-card").count(),4);
    const commissionCard=page.locator('#comparison-grid [data-product-id="10001"]');
    const commissionDetails=commissionCard.locator(".commission-breakdown");
    assert.equal(await commissionDetails.count(),1,"channel breakdown is only present when channel rows exist");
    assert.equal(await commissionCard.locator(".product-metrics > div").count(),4,"channel breakdown keeps the four summary metrics");
    assert.equal(await commissionCard.locator(".product-metrics dt").nth(1).textContent(),"คอม Social","the primary metric names the requested channel");
    assert.equal(await commissionDetails.evaluate(node=>node.open),false,"channel breakdown starts collapsed");
    assert.equal(await page.locator('#comparison-grid [data-product-id="10002"] .commission-breakdown').count(),0,"cards without channel data stay concise");
    assert.match(await commissionDetails.locator("summary").textContent(),/คุ้มสุด · Shopee Live/u);
    assert.match(await commissionDetails.locator("summary").textContent(),/฿749\.25\/ออเดอร์/u);
    assert.match(await commissionDetails.locator("summary").textContent(),/กดเทียบ 3 ช่องทาง/u);
    assert.equal(await commissionDetails.locator("table").count(),0,"channel comparison is a decision summary, not a copy of Shopee's table");
    await commissionDetails.locator("summary").focus();
    await page.keyboard.press("Enter");
    assert.equal(await commissionDetails.evaluate(node=>node.open),true,"native disclosure works from the keyboard");
    assert.equal(await commissionCard.locator(".commission-channel").count(),3);
    assert.deepEqual(await commissionCard.locator(".commission-channel-name").allTextContents(),["Shopee Live","Social","Shopee Video"],"channels are sorted by estimated THB per order");
    assert.equal(await commissionCard.locator(".commission-channel-best").count(),1,"best known estimate is highlighted once");
    assert.equal(await commissionCard.locator('.commission-channel[data-best="true"] .commission-channel-name').textContent(),"Shopee Live");
    assert.equal(await commissionCard.locator('[data-channel="social"] .commission-channel-total').textContent(),"รวม 0%","zero total percent remains zero");
    assert.match(await commissionCard.locator('[data-channel="social"] .commission-channel-estimate').textContent(),/0/u,"zero THB estimate remains zero");
    assert.equal(await commissionCard.locator('[data-channel="social"] .commission-channel-components').textContent(),"ค่าคอมเพิ่ม 0% + Shopee 0%","zero split rates remain zero");
    assert.equal(await commissionCard.locator('[data-channel="shopee_video"] .commission-channel-total').textContent(),"รวม ไม่ทราบ");
    assert.equal(await commissionCard.locator('[data-channel="shopee_video"] .commission-channel-estimate').textContent(),"ประมาณ ไม่ทราบ/ออเดอร์");
    assert.equal(await commissionCard.locator('[data-channel="shopee_video"] .commission-channel-components').textContent(),"ค่าคอมเพิ่ม ไม่ทราบ + Shopee ไม่ทราบ","missing values stay unknown instead of becoming zero");
    assert.equal(await commissionDetails.evaluate(node=>node.scrollWidth<=node.clientWidth),true,"expanded channel details fit inside the card");
    const commissionReview=path.join(__dirname,"../.impeccable/review");fs.mkdirSync(commissionReview,{recursive:true});
    await commissionCard.screenshot({path:path.join(commissionReview,"commission-card-expanded.png"),animations:"disabled"});
    await page.keyboard.press("Enter");
    assert.equal(await commissionDetails.evaluate(node=>node.open),false);
    await page.setViewportSize({width:1024,height:1100});
    await commissionDetails.locator("summary").focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,"expanded channel details do not cause page overflow at 1024px");
    assert.equal(await commissionDetails.evaluate(node=>node.scrollWidth<=node.clientWidth),true,"expanded channel details fit inside a narrow card");
    await page.keyboard.press("Enter");
    await page.setViewportSize({width:1440,height:1100});
    assert.equal(await page.locator("#signals .signal-score").count(),3);
    assert.equal((await page.locator("#signals").textContent()).includes("ไม่ทราบทิศทาง"),false,"missing direction is omitted rather than invented");
    assert.equal(await page.locator("#signals .citation").first().getAttribute("href"),snapshot.research_reports[0].citations[0].url);
    assert.equal(await page.locator("#report-citations .citation").count(),2);
    assert.match(await page.locator("#report-confidence").textContent(),/Agent.*ปานกลาง/u);
    assert.equal(await page.locator('[data-stage="detail"]').getAttribute("data-state"),"active");
    assert.match(await page.locator("#unknowns").textContent(),/ชื่อร้าน/u);
    assert.equal(await page.locator("#view-research .workspace-label").textContent(),"พื้นที่ทำงานคัดสินค้า Affiliate");
    const crossCategory=structuredClone(snapshot);
    const alternate=crossCategory.runs[0].dashboard;
    alternate.query="สมาร์ตโฟนถ่ายวิดีโอ งบไม่เกิน 15,000";
    alternate.winner_product_id="20001";
    alternate.results=[{...alternate.results[0],product_id:"20001",name:"สมาร์ตโฟนกล้องกันสั่น · 5G",shop_name:"Mobile Official Store",price_min_thb:14990,price_max_thb:14990,commission_thb_per_order:749.5,offer_url:"https://affiliate.shopee.co.th/offer/product_offer/20001",image_url:"https://down-th.img.susercontent.com/file/fixture-20001"}];
    crossCategory.runs[0].query=alternate.query;
    crossCategory.research_reports[0].query=alternate.query;
    crossCategory.research_reports[0].headline="กล้องและแบตคือจุดตัดสินใจหลัก";
    await page.evaluate(value=>__pushSnapshot(value),crossCategory);
    assert.equal(await page.locator("#query-heading").textContent(),alternate.query,"one static shell renders a different product category");
    assert.equal(await page.locator("#winner-name").textContent(),alternate.results[0].name);
    assert.equal(await page.locator("#comparison-grid .product-card").count(),1);
    await page.evaluate(value=>__pushSnapshot(value),snapshot);
    assert.equal(await page.locator("#query-heading").textContent(),snapshot.runs[0].dashboard.query,"the same shell returns to the original category");
    await page.locator("#more-signals summary").click();
    assert.equal(await page.locator("#additional-signals .signal-score").count(),0,"unknown scores have no invented chart");
    await page.locator("#more-signals summary").click();
    await page.locator("#comparison-sort").selectOption("commission");
    assert.equal(await page.locator("#comparison-grid .product-card").first().getAttribute("data-product-id"),"10003");
    await page.locator("#comparison-sort").selectOption("rank");
    await page.locator("#winner-save").click();
    assert.equal(await page.locator("#saved-count").textContent(),"1");
    assert.equal(await page.locator("#winner-save").getAttribute("aria-pressed"),"true");
    assert.equal(await page.evaluate(()=>__storage.shopkudSavedProducts.length),1);
    await page.locator("#tab-saved").click();
    assert.equal(await page.locator("#saved-grid .product-card").count(),1);
    assert.match(await page.locator("#saved-grid").textContent(),/ข้อมูล ณ เวลาที่บันทึก/u);
    await page.locator("#tab-live").click();
    assert.equal(await page.locator("#log-list .log-line").count(),2);
    assert.match(await page.locator("#log-list").textContent(),/Returned verified result to Agent/u);
    assert.match(await page.locator("#live-metrics").textContent(),/100%/u);
    await page.locator("#open-tracker").click();
    assert.equal(await page.evaluate(()=>__messages.some(message=>message.type==="shopkud-open-tracker")),true);
    await page.evaluate(()=>{__trackerOK=false;});
    await page.locator("#open-tracker").click();
    assert.match(await page.locator("#notice").textContent(),/เปิดตัวติดตามอัตโนมัติไม่ได้/u);
    for(const theme of ["light","dark"]) {
      await page.emulateMedia({colorScheme:theme});
      for(const width of [1024,1280,1440]) {
        await page.setViewportSize({width,height:1100});
        for(const tab of ["research","saved","live"]) {
          await page.locator(`#tab-${tab}`).click();
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${tab}: no page overflow at ${width}px ${theme}`);
        }
      }
    }
    await page.locator("#tab-research").click();
    await page.evaluate(()=>{document.querySelector("#notice").hidden=true;});
    await page.waitForFunction(()=>[...document.querySelectorAll("#comparison-grid img")].every(image=>image.complete && image.naturalWidth>0 && !image.hidden));
    assert.equal(await page.locator("#comparison-grid .product-picture").evaluateAll(pictures=>pictures.every(picture=>{
      const image=picture.querySelector("img"),frame=picture.getBoundingClientRect(),bounds=image.getBoundingClientRect();
      return bounds.height<=frame.height && bounds.width<=frame.width;
    })),true,"comparison images fit within their picture frame without intrinsic-grid cropping");
    const review=path.join(__dirname,"../.impeccable/review");fs.mkdirSync(review,{recursive:true});
    await page.emulateMedia({colorScheme:"light"});
    await page.screenshot({path:path.join(review,"dashboard-light.png"),fullPage:true,animations:"disabled"});
    await page.emulateMedia({colorScheme:"dark"});
    await page.reload();
    await page.waitForSelector("#winner:not([hidden])");
    await page.locator("#winner-image").waitFor({state:"visible"});
    await page.waitForFunction(()=>[...document.querySelectorAll("#comparison-grid img")].every(image=>image.complete && image.naturalWidth>0 && !image.hidden));
    assert.equal(await page.locator("#winner-image").evaluate(image=>image.complete&&image.naturalWidth>0),true,"dark-first load renders the winner image");
    await page.locator("#winner-save").click();
    await page.screenshot({path:path.join(review,"dashboard-dark.png"),fullPage:true,animations:"disabled"});
    const unsafe=structuredClone(snapshot);
    unsafe.research_reports[0].headline='<img src=x onerror="alert(1)">';
    unsafe.research_reports[0].citations=[{title:"Unsafe script",url:"javascript:alert(1)"},{title:"Credentials",url:"https://user:secret@example.com"},{title:"Safe source",url:"https://example.com/research"}];
    unsafe.research_reports[0].signals[0].source_indexes=[0,1,2,-1,99];
    unsafe.runs[0].dashboard.results[0].offer_url="javascript:alert(1)";
    unsafe.runs[0].dashboard.results[0].image_url="https://untrusted.example/image";
    unsafe.runs[0].dashboard.results[0].sold=null;
    await page.evaluate(value=>__pushSnapshot(value),unsafe);
    assert.equal(await page.locator("#report-headline img").count(),0,"untrusted strings are text, not HTML");
    assert.equal(await page.locator("#winner-open").getAttribute("href"),null,"unsafe product link disabled");
    assert.equal(await page.locator("#winner-image").getAttribute("src"),null,"unapproved image host rejected");
    assert.equal(await page.locator("#winner-sold").textContent(),"ไม่ทราบ","missing number is not zero");
    assert.equal(await page.locator("#report-citations a").count(),1);
    assert.equal(await page.locator("#signals .signal").first().locator("a").count(),1);
    assert.equal(await page.locator('a[href^="javascript:"]').count(),0);
    const mismatched=structuredClone(snapshot);mismatched.research_reports[0].query="เครื่องฟอกอากาศ";mismatched.research_reports[0].updated_at_unix_ms=Date.now()+1000;
    await page.evaluate(value=>__pushSnapshot(value),mismatched);
    assert.equal(await page.locator("#winner").isVisible(),false,"different research queries are not combined");
    assert.equal(await page.locator("#comparison-section").isVisible(),false);
    const noReport=structuredClone(snapshot);noReport.research_reports=[];
    await page.evaluate(value=>__pushSnapshot(value),noReport);
    assert.equal(await page.locator("#market-empty").isVisible(),true);
    assert.equal(await page.locator("#winner").isVisible(),true,"Shopee evidence remains usable without report");
    const failed=structuredClone(noReport);failed.runs[1].status="failed";failed.runs[1].stage="failed";
    await page.evaluate(value=>__pushSnapshot(value),failed);
    assert.match(await page.locator("#journey-status").textContent(),/งานล่าสุดหยุดเพราะพบปัญหา/u);
    await page.evaluate(value=>__pushSnapshot(value),noReport);
    await page.evaluate(()=>{__storageFail=true;});
    await page.locator("#winner-save").click();
    assert.equal(await page.locator("#saved-count").textContent(),"1","failed save does not discard local state");
    assert.match(await page.locator("#notice").textContent(),/บันทึกไม่สำเร็จ/u);
    await page.evaluate(()=>{__storageFail=false;__storagePush([]);});
    assert.equal(await page.locator("#saved-count").textContent(),"0","saved state syncs from other extension views");
    await page.locator("#tab-research").focus();await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#tab-saved").getAttribute("aria-selected"),"true");
    await page.locator("#tab-live").click();
    await page.locator("#clear-completed").click();
    assert.equal(await page.locator("#run-list .run").count(),1);
    await page.locator("#clear-logs").click();
    assert.equal(await page.locator("#log-list .log-line").count(),0);
    await page.emulateMedia({reducedMotion:"reduce"});
    assert.equal(await page.locator("#tab-live").evaluate(node=>getComputedStyle(node).transitionDuration),"0s");
    await page.evaluate(()=>__pushSnapshot({ok:true,connected:false,runs:[],research_reports:[],developer_logs:[]}));
    await page.locator("#tab-research").click();
    assert.equal(await page.locator("#product-empty").isVisible(),true);
    assert.equal(await page.locator("#connection").getAttribute("data-connected"),"false");
    assert.deepEqual(errors,[],"no runtime errors");
    console.log(JSON.stringify({ok:true,checks:["generic shell + cross-category rerender","research + cited signals","safe links and untrusted text","real and unknown product fields","comparison sorting","shared Saved + storage failure","tracker success/fallback","Agent Live + clearing","keyboard tabs + reduced motion","no overflow at 1024/1280/1440 light/dark","empty and disconnected states","no runtime errors"],screenshots:["dashboard-light.png","dashboard-dark.png"]}));
  } finally {await browser.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
