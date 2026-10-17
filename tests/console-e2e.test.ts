import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext, type Page, type Request } from 'playwright';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { request as httpRequest, type Server } from 'http';
import { startConsole, startMockChrome, type Harness } from './fixtures/console-harness.js';

/**
 * Playwright against the real console server, seeded sqlite files and a fake Chrome port.
 * Nothing here talks to a real Chrome or to Shopee. Screenshots go to docs/console-screenshots/.
 * Browser: SHOPKUD_TEST_CHROME=/path/to/chrome, or Playwright's chromium (npx playwright install chromium).
 */
const SHOTS = 'docs/console-screenshots';
const MOCK_CHROME_PORT = 9451;
const READ_PORT = 3151;
const WRITE_PORT = 3152;
const EMPTY_PORT = 3153;

let browser: Browser;
let chrome: Server;
let reader: Harness;
let writer: Harness;
let empty: Harness;
let context: BrowserContext;
let page: Page;
let requests: Request[] = [];

function bangkokDay(offset = 0): string {
  return new Date(Date.now() + 7 * 3600_000 - offset * 86_400_000).toISOString().slice(0, 10);
}

async function api(base: string, tool: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`${base}/api/v1/tools/${tool}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ShopKud-Console': '1' }, body: JSON.stringify(args),
  });
  return res.json();
}

async function open(base: string, id: string) {
  await page.goto(`${base}/#/${id}`);
  await page.reload();
  await page.waitForSelector(`main[data-ready="${id}"]`, { timeout: 15_000 });
}

async function shot(name: string, fullPage = true) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
}

async function confirmOk(withCheck = false) {
  const dialog = page.locator('#confirm-dialog');
  await dialog.waitFor({ state: 'visible' });
  if (withCheck) {
    assert.equal(await page.locator('#confirm-ok').isDisabled(), true, 'confirm is locked until the box is ticked');
    await page.locator('#confirm-check').check();
  }
  await page.locator('#confirm-ok').click();
  await dialog.waitFor({ state: 'detached' });
}

async function confirmCancel() {
  await page.locator('#confirm-dialog').waitFor({ state: 'visible' });
  await page.locator('#confirm-cancel').click();
  await page.locator('#confirm-dialog').waitFor({ state: 'detached' });
}

function toolCalls(name: string): Request[] {
  return requests.filter((r) => r.method() === 'POST' && r.url().endsWith(`/api/v1/tools/${name}`));
}

before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  chrome = await startMockChrome(MOCK_CHROME_PORT);
  reader = await startConsole({ port: READ_PORT, chromePort: MOCK_CHROME_PORT, captcha: true });
  writer = await startConsole({ port: WRITE_PORT, chromePort: MOCK_CHROME_PORT, captcha: false });
  empty = await startConsole({ port: EMPTY_PORT, chromePort: null, empty: true });
  const candidates = [process.env.SHOPKUD_TEST_CHROME, '/usr/local/bin/google-chrome'].filter((p): p is string => Boolean(p && existsSync(p)));
  browser = await chromium.launch({ headless: true, executablePath: candidates[0], args: ['--no-sandbox'] });
  context = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true, locale: 'th-TH' });
  page = await context.newPage();
  page.on('request', (r) => requests.push(r));
});

after(async () => {
  await context?.close();
  await browser?.close();
  await reader?.stop();
  await writer?.stop();
  await empty?.stop();
  await new Promise((r) => chrome?.close(r));
});

