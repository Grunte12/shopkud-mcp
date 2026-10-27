"use strict";

// Offline contract tests for native affiliate search. Synthetic DOM only;
// network requests are aborted and no browser profile or live page is used.
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const CHROMIUM = process.env.SHOPKUD_TEST_CHROMIUM ||
  chromium.executablePath();
const SEARCH_JS = path.join(ROOT, "extension/search.js");
const QUERY = "ชาเขียว test";
const results = [];

const inputHTML = '<input class="ant-input" type="text" placeholder="ค้นหาสินค้าช้อปปี้ทั้งหมด">';
const initialRows = '<div class="product-row" data-id="old">ก่อนค้นหา</div>';

async function reset(page, { input = true, rows = initialRows } = {}) {
  await page.setContent(`<main>${input ? inputHTML : ""}<section id="rows">${rows}</section></main>`);
  await page.addScriptTag({ path: SEARCH_JS });
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());

    await reset(page);
    const successPromise = page.evaluate(async query => {
      const input = document.querySelector("input");
      const rows = document.querySelector("#rows");
      const observed = { input: [], keys: [], scan: [], scanAfterChanged: false };
      input.addEventListener("input", e => observed.input.push({ trusted: e.isTrusted, value: input.value }));
      input.addEventListener("keydown", e => observed.keys.push({ key: e.key, code: e.code, keyCode: e.keyCode, which: e.which }));
      input.addEventListener("keyup", e => observed.keys.push({ key: e.key, code: e.code, keyCode: e.keyCode, which: e.which }));
      input.addEventListener("keydown", e => {
        if (e.key === "Enter") setTimeout(() => { rows.innerHTML = '<div class="product-row" data-id="new">ผลลัพธ์ใหม่</div>'; }, 150);
      });
      const result = await ShopKudSearch.run({
        args: { query, start_page: 2, max_pages: 3, max_products: 25 },
        records: () => [...rows.querySelectorAll(".product-row")].map(r => ({ product_id: r.dataset.id, name: r.textContent })),
        selectionStates: () => [false, false], active: () => true, cancelled: () => false,
        scan: async args => {
          observed.scan.push(args);
          observed.scanAfterChanged = rows.textContent.includes("ผลลัพธ์ใหม่");
          return { ok: true, products: [] };
        },
      });
      return { result, observed };
    }, QUERY);
    const success = await successPromise;
    assert.equal(success.result.ok, true);
    assert.equal(success.result.query, QUERY);
    assert.equal(success.result.search_source, "native_affiliate_input_enter");
    assert.equal(success.result.search_confirmed, true);
    assert.deepEqual(success.observed.input.map(e => e.value), [QUERY]);
    assert.ok(success.observed.keys.some(e => e.key === "Enter" && e.code === "Enter" && e.keyCode === 13 && e.which === 13));
    assert.deepEqual(success.observed.scan, [{ start_page: 2, max_pages: 3, max_products: 25 }]);
    assert.equal(success.observed.scanAfterChanged, true, "bounded scan starts only after changed stable rows");
    results.push("native setter + Enter/13, changed stable results, and bounded scan forwarding");

    await reset(page);
    const duringLoading = await page.evaluate(async query => {
      const input=document.querySelector("input"), rows=document.querySelector("#rows");
      input.addEventListener("keydown", e=>{
        if(e.key!=="Enter")return;
        const spinner=document.createElement("div");spinner.className="ant-spin-spinning";spinner.textContent="Loading";document.body.append(spinner);
        rows.innerHTML='<div data-id="intermediate">ผลเก่าระหว่างโหลด</div>';
        setTimeout(()=>{rows.innerHTML='<div data-id="final">ผลสุดท้าย</div>';spinner.remove();},700);
      });
      return ShopKudSearch.run({args:{query,start_page:1,max_pages:1,max_products:5},
        records:()=>[...rows.children].map(r=>({product_id:r.dataset.id,name:r.textContent})),
        selectionStates:()=>[],active:()=>true,cancelled:()=>false,
        scan:async()=>({ok:true,scanned_id:rows.firstElementChild.dataset.id})});
    },QUERY);
    assert.equal(duringLoading.scanned_id,"final");
    results.push("intermediate stable rows are not scanned while Shopee loading indicator is visible");

    await page.setContent(`<main><span class="ant-input-search">${inputHTML}<button class="ant-input-search-button">ค้นหา</button></span><section id="rows">${initialRows}</section></main>`);
    await page.addScriptTag({ path: SEARCH_JS });
    const buttonSubmit = await page.evaluate(async query => {
      const input = document.querySelector("input");
      const button = document.querySelector("button");
      const rows = document.querySelector("#rows");
      let clicks = 0, enters = 0;
      button.addEventListener("click", () => {
        clicks++;
        setTimeout(() => { rows.innerHTML = '<div class="product-row" data-id="button">ผลลัพธ์จากปุ่ม</div>'; }, 100);
      });
      input.addEventListener("keydown", event => { if(event.key === "Enter") enters++; });
      const result = await ShopKudSearch.run({
        args: { query, start_page: 1, max_pages: 1, max_products: 5 },
        records: () => [...rows.children].map(row => ({product_id:row.dataset.id,name:row.textContent})),
        selectionStates: () => [], active: () => true, cancelled: () => false,
        scan: async () => ({ok:true}),
      });
      return {result, clicks, enters};
    }, QUERY);
    assert.equal(buttonSubmit.result.ok, true);
    assert.equal(buttonSubmit.result.search_source, "native_affiliate_search_button");
    assert.equal(buttonSubmit.clicks, 1);
    assert.equal(buttonSubmit.enters, 0);
    results.push("Ant Design search button is preferred over synthetic Enter");

    await page.setContent(`<main><span class="custom-search-input ant-input-group-wrapper ant-input-group-wrapper-lg"><span class="ant-input-wrapper ant-input-group"><span class="custom-search-input ant-input-affix-wrapper ant-input-affix-wrapper-lg">${inputHTML}</span><span class="ant-input-group-addon"><div>ค้นหา</div></span></span></span><section id="rows"></section></main>`);
    await page.addScriptTag({ path: SEARCH_JS });
    const liveAddon = await page.evaluate(async query => {
      const input = document.querySelector("input");
      const addon = document.querySelector(".ant-input-group-addon > div");
      const rows = document.querySelector("#rows");
      let clicks = 0, scans = 0;
      addon.addEventListener("click", () => {
        clicks++;
        setTimeout(() => { rows.innerHTML = '<div class="product-row" data-id="live">ผลลัพธ์จาก UI ปัจจุบัน</div>'; }, 100);
      });
      const result = await ShopKudSearch.run({
        args: { query, start_page: 1, max_pages: 1, max_products: 5 },
        records: () => [...rows.children].map(row => ({product_id:row.dataset.id,name:row.textContent})),
        selectionStates: () => [], active: () => true, cancelled: () => false,
        scan: async () => { scans++; return {ok:true}; },
      });
      return {result, clicks, scans};
    }, QUERY);
    assert.equal(liveAddon.result.ok, true);
    assert.equal(liveAddon.result.search_source, "native_affiliate_search_addon");
    assert.equal(liveAddon.clicks, 1);
    assert.equal(liveAddon.scans, 1);
    results.push("current Shopee ant-input-group-addon works even when the page starts empty");

    await reset(page, { input: false });
    const delayed = await page.evaluate(async query => {
      const rows = document.querySelector("#rows");
      let scanCalls = 0;
      setTimeout(() => {
        const input = document.createElement("input");
        input.className = "ant-input"; input.type = "text"; input.placeholder = "ค้นหาสินค้าช้อปปี้ทั้งหมด";
        document.querySelector("main").prepend(input);
        input.addEventListener("keydown", e => { if (e.key === "Enter") setTimeout(() => { rows.innerHTML = '<div class="product-row" data-id="later">พร้อมแล้ว</div>'; }, 100); });
      }, 200);
      const result = await ShopKudSearch.run({ args: { query, start_page: 1, max_pages: 1, max_products: 5 },
        records: () => [...rows.children].map(r => ({ product_id: r.dataset.id, name: r.textContent })),
        selectionStates: () => [], active: () => true, cancelled: () => false,
        scan: async () => { scanCalls++; return { ok: true }; } });
      return { result, scanCalls };
    }, QUERY);
    assert.equal(delayed.result.ok, true);
    assert.equal(delayed.scanCalls, 1);
    results.push("delayed search input availability");

    await reset(page);
    const remounted = await page.evaluate(async query => {
      const input = document.querySelector("input"), rows = document.querySelector("#rows");
      let scans = 0;
      input.addEventListener("keydown", event => {
        if(event.key!=="Enter")return;
        setTimeout(() => {
          const replacement=input.cloneNode();
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(replacement,query);
          input.replaceWith(replacement);
          rows.innerHTML='<div class="product-row" data-id="remounted">ผลหลัง Shopee สร้างช่องค้นใหม่</div>';
        },100);
      });
      const result=await ShopKudSearch.run({args:{query,start_page:1,max_pages:1,max_products:5},
        records:()=>[...rows.children].map(row=>({product_id:row.dataset.id,name:row.textContent})),
        selectionStates:()=>[],active:()=>true,cancelled:()=>false,
        scan:async()=>{scans++;return {ok:true};}});
      return {result,scans};
    },QUERY);
    assert.equal(remounted.result.ok,true);
    assert.equal(remounted.scans,1);
    results.push("Shopee search input remount keeps the same read-only search alive");

    await reset(page);
    const selected = await page.evaluate(async query => {
      const input = document.querySelector("input"); let inputs = 0, scans = 0;
      input.addEventListener("input", () => inputs++);
      const result = await ShopKudSearch.run({ args: { query, start_page: 1, max_pages: 1, max_products: 5 },
        records: () => [{ product_id: "p", name: "product" }], selectionStates: () => [true], active: () => true,
        cancelled: () => false, scan: async () => { scans++; return { ok: true }; } });
      return { result, inputs, scans, value: input.value };
    }, QUERY);
    assert.equal(selected.result.error, "navigation_blocked_by_selections");
    assert.equal(selected.inputs, 0); assert.equal(selected.scans, 0); assert.equal(selected.value, "");
    const unknownSelection = await page.evaluate(async query => ShopKudSearch.run({
      args: { query, start_page: 1, max_pages: 1, max_products: 5 }, records: () => [{ product_id: "p", name: "p" }],
      selectionStates: () => [null], active: () => true, cancelled: () => false, scan: async () => ({ ok: true }),
    }), QUERY);
    assert.equal(unknownSelection.error, "selection_state_unknown");
    results.push("selection states refuse before changing the search input");

    await reset(page);
    const duplicate = await page.evaluate(async query => {
      const duplicate = document.querySelector("input").cloneNode(); document.querySelector("main").prepend(duplicate);
      let scans = 0;
      const result = await ShopKudSearch.run({ args: { query, start_page: 1, max_pages: 1, max_products: 5 },
        records: () => [{ product_id: "p", name: "p" }], selectionStates: () => [], active: () => true,
        cancelled: () => false, scan: async () => { scans++; return { ok: true }; } });
      return { result, scans };
    }, QUERY);
    assert.equal(duplicate.result.error, "search_controls_ambiguous"); assert.equal(duplicate.scans, 0);
    results.push("duplicate search controls fail closed");

    await reset(page);
    const invalid = await page.evaluate(async () => {
      const invoke = args => ShopKudSearch.run({ args, records: () => [], selectionStates: () => [], active: () => true,
        cancelled: () => false, scan: async () => ({ ok: true }) });
      return [await invoke({ query: "   ", start_page: 1, max_pages: 1, max_products: 1 }),
        await invoke({ query: "x", start_page: 0, max_pages: 1, max_products: 1 }),
        await invoke({ query: "x", start_page: 1, max_pages: 21, max_products: 1 }),
        await invoke({ query: "x", start_page: 1, max_pages: 1, max_products: 1001 }),
        await invoke({ query: "x", start_page: 1, max_pages: 1, max_products: 1, extra: true })];
    });
    assert.ok(invalid.every(r => r.error === "invalid_input"));
    results.push("invalid arguments rejected before waiting or changing the page");

    await reset(page);
    const noResults = await page.evaluate(async query => {
      let clock = 0, timerId = 0;
      const nativeTimeout = window.setTimeout, nativeClearTimeout = window.clearTimeout;
      const nativeNow = performance.now.bind(performance);
      Object.defineProperty(performance, "now", { configurable: true, value: () => clock });
      window.setTimeout = (callback, delay = 0) => { const id = ++timerId; clock += delay; queueMicrotask(callback); return id; };
      window.clearTimeout = () => {};
      const input = document.querySelector("input"); let enters = 0, scans = 0;
      input.addEventListener("keydown", e => { if (e.key === "Enter") enters++; });
      const result = await ShopKudSearch.run({ args: { query, start_page: 1, max_pages: 1, max_products: 5 },
        records: () => [{ product_id: "old", name: "before" }], selectionStates: () => [], active: () => true,
        cancelled: () => false, scan: async () => { scans++; return { ok: true }; } });
      window.setTimeout = nativeTimeout; window.clearTimeout = nativeClearTimeout;
      Object.defineProperty(performance, "now", { configurable: true, value: nativeNow });
      return { result, enters, scans, value: input.value };
    }, QUERY);
    assert.equal(noResults.result.error, "search_result_unconfirmed");
    assert.equal(noResults.result.outcome, "unconfirmed");
    assert.equal(noResults.enters, 1); assert.equal(noResults.scans, 0); assert.equal(noResults.value, QUERY);
    results.push("unchanged results stay unconfirmed; exactly one Enter, no scan retry");

    await reset(page);
    const repeated = await page.evaluate(async query => {
      const input=document.querySelector("input"),rows=document.querySelector("#rows");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,query);
      const submitted=[];
      input.addEventListener("keydown",e=>{
        if(e.key!=="Enter")return;
        submitted.push(input.value);
        setTimeout(()=>{rows.innerHTML=input.value
          ?'<div class="product-row" data-id="result">ผลเดิมที่ค้นใหม่</div>'
          :'<div class="product-row" data-id="reset">รายการทั้งหมด</div>';},50);
      });
      let scans=0;
      const result=await ShopKudSearch.run({args:{query,start_page:1,max_pages:1,max_products:5},
        records:()=>[...rows.querySelectorAll(".product-row")].map(r=>({product_id:r.dataset.id,name:r.textContent})),
        selectionStates:()=>[],active:()=>true,cancelled:()=>false,
        scan:async()=>{scans++;return {ok:true,products:[]};}});
      return {result,submitted,scans};
    },QUERY);
    assert.equal(repeated.result.ok,true);
    assert.deepEqual(repeated.submitted,["",QUERY]);
    assert.equal(repeated.scans,1);
    results.push("repeated live query resets visible results before searching again");

    await reset(page);
    const lostDuringScan = await page.evaluate(async query => {
      const input=document.querySelector("input"),rows=document.querySelector("#rows");
      input.addEventListener("keydown",event=>{if(event.key==="Enter")setTimeout(()=>{
        rows.innerHTML='<div class="product-row" data-id="filtered">ผลค้นที่ถูกต้อง</div>';
      },50);});
      let scans=0;
      const result=await ShopKudSearch.run({args:{query,start_page:1,max_pages:3,max_products:50},
        records:()=>[...rows.children].map(row=>({product_id:row.dataset.id,name:row.textContent})),
        selectionStates:()=>[],active:()=>true,cancelled:()=>false,
        scan:async(_args,interrupted)=>{
          scans++;
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"");
          return {ok:!interrupted(),outcome:"partial",products:[{product_id:"wrong"}]};
        }});
      return {result,scans};
    },QUERY);
    assert.equal(lostDuringScan.result.error,"search_context_changed");
    assert.equal(lostDuringScan.result.outcome,"unconfirmed");
    assert.equal(lostDuringScan.scans,1);
    results.push("lost search context during pagination fails closed instead of returning unrelated products");

    await reset(page);
    const stopped = await page.evaluate(async query => {
      window.cancelSearch = false;
      const p = ShopKudSearch.run({ args: { query, start_page: 1, max_pages: 1, max_products: 1 },
        records: () => [{ product_id: "p", name: "p" }], selectionStates: () => [], active: () => true,
        cancelled: () => window.cancelSearch, scan: async () => ({ ok: true }) });
      setTimeout(() => { window.cancelSearch = true; }, 50);
      return p;
    }, QUERY);
    assert.equal(stopped.error, "cancelled");

    const inactive = await page.evaluate(async query => ShopKudSearch.run({
      args: { query, start_page: 1, max_pages: 1, max_products: 1 }, records: () => [], selectionStates: () => [],
      active: () => false, cancelled: () => false, scan: async () => ({ ok: true }),
    }), QUERY);
    assert.equal(inactive.error, "page_changed");

    await page.evaluate(() => {
      const captcha = document.createElement("div"); captcha.className = "captcha"; document.querySelector("main").append(captcha);
    });
    const challenge = await page.evaluate(async query => ShopKudSearch.run({
      args: { query, start_page: 1, max_pages: 1, max_products: 1 }, records: () => [{ product_id: "p", name: "p" }],
      selectionStates: () => [], active: () => true, cancelled: () => false, scan: async () => ({ ok: true }),
    }), QUERY);
    assert.equal(challenge.error, "challenge_detected");
    results.push("cancellation, inactive page, and visible challenge stop before scanning");

    await reset(page);
    const userContextPromise = page.evaluate(async query => ShopKudSearch.run({
      args: { query, start_page: 1, max_pages: 1, max_products: 1 }, records: () => [{ product_id: "p", name: "p" }],
      selectionStates: () => [], active: () => true, cancelled: () => false, scan: async () => ({ ok: true }),
    }), QUERY);
    await page.locator("input").click();
    await page.keyboard.type("human");
    const userContext = await userContextPromise;
    assert.equal(userContext.error, "search_context_changed");
    results.push("trusted user input cancels the agent search");

    console.log(JSON.stringify({ ok: true, passed: results.length, failed: [], results }));
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
