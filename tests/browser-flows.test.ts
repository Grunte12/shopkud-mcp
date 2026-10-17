import { test, before, after } from 'node:test';
import assert from 'node:assert';
import type { Server } from 'http';
import { chromium, type Browser, type BrowserContext } from 'patchright';
import { BrowserFlows, type CreateLinkDryRunData } from '../src/core/browser-flows.js';
import { parseProductUrl, isValidProductUrl } from '../src/config/selectors.js';
import { listenMockAffiliate, type MockAffiliateState } from './fixtures/mock-affiliate-pages.js';

const PRODUCT_URL = 'https://shopee.co.th/product/12345/67890';
const SUB_IDS = {
  sub_id1: 'test',
  sub_id2: 'smoke',
  sub_id3: null,
  sub_id4: null,
  sub_id5: null,
};

let server: Server;
let baseUrl: string;
let state: MockAffiliateState;
let browser: Browser;

function resetState() {
  state.createCalls = 0;
  state.offerDetailCalls = 0;
  state.reportExportCalls = 0;
  state.reportListCalls = 0;
}

async function openFlows(extra: { customLinkPage?: string; offerPage?: string; reportsPage?: string } = {}) {
  const context: BrowserContext = await browser.newContext();
  const page = await context.newPage();
  const flows = new BrowserFlows(page, { affiliateBase: baseUrl, fast: true, ...extra });
  return { context, page, flows };
}

before(async () => {
  const listening = await listenMockAffiliate(0);
  server = listening.server;
  baseUrl = listening.baseUrl;
  state = listening.state;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});