describe('Overview', () => {
  test('captcha stop shows red tiles and a what-to-do guide', async () => {
    await open(reader.url, 'overview');
    assert.equal(await page.locator('#tile-chrome').getAttribute('data-tone'), 'ok');
    assert.equal(await page.locator('#tile-login').getAttribute('data-tone'), 'ok');
    assert.equal(await page.locator('#tile-queue').getAttribute('data-tone'), 'bad');
    assert.equal(await page.locator('#tile-stop').getAttribute('data-tone'), 'bad');
    assert.match(await page.locator('#tile-stop').innerText(), /CAPTCHA/);
    assert.equal(await page.locator('#stop-guide li').count(), 4);
    assert.equal(await page.locator('#budgets .gauge').count(), 6);
    assert.match(await page.locator('#page-load-note').innerText(), /cap/);
    assert.equal(await page.locator('#checklist [data-state="done"]').count(), 6);
    assert.match(await page.locator('#conn-text').innerText(), /Chrome พร้อม/);
    await shot('01-overview-captcha-stop');
  });

  test('healthy state has green stop tile and no guide', async () => {
    await open(writer.url, 'overview');
    assert.equal(await page.locator('#tile-stop').getAttribute('data-tone'), 'ok');
    assert.equal(await page.locator('#stop-guide').count(), 0);
    await shot('01b-overview-healthy');
  });

  test('fresh install with Chrome down explains what to do', async () => {
    await open(empty.url, 'overview');
    assert.equal(await page.locator('#tile-chrome').getAttribute('data-tone'), 'bad');
    assert.equal(await page.locator('#tile-login').getAttribute('data-tone'), 'warn');
    assert.equal(await page.locator('#sync-card').getAttribute('data-tone'), 'idle');
    assert.ok(await page.locator('#stop-guide').isVisible());
    assert.match(await page.locator('#conn-text').innerText(), /ยังไม่เชื่อม/);
    await shot('01c-overview-chrome-down-empty');
  });

  test('a failing API shows an error box with retry', async () => {
    await page.route('**/api/v1/tools/setup_status', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'boom' }) }));
    await page.goto(`${reader.url}/#/overview`);
    await page.reload();
    await page.locator('.error-box').first().waitFor();
    assert.match(await page.locator('.error-box').first().innerText(), /boom/);
    await page.unroute('**/api/v1/tools/setup_status');
    await page.getByRole('button', { name: 'ลองใหม่' }).click();
    await page.waitForSelector('#tile-chrome');
  });
});

describe('Workflow', () => {
  test('pipeline diagram has colored steps and details', async () => {
    await open(reader.url, 'workflow');
    await page.waitForTimeout(900);
    assert.equal(await page.locator('.pnode').count(), 6);
    assert.equal(await page.locator('#step-product').getAttribute('data-tone'), 'ok');
    assert.equal(await page.locator('#step-offer').getAttribute('data-tone'), 'warn');
    assert.equal(await page.locator('#step-create').getAttribute('data-tone'), 'bad');
    assert.equal(await page.locator('#step-verify').getAttribute('data-tone'), 'bad');
    await page.locator('#step-offer').click();
    assert.match(await page.locator('#step-detail').innerText(), /ตรวจ offer/);
    assert.ok(await page.locator('#step-go').isVisible());
    await shot('02-workflow');
  });

  test('queue controls are disabled when the backend has no queue tools', async () => {
    assert.equal(await page.locator('#jobs-table tbody tr').count(), 3);
    const resume = page.locator('tr[data-status="captcha_stopped"] button[data-action="resume"]');
    assert.equal(await resume.isDisabled(), true);
    assert.match((await resume.getAttribute('data-tip')) || '', /queue_resume/);
    assert.equal(await page.locator('#jobs-table button[data-action="pause"]').first().isDisabled(), true);
  });

  test('queue controls work behind a confirm dialog once the tools exist', async () => {
    await page.route('**/api/v1/tools', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const response = await route.fetch();
      const body = await response.json();
      return route.fulfill({ response, json: { ...body, tools: [...body.tools, 'queue_pause', 'queue_resume', 'queue_stop'] } });
    });
    await page.route('**/api/v1/tools/queue_pause', (route) => route.fulfill({ json: { ok: true } }));
    await open(reader.url, 'workflow');
    const pause = page.locator('tr[data-status="pending"] button[data-action="pause"]');
    assert.equal(await pause.isDisabled(), false);
    const before = toolCalls('queue_pause').length;
    await pause.click();
    await confirmCancel();
    assert.equal(toolCalls('queue_pause').length, before, 'cancel sends nothing');
    await pause.click();
    const sent = page.waitForRequest((r) => r.url().endsWith('/api/v1/tools/queue_pause'));
    await confirmOk();
    const body = JSON.parse((await sent).postData() || '{}');
    assert.match(body.job_id, /^[0-9a-f]{32}$/);
    await page.unroute('**/api/v1/tools');
    await page.unroute('**/api/v1/tools/queue_pause');
  });
});

