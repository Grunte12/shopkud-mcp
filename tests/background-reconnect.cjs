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

function run() {
  const h = harness();
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
  assert.equal(reload.reloads,1,"idle extension reloads once");

  console.log(JSON.stringify({ ok: true, checks: [
    "startup and bounded single reconnects",
    "saturating reconnect backoff continues and hello-ack resets",
    "manual connect timer cancellation and existing-port dedupe",
    "no command replay or tab creation; stale disconnect is harmless",
    "idle-only extension reload returns a receipt before reloading",
  ] }));
}

run();
