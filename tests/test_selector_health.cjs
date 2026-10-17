/**
 * Read-only selector health. No browser and no affiliate navigation.
 * Run with: node tests/test_selector_health.cjs
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

class El {
  constructor(tag, attrs = {}) {
    this.tagName = String(tag).toUpperCase();
    this.attrs = {...attrs};
    this.children = [];
    this.parentElement = null;
    this.value = attrs.value || "";
    this.disabled = Boolean(attrs.disabled);
    this.readOnly = false;
    this.innerText = attrs.innerText || attrs.textContent || "";
    this.textContent = attrs.textContent || this.innerText;
    this.className = attrs.className || "";
    this.type = attrs.type || "";
    this.clicks = 0;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  append(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  getClientRects() {
    return [{width: 10, height: 10}];
  }

  querySelectorAll(selector) {
    const found = [];
    const visit = node => {
      for (const child of node.children) {
        if (selector.split(",").some(part => matches(child, part.trim()))) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  click() {
    this.clicks += 1;
  }
}

function matches(element, selector) {
  if (!selector) return false;
  const attr = selector.match(/^\[([^\]=]+)(?:=["']?([^"'\]]+)["']?)?\]$/u);
  if (attr) {
    const value = element.getAttribute(attr[1]);
    return attr[2] === undefined ? value !== null : value === attr[2];
  }
  return element.tagName === selector.toUpperCase();
}

function load() {
  global.window = {};
  eval(fs.readFileSync(path.join(__dirname, "../extension/selectors.js"), "utf8"));
  eval(fs.readFileSync(path.join(__dirname, "../extension/diagnose.js"), "utf8"));
  eval(fs.readFileSync(path.join(__dirname, "../extension/subid.js"), "utf8"));
  return {diagnose: global.window.ShopKudDiagnose.diagnose, SubId: global.window.ShopKudSubId};
}

function page() {
  const doc = new El("html");
  doc.location = {href: "https://affiliate.shopee.co.th/offer/product_offer/26916762523"};
  const note = doc.append(new El("p", {textContent: "buyer@example.com ORD-12345"}));
  const link = doc.append(new El("a", {href: "https://s.shopee.co.th/SecretCode1", textContent: "open"}));
  link.click = () => { link.clicks += 1; };
  const dialog = doc.append(new El("div", {role: "dialog"}));
  dialog.append(new El("h4", {textContent: "ลิงก์ข้อเสนอสินค้า"}));
  dialog.append(new El("label", {for: "sid", textContent: "Sub ID 1"}));
  dialog.append(new El("input", {id: "sid", type: "text", value: "secret-sub"}));
  const named = dialog.append(new El("span", {id: "slot2", textContent: "Sub ID 2"}));
  dialog.append(new El("input", {type: "text", "aria-labelledby": "slot2", value: "also-secret"}));
  const button = dialog.append(new El("button", {textContent: "Get Link"}));
  doc.append(new El("span", {textContent: "ยืนยัน (Valid)"}));
  doc.append(new El("span", {textContent: "รอบการจ่ายถัดไป"}));
  doc.button = button;
  doc.link = link;
  doc.named = named;
  return doc;
}

function byId(result, id) {
  return result.checks.find(row => row.id === id);
}

function main() {
  const source = fs.readFileSync(path.join(__dirname, "../extension/diagnose.js"), "utf8");
  assert.equal(/\.click\s*\(/u.test(source), false);
  assert.equal(/location\s*=/u.test(source), false);

  const {diagnose, SubId} = load();
  const doc = page();
  const result = diagnose(doc);
  const encoded = JSON.stringify(result);
  assert.equal(result.ok, true);
  assert.equal(result.opens_links, false);
  assert.equal(result.clicked, false);
  assert.equal(result.pii, false);
  assert.equal(result.page_kind, "detail");
  assert.equal(result.short_link_count, 1);
  assert.equal(byId(result, "dialog_title").status, "matched");
  assert.equal(byId(result, "create_button").status, "matched");
  assert.ok(byId(result, "create_button").pattern_ids.includes("sg_get_link"));
  assert.equal(byId(result, "subid_slots").status, "matched");
  assert.equal(byId(result, "subid_slots").count, 2);
  assert.ok(byId(result, "subid_slots").pattern_ids.includes("slot_1"));
  assert.ok(byId(result, "subid_slots").pattern_ids.includes("slot_2"));
  assert.equal(byId(result, "kyc_verified_phrase").status, "matched");
  assert.equal(byId(result, "next_payout_phrase").status, "matched");
  assert.equal(byId(result, "creator_center_labels").status, "missed");
  assert.equal(doc.button.clicks, 0);
  assert.equal(doc.link.clicks, 0);
  assert.equal(encoded.includes("secret-sub"), false);
  assert.equal(encoded.includes("also-secret"), false);
  assert.equal(encoded.includes("buyer@example.com"), false);
  assert.equal(encoded.includes("ORD-12345"), false);
  assert.equal(encoded.includes("SecretCode1"), false);

  const detected = SubId.detectSubIdInputs(doc.querySelector("[role=dialog]"));
  assert.equal(detected.available_count, 2);
  assert.equal(detected.inputs[0].getAttribute("id"), "sid");
  assert.equal(detected.inputs[1].getAttribute("aria-labelledby"), "slot2");

  const bare = new El("html");
  bare.location = {href: "https://affiliate.shopee.co.th/offer/custom"};
  const anchor = bare.append(new El("a", {href: "https://s.shopee.co.th/OnlyAnchor", textContent: "track"}));
  const missed = diagnose(bare);
  assert.equal(byId(missed, "subid_slots").status, "missed");
  assert.equal(byId(missed, "create_button").status, "missed");
  assert.equal(missed.short_link_count, 1);
  assert.equal(anchor.clicks, 0);
  assert.equal(JSON.stringify(missed).includes("OnlyAnchor"), false);
  assert.equal(missed.page_kind, "affiliate_other");

  console.log("selector health tests passed");
}

main();