describe('How Sub ID works', () => {
  test('animated diagram plays through all five stages', async () => {
    await open(reader.url, 'subid');
    await page.waitForSelector('#xp[data-step="5"]', { timeout: 9000 });
    assert.equal(await page.locator('.xp-stage.is-on').count(), 5);
    assert.equal(await page.locator('.xp-stage .chip-row').count(), 5, 'chips in links, click, order stages');
    await shot('03-subid-explainer');
    await page.locator('#xp-replay').click();
    assert.equal(await page.locator('#xp').getAttribute('data-step'), '0');
    await page.waitForSelector('#xp[data-step="5"]', { timeout: 9000 });
  });

  test('dashboard regroups by the chosen chip and exposes untracked orders', async () => {
    assert.equal(await page.locator('#xp-dash-table').getAttribute('data-group'), 'platform');
    await page.locator('.segmented[data-name="group"] button[data-value="2"]').click();
    assert.equal(await page.locator('#xp-dash-table').getAttribute('data-group'), 'clip');
    const none = page.locator('#xp-dash-table [data-key="(none)"]');
    assert.ok(await none.isVisible());
    assert.match(await none.innerText(), /ไม่มีชิป/);
    await shot('03b-subid-explainer-group-by-clip', false);
  });

  test('every slot has a plain-Thai tooltip and a fixed color', async () => {
    const colors = await page.$$eval('.anatomy-slot', (els) => els.map((el) => getComputedStyle(el.querySelector('.chip')!).color));
    assert.deepEqual(colors, ['rgb(37, 99, 235)', 'rgb(234, 88, 12)', 'rgb(22, 163, 74)', 'rgb(147, 51, 234)', 'rgb(219, 39, 119)']);
    const tips = await page.$$eval('.anatomy-slot .has-tip', (els) => els.map((el) => el.getAttribute('data-tip')));
    assert.equal(tips.length, 5);
    for (const tip of tips) assert.match(tip || '', /[\u0E00-\u0E7F]/);
  });
});

