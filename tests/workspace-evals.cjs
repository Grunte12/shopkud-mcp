"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {chromium} = require("playwright");

const HISTORY_KEY = "shopkudResearchHistory";
const HISTORY_LIMIT = 20;
const DASHBOARD_URL = pathToFileURL(path.join(__dirname, "../extension/dashboard.html")).href;
const SAVED_PRODUCT = {
  product_id: "90001", name: "สินค้าที่บันทึกไว้ก่อนเปิด Workspace", shop_name: "ร้านเดิม",
  price_min_thb: 1290, price_max_thb: 1290, sold: 45, commission_pct: 5,
  commission_thb_per_order: 64.5, mall: false,
  offer_url: "https://affiliate.shopee.co.th/offer/product_offer/90001",
  saved_query: "รายการเดิม", saved_at: "2026-10-24T10:00:00.000Z"
};

function completedSnapshot({query, traceId, productId, productName, affiliateUrl, subIds, now = Date.now(), unsafe = false}) {
  const product = {
    product_id: productId, name: productName, shop_name: `ร้าน ${productId}`,
    price_min_thb: 490, price_max_thb: 490, sold: 125, commission_pct: 5,
    commission_thb_per_order: 24.5, mall: false, channel: "social",
    commission_channels: [
      {channel:"social",commission_pct:5,commission_thb_per_order:24.5,extra_commission_pct:1,shopee_commission_pct:4},
      {channel:"shopee_live",commission_pct:6,commission_thb_per_order:29.4,extra_commission_pct:2,shopee_commission_pct:4},
      {channel:"shopee_video",commission_pct:0,commission_thb_per_order:0,shopee_commission_pct:0}
    ],
    offer_url: `https://affiliate.shopee.co.th/offer/product_offer/${productId}`,
    product_url: `https://shopee.co.th/product/12345/${productId}`,
    shop_url: "https://shopee.co.th/shop/12345",
    observed_at: new Date(now - 1000).toISOString()
  };
  if(affiliateUrl !== undefined) product.affiliate_url = affiliateUrl;
  if(subIds !== undefined) product.sub_ids = subIds;
  const products = [product];
  if(unsafe) products.push({
    ...product, product_id: `${productId}9`, name: "ตัวอย่างข้อมูลที่มี URL อันตราย",
    offer_url: "javascript:alert(1)", product_url: "javascript:alert(1)",
    shop_url: "https://shopee.co.th@evil.example/shop/12345", affiliate_url: "javascript:alert(1)"
  });
  const dashboard = {
    schema_version: 1, report_id: traceId, query, channel: "social", freshness: "live", cache_hit: false,
    partial_market_coverage: false, criteria: {ranking_goal: "balanced"},
    winner_product_id: productId, observed_at: new Date(now - 1000).toISOString(),
    scan: {pages_scanned: 1, unique_products: products.length, reached_end: true, outcome: "completed"},
    exclusions: {}, results: products
  };
  const report = {
    schema_version: 1, report_id: traceId, trace_id: traceId, query, status: "completed", stage: "recommendation",
    headline: `สรุปสำหรับ ${query}`, summary: "หลักฐานงานวิจัยที่บันทึกไว้ในเครื่องนี้",
    confidence: "medium", updated_at_unix_ms: now - 1000,
    product_decisions: [{product_id: productId, status: "recommended", reason: "ตรงโจทย์และผ่านหลักฐานที่ตรวจ", source_indexes: [0]}],
    citations: [
      {title: "แหล่งข้อมูลที่เปิดได้", url: "https://example.com/research/workspace"},
      {title: "ลิงก์อันตราย", url: "javascript:alert(1)"},
      {title: "URL มีข้อมูลรับรอง", url: "https://user:secret@example.com/private"}
    ]
  };
  return {
    ok: true, connected: false, extension_version: "workspace-test", developer_logs: [],
    runs: [{trace_id: traceId, invocation_number: 1, query, stage: "completed", status: "completed",
      updated_at_unix_ms: now, elapsed_ms: 1200, success: true, effective: true, cache_hit: false, dashboard}],
    research_reports: [report]
  };
}