after(async () => {
  await browser?.close();
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('parseProductUrl accepts slug and /product/shop/item forms', () => {
  assert.deepStrictEqual(
    parseProductUrl('https://shopee.co.th/some-name-i.111.222'),
    { shopId: '111', itemId: '222' },
  );
  assert.deepStrictEqual(
    parseProductUrl(PRODUCT_URL),
    { shopId: '12345', itemId: '67890' },
  );
  assert.strictEqual(isValidProductUrl('https://example.com/product/1/2'), false);
  assert.strictEqual(isValidProductUrl('http://shopee.co.th/product/1/2'), false);
});

test('createCustomLink dry-run resolves selectors, fills fields, and does not submit', async () => {
  resetState();
  const { context, page, flows } = await openFlows();
  try {
    const result = await flows.createCustomLink({
      product_url: PRODUCT_URL,
      channel: 'tiktok',
      sub_ids: SUB_IDS,
    }, { dryRun: true });

    assert.strictEqual(result.ok, true, result.error);
    assert.strictEqual(result.status, 'success');
    const data = result.data as CreateLinkDryRunData;
    assert.strictEqual(data.dry_run, true);
    assert.strictEqual(data.submitted, false);
    assert.strictEqual(data.all_required_resolved, true);
    assert.strictEqual(data.create_request_seen, false);
    assert.strictEqual(state.createCalls, 0);
    assert.strictEqual(data.filled.product_url, true);
    assert.strictEqual(data.filled.sub_id1, true);
    assert.strictEqual(data.filled.sub_id2, true);

    for (const name of ['productUrlInput', 'subId1Input', 'subId2Input', 'subId3Input', 'subId4Input', 'subId5Input', 'submitButton']) {
      const check = data.selectors.find((item) => item.name === name);
      assert.ok(check?.resolved, `${name} should resolve`);
    }

    assert.strictEqual(await page.locator('textarea[placeholder*="shopee.co.th"]').inputValue(), PRODUCT_URL);
    assert.strictEqual(await page.locator('#customLink_sub_id1').inputValue(), 'test');
    assert.strictEqual(await page.locator('#customLink_sub_id2').inputValue(), 'smoke');
    assert.strictEqual(await page.locator('[role="dialog"]').isVisible(), false);
    assert.ok(!page.url().includes('s.shopee.co.th'));
  } finally {
    await context.close();
  }
});

test('createCustomLink dry-run reports unresolved selectors and does not submit', async () => {
  resetState();
  const { context, flows } = await openFlows({ customLinkPage: `${baseUrl}/fixture/empty` });
  try {
    const result = await flows.createCustomLink({
      product_url: PRODUCT_URL,
      channel: 'tiktok',
      sub_ids: SUB_IDS,
    }, { dryRun: true });
    const data = result.data as CreateLinkDryRunData;
    assert.strictEqual(result.ok, false);
    assert.strictEqual(data.submitted, false);
    assert.strictEqual(data.all_required_resolved, false);
    assert.strictEqual(state.createCalls, 0);
    assert.ok(data.selectors.some((item) => item.name === 'submitButton' && !item.resolved));
  } finally {
    await context.close();
  }
});

test('createCustomLink on the mock submits only when dry-run is off', async () => {
  resetState();
  const { context, page, flows } = await openFlows();
  try {
    const result = await flows.createCustomLink({
      product_url: PRODUCT_URL,
      channel: 'tiktok',
      sub_ids: SUB_IDS,
    });
    assert.strictEqual(result.ok, true, result.error);
    assert.strictEqual(result.submitted, true);
    assert.strictEqual(state.createCalls, 1);
    assert.ok(result.data && 'short_link' in result.data);
    if (result.data && 'short_link' in result.data) {
      assert.match(result.data.short_link, /^https:\/\/s\.shopee\.co\.th\/[A-Za-z0-9]+$/);
      assert.strictEqual(result.data.history_seen, true);
      assert.strictEqual(result.data.item_id, '67890');
      assert.strictEqual(result.data.shop_id, '12345');
    }
    assert.ok(!page.url().includes('s.shopee.co.th'));
  } finally {
    await context.close();
  }
});

test('getOfferData reads commission from the offer JSON and does not open a short link', async () => {
  resetState();
  const { context, page, flows } = await openFlows();
  try {
    const result = await flows.getOfferData('67890');
    assert.strictEqual(result.ok, true, result.error);
    assert.strictEqual(result.data.store_commission_percent, 10);
    assert.strictEqual(result.data.total_commission_percent, 12);
    assert.strictEqual(result.data.shopee_commission_percent, 2);
    assert.strictEqual(result.data.xtra_commission_percent, 0);
    assert.strictEqual(result.data.checkout_commission_percent, 0.6);
    assert.strictEqual(result.data.commission_rate, 10);
    assert.strictEqual(result.data.price_baht, 299);
    assert.strictEqual(result.data.commission_baht, 29.9);
    assert.strictEqual(result.data.commission_max_baht, 59.9);
    assert.strictEqual(result.data.source, 'network_capture');
    assert.strictEqual(result.data.endpoint_path, '/api/v3/offer/product');
    assert.ok(state.offerDetailCalls >= 1);
    assert.strictEqual(await page.locator('[role="dialog"]').isVisible(), false);
    assert.ok(!page.url().includes('s.shopee.co.th'));
  } finally {
    await context.close();
  }
});

test('getConversions reads the report list and does not download or open a short link', async () => {
  resetState();
  const { context, page, flows } = await openFlows();
  try {
    const result = await flows.getConversions('2026-01-01', '2026-12-31');
    assert.strictEqual(result.ok, true, result.error);
    assert.strictEqual(result.data?.source, 'report_list');
    assert.strictEqual(result.data?.endpoint_path, '/api/v3/report/list');
    assert.strictEqual(result.data?.download_clicked, false);
    assert.strictEqual(result.data?.affiliate_id, '42');
    assert.strictEqual(result.data?.rows.length, 2);
    assert.strictEqual(result.data?.status_query_key, 'checkout_status');
    assert.strictEqual(result.data?.status_filter, 'none');
    assert.strictEqual(result.data?.rows[0].sub_id1, 'tiktok');
    assert.strictEqual(result.data?.rows[0].sub_id2, 'P1');
    assert.strictEqual(result.data?.rows[0].sub_id3, 'clip');
    assert.strictEqual(result.data?.rows[0].sub_id5, '202610');
    assert.strictEqual(result.data?.rows[0].gmv, 100);
    assert.strictEqual(result.data?.rows[0].commission, 10);
    assert.strictEqual(result.data?.rows[0].cancelled, 0);
    assert.ok(!page.url().includes('s.shopee.co.th'));
  } finally {
    await context.close();
  }
});

test('getConversions sends checkout_status when the list URL already has that key', async () => {
  resetState();
  const { context, page, flows } = await openFlows();
  try {
    const result = await flows.getConversions('2026-01-01', '2026-12-31', 'Cancelled');
    assert.strictEqual(result.ok, true, result.error);
    assert.strictEqual(result.data?.status_filter, 'server');
    assert.strictEqual(result.data?.status_query_key, 'checkout_status');
    assert.strictEqual(result.data?.rows.length, 1);
    assert.strictEqual(result.data?.rows[0].sub_id1, 'ig');
    assert.strictEqual(result.data?.rows[0].cancelled, 1);
    assert.ok(!page.url().includes('s.shopee.co.th'));
  } finally {
    await context.close();
  }
});

test('inspectReports checks selectors and does not export', async () => {
  resetState();
  const { context, flows } = await openFlows();
  try {
    const result = await flows.inspectReports();
    assert.strictEqual(result.ok, true, result.error);
    assert.strictEqual(result.data?.download_clicked, false);
    assert.strictEqual(result.data?.export_request_seen, false);
    assert.strictEqual(state.reportExportCalls, 0);
    assert.ok((state.reportListCalls || 0) >= 1);
    for (const name of ['dateRangeStart', 'dateRangeEnd', 'downloadButton', 'reportTable']) {
      const check = result.data?.selectors.find((item) => item.name === name);
      assert.ok(check?.resolved, `${name} should resolve`);
    }
    assert.ok(result.data?.endpoints.some((line) => line.includes('/api/v3/gql') || line.includes('/api/v3/goods/categoryList')));
  } finally {
    await context.close();
  }
});

test('CAPTCHA page stops createCustomLink and getOfferData before any create', async () => {
  resetState();
  const captchaUrl = `${baseUrl}/fixture/captcha`;
  const { context, flows } = await openFlows({ customLinkPage: captchaUrl, offerPage: captchaUrl });
  try {
    const blockers = await (async () => {
      const context2 = await browser.newContext();
      const page = await context2.newPage();
      await page.goto(captchaUrl);
      const seen = await new BrowserFlows(page, { fast: true }).checkForBlockers();
      await context2.close();
      return seen;
    })();
    assert.strictEqual(blockers.captcha, true);
    assert.strictEqual(blockers.login, false);

    const created = await flows.createCustomLink({
      product_url: PRODUCT_URL,
      channel: 'tiktok',
      sub_ids: SUB_IDS,
    }, { dryRun: true });
    assert.strictEqual(created.status, 'captcha_detected');
    assert.strictEqual(state.createCalls, 0);

    const offer = await flows.getOfferData('67890');
    assert.strictEqual(offer.status, 'captcha_detected');
  } finally {
    await context.close();
  }
});

test('login page stops createCustomLink and report inspection', async () => {
  resetState();
  const loginUrl = `${baseUrl}/fixture/login`;
  const { context, flows } = await openFlows({ customLinkPage: loginUrl, reportsPage: loginUrl });
  try {
    const created = await flows.createCustomLink({
      product_url: PRODUCT_URL,
      channel: 'tiktok',
      sub_ids: SUB_IDS,
    });
    assert.strictEqual(created.status, 'login_required');
    assert.strictEqual(state.createCalls, 0);

    const reports = await flows.inspectReports();
    assert.strictEqual(reports.status, 'login_required');
    assert.strictEqual(state.reportExportCalls, 0);
  } finally {
    await context.close();
  }
});
