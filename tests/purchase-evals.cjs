"use strict";

// Offline synthetic DOM contract checks for scoped public purchase/seller evidence.
// This does not validate live Shopee selectors or make authenticity claims.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = fs.readFileSync(path.join(ROOT, "extension/listing.js"), "utf8");
const CHROMIUM = process.env.SHOPKUD_TEST_CHROMIUM ||
  chromium.executablePath();
const URL = "https://shopee.co.th/product/12345/123";
const results = [];

const pair = (label, value) => `<div class="pair"><span>${label}</span><span>${value}</span></div>`;
const baseFixture = ({ seller = "", briefing = "", productInfo = "", extra = "", metadata = "" } = {}) => {
  // The reader scopes product metrics from the title's closest product-summary
  // container. Keep the synthetic heading inside that observed scope.
  const summary = briefing
    ? briefing.replace(/<\/section>$/u, `${productInfo}</section>`)
    : productInfo || "<h1>Fixture Power Bank</h1>";
  return `<!doctype html><html><body>
  <nav>NAV SECRET <section aria-label="ข้อมูลสินค้า">${pair("ขายแล้ว", "999 ชิ้น")}</section></nav>
  <main>${seller}${summary}${extra}
    <section class="reviews"><h2>รีวิว</h2>${pair("รีวิว", "REVIEW SECRET 777")}</section>
  </main><section style="display:none" class="product-briefing"><h1>HIDDEN METRICS</h1>${pair("คะแนนสินค้า", "HIDDEN 0.1")}</section>
  <script type="application/ld+json">${metadata}</script>
</body></html>`;
};