function emptySnapshot() {
  return {ok: true, connected: false, extension_version: "workspace-test", runs: [], research_reports: [], developer_logs: []};
}

async function storedHistory(page) {
  return page.evaluate(key => globalThis.__chromeStorage[key] ?? null, HISTORY_KEY);
}

async function countAt(page, selector) {
  const value = (await page.locator(selector).textContent()) || "";
  const match = value.match(/[0-9][0-9,]*/u);
  assert.ok(match, `${selector} should expose a numeric count, got: ${value}`);
  return Number(match[0].replaceAll(",", ""));
}

async function push(page, snapshot) {
  await page.evaluate(value => globalThis.__pushSnapshot(value), snapshot);
}

async function run() {
  const browser = await chromium.launch({headless: true, executablePath: process.env.SHOPKUD_TEST_CHROMIUM});
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 1000}, colorScheme: "light"});
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    const initial = emptySnapshot();
    await page.addInitScript(saved => {
      let current = saved.snapshot;
      const messageListeners = [], storageListeners = [];
      let values;
      try { values = JSON.parse(localStorage.getItem("__shopkudChromeStorage") || "{}"); } catch { values = {}; }
      values.shopkudSavedProducts ??= [saved.product];
      values.shopkudLinkReceipts ??= saved.receipts;
      const persist = () => localStorage.setItem("__shopkudChromeStorage", JSON.stringify(values));
      globalThis.__pushSnapshot = value => {
        current = value;
        messageListeners.forEach(listener => listener({type: "shopkud-live-update", snapshot: current}));
      };
      globalThis.__chromeStorage = values;
      globalThis.__storagePush = products => {
        const oldValue = values.shopkudSavedProducts;
        values.shopkudSavedProducts = products;
        persist();
        storageListeners.forEach(listener => listener({shopkudSavedProducts: {oldValue, newValue: products}}, "local"));
      };
      globalThis.__receiptPush = receipts => {
        const oldValue = values.shopkudLinkReceipts;
        values.shopkudLinkReceipts = receipts;
        persist();
        storageListeners.forEach(listener => listener({shopkudLinkReceipts: {oldValue, newValue: receipts}}, "local"));
      };
      globalThis.__storageSet = (key, value) => {
        const oldValue = values[key]; values[key] = value; persist();
        storageListeners.forEach(listener => listener({[key]: {oldValue, newValue: value}}, "local"));
      };
      globalThis.chrome = {
        runtime: {
          onMessage: {addListener: listener => messageListeners.push(listener)},
          sendMessage: async message => {
            if(message.type === "shopkud-open-tracker") return {ok: false};
            return current;
          }
        },
        storage: {
          local: {
            get: async keys => Array.isArray(keys)
              ? Object.fromEntries(keys.map(key => [key, values[key]]))
              : {[keys]: values[keys]},
            set: async update => {
              const before = {...values}; Object.assign(values, update);
              persist();
              storageListeners.forEach(listener => {
                const changes = {};
                for(const [key, value] of Object.entries(update)) changes[key] = {oldValue: before[key], newValue: value};
                listener(changes, "local");
              });
            }
          },
          onChanged: {addListener: listener => storageListeners.push(listener)}
        }
      };
    }, {snapshot: initial, product: SAVED_PRODUCT, receipts: [{
      product_id: "90001", affiliate_url: "https://s.shopee.co.th/Confirmed90001",
      sub_ids: ["workspace", "saved-product"], status: "confirmed", created_at: "2026-10-24T10:01:00.000Z"
    }]});
    await page.route("https://**/*", route => route.abort());
    await page.goto(DASHBOARD_URL);
    await page.waitForSelector("#saved-count");

    const kitchenQuery = "ไฟอ่านหนังสือประหยัดพลังงาน";
    const kitchen = completedSnapshot({
      query: kitchenQuery, traceId: "workspace-trace-kitchen", productId: "71001",
      productName: "โคมไฟอ่านหนังสือปรับระดับ", affiliateUrl: "https://s.shopee.co.th/workspaceKitchen",
      subIds: ["workspace", "lighting"], unsafe: true
    });
    await push(page, kitchen);
    await page.waitForFunction(key => {
      return globalThis.__chromeStorage[key]?.length === 1;
    }, HISTORY_KEY);
    await page.locator("#tab-saved").click();

    let history = await storedHistory(page);
    assert.ok(Array.isArray(history), `${HISTORY_KEY} should contain a JSON array`);
    assert.equal(history.length, 1);
    assert.equal(history[0].query, kitchenQuery);
    assert.equal(history[0].trace_id, "workspace-trace-kitchen");
    assert.equal(history[0].dashboard.schema_version, 1);
    assert.equal(history[0].report.query, kitchenQuery, "matching report and citations are retained with the completed snapshot");
    assert.equal(await countAt(page, "#workspace-project-count"), 1);
    assert.equal(await countAt(page, "#workspace-product-count"), 1, "product count reflects the existing saved-product collection");
    assert.equal(await countAt(page, "#workspace-link-count"), 1, "only confirmed Affiliate receipts count as ready links");
    assert.equal(await page.locator("#workspace-history-list [data-history-id]").count(), 1);
    assert.equal(await page.locator("#workspace-history-empty").isVisible(), false);
    assert.equal(await page.locator("#workspace-product-empty").isVisible(), false);

    const kitchenCard = page.locator("#workspace-product-grid [data-product-id='71001']");
    await kitchenCard.waitFor({state: "visible"});
    assert.equal(await kitchenCard.locator("a[data-affiliate-link]").getAttribute("href"), "https://s.shopee.co.th/workspaceKitchen");
    assert.match(await kitchenCard.locator(".product-subids").textContent(), /workspace.*lighting/u);
    assert.ok(await page.locator('a[href="https://shopee.co.th/product/12345/71001"]').count(), "safe product link is rendered");
    assert.ok(await page.locator('a[href="https://shopee.co.th/shop/12345"]').count(), "safe store link is rendered");
    assert.ok(await page.locator('a[href="https://example.com/research/workspace"]').count(), "safe research source is rendered");
    const workspaceCommission=kitchenCard.locator(".commission-breakdown");
    assert.equal(await workspaceCommission.count(),1,"workspace product cards include available channel details");
    assert.equal(await kitchenCard.locator(".product-metrics > div").count(),4,"workspace cards keep the four summary metrics");
    assert.equal(await kitchenCard.locator(".product-metrics dt").nth(1).textContent(),"คอม Social","workspace keeps the researched channel explicit");
    await workspaceCommission.locator("summary").focus();
    await page.keyboard.press("Enter");
    assert.equal(await kitchenCard.locator(".commission-channel").count(),3,"workspace shows one row for each supplied channel");
    assert.deepEqual(await kitchenCard.locator(".commission-channel-name").allTextContents(),["Shopee Live","Social","Shopee Video"],"workspace channels are sorted by estimated THB per order");
    assert.equal(await kitchenCard.locator('.commission-channel[data-best="true"] .commission-channel-name').textContent(),"Shopee Live");
    assert.equal(await kitchenCard.locator('[data-channel="shopee_video"] .commission-channel-total').textContent(),"รวม 0%","workspace preserves zero rates");
    assert.match(await kitchenCard.locator('[data-channel="shopee_video"] .commission-channel-estimate').textContent(),/0/u,"workspace preserves a zero estimate");
    assert.equal(await kitchenCard.locator('[data-channel="shopee_video"] .commission-channel-components').textContent(),"ค่าคอมเพิ่ม ไม่ทราบ + Shopee 0%","workspace keeps the missing split value unknown");
    assert.equal(await workspaceCommission.evaluate(node=>node.scrollWidth<=node.clientWidth),true,"expanded workspace details fit inside the card");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator('a[href^="javascript:"]').count(), 0, "unsafe schemes never become links");
    assert.equal(await page.locator('a[href^="https://user:secret@"]').count(), 0, "credential-bearing source URLs are rejected");

    const runningQuery = "รองเท้าวิ่งสำหรับผู้เริ่มต้น";
    const running = completedSnapshot({
      query: runningQuery, traceId: "workspace-trace-running", productId: "72001",
      productName: "รองเท้าวิ่งน้ำหนักเบาสำหรับมือใหม่", now: Date.now() + 1000
    });
    await push(page, running);
    await page.waitForFunction(key => {
      return globalThis.__chromeStorage[key]?.length === 2;
    }, HISTORY_KEY);
    history = await storedHistory(page);
    assert.deepEqual(history.map(item => item.query), [runningQuery, kitchenQuery], "distinct category/project snapshots remain available, newest first");
    assert.equal(await countAt(page, "#workspace-project-count"), 2);
    assert.equal(await countAt(page, "#workspace-product-count"), 1, "research results do not replace explicitly saved products");
    assert.equal(await countAt(page, "#workspace-link-count"), 1, "missing research links do not change confirmed receipt count");

    const historyButtons = page.locator("#workspace-history-list [data-history-id]");
    assert.equal(await historyButtons.count(), 2);
    assert.equal(await page.locator("#workspace-history-list [data-history-id][aria-pressed='true']").count(), 1, "one workspace remains selected while history changes");
    assert.ok(await historyButtons.first().getAttribute("data-history-id"));
    await historyButtons.filter({hasText: kitchenQuery}).first().click();
    assert.equal(await page.locator("#workspace-product-grid .product-name").first().textContent(), "โคมไฟอ่านหนังสือปรับระดับ");
    assert.equal(await page.locator("#workspace-product-grid a[data-affiliate-link]").count(), 1);
    await historyButtons.filter({hasText: runningQuery}).first().click();
    assert.equal(await page.locator("#workspace-product-grid .product-name").first().textContent(), "รองเท้าวิ่งน้ำหนักเบาสำหรับมือใหม่");
    assert.equal(await page.locator("#workspace-product-grid a[data-affiliate-link]").count(), 0, "affiliate link is absent when the snapshot has no affiliate_url");
    assert.equal(await page.locator("#workspace-product-grid .product-subids").count(), 0, "sub_ids are absent when not supplied");

    await page.evaluate(product => __storagePush([__chromeStorage.shopkudSavedProducts[0], product]), {
      product_id: "90002", name: "สินค้าที่เพิ่มผ่านพื้นที่เดิม", shop_name: "ร้านที่สอง",
      price_min_thb: 620, price_max_thb: 620, sold: 50, commission_pct: 5,
      commission_thb_per_order: 31, mall: false, offer_url: "https://affiliate.shopee.co.th/offer/product_offer/90002",
      saved_query: "รายการเดิม", saved_at: "2026-10-25T10:00:00.000Z"
    });
    assert.equal(await countAt(page, "#workspace-product-count"), 2, "Workspace count follows explicit saved-product updates");
    await page.evaluate(() => __receiptPush([
      ...__chromeStorage.shopkudLinkReceipts,
      {product_id: "90002", affiliate_url: "https://s.shopee.co.th/Confirmed90002", sub_ids: ["workspace", "saved-product-2"], status: "confirmed", created_at: "2026-10-25T10:01:00.000Z"},
      {...__chromeStorage.shopkudLinkReceipts[0]}
    ]));
    assert.equal(await countAt(page, "#workspace-link-count"), 2, "confirmed link count refreshes and deduplicates product+URL pairs");
    const review = path.resolve(process.env.SHOPKUD_TEST_OUTPUT_DIR || path.join(__dirname, "../artifacts/tests"));
    fs.mkdirSync(review, {recursive: true});
    await page.emulateMedia({colorScheme: "light"});
    await page.screenshot({path: path.join(review, "workspace-light.png"), fullPage: true, animations: "disabled"});
    await page.emulateMedia({colorScheme: "dark"});
    await page.screenshot({path: path.join(review, "workspace-dark.png"), fullPage: true, animations: "disabled"});
    await page.emulateMedia({colorScheme: "light"});

    const duplicate = completedSnapshot({
      query: kitchenQuery, traceId: "workspace-trace-kitchen", productId: "71001",
      productName: "โคมไฟอ่านหนังสือปรับระดับ · ตรวจซ้ำ", affiliateUrl: "https://s.shopee.co.th/workspaceKitchen",
      subIds: ["workspace", "lighting"], now: Date.now() + 2000
    });
    await push(page, duplicate);
    await page.waitForFunction(key => {
      return globalThis.__chromeStorage[key]?.length === 2;
    }, HISTORY_KEY);
    history = await storedHistory(page);
    assert.equal(history.length, 2, "the same completed trace updates one history record instead of duplicating it");
    assert.equal(history.filter(item => item.trace_id === "workspace-trace-kitchen").length, 1);
    assert.equal(await countAt(page, "#workspace-project-count"), 2);

    await page.locator("#tab-saved").click();
    assert.equal(await page.locator("#saved-count").textContent(), "2", "existing explicitly saved-product count remains intact and updates");
    assert.equal(await page.locator("#saved-grid .product-card").count(), 2);
    assert.equal(await page.locator("#saved-grid .commission-breakdown").count(), 0, "saved cards without channel data stay concise");
    assert.match(await page.locator("#saved-grid").textContent(), /สินค้าที่บันทึกไว้ก่อนเปิด Workspace/u);

    for(let index = 1; index <= 21; index++) {
      const number = String(index).padStart(2, "0");
      await push(page, completedSnapshot({
        query: `อุปกรณ์งานอดิเรก หมวด ${number}`, traceId: `workspace-trace-${number}`,
        productId: String(73000 + index), productName: `สินค้าในหมวด ${number}`, now: Date.now() + 3000 + index
      }));
    }
    await page.waitForFunction(key => {
      const history = globalThis.__chromeStorage[key];
      return history?.length === 20 && history[0]?.query === "อุปกรณ์งานอดิเรก หมวด 21";
    }, HISTORY_KEY);
    history = await storedHistory(page);
    assert.equal(history.length, HISTORY_LIMIT, "history is bounded to 20 completed snapshots");
    assert.equal(history[0].query, "อุปกรณ์งานอดิเรก หมวด 21", "newer snapshots remain available after the cap is reached");
    assert.equal(history.at(-1).query, "อุปกรณ์งานอดิเรก หมวด 02", "oldest snapshots are trimmed first");
    assert.equal(await page.locator("#workspace-history-list [data-history-id]").count(), HISTORY_LIMIT);

    await page.reload();
    await page.locator("#tab-saved").click();
    await page.waitForFunction(key => {
      const list = document.querySelectorAll("#workspace-history-list [data-history-id]");
      return list.length === 20 && [...list].some(item => item.textContent.includes("หมวด 21"));
    }, HISTORY_KEY);
    assert.equal(await countAt(page, "#workspace-project-count"), HISTORY_LIMIT, "reload restores persisted workspace history");
    assert.equal(await page.locator("#saved-count").textContent(), "2", "explicit saved products survive workspace reload unchanged");

    await page.evaluate(key => __storageSet(key, "{not valid JSON"), HISTORY_KEY);
    await page.reload();
    await page.waitForFunction(() => globalThis.__chromeStorage && document.querySelector("#saved-count")?.textContent === "2", null, {timeout:60000});
    await page.locator("#tab-saved").click();
    await page.waitForSelector("#workspace-history-empty");
    assert.equal(await page.locator("#workspace-history-empty").isVisible(), true, "malformed storage fails closed to an empty history");
    assert.equal(await countAt(page, "#workspace-project-count"), 0);
    assert.equal(await page.locator("#workspace-history-list [data-history-id]").count(), 0);
    assert.equal(await page.locator("#saved-count").textContent(), "2", "a malformed history does not affect saved products");
    assert.deepEqual(pageErrors, [], "malformed local storage does not crash the dashboard");

    console.log(JSON.stringify({ok: true, checks: [
      "completed snapshot + matching research citations persist locally",
      "bounded 20-entry history + trace deduplication",
      "generic categories/projects remain switchable",
      "product/store/source URLs render safely",
      "affiliate_url and sub_ids are conditional",
      "workspace counts update from projects, saved products, and confirmed link receipts",
      "saved products remain compatible",
      "reload restores history",
      "malformed history storage fails safely"
    ]}));
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