describe('Links', () => {
  test('registry renders chips, owned_by_us badges and empty-slot hints', async () => {
    await open(reader.url, 'links');
    assert.equal(await page.locator('#links-table tbody tr').count(), 7);
    assert.equal(await page.locator('[data-owned-by-us="true"]').count(), 3);
    assert.equal(await page.locator('[data-owned-by-us="false"]').count(), 1);
    assert.equal(await page.locator('[data-owned-by-us="unknown"]').count(), 3);
    assert.equal(await page.locator('.gap-note').count(), 3);
    assert.equal(await page.locator('#links-table .chip-row').count(), 7);
    assert.equal(await page.locator('#links-table .chip').count(), 35);
    const s1 = await page.$eval('#links-table .chip[data-slot="1"]', (el) => getComputedStyle(el).color);
    assert.equal(s1, 'rgb(37, 99, 235)', 'same s1 color as the explainer');
    assert.equal(await page.locator('a[href*="shopee"]').count(), 0, 'short links are plain text');
    await shot('04-links-registry');
  });

  test('filters narrow the registry', async () => {
    await page.locator('#filter-gaps').check();
    assert.equal(await page.locator('#links-table tbody tr').count(), 3);
    await page.locator('#filter-gaps').uncheck();
    await page.locator('#filter-owner').selectOption('false');
    assert.equal(await page.locator('#links-table tbody tr').count(), 1);
    await page.locator('#filter-owner').selectOption('');
    await page.locator('#filter-q').fill('202610');
    assert.equal(await page.locator('#links-table tbody tr').count(), 6);
    await page.locator('#filter-q').fill('');
  });

  test('builder shows a live colored preview, tooltips and empty-slot warnings', async () => {
    await page.locator('.segmented[data-name="links-tab"] button[data-value="builder"]').click();
    await page.locator('#product-url').fill('https://shopee.co.th/หูฟัง-i.9001.111');
    await page.locator('#fill-example').click();
    assert.equal(await page.locator('#preview-utm').innerText(), 'tiktok-P1-v6-a-202610');
    assert.equal(await page.locator('.issue-warn').count(), 0);
    assert.equal(await page.locator('#preview .chip').count(), 5);

    await page.locator('#slot-3').fill('');
    await page.locator('#slot-4').fill('');
    await page.locator('.issue-warn[data-code="empty_slot"][data-slot="3"]').waitFor();
    assert.equal(await page.locator('.issue-warn[data-code="empty_slot"]').count(), 2);
    assert.equal(await page.locator('#preview .chip[data-empty="1"]').count(), 2);
    assert.equal(await page.locator('#preview-utm').innerText(), 'tiktok-P1---202610');

    const expected: Record<number, RegExp> = { 1: /แพลตฟอร์ม|TikTok/, 2: /รหัสสินค้า/, 3: /คลิป/, 4: /แบบ/, 5: /202610/ };
    for (const n of [1, 2, 3, 4, 5]) {
      const tip = (await page.locator(`#tip-${n}`).getAttribute('data-tip')) || '';
      assert.match(tip, expected[n]);
    }
    await page.locator('#tip-3').hover();
    await shot('04b-links-builder-live-preview', false);
  });

  test('bad characters and bad URLs block the button', async () => {
    await page.locator('#slot-2').fill('P-1');
    assert.equal(await page.locator('#submit').isDisabled(), true);
    assert.match(await page.locator('#issues').innerText(), /ห้ามมี -/);
    await page.locator('#slot-2').fill('P1');
    assert.equal(await page.locator('#submit').isDisabled(), false);
    await page.locator('#product-url').fill('https://example.com/x');
    assert.equal(await page.locator('#submit').isDisabled(), true);
    await page.locator('#product-url').fill('https://shopee.co.th/หูฟัง-i.9001.111');
  });

  test('dry-run is the default and writes nothing', async () => {
    await page.locator('#fill-example').click();
    assert.equal(await page.locator('#dry-run').isChecked(), true);
    assert.match(await page.locator('#submit').innerText(), /dry-run/);
    const before = toolCalls('create_link').length;
    await page.locator('#submit').click();
    await page.locator('#dry-result').waitFor();
    assert.equal(await page.locator('#dry-result').getAttribute('data-exists'), '1');
    assert.match(await page.locator('#dry-result').innerText(), /ยังไม่ได้เขียนอะไรเลย/);
    assert.equal(toolCalls('create_link').length, before);
    await shot('04c-links-builder-dry-run', false);
  });

  test('real submit needs the switch off, a confirm dialog and a ticked box', async () => {
    await page.locator('#dry-run').uncheck({ force: true });
    assert.match(await page.locator('#submit').innerText(), /สร้างลิงก์จริง/);
    assert.equal(await page.locator('#builder').getAttribute('data-mode'), 'real');
    await page.locator('#submit').click();
    await page.locator('#confirm-dialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#confirm-ok').isDisabled(), true);
    assert.match(await page.locator('#confirm-dialog').innerText(), /placeholder/);
    await shot('04d-links-confirm-dialog', false);
    await confirmCancel();
    assert.equal(toolCalls('create_link').length, 0, 'cancelling creates nothing');
  });

  test('confirmed real submit calls create_link once and refreshes the registry', async () => {
    await open(writer.url, 'links');
    const before = (await api(writer.url, 'find_link', {})).links.length;
    await page.locator('.segmented[data-name="links-tab"] button[data-value="builder"]').click();
    await page.locator('#product-url').fill('https://shopee.co.th/หูฟัง-i.9001.111');
    await page.locator('#fill-example').click();
    await page.locator('#slot-3').fill('v99');
    await page.locator('#dry-run').uncheck({ force: true });
    await page.locator('#submit').click();
    const sent = page.waitForRequest((r) => r.url().endsWith('/api/v1/tools/create_link'));
    await confirmOk(true);
    const call = await sent;
    assert.equal(call.headers()['x-shopkud-console'], '1');
    assert.deepEqual(JSON.parse(call.postData() || '{}'), {
      product_url: 'https://shopee.co.th/หูฟัง-i.9001.111', channel: 'tiktok', clip_id: 'v99',
      sub_ids: { sub_id1: 'tiktok', sub_id2: 'P1', sub_id3: 'v99', sub_id4: 'a', sub_id5: '202610' },
    });
    await page.locator('#create-ok').waitFor();
    assert.equal(await page.locator('#create-ok').getAttribute('data-created'), '1');
    assert.match(await page.locator('#create-ok').innerText(), /placeholder/);
    assert.equal((await api(writer.url, 'find_link', {})).links.length, before + 1);

    await page.locator('#submit').click();
    await confirmOk(true);
    await page.waitForFunction(() => document.querySelector('#create-ok')?.getAttribute('data-created') === '0');
    assert.equal((await api(writer.url, 'find_link', {})).links.length, before + 1, 'same Sub IDs are not duplicated');
  });
});

