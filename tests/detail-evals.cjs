"use strict";

// Offline DOM/parser contract checks for the explicit product-detail reader.
// Uses the synthetic fixture only; no extension install or network requests.
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const fixture = require("./detail-fixture.cjs");

const ROOT = path.resolve(__dirname, "..");
const CHROMIUM = process.env.SHOPKUD_TEST_CHROMIUM ||
  chromium.executablePath();
const URL = "https://affiliate.shopee.co.th/offer/product_offer/123";
const results = [];
const failures = [];

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM });
  try {
    const page = await browser.newPage();
    await page.route("https://**/*", route => route.abort());
    await page.setContent(fixture());
    await page.addScriptTag({ path: path.join(ROOT, "extension/core.js") });
    await page.addScriptTag({ path: path.join(ROOT, "extension/detail.js") });

    const routes = await page.evaluate(() => {
      const D = window.ShopKudDetail;
      return {
        list: D.route("https://affiliate.shopee.co.th/offer/product_offer?sort=commission"),
        detail: D.route("https://affiliate.shopee.co.th/offer/product_offer/123/?from=list"),
        invalid: [
          "https://evil.example/offer/product_offer/123",
          "https://affiliate.shopee.co.th.evil.example/offer/product_offer/123",
          "https://user@affiliate.shopee.co.th/offer/product_offer/123",
          "https://affiliate.shopee.co.th:444/offer/product_offer/123",
          "https://affiliate.shopee.co.th/offer/product_offer/0",
          "https://affiliate.shopee.co.th/offer/product_offer/123456789012345678901",
          "https://affiliate.shopee.co.th/offer/product_offer/123/extra",
        ].map(value => D.route(value)),
      };
    });
    assert.deepEqual(routes.list, { kind: "list", url: "https://affiliate.shopee.co.th/offer/product_offer" });
    assert.deepEqual(routes.detail, { kind: "detail", product_id: "123", url: URL });
    assert.ok(routes.invalid.every(value => value === null), JSON.stringify(routes.invalid));
    results.push("route classification, query canonicalization, and unsafe/invalid paths");

    const baseline = await page.evaluate(url => window.ShopKudDetail.read(document, url, window.ShopeePickerCore), URL);
    assert.equal(baseline.ok, true);
    assert.equal(baseline.name, "FixtureSupplement ทดสอบ 300 กรัม");
    assert.equal(baseline.price_min_thb, 498);
    assert.equal(baseline.price_max_thb, 498);
    assert.equal(baseline.product_url, "https://shopee.co.th/product/12345/123");
    assert.equal(baseline.shop_id, "12345");
    assert.equal(baseline.item_id, "123");
    assert.deepEqual(baseline.variant_info, { model_id: null, model_name: null, color: null, source: null });
    assert.ok(baseline.missing_fields.includes("variant_model"));
    assert.ok(baseline.missing_fields.includes("variant_color"));
    assert.deepEqual(baseline.images.map(image => [image.url, image.role, image.order]), [
      ["https://down-th.img.susercontent.com/file/fixture-main.jpg", "main", 0],
      ["https://down-th.img.susercontent.com/file/fixture-gallery-1.jpg", "gallery", 1],
      ["https://down-th.img.susercontent.com/file/fixture-variant.jpg", "variant", 2],
    ]);
    assert.ok(baseline.images.every(image => image.source === "visible_offer_dom" && image.source_url === URL));
    assert.deepEqual(baseline.images.map(image => [image.width, image.height]), [[null, null], [null, null], [null, null]]);
    assert.deepEqual(baseline.channels.map(row => row.channel), ["social", "shopee_video"]);
    assert.equal(baseline.channels[0].extra_commission.pct, 10);
    assert.equal(baseline.channels[0].shopee_commission.pct, 2);
    assert.equal(baseline.channels[0].estimated_commission_thb, 59.76);
    assert.equal(baseline.channels[1].estimated_commission_thb, 49.8);
    assert.equal(baseline.channels[0].total_pct, 12);
    assert.equal(baseline.channels[1].total_pct, 10);
    assert.ok(baseline.channels.every(row => row.commission_layout === "extra_and_shopee"));
    assert.ok(baseline.channels.every(row => row.total_pct_source === "component_sum"));
    assert.ok(baseline.channels.every(row => row.extra_commission_displayed === true));
    assert.ok(baseline.channels.every(row => row.cap_thb === null && row.cap_source === null));
    assert.equal(baseline.offer_end_date, "2026-10-29");
    assert.equal(baseline.offer_end_date_source, "visible_offer_dom");
    assert.equal(baseline.extra_commission_start_date, null);
    assert.equal(baseline.extra_commission_end_date, null);
    assert.equal(baseline.attribution_duration_days, null);
    assert.equal(baseline.attribution_duration_source, null);
    assert.ok(baseline.missing_fields.includes("extra_commission_period"));
    assert.ok(baseline.missing_fields.includes("attribution_duration"));
    const invalidOfferDate = await page.evaluate(url => {
      document.querySelector(".comm-end-date").textContent = "ข้อเสนอสิ้นสุดวันที่ 31-02-2026";
      return window.ShopKudDetail.read(document, url, window.ShopeePickerCore);
    }, URL);
    assert.equal(invalidOfferDate.offer_end_date, null);
    assert.equal(invalidOfferDate.offer_end_date_source, null);
    assert.ok(invalidOfferDate.missing_fields.includes("offer_end_date"));
    assert.equal(baseline.affiliate_url, "https://s.shopee.co.th/Fixture123");
    assert.equal(baseline.link_source, "visible_link_dialog");
    assert.equal(baseline.commission_layout_evidence, null, "normal channel layout remains separately parsed");
    assert.equal(await page.locator("#click-count").textContent(), "0");
    results.push("product/shop IDs, visible images, unknown variants/caps, and channels parse without clicks");

    const evidence = await page.evaluate(url => {
      const main = document.querySelector("main");
      document.querySelector("table").remove();
      const nav = document.createElement("nav"); nav.innerHTML = "<h3>ค่าคอม NAV SECRET</h3>"; main.prepend(nav);
      const review = document.createElement("section"); review.className = "reviews";
      review.innerHTML = '<h3>ค่าคอม REVIEW SECRET</h3><table><thead><tr><th>ค่าคอม รีวิว</th></tr></thead></table>';
      main.append(review);
      const created = [];
      for (let i = 0; i < 4; i++) {
        const table = document.createElement("table");
        table.innerHTML = `<thead><tr>${Array.from({length: 12}, (_, n) => `<th class="header-${n}">${n === 0 ? "ประเภทช่องทาง" : n === 1 ? "ค่าคอมช้อปปี้" : `หัวข้อ-${n}`}</th>`).join("")}</tr></thead><tbody>${Array.from({length: 10}, (_, row) => `<tr>${Array.from({length: 12}, (_, col) => `<td>${row === 0 && col === 0 ? `Unknown-${i}` : col === 1 ? "ค่าคอม —" : `cell-${row}-${col}`}</td>`).join("")}</tr>`).join("")}</tbody>`;
        main.append(table); created.push(table);
      }
      for (let i = 0; i < 10; i++) {
        const label = document.createElement("h3"); label.className = "commission-label";
        label.textContent = `ค่าคอม label ${i}`; main.append(label);
      }
      const result = window.ShopKudDetail.read(document, url, window.ShopeePickerCore);
      return result;
    }, URL);
    assert.deepEqual(evidence.channels, [], "unsupported layout must not infer commission channels or rates");
    assert.equal(evidence.commission_layout_evidence.status, "unsupported_or_not_observed");
    assert.equal(evidence.commission_layout_evidence.source, "visible_offer_dom");
    assert.equal(evidence.commission_layout_evidence.source_url, URL);
    assert.equal(evidence.commission_layout_evidence.tables.length, 3, "table evidence is bounded to three");
    assert.ok(evidence.commission_layout_evidence.tables.every(table =>
      table.headers.length <= 10 && table.header_classes.length <= 10 && table.rows.length <= 8 &&
      table.rows.every(row => row.length <= 10) &&
      [...table.headers, ...table.header_classes, ...table.rows.flat()].every(value => value.length <= 240)));
    assert.equal(evidence.commission_layout_evidence.labels.length, 8, "commission labels are bounded to eight");
    assert.ok(evidence.commission_layout_evidence.labels.every(label => label.length <= 240));
    assert.ok(!JSON.stringify(evidence.commission_layout_evidence).includes("NAV SECRET"));
    assert.ok(!JSON.stringify(evidence.commission_layout_evidence).includes("REVIEW SECRET"));
    assert.ok(!JSON.stringify(evidence.commission_layout_evidence).includes("ค่าคอม รีวิว"));
    results.push("unsupported-layout evidence is visible, bounded, and excludes nav/review text without inferring rates");
    await page.setContent(fixture());
    await page.addScriptTag({ path: path.join(ROOT, "extension/core.js") });
    await page.addScriptTag({ path: path.join(ROOT, "extension/detail.js") });

    const threeColumn = await page.evaluate(url => {
      const table = document.querySelector("main table");
      table.querySelector("thead").innerHTML = "<tr><th>ประเภทช่องทาง</th><th>ค่าคอมช้อปปี้</th><th>ค่าคอมมิชชั่นโดยประมาณ</th></tr>";
      table.querySelector("tbody").innerHTML = "<tr><td>โซเชียลมีเดีย โปรโมตบ่อยสุด</td><td>2% (฿79.98)</td><td>฿79.98</td></tr><tr><td>ช้อปปี้ไลฟ์</td><td>0% (฿0.00)</td><td>฿0.00</td></tr><tr><td>ช้อปปี้วีดีโอ</td><td>0% (฿0.00)</td><td>฿0.00</td></tr>";
      const result = window.ShopKudDetail.read(document, url, window.ShopeePickerCore);
      const rows = result.channels;
      table.querySelector("tbody tr").cells[1].textContent = "2%-5%";
      const malformed = window.ShopKudDetail.read(document, url, window.ShopeePickerCore).channels[0];
      return { result, malformed };
    }, URL);
    assert.equal(threeColumn.result.commission_layout_evidence, null);
    assert.deepEqual(threeColumn.result.channels.map(row => row.channel), ["social", "shopee_live", "shopee_video"]);
    assert.ok(threeColumn.result.channels.every(row => row.commission_layout === "shopee_only"));
    assert.ok(threeColumn.result.channels.every(row => row.extra_commission_displayed === false));
    assert.ok(threeColumn.result.channels.every(row => row.extra_commission.pct === null && row.extra_commission.amount_thb === null));
    assert.deepEqual(threeColumn.result.channels.map(row => [row.shopee_commission.pct, row.total_pct, row.total_pct_source]), [
      [2, 2, "visible_shopee_column"], [0, 0, "visible_shopee_column"], [0, 0, "visible_shopee_column"],
    ]);
    assert.equal(threeColumn.result.channels[2].total_pct, 0, "do not guess a 2% extra commission for video");
    assert.equal(threeColumn.malformed.shopee_commission.pct, null);
    assert.equal(threeColumn.malformed.total_pct, null, "malformed visible percent remains unknown");
    results.push("observed three-column commission table uses only visible Shopee rates; malformed and absent extra rates stay unknown");
    await page.setContent(fixture());
    await page.addScriptTag({ path: path.join(ROOT, "extension/core.js") });
    await page.addScriptTag({ path: path.join(ROOT, "extension/detail.js") });

    const imageCases = await page.evaluate(url => {
      const read = () => window.ShopKudDetail.read(document, url, window.ShopeePickerCore);
      const before = read().images;
      const mainImage = document.querySelector(".main-image");
      Object.defineProperty(mainImage, "naturalWidth", { configurable: true, value: 800 });
      Object.defineProperty(mainImage, "naturalHeight", { configurable: true, value: 800 });
      const withNaturalDimensions = read().images[0];
      const gallery = document.querySelector(".detail-info .gallery");
      const saved = gallery.innerHTML;
      gallery.innerHTML = "";
      const noGallery = read();
      gallery.innerHTML = saved;
      return { before, withNaturalDimensions, noGallery };
    }, URL);
    assert.equal(imageCases.before.length, 3, "duplicate assets and unsafe/unrelated/review images are excluded");
    assert.deepEqual([imageCases.withNaturalDimensions.width, imageCases.withNaturalDimensions.height], [800, 800]);
    assert.ok(imageCases.noGallery.missing_fields.includes("gallery"));
    assert.deepEqual(imageCases.noGallery.images.map(image => image.role), ["main"]);
    results.push("image extraction deduplicates and excludes unsafe, review, and unrelated images");

    const linkCases = await page.evaluate(url => {
      const read = (route = url) => window.ShopKudDetail.read(document, route, window.ShopeePickerCore);
      const dialog = document.querySelector('[role="dialog"]');
      const area = dialog.querySelector("textarea");
      const original = area.value;
      area.value = "https://s.shopee.co.th/NotVisible";
      dialog.style.display = "none";
      const hidden = read().affiliate_url;
      dialog.style.display = "";
      area.value = original;
      const second = dialog.cloneNode(true);
      document.body.append(second);
      const ambiguous = read().affiliate_url;
      second.remove();
      const other = document.createElement("div");
      other.setAttribute("role", "dialog");
      other.innerHTML = '<h4>อื่น</h4><textarea disabled>https://s.shopee.co.th/OtherDialog</textarea>';
      document.body.append(other);
      const otherDialog = read().affiliate_url;
      other.remove();
      area.disabled = false;
      const enabled = read().affiliate_url;
      return { hidden, ambiguous, otherDialog, enabled };
    }, URL);
    assert.equal(linkCases.hidden, null);
    assert.equal(linkCases.ambiguous, null);
    assert.equal(linkCases.otherDialog, "https://s.shopee.co.th/Fixture123");
    assert.equal(linkCases.enabled, null);
    results.push("affiliate link requires exactly one visible disabled field in the matching dialog");

    const errors = await page.evaluate(url => {
      const main = document.querySelector("main");
      const read = (route = url) => window.ShopKudDetail.read(document, route, window.ShopeePickerCore);
      const name = document.querySelector(".detail-info .name");
      const price = document.querySelector(".detail-info .price");
      const productLink = document.querySelector('.detail-info a[href]');
      const saved = { name: name.textContent, price: price.textContent, href: productLink.href };
      name.textContent = "";
      const missingName = read().error;
      name.textContent = saved.name;
      price.textContent = "ราคาไม่ชัดเจน";
      const missingPrice = read().error;
      price.textContent = saved.price;
      productLink.href = "https://shopee.co.th/product/12345/999";
      const mismatch = read().error;
      productLink.href = saved.href;
      const listRoute = read("https://affiliate.shopee.co.th/offer/product_offer").error;
      return { missingName, missingPrice, mismatch, listRoute, mainExists: Boolean(main) };
    }, URL);
    assert.equal(errors.missingName, "product_detail_unavailable");
    assert.equal(errors.missingPrice, "product_detail_unavailable");
    assert.equal(errors.mismatch, "product_detail_unavailable");
    assert.equal(errors.listRoute, "product_detail_page_required");
    results.push("missing or mismatched required product facts fail closed; list route is rejected");

    const commissionCases = await page.evaluate(url => {
      const table = document.querySelector("table");
      const tbody = table.querySelector("tbody");
      const baseRows = [...tbody.children];
      const add = label => {
        const row = document.createElement("tr");
        row.innerHTML = `<td>${label}</td><td>—</td><td>—</td><td>—</td>`;
        tbody.append(row);
      };
      add("ช่องทางใหม่");
      const afterUnknown = window.ShopKudDetail.read(document, url, window.ShopeePickerCore);
      add("โซเชียลมีเดีย ช่องทางซ้ำ");
      const duplicate = window.ShopKudDetail.read(document, url, window.ShopeePickerCore).error;
      tbody.replaceChildren(...baseRows);
      const video = [...tbody.querySelectorAll("tr")].find(row => row.cells[0].textContent.includes("ช้อปปี้วีดีโอ"));
      video.cells[1].textContent = "—";
      video.cells[2].textContent = "—";
      video.cells[3].textContent = "—";
      const missing = window.ShopKudDetail.read(document, url, window.ShopeePickerCore);
      const ambiguousRate = document.createElement("tr");
      ambiguousRate.innerHTML = '<td>ช้อปปี้ไลฟ์</td><td>5%-10% (฿5-฿10)</td><td>2%</td><td>฿12</td>';
      tbody.append(ambiguousRate);
      const ambiguous = window.ShopKudDetail.read(document, url, window.ShopeePickerCore);
      return {
        unknownChannels: afterUnknown.channels.map(row => row.channel),
        duplicate,
        missing: missing.channels.find(row => row.channel === "shopee_video"),
        ambiguous: ambiguous.channels.find(row => row.channel === "shopee_live"),
      };
    }, URL);
    assert.deepEqual(commissionCases.unknownChannels, ["social", "shopee_video"]);
    assert.equal(commissionCases.duplicate, "ambiguous_commission_table");
    assert.equal(commissionCases.missing.extra_commission.pct, null);
    assert.equal(commissionCases.missing.shopee_commission.pct, null);
    assert.equal(commissionCases.missing.estimated_commission_thb, null);
    assert.equal(commissionCases.ambiguous.extra_commission.pct, null, "range rate must not be guessed");
    if (commissionCases.ambiguous.extra_commission.amount_thb !== null) {
      failures.push(`range amount was guessed as ${commissionCases.ambiguous.extra_commission.amount_thb}`);
    }
    results.push("unknown/duplicate rows and missing/range commission values remain unguessed");

    assert.equal(await page.locator("#click-count").textContent(), "0");
    console.log(JSON.stringify({ ok: failures.length === 0, passed: results.length, failed: failures, results }));
    if (failures.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
