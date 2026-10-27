"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {chromium} = require("playwright");

const ROOT = path.resolve(__dirname, "../extension");
const DASHBOARD_URL = "http://shopkud.test/dashboard.html";
const OUT = process.env.SHOPKUD_SOCIAL_QA_DIR || "/tmp/shopkud-social-qa";
const SOCIAL_KEY = "shopkudSocialLinks";
const RECEIPT_KEY = "shopkudLinkReceipts";
const platforms = ["facebook", "x", "tiktok", "youtube", "instagram", "threads", "line", "shopee_video"];
const receipts = [
  {product_id:"41001",affiliate_url:"https://s.shopee.co.th/SocialA",sub_ids:["facebook","spring"],status:"confirmed",created_at:"2026-10-25T10:00:00.000Z"},
  {product_id:"41001",affiliate_url:"https://s.shopee.co.th/SocialB",channel:"instagram",sub_ids:["instagram","spring"],status:"confirmed",created_at:"2026-10-24T10:00:00.000Z"},
  {product_id:"41002",affiliate_url:"https://s.shopee.co.th/SocialC",channel:"tiktok",sub_ids:["tiktok"],status:"confirmed",created_at:"2026-10-23T10:00:00.000Z"}
];
const product = {product_id:"41001",name:"ขวดน้ำพกพา",shop_name:"ร้านตัวอย่าง"};
const REPORT_URL = "https://affiliate.shopee.co.th/report/click_report";
const report = (id, groups, total=groups.length) => ({
  ok:true,schema_version:1,source_url:REPORT_URL,period_start:"2026-10-01",period_end:"2026-10-26",
  observed_at:"2026-10-26T12:30:00.000Z",groups,visible_rows:groups.length,
  total_rows:total,coverage:"visible_page_only"
});

async function boot(page) {
  await page.addInitScript(seed => {
    const storageListeners=[],runtimeListeners=[];
    let values=JSON.parse(localStorage.getItem("__socialStorage")||"{}");
    values.shopkudLinkReceipts ??= seed.receipts;
    values.shopkudSavedProducts ??= [seed.product];
    let tabs=seed.tabs;
    const persist=()=>localStorage.setItem("__socialStorage",JSON.stringify(values));
    const notify=(changes)=>storageListeners.forEach(listener=>listener(changes,"local"));
    globalThis.__chromeStorage=values;
    globalThis.__clipboardText="";
    Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async value=>{globalThis.__clipboardText=value;},readText:async()=>globalThis.__clipboardText}});
    globalThis.__setAnalyticsTabs=next=>{tabs=next;};
    globalThis.__mockStorageFailure=enabled=>{globalThis.__storageFailure=enabled;};
    globalThis.__chromeStoragePush=(key,value)=>{const oldValue=values[key];values[key]=value;persist();notify({[key]:{oldValue,newValue:value}});};
    globalThis.__chromeStorage=values;
    globalThis.chrome={
      runtime:{id:"shopkud-test-extension",getURL:value=>`chrome-extension://shopkud/${value}`,onMessage:{addListener:fn=>runtimeListeners.push(fn)},sendMessage:async()=>({ok:true,connected:false,runs:[],research_reports:[],developer_logs:[]})},
      storage:{local:{get:async keys=>{if(globalThis.__storageFailure)throw Error("synthetic storage failure");if(Array.isArray(keys))return Object.fromEntries(keys.map(key=>[key,values[key]]));return {[keys]:values[keys]};},set:async update=>{if(globalThis.__storageFailure)throw Error("synthetic storage failure");const changes={};for(const [key,value] of Object.entries(update)){changes[key]={oldValue:values[key],newValue:value};values[key]=value;}persist();notify(changes);}},onChanged:{addListener:fn=>storageListeners.push(fn)}},
      tabs:{query:async()=>tabs.map(tab=>({id:tab.id})),sendMessage:async id=>tabs.find(tab=>tab.id===id)?.response||null,create:async()=>({id:999})}
    };
  },{receipts,product,tabs:[]});
  await page.route("https://**/*",route=>route.abort());
  await page.route("http://shopkud.test/**",route=>{
    const file=path.resolve(ROOT,"."+new URL(route.request().url()).pathname);
    if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file))return route.abort();
    return route.fulfill({path:file});
  });
  await page.goto(DASHBOARD_URL);
  await page.waitForSelector("#social-platforms",{state:"attached"});
  await page.locator("#tab-social").click();
}

async function screenshot(page,name,{width,scheme,tab}) {
  await page.setViewportSize({width,height:1000});
  await page.emulateMedia({colorScheme:scheme});
  await page.locator(`#tab-${tab}`).click();
  if(tab==="social") await page.evaluate(()=>{
    document.querySelector("#social-search").value="";
    document.querySelector("#social-status").value="all";
    document.querySelector("#social-message").hidden=true;
    document.querySelector(".link-add").open=false;
    document.querySelector("#social-search").dispatchEvent(new Event("input",{bubbles:true}));
  });
  await page.screenshot({path:path.join(OUT,`synthetic-${name}-${scheme}-${width}.png`),fullPage:true,animations:"disabled"});
}