describe('Offers', () => {
  test('stacked bar splits store, Shopee and Xtra in percent and baht', async () => {
    await open(reader.url, 'offers');
    assert.equal(await page.locator('#offers-table tbody tr').count(), 5);
    assert.equal(await page.locator('#offers-table tr[data-excluded="1"]').count(), 1);
    await page.locator('button[data-pick="111"]').click();
    await page.locator('#offer-result[data-item="111"]').waitFor();
    assert.deepEqual(await page.$$eval('#offer-result .stack-seg', (els) => els.map((el) => el.getAttribute('data-seg'))), ['store', 'shopee', 'xtra']);
    assert.equal(await page.locator('#offer-total').innerText(), '12.5% · ฿73.75');
    const legend = await page.locator('#offer-legend').innerText();
    assert.match(legend, /8% = ฿47\.20/);
    assert.match(legend, /3% = ฿17\.70/);
    assert.match(legend, /1\.5% = ฿8\.85/);
    assert.match(await page.locator('#offer-result').innerText(), /จากแคช/);
    assert.match(await page.locator('#offer-result').innerText(), /ราคาย้อนหลัง/);
    assert.ok(await page.locator('#suggestions .mini-card').first().isVisible());
    await shot('05-offers-stacked-bar');
  });

  test('excluded category shows a warning with its citation as plain text', async () => {
    await page.locator('button[data-pick="333"]').click();
    await page.waitForSelector('#offer-result[data-item="333"]');
    assert.equal(await page.locator('#offer-result').getAttribute('data-excluded'), '1');
    const text = await page.locator('#offer-result .notice-bad').innerText();
    assert.match(text, /ไม่ได้ค่าคอม/);
    assert.match(text, /เครื่องประดับ/);
    assert.match(text, /help\.shopee\.co\.th\/portal\/10\/article\/132895/);
    assert.equal(await page.locator('a[href*="shopee"]').count(), 0);
    await shot('05b-offers-excluded-category');
  });

  test('an unknown item asks before opening a Shopee page and sends nothing when declined', async () => {
    await page.locator('#offer-item-id').fill('666');
    const before = toolCalls('get_offer').length;
    await page.locator('#offer-go').click();
    await page.locator('#confirm-dialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#confirm-dialog').innerText(), /page load/);
    await confirmCancel();
    assert.equal(toolCalls('get_offer').length, before);
    assert.match(await page.locator('#offer-out').innerText(), /ไม่ได้เปิดหน้า Shopee/);
    await page.locator('#offer-item-id').fill('abc');
    await page.locator('#offer-go').click();
    assert.match(await page.locator('#offer-out').innerText(), /ต้องเป็นตัวเลข/);
  });

  test('a live offer response with Shopee and Xtra baht values is rendered as sent', async () => {
    await page.route('**/api/v1/tools/get_offer', (route) => route.fulfill({
      json: {
        ok: true, source: 'cdp', as_of: new Date().toISOString(),
        offer: {
          item_id: '111', price: 1000, store_commission_percent: 10, store_commission_baht: 100, shopee_commission_percent: 2, shopee_commission_baht: 20,
          xtra_commission_percent: 1, excluded_category: false, warnings: [],
        },
      },
    }));
    await page.locator('#offer-item-id').fill('111');
    await page.locator('#offer-go').click();
    await page.waitForSelector('#offer-result[data-source="cdp"]');
    assert.equal(await page.locator('#offer-total').innerText(), '13% · ฿130.00');
    assert.match(await page.locator('#offer-legend [data-part="xtra"]').innerText(), /1% = ฿10\.00 \(คำนวณ\)/);
    assert.match(await page.locator('#offer-result').innerText(), /ดึงสดจาก Chrome/);
    await page.unroute('**/api/v1/tools/get_offer');
  });
});

