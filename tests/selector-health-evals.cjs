"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const {chromium} = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const HTML = `<!doctype html><html><body>
  <p>buyer@example.com ORD-12345</p>
  <a id="aff" href="https://s.shopee.co.th/SecretCode1">open</a>
  <div role="dialog" aria-label="Get Link">
    <h4>ลิงก์ข้อเสนอสินค้า</h4>
    <label for="sid">Sub ID 1</label>
    <input id="sid" type="text" value="secret-sub">
    <input id="slot2" type="text" aria-label="Sub ID 2" value="also-secret">
    <button type="button">Get Link</button>
    <div role="button" aria-label="Copy the Link">copy</div>
  </div>
  <span>ยืนยัน (Valid)</span>
  <span>รอบการจ่ายถัดไป</span>
  <table><thead><tr><th>ประเภทช่องทาง</th><th>ค่าคอมช้อปปี้</th></tr></thead>
  <tbody><tr><td>โซเชียลมีเดีย</td><td>4%</td></tr></tbody></table>
</body></html>`;

async function main() {
  const browser = await chromium.launch({headless: true, executablePath: chromium.executablePath()});
  const page = await browser.newPage();
  await page.route("https://**/*", route => route.abort());
  await page.setContent(HTML);
  await page.addScriptTag({path: path.join(ROOT, "extension/selectors.js")});
  await page.addScriptTag({path: path.join(ROOT, "extension/diagnose.js")});
  const observed = await page.evaluate(() => {
    let clicks = 0;
    for (const node of document.querySelectorAll("a, button, [role=button]")) {
      node.addEventListener("click", () => { clicks += 1; });
    }
    const result = window.ShopKudDiagnose.diagnose(document);
    return {result, clicks};
  });
  const encoded = JSON.stringify(observed.result);
  const check = id => observed.result.checks.find(row => row.id === id);
  assert.equal(observed.clicks, 0);
  assert.equal(observed.result.opens_links, false);
  assert.equal(observed.result.clicked, false);
  assert.equal(observed.result.pii, false);
  assert.equal(observed.result.short_link_count, 1);
  assert.equal(check("dialog_title").status, "matched");
  assert.equal(check("create_button").status, "matched");
  assert.ok(check("create_button").pattern_ids.includes("sg_get_link"));
  assert.ok(check("create_button").pattern_ids.includes("sg_copy_link"));
  assert.equal(check("subid_slots").count, 2);
  assert.equal(check("commission_headers").status, "matched");
  assert.equal(check("channel_labels").status, "matched");
  assert.equal(check("kyc_verified_phrase").evidence, "cited");
  assert.equal(encoded.includes("secret-sub"), false);
  assert.equal(encoded.includes("also-secret"), false);
  assert.equal(encoded.includes("buyer@example.com"), false);
  assert.equal(encoded.includes("ORD-12345"), false);
  assert.equal(encoded.includes("SecretCode1"), false);
  assert.equal(encoded.includes("4%"), false);
  await browser.close();
  console.log("selector-health evals passed");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