async function run() {
  fs.mkdirSync(OUT,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.SHOPKUD_TEST_CHROMIUM||chromium.executablePath()});
  const errors=[];
  try {
    const context=await browser.newContext({viewport:{width:1280,height:1000},colorScheme:"light"});
    const page=await context.newPage();
    page.on("pageerror",e=>errors.push(e.message));
    await boot(page);

    await page.locator("#tab-social").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#tab-analytics").getAttribute("aria-selected"),"true","arrow-key tab navigation reaches Analytics");
    await page.keyboard.press("ArrowLeft");
    assert.equal(await page.locator("#tab-social").getAttribute("aria-selected"),"true","arrow-key tab navigation returns to Social");
    assert.equal(await page.locator("#social-platforms .platform-filter").count(),10,"all, eight platforms, and unknown filter are rendered");
    assert.deepEqual(await page.locator("#social-platforms .platform-filter img.platform-icon").evaluateAll(nodes=>nodes.map(node=>node.getAttribute("src"))),platforms.map(id=>`platform-${id==="shopee_video"?"shopee":id}.svg`),"all eight platform filters have their matching icons");
    assert.equal(await page.locator("#social-links .social-link").count(),3,"distinct URLs for one product remain separate receipts");
    assert.equal(await page.locator("#social-links .social-link").filter({hasText:"สินค้า 41001"}).count(),2,"same product can have multiple receipt links");
    assert.equal(await page.locator("#social-links .social-link").first().locator(".platform-icon").count(),1,"receipt cards show a platform icon");
    assert.equal(await page.locator("#social-links").getByText(/ยังไม่ยืนยัน SubID หรือค่าคอม/u).count(),3,"receipt display does not claim analytics or commission evidence");

    await page.locator("#social-search").fill("SocialB");
    assert.equal(await page.locator("#social-links .social-link").count(),1,"search matches affiliate URL");
    await page.locator("#social-search").fill("");
    await page.locator("#social-platforms .platform-filter").filter({hasText:"Instagram"}).click();
    assert.equal(await page.locator("#social-links .social-link").count(),1,"platform filter narrows rows");
    await page.locator("#social-platforms .platform-filter").first().click();
    await page.locator("#social-links .social-link").first().getByRole("button",{name:"คัดลอกลิงก์"}).click();
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),"https://s.shopee.co.th/SocialA","copy button copies the selected receipt URL");

    await page.evaluate(()=>__mockStorageFailure(true));
    await page.locator("#social-links .social-link").first().getByRole("button",{name:"บันทึกว่าใช้แล้ว"}).click();
    assert.match(await page.locator("#social-message").textContent(),/บันทึกไม่สำเร็จ/u,"storage failure is surfaced clearly");
    assert.equal(await page.locator("#social-links .social-link").first().getByRole("button",{name:"บันทึกว่าใช้แล้ว"}).count(),1,"failed write does not falsely mark a link used");
    await page.evaluate(()=>__mockStorageFailure(false));
    await page.locator("#social-links .social-link").first().getByRole("button",{name:"บันทึกว่าใช้แล้ว"}).click();
    await page.waitForFunction(key=>globalThis.__chromeStorage[key]?.["https://s.shopee.co.th/SocialA"]?.used===true,SOCIAL_KEY);
    await page.reload();
    await page.locator("#tab-social").click();
    await page.waitForSelector("#social-links .social-link");
    assert.equal(await page.locator("#social-links .social-link").first().getByText("คุณบันทึกว่าใช้แล้ว").count(),1,"used state survives a reload");
    assert.match(await page.locator("#social-links .social-link").first().innerText(),/แนะนำจาก SubID โปรดตรวจ/u,"marking used does not turn inferred platform into owner confirmation");
    await page.locator("#social-status").selectOption("used");
    assert.equal(await page.locator("#social-links .social-link").count(),1,"used filter returns only explicitly used links");
    await page.locator("#social-status").selectOption("unused");
    assert.equal(await page.locator("#social-links .social-link").count(),2,"unused filter returns the other links");
    await page.locator("#social-status").selectOption("all");

    const add=page.locator("#social-add");
    await page.locator(".link-add summary").click();
    await add.locator('[name="name"]').fill("สินค้าเพิ่มเอง");
    await add.locator('[name="product_id"]').fill("41003");
    await add.locator('[name="url"]').fill("https://s.shopee.co.th/ManualLink");
    await add.locator('[name="platform"]').selectOption("youtube");
    await add.getByRole("button",{name:"บันทึกลิงก์เดิม"}).click();
    await page.waitForFunction(key=>Boolean(globalThis.__chromeStorage[key]?.["https://s.shopee.co.th/ManualLink"]),SOCIAL_KEY);
    assert.equal(await page.locator("#social-links .social-link").count(),4,"valid manual short link is saved");
    await add.locator('[name="name"]').fill("ลิงก์ไม่ปลอดภัย");
    await add.locator('[name="product_id"]').fill("41004");
    await add.locator('[name="url"]').fill("https://s.shopee.co.th/ManualLink?redirect=https://evil.example");
    await add.getByRole("button",{name:"บันทึกลิงก์เดิม"}).click();
    assert.match(await page.locator("#social-message").textContent(),/ใช้ลิงก์สั้น/u,"unsafe manual URL is rejected");
    assert.equal(await page.locator("#social-links .social-link").count(),4,"unsafe link is not persisted");

    await page.locator("#social-search").fill("no-such-product");
    assert.match(await page.locator("#social-links .empty-state").textContent(),/ไม่พบลิงก์ตามตัวกรอง/u,"filtered empty state is explained");
    await page.locator("#social-search").fill("");

    await page.locator("#tab-analytics").click();
    assert.equal(await page.locator("#analytics-result").isVisible(),false,"analytics is not fabricated from receipt records");
    await page.evaluate(()=>__setAnalyticsTabs([]));
    await page.locator("#analytics-refresh").click();
    assert.match(await page.locator("#analytics-message").textContent(),/เปิดรายงานคลิก Shopee/u,"zero readable report tabs prompts the user to open a report");

    const partial=report(1,[{sub_id:"facebook",referrer:"facebook.com",clicks:7},{sub_id:"instagram",referrer:"instagram.com",clicks:2}],12);
    const noGroups=report(2,[],0);
    await page.evaluate(({partial,noGroups})=>__setAnalyticsTabs([
      {id:11,response:partial},{id:12,response:noGroups},
      {id:13,response:{...partial,schema_version:2}},
      {id:14,response:{...partial,source_url:"https://evil.example/report"}},
      {id:15,response:{...partial,coverage:"all_pages"}}
    ]),{partial,noGroups});
    await page.locator("#analytics-refresh").click();
    assert.match(await page.locator("#analytics-message").textContent(),/พบหลายแท็บ/u,"multiple valid reports require explicit selection");
    assert.equal(await page.locator("#analytics-tabs option").count(),3,"only two valid report tabs plus prompt are listed");
    await page.locator("#analytics-tabs").selectOption("11");
    assert.equal(await page.locator("#analytics-groups tbody tr").count(),2,"selected report rows are rendered");
    assert.match(await page.locator("#analytics-provenance").textContent(),/2 แถว จาก 12 แถวในรายงาน/u,"partial visible-page coverage and total are distinct");
    assert.equal(await page.locator("#analytics-groups tbody tr").nth(0).locator("td").nth(2).textContent(),"7","click count comes from source report response");
    await page.locator("#analytics-tabs").selectOption("12");
    assert.match(await page.locator("#analytics-groups .empty-state").textContent(),/ไม่มีข้อมูล/u,"empty report is represented as empty, not zero activity certainty");
    assert.equal(await page.locator("#analytics-groups tbody tr").count(),0);
    await page.evaluate(value=>__setAnalyticsTabs([{id:11,response:value}]),partial);
    await page.locator("#analytics-refresh").click();
    assert.equal(await page.locator("#analytics-groups tbody tr").count(),2,"single valid report is selected automatically for evidence capture");

    for(const width of [1024,1440]){
      await screenshot(page,"social",{width,scheme:"light",tab:"social"});
      await screenshot(page,"social",{width,scheme:"dark",tab:"social"});
      await screenshot(page,"analytics",{width,scheme:"light",tab:"analytics"});
      await screenshot(page,"analytics",{width,scheme:"dark",tab:"analytics"});
      const overflow=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
      assert.ok(overflow.scroll<=overflow.client+1,`no horizontal overflow at ${width}px (${overflow.scroll}/${overflow.client})`);
    }
    await page.evaluate(()=>{
      __chromeStoragePush("shopkudSocialLinks",{});
      __chromeStoragePush("shopkudLinkReceipts",[]);
    });
    assert.match(await page.locator("#social-links .empty-state").textContent(),/ยังไม่มีลิงก์ที่บันทึกไว้/u,"empty Social library explains how links appear");
    await page.evaluate(()=>{__mockStorageFailure(true);__chromeStoragePush("shopkudSocialLinks",{});});
    assert.match(await page.locator("#social-message").textContent(),/อ่านข้อมูลที่เก็บไว้ไม่ได้/u,"storage read failure is surfaced clearly");
    assert.deepEqual(errors,[],"no uncaught page errors");
    console.log(`PASS social-dashboard: icons, receipts, copy, search/filter, persisted used-state, manual-link safety, analytics provenance/empty/multi-tab, keyboard nav, storage failure, responsive/no-overflow; screenshots: ${OUT}`);
  } finally { await browser.close(); }
}

run().catch(error=>{console.error(error);process.exitCode=1;});