describe('Analytics', () => {
  test('KPI cards match sales_by totals', async () => {
    await open(reader.url, 'analytics');
    const from = bangkokDay(29);
    const to = bangkokDay(0);
    const sales = await api(reader.url, 'sales_by', { dim: 'sub_id', from, to });
    const sum = (key: string) => sales.buckets.reduce((s: number, b: any) => s + b[key], 0);
    assert.equal((await page.locator('#kpi-orders .kpi-value').innerText()).replace(/,/g, ''), String(sum('orders')));
    assert.equal((await page.locator('#kpi-cancelled .kpi-value').innerText()).replace(/,/g, ''), String(sum('cancelled')));
    assert.match(await page.locator('#kpi-commission .kpi-value').innerText(), /^฿[\d,]+\.\d{2}$/);
    assert.match(await page.locator('#kpi-gmv .kpi-value').innerText(), /^฿/);
    assert.equal(await page.locator('[data-chart="timeseries"]').getAttribute('data-points'), '30');
  });

  test('sales_by switches between platform, product, clip, variant, month and sub_id', async () => {
    assert.equal(await page.locator('#dim-view').getAttribute('data-dim'), 'platform');
    for (const dim of ['product', 'clip', 'variant', 'month', 'sub_id']) {
      await page.locator(`.segmented[data-name="dim"] button[data-value="${dim}"]`).click();
      assert.equal(await page.locator('#dim-view').getAttribute('data-dim'), dim);
      assert.ok(await page.locator('#dim-table tbody tr').count() > 0, dim);
    }
    await page.locator('.segmented[data-name="dim"] button[data-value="sub_id"]').click();
    assert.ok(await page.locator('#dim-table .chip-row').count() > 0, 'full Sub IDs render as chips');
    await page.locator('.segmented[data-name="dim"] button[data-value="clip"]').click();
    assert.ok(await page.locator('#dim-table [data-key="(none)"]').count() > 0, 'empty clip bucket is labeled');
  });

  test('Sankey connects platform, clip and order result', async () => {
    assert.ok(await page.locator('[data-chart="sankey"] .sankey-node').count() >= 5);
    assert.ok(await page.locator('[data-chart="sankey"] .sankey-link').count() >= 4);
    assert.ok(await page.locator('[data-chart="sankey"] [data-node="o:cancel"]').count() === 1);
  });

  test('untracked share is big and matches the API', async () => {
    const sales = await api(reader.url, 'sales_by', { dim: 'sub_id', from: bangkokDay(29), to: bangkokDay(0) });
    const none = sales.buckets.find((b: any) => b.key === '(none)');
    assert.ok(none, 'seed has untracked orders');
    assert.equal(await page.locator('#untracked-orders').innerText(), String(none.orders));
    assert.notEqual(await page.locator('#untracked').getAttribute('data-tone'), 'ok');
    assert.ok(await page.locator('#untracked [data-chart="donut"]').isVisible());
  });

  test('commission alerts, cancellation reasons and earnings are explained', async () => {
    const statuses = await page.$$eval('.alert-card', (els) => els.map((el) => el.getAttribute('data-status')).sort());
    assert.deepEqual(statuses, ['dropped', 'oos', 'removed']);
    assert.match(await page.locator('.alert-card[data-item="111"]').innerText(), /ค่าคอมลดลง · ตอนนี้ 8%/, 'export has no old_rate, so only the current rate is shown');
    const reasons = await page.$$eval('#cancel-list .cancel-item', (els) => els.map((el) => el.getAttribute('data-reason')));
    assert.ok(reasons.includes('order_cancelled_or_returned'));
    assert.match(await page.locator('#cancel-list').innerText(), /ผู้ซื้อยกเลิกหรือคืนสินค้า/);
    assert.match(await page.locator('#earnings').innerText(), /฿1,000\.00/);
    assert.match(await page.locator('#earnings .notice-warn').innerText(), /17\d วัน/);
    await shot('06-analytics');
  });

  test('changing the range reloads with fewer days, and re-checking health asks first', async () => {
    await page.locator('.segmented[data-name="range"] button[data-value="7"]').click();
    await page.waitForFunction(() => document.querySelector('[data-chart="timeseries"]')?.getAttribute('data-points') === '7');
    assert.match(await page.locator('#range-note').innerText(), new RegExp(bangkokDay(6)));
    const before = toolCalls('check_commission_health').length;
    await page.locator('#run-health').click();
    await confirmCancel();
    assert.equal(toolCalls('check_commission_health').length, before);
    await page.locator('#run-health').click();
    await confirmOk();
    await page.locator('.toast', { hasText: 'ตรวจ 5 สินค้า' }).waitFor();
    assert.equal(toolCalls('check_commission_health').length, before + 1);
    assert.match(await page.locator('.alert-card[data-item="111"]').innerText(), /ลดจาก 10% เหลือ 8%/, 'the check result carries old and new rates');
  });
});

