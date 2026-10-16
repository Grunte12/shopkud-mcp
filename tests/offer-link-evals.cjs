"use strict";

// Offline synthetic DOM contract checks for guarded affiliate offer-link opening.
// No extension install, live Shopee page, browser profile, or network is used.
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const fixture = require("./detail-fixture.cjs");

const ROOT = path.resolve(__dirname, "..");
const CHROMIUM = process.env.SHOPKUD_TEST_CHROMIUM ||
  chromium.executablePath();
const URL = "https://affiliate.shopee.co.th/offer/product_offer/123";
const results = [];

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM });
  try {
    const newPage = async () => {
      const page = await browser.newPage();
      await page.route("https://**/*", route => route.abort());
      await page.setContent(fixture());
      await page.addScriptTag({ path: path.join(ROOT, "extension/core.js") });
      await page.addScriptTag({ path: path.join(ROOT, "extension/detail.js") });
      return page;
    };
    const open = (page, mode = "current") => page.evaluate(({ url, mode }) => {
      let checks = 0;
      const stillCurrent = mode === "stale" ? () => ++checks === 1 : () => true;
      return window.ShopKudDetail.openLink(document, url, window.ShopeePickerCore, stillCurrent);
    }, { url: URL, mode });
    const clicks = page => page.locator("#click-count").textContent().then(Number);

    // A matching already-open offer dialog is read-only; copy remains untouched.
    {
      const page = await newPage();
      await page.locator("#copy-link").evaluate(node => {
        node.dataset.copied = "0";
        node.addEventListener("click", () => { node.dataset.copied = "1"; });
      });
      const result = await open(page);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.affiliate_url, "https://s.shopee.co.th/Fixture123");
      assert.deepEqual(result.link_action, { clicked: false, source: "existing_visible_link_dialog" });
      assert.equal(await clicks(page), 0);
      assert.equal(await page.locator("#copy-link").getAttribute("data-copied"), "0");
      results.push("already-open exact offer dialog is read without clicking offer or copy buttons");
      await page.close();
    }

    // Closed offer dialog: only the exact detail-info button is clicked once.
    {
      const page = await newPage();
      await page.locator('[role="dialog"]').evaluate(node => { node.style.display = "none"; });
      await page.locator("#copy-link").evaluate(node => {
        node.dataset.copied = "0";
        node.addEventListener("click", () => { node.dataset.copied = "1"; });
      });
      await page.locator("#get-link").evaluate(node => node.addEventListener("click", () => {
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        dialog.innerHTML = '<h4>ลิงก์ข้อเสนอสินค้า</h4><textarea disabled>https://s.shopee.co.th/OpenedOnce</textarea><button>คัดลอกลิงก์</button>';
        document.body.append(dialog);
      }));
      const result = await open(page);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.affiliate_url, "https://s.shopee.co.th/OpenedOnce");
      assert.equal(result.link_action.clicked, true);
      assert.equal(result.retry_automatically, false);
      assert.equal(await clicks(page), 1);
      assert.equal(await page.locator("#copy-link").getAttribute("data-copied"), "0");
      results.push("closed exact offer modal is opened once and its disabled short URL is read without copying");
      await page.close();
    }

    // A visible unrelated dialog blocks the action.
    {
      const page = await newPage();
      await page.locator('[role="dialog"]').evaluate(node => { node.style.display = "none"; });
      await page.locator("body").evaluate(node => {
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog"); dialog.innerHTML = "<h4>Other dialog</h4>";
        node.append(dialog);
      });
      const result = await open(page);
      assert.equal(result.error, "other_dialog_open");
      assert.equal(result.retry_automatically, false);
      assert.equal(await clicks(page), 0);
      results.push("visible unrelated dialog prevents offer-link clicks");
      await page.close();
    }

    // Ambiguous or disabled matching buttons do not get clicked.
    {
      const page = await newPage();
      await page.locator('[role="dialog"]').evaluate(node => { node.style.display = "none"; });
      await page.locator(".detail-info").evaluate(node => {
        const button = document.createElement("button"); button.textContent = "Get Link"; node.append(button);
      });
      const result = await open(page);
      assert.equal(result.error, "link_button_unavailable");
      assert.equal(await clicks(page), 0);
      await page.close();

      const disabled = await newPage();
      await disabled.locator('[role="dialog"]').evaluate(node => { node.style.display = "none"; });
      await disabled.locator("#get-link").evaluate(node => { node.disabled = true; });
      const disabledResult = await open(disabled);
      assert.equal(disabledResult.error, "link_button_unavailable");
      assert.equal(await clicks(disabled), 0);
      results.push("ambiguous and disabled Get Link controls fail closed without clicks");
      await disabled.close();
    }

    // Hidden in-scope duplicates and visible out-of-scope buttons cannot create ambiguity.
    {
      const page = await newPage();
      await page.locator('[role="dialog"]').evaluate(node => { node.style.display = "none"; });
      await page.locator("#get-link").evaluate(node => {
        const hidden = document.createElement("button"); hidden.textContent = "เอา ลิงก์";
        hidden.style.display = "none"; node.parentElement.append(hidden);
      });
      await page.locator("body").evaluate(node => {
        const outside = document.createElement("button"); outside.textContent = "Get Link"; node.append(outside);
      });
      await page.locator("#get-link").evaluate(node => node.addEventListener("click", () => {
        const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog");
        dialog.innerHTML = '<h4>ลิงก์ข้อเสนอสินค้า</h4><textarea disabled>https://s.shopee.co.th/Scoped</textarea>';
        document.body.append(dialog);
      }));
      const result = await open(page);
      assert.equal(result.ok, true);
      assert.equal(result.affiliate_url, "https://s.shopee.co.th/Scoped");
      assert.equal(await clicks(page), 1);
      results.push("hidden duplicates and buttons outside detail-info are excluded from action selection");
      await page.close();
    }

    // A cancelled/stale page callback is checked again immediately before click.
    {
      const page = await newPage();
      await page.locator('[role="dialog"]').evaluate(node => { node.style.display = "none"; });
      const result = await open(page, "stale");
      assert.equal(result.error, "page_changed");
      assert.equal(await clicks(page), 0);
      results.push("cancelled page-current callback prevents a click");
      await page.close();
    }

    // Challenge state rejects before any interaction.
    {
      const page = await newPage();
      await page.locator('[role="dialog"]').evaluate(node => { node.style.display = "none"; });
      await page.locator("body").evaluate(node => {
        const frame = document.createElement("iframe"); frame.src = "https://captcha.example/check";
        frame.style.cssText = "width:300px;height:100px"; node.append(frame);
      });
      const result = await open(page);
      assert.equal(result.error, "challenge_detected");
      assert.equal(await clicks(page), 0);
      results.push("challenge state rejects offer-link opening without clicks");
      await page.close();
    }

    // A click that fails to produce a dialog times out once and is never retried.
    {
      const page = await newPage();
      await page.locator('[role="dialog"]').evaluate(node => { node.style.display = "none"; });
      const result = await page.evaluate(async url => {
        const original = window.setTimeout;
        window.setTimeout = (fn, delay, ...args) => original(fn, delay === 10000 ? 0 : delay, ...args);
        try { return await window.ShopKudDetail.openLink(document, url, window.ShopeePickerCore, () => true); }
        finally { window.setTimeout = original; }
      }, URL);
      assert.equal(result.error, "link_dialog_attempt_unconfirmed");
      assert.equal(result.outcome, "unconfirmed");
      assert.equal(result.retry_automatically, false);
      assert.equal(await clicks(page), 1);
      const second = await open(page);
      assert.equal(second.error, "link_dialog_attempt_unconfirmed");
      assert.equal(second.retry_automatically, false);
      assert.equal(await clicks(page), 1, "second call cannot click again after an unconfirmed first attempt");
      results.push("unknown outcome is not automatically or repeatedly retried");
      await page.close();
    }
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
