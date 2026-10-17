/**
 * DOM-level guards for product attestation, missing SubID fields, and exact ownership.
 * Run with: node tests/test_create_guard.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

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
    this.hidden = Boolean(attrs.hidden);
    this.clicks = 0;
    this.onClick = null;
  }

  getAttribute(name) {
    if (name === "aria-disabled") return this.attrs["aria-disabled"] || null;
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  append(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  getClientRects() {
    return this.hidden ? [] : [{width: 12, height: 12}];
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (matches(child, selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  dispatchEvent() {}

  click() {
    this.clicks += 1;
    if (this.onClick) this.onClick();
  }
}

function matches(element, selector) {
  return selector.split(",").some((part) => matchesOne(element, part.trim()));
}

function matchesOne(element, selector) {
  if (!selector) return false;
  if (selector.startsWith(".")) {
    return element.className.split(/\s+/u).includes(selector.slice(1));
  }
  const attr = selector.match(/^\[([^\]=]+)(?:=["']?([^"'\]]+)["']?)?\]$/u);
  if (attr) {
    const value = element.getAttribute(attr[1]);
    return attr[2] === undefined ? value !== null : value === attr[2];
  }
  return element.tagName === selector.toUpperCase();
}

function load() {
  global.window = {};
  global.Event = class Event {
    constructor(type) {
      this.type = type;
    }
  };
  eval(fs.readFileSync(path.join(__dirname, "../extension/subid.js"), "utf8"));
  eval(fs.readFileSync(path.join(__dirname, "../extension/verify.js"), "utf8"));
  return {SubId: global.window.ShopKudSubId, Verify: global.window.ShopKudVerify};
}

function dialogDoc(options = {}) {
  const doc = new El("html");
  doc.location = {pathname: "/offer/product_offer/26916762523"};
  const dialog = new El("div", {role: "dialog", hidden: options.hidden});
  dialog.append(new El("h4", {textContent: "ลิงก์ข้อเสนอสินค้า"}));
  const slots = options.slots === undefined ? [1, 2] : options.slots;
  for (const slot of slots) {
    dialog.append(new El("input", {name: `subId${slot}`, placeholder: `Sub ID ${slot}`, type: "text"}));
  }
  const output = new El("textarea");
  const button = new El("button", {innerText: "รับลิงก์", textContent: "รับลิงก์"});
  button.onClick = () => {
    if (options.fillOnClick !== false) output.value = options.url || "https://s.shopee.co.th/GuardLink1";
  };
  dialog.append(output);
  dialog.append(button);
  doc.append(dialog);
  doc.button = button;
  return doc;
}

async function main() {
  const {SubId, Verify} = load();

  const missing = dialogDoc({slots: [1]});
  let result = await SubId.createLinkWithSubIds(missing, ["tiktok", "P1"], {
    expected_product_id: "26916762523",
    page_url: "https://affiliate.shopee.co.th/offer/product_offer/26916762523",
    intent_key: "a".repeat(64),
    output_timeout: 40
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, "subid_field_missing");
  assert.strictEqual(result.status, "not_attempted");
  assert.strictEqual(result.clicked, false);
  assert.strictEqual(missing.button.clicks, 0);

  const readback = dialogDoc();
  const input = readback.querySelector('input');
  const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
  Object.defineProperty(input, "value", {
    get() { return "changed-by-page"; },
    set() {}
  });
  result = await SubId.createLinkWithSubIds(readback, ["tiktok"], {
    expected_product_id: "26916762523",
    intent_key: "b".repeat(64),
    output_timeout: 40
  });
  assert.strictEqual(result.error, "fill_readback_mismatch");
  assert.strictEqual(result.clicked, false);
  assert.strictEqual(readback.button.clicks, 0);
  if (original) Object.defineProperty(input, "value", original);

  const batchDoc = dialogDoc();
  result = await SubId.createBatchLinks(batchDoc, [
    {product_id: "26916762523", sub_ids: ["tiktok", "P1"], intent_key: "c".repeat(64)},
    {product_id: "888", sub_ids: ["tiktok", "P2"], intent_key: "d".repeat(64)}
  ], {
    attested_product_id: "26916762523",
    page_url: "https://affiliate.shopee.co.th/offer/product_offer/26916762523",
    stop_on_error: false
  });
  assert.strictEqual(result.results[0].status, "confirmed");
  assert.strictEqual(result.results[0].product_id, "26916762523");
  assert.strictEqual(result.results[0].link_receipt.product_id, "26916762523");
  assert.strictEqual(result.results[1].status, "not_attempted");
  assert.strictEqual(result.results[1].error, "product_not_on_page");
  assert.strictEqual(result.results[1].clicked, false);
  assert.strictEqual(batchDoc.button.clicks, 1);

  SubId._memoryAttempts.clear();
  const replay = dialogDoc({fillOnClick: false});
  result = await SubId.createLinkWithSubIds(replay, ["tiktok"], {
    expected_product_id: "26916762523",
    page_url: "https://affiliate.shopee.co.th/offer/product_offer/26916762523",
    intent_key: "e".repeat(64),
    output_timeout: 30
  });
  assert.strictEqual(result.status, "unconfirmed");
  assert.strictEqual(replay.button.clicks, 1);
  result = await SubId.createLinkWithSubIds(replay, ["tiktok"], {
    expected_product_id: "26916762523",
    intent_key: "e".repeat(64),
    output_timeout: 30
  });
  assert.strictEqual(result.error, "create_not_replayed");
  assert.strictEqual(replay.button.clicks, 1);

  const owned = new El("html");
  owned.location = {pathname: "/my-links"};
  owned.append(new El("h1", {textContent: "My Links"}));
  const row = new El("tr");
  row.append(new El("a", {href: "https://s.shopee.co.th/GuardLink1?utm=1"}));
  row.append(new El("a", {href: "https://s.shopee.co.th/GuardLink1EXTRA"}));
  owned.append(row);
  let ownership = Verify.verifyOwnershipFromMyLinks(owned, "https://s.shopee.co.th/GuardLink1");
  assert.strictEqual(ownership.ownership_verified, true);
  ownership = Verify.verifyOwnershipFromMyLinks(owned, "https://s.shopee.co.th/GuardLink");
  assert.strictEqual(ownership.ownership_verified, false);

  const paged = new El("html");
  paged.location = {pathname: "/custom-link"};
  paged.append(new El("h2", {textContent: "Custom Link"}));
  paged.append(new El("button", {innerText: "ถัดไป", textContent: "ถัดไป"}));
  ownership = Verify.verifyOwnershipFromMyLinks(paged, "https://s.shopee.co.th/GuardLink1");
  assert.strictEqual(ownership.ownership_verified, "unknown");
  assert.strictEqual(ownership.evidence, "paginated_list_incomplete");

  const other = new El("html");
  other.location = {pathname: "/offer/product_offer"};
  other.append(new El("h1", {textContent: "Product offer"}));
  ownership = Verify.verifyOwnershipFromMyLinks(other, "https://s.shopee.co.th/GuardLink1");
  assert.strictEqual(ownership.ownership_verified, "unknown");
  assert.strictEqual(Verify.verifyFromDashboard().ownership_verified, "unknown");

  console.log("create guard tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