describe('Tools and settings', () => {
  test('convert_links_in_text swaps a product URL for the registry link without opening it', async () => {
    await open(reader.url, 'tools');
    await page.locator('#convert-text').fill('ดูหูฟังที่ https://shopee.co.th/หูฟัง-i.9001.111 และ https://shopee.co.th/x-i.1.99999');
    await page.locator('#convert-channel').selectOption('tiktok');
    await page.locator('#convert-go').click();
    await page.locator('#convert-result').waitFor();
    const result = await page.locator('#convert-result').inputValue();
    assert.match(result, /https:\/\/s\.shopee\.co\.th\/seed\dx111/);
    assert.equal(await page.locator('#convert-table tr[data-replaced="1"]').count(), 1);
    assert.equal(await page.locator('#convert-table tr[data-replaced="0"]').count(), 1);
    assert.equal(await page.locator('a[href*="shopee"]').count(), 0);
    assert.ok(requests.every((r) => !/shopee\.co\.th/.test(new URL(r.url()).hostname)), 'no request ever left for Shopee');
  });

  test('export buttons download CSV with a BOM and JSON from the documented endpoint', async () => {
    assert.equal(await page.locator('#export-grid .export-item').count(), 9);
    const [csv] = await Promise.all([page.waitForEvent('download'), page.locator('.export-item[data-kind="links"] a[data-format="csv"]').click()]);
    assert.equal(csv.suggestedFilename(), 'shopkud-links.csv');
    const body = readFileSync((await csv.path())!, 'utf8');
    assert.ok(body.startsWith('\uFEFFitem_id,short_link'));
    const [json] = await Promise.all([page.waitForEvent('download'), page.locator('.export-item[data-kind="conversions"] a[data-format="json"]').click()]);
    const parsed = JSON.parse(readFileSync((await json.path())!, 'utf8'));
    assert.ok(parsed.count > 50);
  });

  test('missions are read-only until prepare is confirmed, and never go to Shopee', async () => {
    assert.equal(await page.locator('#missions-table tbody tr').count(), 2);
    await page.locator('#mission-id').fill('m-test');
    await page.locator('#mission-name').fill('มิชชั่นทดสอบ');
    await page.locator('#mission-preview').click();
    await page.locator('#mission-plan-box').waitFor();
    assert.equal(await page.locator('#mission-plan-box').getAttribute('data-submitted'), 'false');
    assert.equal(await page.locator('#missions-table tbody tr').count(), 2, 'preview wrote nothing');
    await page.locator('#mission-prepare').click();
    await confirmCancel();
    assert.equal(await page.locator('#missions-table tbody tr').count(), 2);
  });

  test('posting caps change only after a confirm dialog', async () => {
    await open(writer.url, 'tools');
    const row = page.locator('.cap-row[data-platform="fb"]');
    assert.equal(await row.locator('.gauge').getAttribute('data-max'), '5');
    assert.match(await row.innerText(), /ตั้งเอง/);
    await page.locator('#cap-fb').fill('7');
    await page.locator('button[data-save="fb"]').click();
    await confirmCancel();
    assert.equal((await api(writer.url, 'posting_budget', { platform: 'fb' })).cap, 5);
    await page.locator('button[data-save="fb"]').click();
    await confirmOk();
    await page.waitForFunction(() => document.querySelector('.cap-row[data-platform="fb"] .gauge')?.getAttribute('data-max') === '7');
    assert.equal((await api(writer.url, 'posting_budget', { platform: 'fb' })).cap, 7);
  });

  test('mission prepare writes a prepared row after confirm', async () => {
    await page.locator('#mission-id').fill('m-test');
    await page.locator('#mission-name').fill('มิชชั่นทดสอบ');
    await page.locator('#mission-preview').click();
    await page.locator('#mission-prepare').click();
    await confirmOk(true);
    await page.waitForSelector('#missions-table tr[data-mission="m-test"]');
    assert.match(await page.locator('#missions-table tr[data-mission="m-test"]').innerText(), /prepared/);
    const listed = await api(writer.url, 'list_missions', {});
    const mission = listed.missions.find((m: any) => m.mission_id === 'm-test');
    assert.equal(mission.status, 'prepared');
    assert.equal(mission.enrolled, false);
  });

  test('logs list the API calls made and the safety rules are visible', async () => {
    await page.locator('#logs-refresh').click();
    await page.locator('#log-table tbody tr').first().waitFor();
    assert.ok(await page.locator('#log-table tr[data-tool="posting_budget"]').count() > 0);
    assert.ok(await page.locator('#log-table tr[data-tool="set_posting_cap"]').count() > 0);
    assert.equal(await page.locator('#safety li').count(), 6);
    await shot('07-tools-settings');
  });
});

