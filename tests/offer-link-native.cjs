"use strict";

// Isolated end-to-end: local MCP -> temporary native host -> unpacked MV3
// extension -> synthetic affiliate detail page. Never use an owner's Chrome
// profile, installed native host, account, clipboard, or external network.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const PYTHON = process.env.SHOPKUD_TEST_PYTHON;
const CHROMIUM_PATH = process.env.SHOPEE_TEST_CHROMIUM ||
  chromium.executablePath();
const OFFER_URL = "https://affiliate.shopee.co.th/offer/product_offer/123";
const PRODUCT_URL = "https://shopee.co.th/product/12345/123";
const FIXTURE_LINK = "https://s.shopee.co.th/NativeFixture123";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}
function shellQuote(value) { return `'${String(value).replaceAll("'", "'\\''")}'`; }
function isolatedHostDirectory(home) {
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
  if (process.platform === "linux") return path.join(home, ".config", "chromium", "NativeMessagingHosts");
  throw new Error("unsupported_platform_for_isolated_native_messaging");
}
function extensionId(publicKeyDer) {
  return crypto.createHash("sha256").update(publicKeyDer).digest().subarray(0, 16)
    .toString("hex").replace(/[0-9a-f]/gu, digit => String.fromCharCode(97 + Number.parseInt(digit, 16)));
}
function delayedOfferPage() {
  const detail = `<main><div class="detail">
    <img class="offer-img main-image" src="https://down-th.img.susercontent.com/file/native-fixture-main.jpg" width="800" height="800">
    <div class="detail-info">
      <div class="name-wrap"><div class="name">Native Fixture Product</div><a href="${PRODUCT_URL}">ดูสินค้า</a></div>
      <span class="price">498.00</span>
      <div class="gallery"><img src="https://down-th.img.susercontent.com/file/native-fixture-gallery.jpg" width="600" height="600"></div>
      <button id="get-link">เอา ลิงก์</button>
    </div>
  </div><table><thead><tr><th>ประเภทช่องทาง</th><th>ค่าคอมช้อปปี้</th><th>ค่าคอมมิชชั่นโดยประมาณ</th></tr></thead>
    <tbody><tr><td>โซเชียลมีเดีย</td><td>2% (฿9.96)</td><td>฿9.96</td></tr></tbody></table></main>`;
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>Offline offer fixture</title></head><body>
    <main id="fixture-shell"><h1>Loading offer fixture…</h1></main><p id="fixture-phase">loading</p>
    <p id="offer-clicks">0</p><p id="copy-clicks">0</p>
    <script>
      window.__fixtureClicks = 0; window.__copyClicks = 0;
      setTimeout(() => {
        const shell = document.getElementById("fixture-shell");
        shell.innerHTML = ${JSON.stringify(detail)};
        document.getElementById("fixture-phase").textContent = "ready";
        document.getElementById("get-link").addEventListener("click", () => {
          window.__fixtureClicks++; document.getElementById("offer-clicks").textContent = String(window.__fixtureClicks);
          setTimeout(() => {
            const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog");
            dialog.innerHTML = '<h4>ลิงก์ข้อเสนอสินค้า</h4><textarea disabled>${FIXTURE_LINK}</textarea><button id="copy-fixture-link">คัดลอกลิงก์</button>';
            dialog.querySelector("#copy-fixture-link").addEventListener("click", () => { window.__copyClicks++; document.getElementById("copy-clicks").textContent = String(window.__copyClicks); });
            document.body.append(dialog);
          }, 450);
        });
      }, 1600);
    </script>
  </body></html>`;
}

async function run() {
  if (!PYTHON) throw new Error("Set SHOPKUD_TEST_PYTHON to Python with MCP SDK and uvicorn installed");
  const tempRoot = await fs.realpath(await fs.mkdtemp("/private/tmp/shopkud-offer-link-e2e-"));
  assert.ok(tempRoot.startsWith("/private/tmp/shopkud-offer-link-e2e-"), "temporary root must be newly allocated under /private/tmp");
  await fs.chmod(tempRoot, 0o700);
  const home = path.join(tempRoot, "home");
  const profile = path.join(tempRoot, "profile");
  const extensionCopy = path.join(tempRoot, "extension");
  const output = path.join(tempRoot, "output");
  await Promise.all([home, profile, output].map(dir => fs.mkdir(dir, { recursive: true, mode: 0o700 })));

  let context;
  let server;
  let serverStderr = "";
  const routeHits = [];
  const unexpectedRequests = [];
  try {
    const hostDir = isolatedHostDirectory(home);
    await fs.mkdir(hostDir, { recursive: true, mode: 0o700 });
    await fs.cp(path.join(ROOT, "extension"), extensionCopy, { recursive: true, errorOnExist: true, force: false });

    // Give this temporary unpacked extension an ephemeral ID so no installed
    // owner host can authorize it even if a platform ignores HOME isolation.
    const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
    const id = extensionId(publicKeyDer);
    const origin = `chrome-extension://${id}/`;
    const manifestPath = path.join(extensionCopy, "manifest.json");
    const extensionManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    extensionManifest.key = publicKeyDer.toString("base64");
    await fs.writeFile(manifestPath, JSON.stringify(extensionManifest, null, 2), { mode: 0o600 });
    assert.equal(extensionId(Buffer.from(extensionManifest.key, "base64")), id);

    const token = crypto.randomBytes(32).toString("hex");
    const port = await freePort();
    const configPath = path.join(tempRoot, "config.json");
    const socketPath = path.join(tempRoot, "native.sock");
    await fs.writeFile(configPath, JSON.stringify({ token, port, socket_path: socketPath, allowed_origins: [origin], workspace_enabled: true }), { mode: 0o600 });
    const launcher = path.join(tempRoot, "native-launcher");
    const nativeScript = path.join(ROOT, "shopkud_mcp", "native_host.py");
    await fs.writeFile(launcher, `#!/bin/sh\nexec ${shellQuote(PYTHON)} ${shellQuote(nativeScript)} --config ${shellQuote(configPath)} "$@"\n`, { mode: 0o700 });
    const nativeManifestPath = path.join(hostDir, "org.shopkud.mcp.json");
    assert.ok(nativeManifestPath.startsWith(home + path.sep), "native host manifest must be within the isolated HOME");
    await fs.writeFile(nativeManifestPath, JSON.stringify({ name: "org.shopkud.mcp", description: "isolated offer-link fixture", path: launcher, type: "stdio", allowed_origins: [origin] }), { mode: 0o600, flag: "wx" });

    const isolatedEnv = {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_DATA_HOME: path.join(home, ".local", "share"),
      XDG_CACHE_HOME: path.join(home, ".cache"),
      PYTHONPATH: ROOT,
    };
    await Promise.all([isolatedEnv.XDG_CONFIG_HOME, isolatedEnv.XDG_DATA_HOME, isolatedEnv.XDG_CACHE_HOME].map(dir => fs.mkdir(dir, { recursive: true, mode: 0o700 })));
    const versionResult = spawnSync(PYTHON, ["-c", "import importlib.metadata as m; print(m.version('shopkud-mcp'))"], { cwd: ROOT, env: isolatedEnv, encoding: "utf8" });
    assert.equal(versionResult.status, 0, versionResult.stderr);
    const packageVersion = versionResult.stdout.trim();
    const sourceVersion = /version\s*=\s*"([^"]+)"/u.exec(await fs.readFile(path.join(ROOT, "pyproject.toml"), "utf8"))?.[1];
    assert.equal(packageVersion, sourceVersion, "the local ShopKud package metadata must match this checkout");

    server = spawn(PYTHON, ["-m", "shopkud_mcp.server", "serve", "--config", configPath], { cwd: ROOT, env: isolatedEnv, stdio: ["ignore", "ignore", "pipe"] });
    server.stderr.on("data", data => { serverStderr += data.toString(); });
    for (let i = 0; i < 120; i++) {
      if (server.exitCode !== null) throw new Error(`isolated MCP server exited: ${serverStderr.slice(-2000)}`);
      try { await fs.stat(socketPath); break; } catch {}
      await pause(50);
    }
    const endpoint = `http://127.0.0.1:${port}/mcp`;
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(endpoint)).status === 401) { ready = true; break; } } catch {}
      await pause(50);
    }
    assert.equal(ready, true, "local MCP server must be ready before loading the temporary extension");

    const browserEnv = { ...isolatedEnv };
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", headless: true, viewport: { width: 1200, height: 900 }, env: browserEnv,
      ...(process.env.SHOPEE_TEST_CHROMIUM ? { executablePath: CHROMIUM_PATH } : {}),
      args: [
        `--disable-extensions-except=${extensionCopy}`,
        `--load-extension=${extensionCopy}`,
        "--disable-background-networking",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
      ],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 10000 });
    assert.equal(new URL(worker.url()).hostname, id, "only the temporary extension ID should be loaded");
    await context.route("**/*", route => {
      let requestUrl;
      try { requestUrl = new URL(route.request().url()); } catch { return route.abort(); }
      if (requestUrl.origin === "https://affiliate.shopee.co.th" && requestUrl.pathname === "/offer/product_offer") {
        routeHits.push(requestUrl.href);
        return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><html><body><main><h1>Offline owner page</h1></main></body></html>" });
      }
      if (requestUrl.origin === "https://affiliate.shopee.co.th" && requestUrl.pathname === "/offer/product_offer/123") {
        routeHits.push(requestUrl.href);
        return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: delayedOfferPage() });
      }
      unexpectedRequests.push(requestUrl.href);
      return route.abort();
    });

    const owner = await context.newPage();
    await owner.goto("https://affiliate.shopee.co.th/offer/product_offer");
    await owner.waitForFunction(() => document.querySelector("#shopkud-panel")?.shadowRoot?.getElementById("status")?.textContent.includes("เชื่อมต่อแล้ว"), null, { timeout: 12000 });
    const ownerBefore = await worker.evaluate(() => new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0]?.id))));
    const tabsBefore = await worker.evaluate(() => new Promise(resolve => {
      chrome.tabs.query({}, tabs => resolve(tabs.map(tab => tab.id)));
    }));
    assert.equal(tabsBefore.length, 1, "one isolated owner tab should exist before the MCP request");

    let sequence = 0;
    async function rpc(method, params = {}) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method, params }),
      });
      assert.equal(response.status, 200, `MCP ${method} must succeed`);
      const body = await response.json();
      assert.ok(!body.error, JSON.stringify(body.error));
      return body.result;
    }
    async function tool(name, args = {}) {
      const response = await rpc("tools/call", { name, arguments: args });
      assert.equal(response.isError, false, JSON.stringify(response));
      return response.structuredContent || JSON.parse(response.content[0].text);
    }
    await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "isolated-offer-link-eval", version: "1" } });
    const names = (await rpc("tools/list")).tools.map(item => item.name);
    assert.ok(names.includes("get_product_detail"));

    const before = new Set(context.pages());
    const pending = tool("get_product_detail", { offer_url: OFFER_URL, open_if_missing: true, open_link_dialog: true, save: true });
    const target = await context.waitForEvent("page", { timeout: 10000 });
    assert.ok(!before.has(target), "the extension must create exactly one new target tab");
    await target.waitForURL(OFFER_URL, { timeout: 10000 });
    await target.waitForSelector("#fixture-phase", { timeout: 10000 });

    // Content registration must arrive while the delayed page is still loading
    // its product DOM; openOffer must then wait for both tab-complete and registration.
    let earlyPage = null;
    for (let i = 0; i < 50; i++) {
      const listing = await tool("list_pages");
      earlyPage = listing.pages.find(page => page.url === OFFER_URL) || null;
      if (earlyPage && await target.locator("#fixture-phase").textContent() === "loading") break;
      await pause(60);
    }
    assert.ok(earlyPage, "the delayed detail tab must register before product details appear");
    assert.equal(await target.locator("#fixture-phase").textContent(), "loading", "early registration must precede fixture hydration");

    const result = await pending;
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.affiliate_url, FIXTURE_LINK);
    assert.equal(result.link_source, "visible_link_dialog");
    assert.equal(result.product_id, "123");
    assert.equal(result.history_saved, true);
    assert.deepEqual(result.history_receipt, {
      ok: true, saved: true, new_entry: true, product_id: "123", affiliate_link_saved: true,
      channel: null, sub_id: null, link_attribution_verified: false,
    });
    assert.equal(result.entry.created_tab, true);
    assert.equal(result.entry.reused_tab, false);
    assert.equal(result.entry.owner_tab_changed, false);
    assert.deepEqual(result.entry.readiness, {
      tab_complete: true, registered: true, owned: true, inactive: true, isolated_exact_url_attested: true,
    });

    assert.equal(context.pages().length, 2, "exactly one new browser tab should be created");
    assert.equal(await target.locator("#offer-clicks").textContent(), "1", "official Get Link must be clicked exactly once");
    assert.equal(await target.locator("#copy-clicks").textContent(), "0", "Copy and clipboard must never be used");
    assert.equal(await worker.evaluate(() => new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0]?.id)))), ownerBefore, "owner tab must remain active");
    const owned = await worker.evaluate(() => entryInfo({}));
    assert.equal(owned.ok, true);
    assert.equal(owned.entries.length, 1);
    assert.equal(owned.entries[0].entry_url, OFFER_URL);
    assert.equal(owned.entries[0].active, false);
    assert.equal(owned.entries[0].reusable_detail, true);
    const tabsAfter = await worker.evaluate(() => new Promise(resolve => {
      chrome.tabs.query({}, tabs => resolve(tabs.map(tab => ({ id: tab.id, active: tab.active, status: tab.status, urlAvailable: typeof tab.url === "string" }))));
    }));
    assert.equal(tabsAfter.length, 2);
    assert.equal(tabsAfter.filter(tab => !tabsBefore.includes(tab.id)).length, 1);
    assert.equal(tabsAfter.find(tab => tab.id === result.entry.tab_id).active, false);

    assert.ok(routeHits.includes(OFFER_URL), "the synthetic affiliate fixture must serve the created tab");
    assert.deepEqual(unexpectedRequests, [], "all non-fixture browser network traffic must remain blocked");
    const summary = {
      status: "pass",
      mcp_package_version: packageVersion,
      extension_package_version: result.entry.extension_version,
      temporary_home_isolated: browserEnv.HOME === home && browserEnv.XDG_CONFIG_HOME.startsWith(home + path.sep),
      temporary_native_manifest: nativeManifestPath,
      registration_before_fixture_ready: true,
      readiness: result.entry.readiness,
      created_tab_count: tabsAfter.length - tabsBefore.length,
      created_tab_active: tabsAfter.find(tab => tab.id === result.entry.tab_id).active,
      owner_tab_preserved_active: true,
      offer_url: OFFER_URL,
      returned_affiliate_url: result.affiliate_url,
      history_receipt: result.history_receipt,
      offer_button_clicks: Number(await target.locator("#offer-clicks").textContent()),
      copy_clicks: Number(await target.locator("#copy-clicks").textContent()),
      tab_url_available: owned.entries[0].tab_url_available,
      fixture_routes: routeHits,
      blocked_nonfixture_requests: unexpectedRequests.length,
    };
    await fs.writeFile(path.join(output, "result.json"), JSON.stringify(summary, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(summary));
  } catch (error) {
    console.error(JSON.stringify({ status: "fail", error: error.message, server_error: serverStderr.slice(-2000), fixture_routes: routeHits, blocked_nonfixture_requests: unexpectedRequests.slice(-10) }));
    throw error;
  } finally {
    if (context) await context.close();
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await Promise.race([new Promise(resolve => server.once("exit", resolve)), pause(3000)]);
      if (server.exitCode === null) server.kill("SIGKILL");
    }
    const cleanup = await fs.realpath(tempRoot);
    assert.equal(cleanup, tempRoot, "only the test-created temporary root may be removed");
    assert.ok(cleanup.startsWith("/private/tmp/shopkud-offer-link-e2e-"));
    await fs.rm(cleanup, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
