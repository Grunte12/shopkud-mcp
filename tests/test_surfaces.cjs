"use strict";

const assert = require("node:assert/strict");
const surfaces = require("../extension/surfaces.js");

const earnings = surfaces.readEarnings("รอดำเนินการ 1,200.50\nตรวจสอบแล้ว 80.00\nจ่ายแล้ว 10");
assert.equal(earnings.pending, "1200.50");
assert.equal(earnings.validated, "80.00");
assert.equal(earnings.paid, "10");
assert.equal(earnings.opens_links, false);
assert.equal(earnings.kyc_status, "unknown");
const verified = surfaces.readEarnings("ยืนยัน (Valid)\nรอบการจ่ายถัดไป");
assert.equal(verified.kyc_status, "verified");
assert.equal(verified.opens_links, false);

const level = surfaces.readVideoLevel("เลเวล 2\nวันใช้งาน 16\nคลิปผ่านเกณฑ์ 18");
assert.equal(level.level, 2);
assert.equal(level.active_days, 16);
assert.equal(level.qualifying_clips, 18);

let clicks = 0;
const doc = {
  querySelectorAll: () => [{textContent: "เผยแพร่", click: () => { clicks += 1; }}],
};
const draft = surfaces.planVideoDraft(doc, {file_name: "clip.mp4"});
assert.equal(draft.clicked_publish, false);
assert.equal(draft.publish_allowed, false);
assert.equal(draft.publish_control_present, true);
assert.equal(clicks, 0);
const swap = surfaces.planCartSwap(doc);
assert.equal(swap.clicked_save, false);
assert.equal(swap.submitted_to_shopee, false);
assert.equal(clicks, 0);

console.log("surfaces tests passed");