describe('Safety rules', () => {
  test('a tour of every page only uses localhost, the documented API and the console header', async () => {
    requests = [];
    for (const id of ['overview', 'workflow', 'subid', 'links', 'offers', 'analytics', 'tools']) await open(reader.url, id);
    assert.ok(requests.length > 20);
    for (const r of requests) {
      const url = new URL(r.url());
      assert.equal(url.hostname, '127.0.0.1', r.url());
      const allowed = url.pathname === '/' || url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/')
        || url.pathname.startsWith('/api/v1/tools') || url.pathname.startsWith('/api/v1/export/');
      assert.ok(allowed, `unexpected request ${r.method()} ${url.pathname}`);
      if (r.method() === 'POST') assert.equal(r.headers()['x-shopkud-console'], '1', url.pathname);
    }
    const tools = new Set(requests.filter((r) => r.method() === 'POST').map((r) => r.url().split('/').pop()));
    for (const forbidden of ['get_conversions', 'verify_link', 'create_link', 'enroll_mission', 'set_posting_cap', 'get_offer', 'check_commission_health']) {
      assert.ok(!tools.has(forbidden), `${forbidden} must not run on page load`);
    }
  });

  test('no page contains an anchor to s.shopee.co.th', async () => {
    for (const id of ['links', 'tools', 'offers']) {
      await open(reader.url, id);
      assert.equal(await page.locator('a[href*="shopee"]').count(), 0, id);
    }
  });

  test('cookies and tokens in a response never reach the screen', async () => {
    await page.route('**/api/v1/tools/setup_status', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      return route.fulfill({
        response,
        json: { ...body, cookie: 'SESSION=abc-secret-cookie', steps: [...body.steps, { key: 'x', state: 'done', detail: 'ok', token: 'tok-secret-123' }], password: 'pw-secret' },
      });
    });
    await open(reader.url, 'overview');
    const text = await page.locator('body').innerText();
    const html = await page.content();
    for (const secret of ['abc-secret-cookie', 'tok-secret-123', 'pw-secret']) {
      assert.ok(!text.includes(secret) && !html.includes(secret), secret);
    }
    await page.unroute('**/api/v1/tools/setup_status');
  });

  test('the API itself refuses a non-local Host and a missing console header', async () => {
    const hostile = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port: READ_PORT, path: '/api/v1/tools', headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode || 0); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(hostile, 403);
    const noHeader = await fetch(`${reader.url}/api/v1/tools/setup_status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(noHeader.status, 403);
  });

  test('nav reaches all seven pages', async () => {
    await open(reader.url, 'overview');
    const ids = await page.$$eval('#nav .nav-item', (els) => els.map((el) => (el as HTMLElement).dataset.page));
    assert.deepEqual(ids, ['overview', 'workflow', 'subid', 'links', 'offers', 'analytics', 'tools']);
    for (const id of ids) {
      await page.locator(`#nav .nav-item[data-page="${id}"]`).click();
      await page.waitForSelector(`main[data-ready="${id}"]`);
      assert.equal(await page.locator('#nav .nav-item.active').getAttribute('data-page'), id);
    }
  });
});
