"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const fixture = require("./detail-fixture.cjs");

const ROOT = path.resolve(__dirname, "..");
const URL = "https://affiliate.shopee.co.th/offer/product_offer/123";

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath() });
  const page = await browser.newPage();
  await page.route("https://**/*", route => route.abort());
  await page.setContent(fixture());
  await page.addScriptTag({ path: path.join(ROOT, "extension/core.js") });
  await page.addScriptTag({ path: path.join(ROOT, "extension/linkcapture.js") });
  await page.addScriptTag({ path: path.join(ROOT, "extension/detail.js") });
  const read = () => page.evaluate(url => window.ShopKudDetail.read(document, url, window.ShopeePickerCore), URL);

  await page.locator('[role="dialog"] textarea').evaluate(node => { node.style.display = "none"; });
  const hiddenField = await read();
  assert.equal(hiddenField.ok, true);
  assert.equal(hiddenField.affiliate_url, "https://s.shopee.co.th/Fixture123");
  assert.equal(hiddenField.link_source, "hidden_link_field");

  await page.locator('[role="dialog"]').evaluate(node => { node.style.display = "none"; });
  const hiddenDialog = await read();
  assert.equal(hiddenDialog.affiliate_url, null);
  assert.equal(hiddenDialog.link_source, null);

  await browser.close();
  console.log("hidden-link evals passed");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
