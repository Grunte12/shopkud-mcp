"use strict";

// Isolated reconnect lifecycle test. No browser, native host, or profile is used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8");

function event() {
  const listeners = [];
  return {
    addListener(fn) { listeners.push(fn); },
    removeListener(fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    fire(...args) { for (const fn of [...listeners]) fn(...args); },
  };
}

function harness() {
  const timers = new Map();
  let nextTimer = 1;
  const ports = [];
  const sentToTabs = [];
  let tabCreates = 0;
  let reloads = 0;
  const runtimeMessage = event();
  const tabsRemoved = event();
  const tabsUpdated = event();
  const chrome = {
    runtime: {
      id: "extension-id",
      lastError: null,
      reload() { reloads++; },
      getManifest: () => ({ version: "test" }),
      onMessage: runtimeMessage,
      connectNative(host) {
        const p = { host, messages: [], onDisconnect: event(), onMessage: event(), postMessage(value) { this.messages.push(value); } };
        ports.push(p);
        return p;
      },
    },
    tabs: {
      onRemoved: tabsRemoved,
      onUpdated: tabsUpdated,
      query: async () => [],
      sendMessage(tab, message, callback) { sentToTabs.push({ tab, message }); callback?.({}); },
      create: async () => { tabCreates++; return { id: 100 + tabCreates }; },
      get(_tab, callback) { callback({ status: "complete" }); },
    },
  };
  const context = vm.createContext({
    chrome,
    URL,
    Map,
    Promise,
    Object,
    Array,
    Number,
    String,
    RegExp,
    setTimeout(fn, delay) { const id = nextTimer++; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(source, context, { filename: "background.js" });
  return {
    context,
    ports, timers, sentToTabs, get tabCreates() { return tabCreates; }, get reloads() { return reloads; }, runtimeMessage,
    fireTimer(id) { const timer = timers.get(id); assert.ok(timer, `timer ${id} exists`); timers.delete(id); timer.fn(); },
    fireDelay(delay) { const entry = [...timers].find(([, timer]) => timer.delay === delay); assert.ok(entry, `timer ${delay}ms exists`); this.fireTimer(entry[0]); },
    connectMessage() {
      runtimeMessage.fire({ type: "shopkud-connect", page_url: "https://affiliate.shopee.co.th/offer/product_offer/123" }, {
        id: "extension-id", frameId: 0, tab: { id: 7 }, url: "https://affiliate.shopee.co.th/offer/product_offer/123",
      }, () => {});
    },
    registerPage() {
      runtimeMessage.fire({ type: "shopkud-register", nonce: "a".repeat(32), page_url: "https://affiliate.shopee.co.th/offer/product_offer/123" }, {
        id: "extension-id", frameId: 0, tab: { id: 7 }, url: "https://affiliate.shopee.co.th/offer/product_offer/123",
      }, () => {});
    },
  };
}

async function run() {
  const h = harness();
  const helpers = vm.runInContext("({confirmedLinkReceipts,sanitizeDashboard})", h.context);
  const receipts = helpers.confirmedLinkReceipts("create_link_with_subids", {product_id:"123",sub_ids:["twitter","clip-1"]}, {
    ok:true,status:"confirmed",product_id:"123",affiliate_url:"https://s.shopee.co.th/Abc123",link_receipt:{created_at:"2026-10-25T00:00:00.000Z"}
  });
  assert.equal(JSON.stringify(receipts),JSON.stringify([{product_id:"123",affiliate_url:"https://s.shopee.co.th/Abc123",sub_ids:["twitter","clip-1"],status:"confirmed",created_at:"2026-10-25T00:00:00.000Z"}]),"confirmed link receipts are safe and dashboard-ready");
  assert.equal(helpers.confirmedLinkReceipts("create_link_with_subids", {product_id:"123",sub_ids:["x"]}, {ok:true,status:"confirmed",product_id:"123",affiliate_url:"https://evil.example/x"}).length,0,"foreign link receipts are rejected");
  const dashboard = helpers.sanitizeDashboard({schema_version:1,query:"ทีวี",channel:"social",freshness:"live",partial_market_coverage:false,cache_hit:false,cache_age_ms:0,
    criteria:{target_kind:"product",required_terms:["ทีวี"]},winner_product_id:"123",winner_status:"metric_leader_pending_agent_review",review_required:true,candidate_verification_partial:false,scan:{},exclusions:{},results:[{product_id:"123",name:"ทีวี",shop_name:" ร้านทางการ ",shop_id:"456",offer_url:"https://affiliate.shopee.co.th/offer/product_offer/123",
      product_url:"https://shopee.co.th/product/456/123",shop_url:"https://shopee.co.th/shop/456",mall:true,
      commission_channels:[{channel:"social",label:"โซเชียลมีเดีย",commission_pct:7,commission_thb_per_order:1297,extra_commission_pct:5,shopee_commission_pct:2},{channel:"bad",commission_pct:999}]}],winner_product_id:"123"});
  assert.equal(dashboard.results[0].shop_name,"ร้านทางการ","store name survives the MCP-to-dashboard boundary");
  assert.equal(dashboard.results[0].shop_id,"456","matching store evidence survives the MCP-to-dashboard boundary");
  assert.equal(dashboard.results[0].product_url,"https://shopee.co.th/product/456/123","canonical product URL survives");
  assert.equal(dashboard.results[0].shop_url,"https://shopee.co.th/shop/456","matching canonical shop URL survives");
  assert.equal(dashboard.criteria.target_kind,"product","target intent survives the MCP-to-dashboard boundary");
  assert.deepEqual(dashboard.criteria.required_terms,["ทีวี"],"hard identity terms survive the MCP-to-dashboard boundary");
  assert.equal(dashboard.review_required,true,"metric leader stays pending Agent review");
  assert.equal(JSON.stringify(dashboard.results[0].commission_channels),JSON.stringify([{channel:"social",label:"โซเชียลมีเดีย",commission_pct:7,commission_thb_per_order:1297,extra_commission_pct:5,shopee_commission_pct:2}]),"bounded observed commission channels survive while unknown channels are rejected");
  assert.equal(h.ports.length, 1, "startup connects once");

  h.ports[0].onDisconnect.fire();
  assert.equal(h.timers.size, 1, "disconnect schedules one reconnect");
  h.fireDelay(1000);
  assert.equal(h.ports.length, 2, "first timer reconnects once");
  h.ports[1].onDisconnect.fire();
  assert.equal(h.timers.size, 1, "second failure keeps one reconnect timer");
  h.fireDelay(3000);
  assert.equal(h.ports.length, 3, "second timer reconnects once");
  h.ports[2].onDisconnect.fire();
  assert.equal(h.timers.size, 1, "third failure keeps one reconnect timer");
  h.fireDelay(8000);
  assert.equal(h.ports.length, 4, "third timer reconnects once");
  h.ports[3].onDisconnect.fire();
  assert.equal(h.timers.size, 1, "fourth failure retains one reconnect timer");
  h.fireDelay(15000);
  assert.equal(h.ports.length, 5, "fourth timer reconnects once");
  h.ports[4].onDisconnect.fire();
  assert.equal(h.timers.size, 1, "long outage still keeps one pending timer");
  assert.equal([...h.timers.values()][0].delay, 15000, "backoff saturates at fifteen seconds");
  h.fireDelay(15000);
  assert.equal(h.ports.length, 6, "reconnect continues after the backoff saturates");
  h.ports[5].onDisconnect.fire();
  assert.equal(h.timers.size, 1, "repeated failures continue with one timer");

  const reset = harness();
  reset.ports[0].onDisconnect.fire();
  reset.fireDelay(1000);
  reset.ports[1].onMessage.fire({ type: "hello-ack" });
  reset.ports[1].onDisconnect.fire();
  reset.fireDelay(1000);
  assert.equal(reset.ports.length, 3, "hello-ack resets backoff to first delay");

  const manual = harness();
  manual.ports[0].onDisconnect.fire();
  const pending = [...manual.timers.keys()][0];
  manual.connectMessage();
  assert.ok(!manual.timers.has(pending), "manual same-host connect cancels pending timer");
  assert.equal(manual.ports.length, 2, "manual connect creates a port");
  manual.connectMessage();
  assert.equal(manual.ports.length, 2, "existing port prevents duplicate manual connect");

  const safety = harness();
  safety.registerPage();
  const oldPort = safety.ports[0];
  oldPort.onDisconnect.fire();
  safety.fireDelay(1000);
  const newPort = safety.ports[1];
  const command = { type: "command", id: "b".repeat(32), page_id: "7:" + "a".repeat(32), operation: "snapshot", arguments: {} };
  newPort.onMessage.fire(command);
  newPort.onMessage.fire({...command, id: "c".repeat(32), operation: "selector_health"});
  newPort.onMessage.fire({...command, id: "d".repeat(32), operation: "create_link_with_subids"});
  assert.equal(safety.sentToTabs.filter(x => x.message.type === "shopkud-command").length, 3);
  assert.ok(safety.sentToTabs.some(x => x.message.operation === "selector_health"));
  assert.ok(safety.sentToTabs.some(x => x.message.operation === "create_link_with_subids"));
  oldPort.onDisconnect.fire();
  assert.equal(safety.timers.size, 0, "stale port disconnect cannot schedule over current port");
  assert.equal(safety.ports.length, 2, "stale port does not replace or drop current port");
  newPort.onDisconnect.fire();
  safety.fireDelay(3000);
  assert.equal(safety.ports.length, 3);
  assert.equal(safety.ports[2].messages.some(m => m.type === "command"), false, "commands are not replayed");
  assert.equal(safety.tabCreates, 0, "reconnection never creates a browser tab");

  const reload = harness();
  const reloadPort = reload.ports[0];
  reloadPort.onMessage.fire({type:"command",id:"e".repeat(32),page_id:"extension",operation:"reload_extension",arguments:{}});
  assert.equal(JSON.stringify(reloadPort.messages.at(-1)),JSON.stringify({type:"result",id:"e".repeat(32),result:{ok:true,status:"reloading",extension_version:"test"}}));
  assert.equal(reload.reloads,0,"reload waits until its receipt is sent");
  reload.fireDelay(100);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reload.reloads,1,"idle extension reloads once");

  console.log(JSON.stringify({ ok: true, checks: [
    "startup and bounded single reconnects",
    "saturating reconnect backoff continues and hello-ack resets",
    "manual connect timer cancellation and existing-port dedupe",
    "no command replay or tab creation; stale disconnect is harmless",
    "idle-only extension reload returns a receipt before reloading",
    "safe link receipt capture and store-name preservation",
  ] }));
}

run().catch(error=>{console.error(error);process.exitCode=1;});