function validEvidenceValue(value, field) {
  if (value === null) return;
  assert.equal(typeof value, "object", `${field} must be null or a provenance object`);
  assert.equal(typeof value.display, "string", `${field}.display must be a string`);
  assert.ok(value.display.length <= 120, `${field}.display must be bounded`);
  assert.ok(["visible_seller_panel", "visible_product_summary", "exact_product_json_ld"].includes(value.source), `${field}.source must identify its evidence source`);
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
    await page.goto(URL);
    const read = () => page.evaluate(source => (0, eval)(source), SOURCE);
    const seller = `<section class="page-product__shop" aria-label="ข้อมูลร้านค้า"><h2>ข้อมูลร้านค้า</h2>
      ${pair("ชื่อร้านค้า", "Fixture Official Store")}${pair("Ratings", "1.2k")}${pair("ผู้ติดตาม", "5.6k")}
      ${pair("เข้าร่วมเมื่อ", "5 ปีที่แล้ว")}${pair("อัตราการตอบกลับ", "98%")}${pair("เวลาในการตอบกลับ", "ภายใน 1 ชั่วโมง")}
      <img alt="Mall" src="https://images.example/mall-badge.svg" style="width:30px;height:20px">
    </section>`;
    const briefing = `<section class="product-briefing"><h1>สินค้า</h1>
      ${pair("คะแนนสินค้า", "4.8")}${pair("รีวิว", "84")}${pair("การให้คะแนน", "1.1k")}${pair("ขายแล้ว", "58 ชิ้น")}
      <section><h2>สี</h2><button aria-checked="true" aria-label="สีดำ">สีดำ</button><button disabled>สีขาว</button></section>
    </section>`;
    const productInfo = `<section aria-label="ข้อมูลสินค้า"><h2>ข้อมูลสินค้า</h2>
      ${pair("Ships from", "Bangkok")}${pair("Delivery time", "2-3 days")}${pair("Shipping fee", "฿35")}${pair("Stock", "58")}
    </section>`;
    await page.setContent(baseFixture({ seller, briefing, productInfo }));
    const result = await read();
    assert.equal(result.ok, true);
    for (const [group, fields] of Object.entries({
      seller_info: ["name", "mall_badge", "ratings_count", "followers", "shop_age", "response_rate", "response_time"],
      product_metrics: ["rating", "rating_count", "review_count", "sold"],
      shipping_info: ["ships_from", "delivery", "shipping_fee", "stock"],
    })) {
      assert.ok(result[group], `${group} should be present`);
      for (const name of fields) validEvidenceValue(result[group][name], `${group}.${name}`);
    }
    const expect = (actual, group, name, display, source) => assert.deepEqual(actual[group][name], { display, source });
    expect(result, "seller_info", "name", "Fixture Official Store", "visible_seller_panel");
    expect(result, "seller_info", "mall_badge", "Mall", "visible_seller_panel");
    expect(result, "seller_info", "ratings_count", "1.2k", "visible_seller_panel");
    expect(result, "seller_info", "followers", "5.6k", "visible_seller_panel");
    expect(result, "seller_info", "response_rate", "98%", "visible_seller_panel");
    expect(result, "product_metrics", "rating", "4.8", "visible_product_summary");
    expect(result, "product_metrics", "rating_count", "1.1k", "visible_product_summary");
    expect(result, "product_metrics", "review_count", "84", "visible_product_summary");
    expect(result, "product_metrics", "sold", "58 ชิ้น", "visible_product_summary");
    expect(result, "shipping_info", "ships_from", "Bangkok", "visible_product_summary");
    expect(result, "shipping_info", "delivery", "2-3 days", "visible_product_summary");
    expect(result, "shipping_info", "shipping_fee", "฿35", "visible_product_summary");
    expect(result, "shipping_info", "stock", "58", "visible_product_summary");
    assert.deepEqual(result.variant_info.available_options[0].options, ["สีดำ", "สีขาว"], "legacy option strings remain available");
    assert.deepEqual(result.variant_info.available_options[0].option_evidence, [
      { value: "สีดำ", selected: true, disabled: false, source: "visible_labeled_buttons" },
      { value: "สีขาว", selected: null, disabled: true, source: "visible_labeled_buttons" },
    ]);
    const privacy = JSON.stringify(result);
    for (const sentinel of ["NAV SECRET", "REVIEW SECRET", "HIDDEN METRICS", "HIDDEN 0.1"])
      assert.ok(!privacy.includes(sentinel), `must exclude unrelated ${sentinel}`);
    assert.ok(!privacy.includes("authentic"), "do not invent authenticity claims");
    results.push("unique visible seller/product/shipping scopes preserve display provenance, abbreviations, and safe option evidence");

    // A seller name containing Mall is not itself a Mall badge.
    await page.setContent(baseFixture({ seller: `<section class="page-product__shop" aria-label="Shop information"><h2>Shop information</h2>${pair("Shop name", "Shopee Mall Fixture")}</section>` }));
    const nameOnly = await read();
    expectFieldNull(nameOnly, "seller_info", "mall_badge");
    assert.deepEqual(nameOnly.seller_info.name, { display: "Shopee Mall Fixture", source: "visible_seller_panel" });
    results.push("Mall wording in the seller name does not create a Mall badge claim");

    await page.setContent(baseFixture({ seller: `<section class="page-product__shop"><h2 itemprop="name">Example Store</h2>${pair("เข้าร่วมเมื่อ", "รายการสินค้า N/A")}${pair("เวลาในการตอบกลับ", "-")}</section>`, productInfo: `<h1>TV</h1><section><h2>ขนาดจอ</h2><button>50 นิ้ว</button><button>55 นิ้ว</button></section><section><h2>ความจุ</h2><button>256GB</button></section>` }));
    const expanded = await read();
    expect(expanded, "seller_info", "name", "Example Store", "visible_seller_panel");
    assert.equal(expanded.seller_info.shop_age, null);
    assert.equal(expanded.seller_info.response_time, null);
    assert.deepEqual(expanded.variant_info.available_options.map(group=>group.options), [["50 นิ้ว", "55 นิ้ว"], ["256GB"]]);
    assert.deepEqual(expanded.variant_info.selected_options, []);
    results.push("screen size/capacity options are read without claiming selection; seller placeholders remain unknown");

    // Conflicting visible panels fail closed rather than choosing one seller.
    const conflictingSellers = `<section class="page-product__shop" aria-label="ข้อมูลร้านค้า">${pair("ชื่อร้านค้า", "Shop A")}${pair("Followers", "100")}</section>
      <section class="page-product__shop" aria-label="ข้อมูลร้านค้า">${pair("ชื่อร้านค้า", "Shop B")}${pair("Followers", "200")}</section>`;
    await page.setContent(baseFixture({ seller: conflictingSellers }));
    const conflict = await read();
    expectFieldNull(conflict, "seller_info", "name");
    expectFieldNull(conflict, "seller_info", "followers");
    results.push("conflicting visible seller panel values remain null");

    // Address-like delivery text and availability adjectives do not become delivery time or stock.
    await page.setContent(baseFixture({ productInfo: `<section aria-label="Product details"><h1>Fixture Power Bank</h1><h2>Product details</h2>
      ${pair("Ships from", "Bangkok")}${pair("Delivery time", "Recipient address 123 Example Road")}${pair("Shipping fee", "Free")}${pair("Stock", "Available")}
      <button disabled>สีดำ (หมด)</button></section>` }));
    const unsafeSummary = await read();
    expectFieldNull(unsafeSummary, "shipping_info", "delivery");
    expectFieldNull(unsafeSummary, "shipping_info", "stock");
    assert.deepEqual(unsafeSummary.shipping_info.ships_from, { display: "Bangkok", source: "visible_product_summary" });
    assert.deepEqual(unsafeSummary.shipping_info.shipping_fee, { display: "Free", source: "visible_product_summary" });
    results.push("non-duration delivery text and disabled options do not imply delivery time or stock");

    const exactJsonLd = JSON.stringify({
      "@context": "https://schema.org", "@type": "Product", url: URL, name: "Fixture Power Bank",
      aggregateRating: { ratingValue: "4.6", ratingCount: 1400, reviewCount: "132" },
    });
    await page.setContent(baseFixture({ metadata: exactJsonLd }));
    const jsonLd = await read();
    expectFieldNull(jsonLd, "seller_info", "name");
    expectFieldNull(jsonLd, "shipping_info", "stock");
    expect(jsonLd, "product_metrics", "rating", "4.6", "exact_product_json_ld");
    expect(jsonLd, "product_metrics", "rating_count", "1400", "exact_product_json_ld");
    expect(jsonLd, "product_metrics", "review_count", "132", "exact_product_json_ld");
    results.push("exact-product aggregateRating supplies only its matching product metrics");

    const wrongJsonLd = JSON.stringify({
      "@context": "https://schema.org", "@type": "Product", url: "https://shopee.co.th/product/12345/999",
      name: "Wrong product", aggregateRating: { ratingValue: "1.0", ratingCount: "9", reviewCount: "7" },
    });
    await page.setContent(baseFixture({ metadata: wrongJsonLd }));
    const wrong = await read();
    expectFieldNull(wrong, "product_metrics", "rating");
    expectFieldNull(wrong, "product_metrics", "rating_count");
    expectFieldNull(wrong, "product_metrics", "review_count");
    results.push("mismatched JSON-LD product ratings are ignored");
  } finally {
    await browser.close();
  }

  for (const item of results) console.log(`PASS ${item}`);
  console.log(`${results.length} passed, 0 failed`);
}

function expectFieldNull(result, group, name) {
  assert.ok(result[group], `${group} should be present`);
  assert.equal(result[group][name], null, `${group}.${name} should remain unknown`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
