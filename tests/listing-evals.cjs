"use strict";

// Offline synthetic DOM contract checks for extension/listing.js.
// This verifies parser behavior only; it does not validate live Shopee selectors.
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

function modelFixture({ title, description = "", specBrand = null, extra = "", metadata = "" }) {
  const descriptionSection = description
    ? `<section><h2>รายละเอียดสินค้า</h2><p>${description}</p></section>` : "";
  const specSection = specBrand === null ? ""
    : `<section><h2>ข้อมูลจำเพาะของสินค้า</h2><div class="RNeUsI"><div><h3>สินค้า</h3><div>${specBrand}</div></div></div></section>`;
  return `<!doctype html><html><body><nav>Navigation A1689 SECRET</nav><main>
    <h1>${title}</h1>${descriptionSection}${specSection}${extra}
  </main><script type="application/ld+json">${metadata}</script></body></html>`;
}

const fixture = (metadata = "") => `<!doctype html><html><body>
  <nav>Navbar ACCOUNT SECRET</nav>
  <main>
    <h1>Phone case A1695 Silver</h1>
    <div class="specs"><section><h2>ข้อมูลจำเพาะ</h2><table><tr><th>รุ่น</th><td>Explicit M-42</td></tr><tr><th>SKU</th><td>SKU-123</td></tr></table></section></div>
    <div role="radiogroup" aria-label="สี"><button role="radio" aria-label="ดำ" aria-checked="false">ดำ</button><button role="radio" aria-label="เงิน" aria-checked="true">เงิน</button></div>
    <div class="reviews">Review SECRET <img src="https://images.example/review.jpg"></div>
    <div class="gallery"><img src="https://images.example/gallery-only.jpg"></div>
  </main>
  <script type="application/ld+json">${metadata}</script>
  <script type="application/ld+json">{broken</script>
</body></html>`;

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
    const exact = JSON.stringify({
      "@context": "https://schema.org", "@type": "Product", "@id": URL,
      url: URL, name: "Exact Product Name", model: "LD-MODEL", sku: "LD-SKU",
      image: ["https://images.example/ld-main.jpg", "https://images.example/ld-2.jpg"],
      additionalProperty: [{ name: "รุ่น", value: "LD-MODEL" }, { name: "สี", value: "Spec Color" }],
    });
    await page.goto(URL);
    await page.setContent(fixture(exact));
    const read = async () => page.evaluate(source => (0, eval)(source), SOURCE);

    const result = await read();
    assert.equal(result.ok, true);
    assert.equal(result.name, "Exact Product Name");
    assert.equal(result.shop_id, "12345");
    assert.equal(result.product_id, "123");
    assert.equal(result.metadata_source, "exact_product_json_ld");
    assert.equal(result.variant_info.model, null, "conflicting explicit model sources remain unknown");
    assert.equal(result.variant_info.sku, null, "conflicting explicit SKU sources remain unknown");
    assert.equal(result.variant_info.color, "เงิน");
    assert.deepEqual(result.gallery.map(item => item.url), ["https://images.example/ld-main.jpg", "https://images.example/ld-2.jpg"]);
    assert.ok(result.gallery.every(item => item.source === "product_json_ld"));
    assert.equal(result.gallery_complete, false);
    assert.ok(!JSON.stringify(result).includes("gallery-only"));
    assert.ok(!JSON.stringify(result).includes("Review SECRET"));
    assert.ok(!JSON.stringify(result).includes("Navbar ACCOUNT SECRET"));
    results.push("canonical product data, exact JSON-LD, explicit variant sources, and isolated gallery sources");

    const identicalSources = await page.evaluate(async source => {
      const rows = document.querySelectorAll(".specs td");
      rows[0].textContent = "LD-MODEL";
      rows[1].textContent = "LD-SKU";
      return (0, eval)(source);
    }, SOURCE);
    assert.equal(identicalSources.variant_info.model, "LD-MODEL");
    assert.equal(identicalSources.variant_info.sku, "LD-SKU");
    results.push("identical explicit model/SKU sources preserve their shared value");

    const unrelated = JSON.stringify({
      "@context": "https://schema.org", "@graph": [
        { "@type": "Product", url: "https://shopee.co.th/product/12345/999", name: "Recommended Product", model: "WRONG" },
        { "@type": "Product", url: URL + "?from=recommend", name: "Query Product", sku: "WRONG" },
      ],
    });
    await page.setContent(fixture(unrelated));
    const ignored = await read();
    assert.equal(ignored.name, "Phone case A1695 Silver");
    assert.equal(ignored.metadata_source, null);
    assert.equal(ignored.variant_info.model, "Explicit M-42");
    assert.equal(ignored.variant_info.sku, "SKU-123");
    assert.equal(ignored.variant_info.color, "เงิน");
    results.push("other/recommended/query JSON-LD ignored; title tokens do not become model or color");

    const longDescription = `🎗️Anker Laptop Power Bank(A1695)🎗️ ${"description words ".repeat(35)}DESCRIPTION_TAIL_SECRET`;
    await page.setContent(modelFixture({ title: "Anker Laptop Power Bank 535", description: longDescription, specBrand: "Anker" }));
    const descriptionFixture = await read();
    const descriptionFixtureEvidence = descriptionFixture.model_evidence.filter(item => item.model === "A1695");
    assert.ok(descriptionFixtureEvidence.some(item => item.source === "visible_product_description" && item.role === "identity"));
    assert.equal(descriptionFixture.variant_info.model, "A1695", "a single unambiguous identity may supply model information");
    assert.ok(descriptionFixture.model_evidence.length <= 12);
    assert.ok(descriptionFixture.model_evidence.every(item => item.model.length <= 40 && item.snippet.length <= 180));
    assert.ok(!JSON.stringify(descriptionFixture).includes("DESCRIPTION_TAIL_SECRET"), "full product descriptions must not be emitted");
    results.push("535-style description identifies parenthesized model with bounded evidence and no full description leak");

    await page.setContent(modelFixture({ title: "Anker accessory case for A1695" }));
    const accessory = await read();
    assert.ok(accessory.model_evidence.some(item => item.model === "A1695" && item.role === "compatible"));
    assert.ok(!accessory.model_evidence.some(item => item.model === "A1695" && item.role === "identity"));

    await page.setContent(modelFixture({ title: "Anker Laptop Power Bank", description: "Anker Laptop Power Bank (A1695) and Anker PowerCore (A1689)", specBrand: "Anker" }));
    const conflicting = await read();
    assert.deepEqual(conflicting.model_evidence.filter(item => item.role === "identity").map(item => item.model).filter((value, index, all) => all.indexOf(value) === index).sort(), ["A1689", "A1695"]);
    assert.equal(conflicting.variant_info.model, null, "multiple identity candidates never fall back to one variant");

    await page.setContent(modelFixture({ title: "Generic Gadget A1695" }));
    await page.setContent(`<main><section class="SQguX_"><div><h1>Sony รุ่น K-65S20M2 | Processor X1™</h1></div><div><span>ขายแล้ว 24 ชิ้น</span></div></section><section><h2>สินค้าแนะนำ</h2><span>ขายแล้ว 999 ชิ้น</span></section></main>`);
    const sony=await read();
    assert.equal(sony.variant_info.model,"K-65S20M2");
    assert.ok(!sony.model_evidence.some(item=>item.model==="X1TM"));
    assert.equal(sony.product_metrics.sold.display,"24 ชิ้น");
    await page.setContent('<main><div class="xvTkTc"><div><h1>Sony รุ่น K-65S20M2</h1></div><div class="Ocv3B8">ขายแล้ว <span>24</span> ชิ้น</div></div><aside>ขายแล้ว 999 ชิ้น</aside></main>');
    assert.equal((await read()).product_metrics.sold.display,"24 ชิ้น");
    await page.setContent(modelFixture({title:"Phone รุ่น ABC123 | Chipset A15"}));
    const chip=await read();
    assert.equal(chip.variant_info.model,"ABC123");
    assert.equal(chip.model_evidence.find(item=>item.model==="A15").role,"mention");
    await page.setContent(modelFixture({ title: "Generic Gadget A1695" }));
    const titleOnly = await read();
    assert.ok(titleOnly.model_evidence.some(item => item.model === "A1695" && item.source === "visible_product_title" && item.role === "identity"));

    await page.setContent(modelFixture({ title: "Anker Power Bank 26K", description: "หมายเลขรุ่น: A1695 Anker Power Bank (25K, 165W, 27650mAh)", specBrand: "Anker" }));
    const labeled = await read();
    assert.ok(labeled.model_evidence.some(item => item.model === "A1695" && item.source === "visible_product_description" && item.role === "identity"));

    await page.setContent(modelFixture({ title: "Generic Gadget XA1695, A16950, and A1695Pro" }));
    const boundaries = await read();
    assert.ok(!boundaries.model_evidence.some(item => item.model === "A1695"), "codes must not match inside longer letter/digit tokens");

    await page.setContent(modelFixture({ title: "Anker Power Bank bundle -A1695 & A2697", description: "Anker Laptop Power Bank (A1695)", specBrand: "Anker" }));
    const bundleModels = await read();
    const bundleIdentityModels = [...new Set(bundleModels.model_evidence.filter(item => item.role === "identity").map(item => item.model))].sort();
    assert.deepEqual(bundleIdentityModels, ["A1695", "A2697"]);
    assert.ok(bundleModels.model_evidence.some(item => item.model === "A1695" && item.source === "visible_product_title" && item.role === "identity"));
    assert.ok(bundleModels.model_evidence.some(item => item.model === "A1695" && item.source === "visible_product_description" && item.role === "identity"));
    assert.equal(bundleModels.variant_info.model, null, "hyphen-prefixed bundle IDs remain ambiguous rather than selecting one model");

    await page.setContent(modelFixture({ title: "Anker Power Bank -A1695", specBrand: "Anker" }));
    const leadingHyphen = await read();
    assert.ok(leadingHyphen.model_evidence.some(item => item.model === "A1695" && item.role === "identity"));
    assert.equal(leadingHyphen.variant_info.model, "A1695");

    const ldModel = JSON.stringify({ "@context": "https://schema.org", "@type": "Product", url: URL, name: "Anker Power Bank A1695", model: "A1695" });
    await page.setContent(modelFixture({ title: "Anker Power Bank", metadata: ldModel }));
    const ldEvidence = await read();
    assert.ok(ldEvidence.model_evidence.some(item => item.model === "A1695" && item.source === "product_json_ld_title"));
    assert.ok(ldEvidence.model_evidence.some(item => item.model === "A1695" && item.source === "product_json_ld"));

    await page.setContent(modelFixture({
      title: "Generic Gadget",
      extra: '<section style="display:none"><h2>รายละเอียดสินค้า</h2><p>Hidden model (A1611)</p></section><section class="reviews"><h2>รีวิว A1700</h2><p>Review model A1700</p></section>',
    }));
    const ignoredRegions = await read();
    assert.ok(!ignoredRegions.model_evidence.some(item => ["A1689", "A1611", "A1700"].includes(item.model)));
    assert.ok(!JSON.stringify(ignoredRegions).includes("Navigation A1689 SECRET"));
    results.push("accessory compatibility, conflicting identities, title-only codes, token boundaries, JSON-LD sources, and hidden/unrelated regions are classified safely");

    await page.setContent(`<!doctype html><html><body>
      <nav><section><h2>颜色</h2><button>导航颜色 SECRET</button></section></nav>
      <main>
        <img src="https://images.example/shop-icon.jpg" alt="Shop icon" style="width:24px;height:24px">
        <img src="https://down-th.img.susercontent.com/file/product-hero.jpg" alt="Product hero" style="width:240px;height:240px">
        <h1>Phone case A1695 Silver</h1>
        <img src="https://down-th.img.susercontent.com/file/gallery-after-title.jpg" alt="Gallery" style="width:240px;height:240px">
        <section><h2>ข้อมูลจำเพาะของสินค้า</h2><div class="RNeUsI">
          <div><h3>สินค้า</h3><a href="/shop">FixtureShop</a></div>
          <div><h3>ขนาดความจุของแบตสำรอง</h3><div>&gt;20000mAh</div></div>
          <div><h3>จำนวนพอร์ต</h3><div>2</div></div>
          <div><h3>คลัง</h3><div>7</div></div>
          <div><h3>ส่งจาก</h3><div>จังหวัดสมุทรปราการ</div></div>
          <div style="display:none"><h3>ซ่อน</h3><div>HIDDEN SPEC</div></div>
        </div></section>
        <section class="flex items-center"><h2>สี</h2><div>
          <button class="selection-box-unselected">สีดำ</button>
          <button class="selection-box-unselected">ขาว</button>
          <button class="selection-box-selected">ดำ 95 ใหม่</button>
          <button style="display:none">ซ่อนสี</button>
        </div></section>
        <section><h2>รีวิว</h2><div><h3>รีวิวแนะนำ</h3><div>REVIEW SECRET</div></div></section>
        <section><h2>รายการแนะนำ</h2><div><h3>จำนวนพอร์ต</h3><div>999</div></div></section>
      </main></body></html>`);
    const nativeEvidence = await read();
    assert.equal(nativeEvidence.name, "Phone case A1695 Silver", "model-like title tokens are not a model field");
    assert.deepEqual(nativeEvidence.spec_evidence.map(({ label, value, source }) => ({ label, value, source })), [
      { label: "สินค้า", value: "FixtureShop", source: "visible_product_spec" },
      { label: "ขนาดความจุของแบตสำรอง", value: ">20000mAh", source: "visible_product_spec" },
      { label: "จำนวนพอร์ต", value: "2", source: "visible_product_spec" },
      { label: "คลัง", value: "7", source: "visible_product_spec" },
      { label: "ส่งจาก", value: "จังหวัดสมุทรปราการ", source: "visible_product_spec" },
    ]);
    assert.equal(nativeEvidence.shipping_info.stock.display,"7");
    assert.equal(nativeEvidence.shipping_info.ships_from.display,"จังหวัดสมุทรปราการ");
    assert.equal(nativeEvidence.variant_info.color, null, "selected CSS class is not explicit selection evidence");
    const colorGroup = nativeEvidence.variant_info.available_options.find(group => group.label === "สี");
    assert.deepEqual(colorGroup.options, ["สีดำ", "ขาว", "ดำ 95 ใหม่"]);
    assert.ok(!JSON.stringify(nativeEvidence).includes("HIDDEN SPEC"));
    assert.ok(!JSON.stringify(nativeEvidence).includes("REVIEW SECRET"));
    assert.ok(!JSON.stringify(nativeEvidence).includes("999"));
    assert.ok(!JSON.stringify(nativeEvidence).includes("ซ่อนสี"));
    assert.ok(!JSON.stringify(nativeEvidence).includes("导航颜色 SECRET"));
    assert.deepEqual(nativeEvidence.layout_evidence.image_candidates.map(image => image.src), [
      "https://down-th.img.susercontent.com/file/product-hero.jpg",
    ], "icon is excluded and only a pre-heading hero remains as an image diagnostic candidate");
    results.push("Shopee semantic spec rows and visible color options parse; CSS-only selection and unrelated/hidden content are excluded");

    await page.setContent(`<!doctype html><html><body><main>
      <img src="https://images.example/icon.jpg" alt="icon" style="width:24px;height:24px">
      <div><img src="https://down-th.img.susercontent.com/file/outside.jpg" alt="outside tile" style="width:100px;height:100px"></div>
      <div class="R32005"><img src="https://down-th.img.susercontent.com/file/hero.jpg" alt="hero" style="width:240px;height:240px"></div>
      <div class="mdCA_C"><img src="https://down-th.img.susercontent.com/file/thumbnail.jpg" alt="thumbnail" style="width:80px;height:80px"></div>
      <div class="mdCA_C"><img src="https://down-th.img.susercontent.com/file/video-cover.jpg" alt="cover" style="width:80px;height:80px"><img src="https://down-th.img.susercontent.com/file/icon-video-play.png" alt="icon video play" style="width:16px;height:16px"></div>
      <div class="mdCA_C"><img src="https://down-th.img.susercontent.com/file/hero.jpg" alt="duplicate hero" style="width:80px;height:80px"></div>
      <h1>Gallery product</h1>
      <section class="reviews"><div class="R32005"><img src="https://down-th.img.susercontent.com/file/review-after-title.jpg" alt="review" style="width:200px;height:200px"></div></section>
    </main></body></html>`);
    const galleryCase = await read();
    assert.deepEqual(galleryCase.gallery.map(item => [item.url, item.role, item.source]), [
      ["https://down-th.img.susercontent.com/file/hero.jpg", "main_image", "visible_product_gallery"],
      ["https://down-th.img.susercontent.com/file/thumbnail.jpg", "product_thumbnail", "visible_product_gallery"],
      ["https://down-th.img.susercontent.com/file/video-cover.jpg", "video_cover", "visible_product_gallery"],
    ]);
    assert.equal(galleryCase.gallery_complete, false);
    const galleryLimit = await page.evaluate(async source => {
      const main = document.querySelector("main"), heading = main.querySelector("h1");
      for (let i = 0; i < 25; i++) {
        const tile = document.createElement("div"); tile.className = "mdCA_C";
        const image = document.createElement("img");
        image.src = `https://down-th.img.susercontent.com/file/limit-${i}.jpg`;
        image.alt = `limit ${i}`; image.style.cssText = "width:80px;height:80px";
        tile.append(image); main.insertBefore(tile, heading);
      }
      return (0, eval)(source);
    }, SOURCE);
    assert.equal(galleryLimit.gallery.length, 20);
    assert.equal(galleryLimit.gallery_complete, false);
    results.push("observed gallery classes provide deduplicated, role-labeled assets with strict source/location filters and a 20-item cap");

    await page.setContent(fixture(unrelated));
    const variantCases = await page.evaluate(source => {
      const run = () => (0, eval)(source);
      const radios = [...document.querySelectorAll('[role="radio"]')];
      radios[0].setAttribute("aria-checked", "true");
      const multiple = run().variant_info.color;
      radios[0].setAttribute("aria-checked", "false");
      radios[1].setAttribute("aria-checked", "false");
      const none = run().variant_info.color;
      const group = document.querySelector('[role="radiogroup"]');
      group.style.display = "none";
      const hidden = run().variant_info.color;
      group.style.display = "";
      const hiddenSpec = document.querySelector(".specs section");
      hiddenSpec.style.display = "none";
      const hiddenEvidence = run().spec_evidence;
      return { multiple, none, hidden, hiddenEvidence };
    }, SOURCE);
    assert.equal(variantCases.multiple, null);
    assert.equal(variantCases.none, null);
    assert.equal(variantCases.hidden, null);
    assert.deepEqual(variantCases.hiddenEvidence, []);
    results.push("color only from a visible, uniquely aria-checked known group; hidden evidence excluded");

    const bounds = await page.evaluate(source => {
      const main = document.querySelector("main");
      for (let i = 0; i < 80; i++) {
        const section = document.createElement("section");
        section.innerHTML = `<h2>ข้อมูลจำเพาะ</h2><table><tr><th>${"L".repeat(100)}</th><td>${"V".repeat(400)}</td></tr></table>`;
        main.append(section);
      }
      return (0, eval)(source);
    }, SOURCE);
    assert.ok(bounds.spec_evidence.length <= 30);
    assert.ok(bounds.spec_evidence.every(item => item.label.length <= 80 && item.value.length <= 240));
    assert.ok(bounds.layout_evidence.headings.length <= 12);
    assert.ok(bounds.layout_evidence.field_labels.length <= 20);
    results.push("output evidence remains bounded");

    const routes = [];
    for (const value of ["https://evil.example/product/12345/123", URL + "?x=1", URL + "/extra"]) {
      await page.goto(value);
      routes.push(await read());
    }
    assert.ok(routes.every(item => item.ok === false && item.error === "unsupported_product_route"));
    results.push("invalid host, query, and non-canonical path rejected");

    await page.goto(URL);
    await page.setContent("<html><body><nav>Nav</nav></body></html>");
    const noMain = await read();
    assert.equal(noMain.ok, false);
    assert.equal(noMain.error, "unsupported_product_layout");
    assert.deepEqual(noMain.layout_evidence, { main_found: false, matched_product_metadata: 0 });
    results.push("unsupported layout returns explicit main-not-found error");
  } finally {
    await browser.close();
  }

  for (const item of results) console.log(`PASS ${item}`);
  console.log(`${results.length} passed, 0 failed`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
