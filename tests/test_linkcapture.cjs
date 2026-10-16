"use strict";

const assert = require("node:assert/strict");
const capture = require("../extension/linkcapture.js");

function field(value, visible, disabled = true) {
  return {
    value,
    disabled,
    getClientRects: () => (visible ? [{width: 10}] : []),
  };
}

function dialog(fields) {
  return {querySelectorAll: () => fields};
}

const shortLink = value => /^https:\/\/s\.shopee\.co\.th\/[A-Za-z0-9]+$/.test(value) ? value : null;

const visible = capture.choose([dialog([field("https://s.shopee.co.th/Visible1", true)])], shortLink);
assert.deepEqual(visible, {values: ["https://s.shopee.co.th/Visible1"], source: "visible_link_dialog"});

const hidden = capture.choose([dialog([field("https://s.shopee.co.th/Hidden1", false)])], shortLink);
assert.deepEqual(hidden, {values: ["https://s.shopee.co.th/Hidden1"], source: "hidden_link_field"});

const preferVisible = capture.choose([dialog([
  field("https://s.shopee.co.th/Hidden1", false),
  field("https://s.shopee.co.th/Visible1", true),
])], shortLink);
assert.equal(preferVisible.source, "visible_link_dialog");
assert.deepEqual(preferVisible.values, ["https://s.shopee.co.th/Visible1"]);

const ambiguous = capture.choose([dialog([
  field("https://s.shopee.co.th/Hidden1", false),
  field("https://s.shopee.co.th/Hidden2", false),
])], shortLink);
assert.equal(ambiguous.source, null);
assert.equal(ambiguous.values.length, 2);

console.log("linkcapture tests passed");
