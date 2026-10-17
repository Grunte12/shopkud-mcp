#!/usr/bin/env node
/**
 * Read-only / dry-run CLI for the dedicated affiliate Chrome.
 *
 * create-link --dry-run fills the form and does not submit.
 * create-link without --dry-run clicks submit once.
 * This CLI never opens a short link (s.shopee.co.th) and never types a password.
 */
import { chromium, type Browser, type Page, type Response } from 'patchright';
import { BrowserFlows } from './core/browser-flows.js';
import { parseProductUrl } from './config/selectors.js';
import { resolveCdpUrl } from './config/cdp.js';
import { ShopkudDatabase } from './core/database.js';
import { salesBy, type SalesDim } from './core/conversions.js';
import { headNoRedirect, ownershipFromLocation } from './core/verify-link.js';

const CDP_URL = resolveCdpUrl();
const PAGE_LOAD_BUDGET = 20;

interface EndpointHit {
  method: string;
  host: string;
  path: string;
  operation?: string;
  query_keys?: string[];
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return undefined;
  return process.argv[index + 1];
}

function has(flag: string): boolean {
  return process.argv.includes(flag);
}

function print(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

function printOfferAmounts(data: any) {
  if (data?.store_commission_percent == null) return;
  console.log(`SENSITIVE store_commission_percent=${data.store_commission_percent}`);
  console.log(`SENSITIVE shopee_commission_percent=${data.shopee_commission_percent}`);
  console.log(`SENSITIVE xtra_commission_percent=${data.xtra_commission_percent}`);
  console.log(`SENSITIVE total_commission_percent=${data.total_commission_percent}`);
  console.log(`SENSITIVE price_baht=${data.price_baht}`);
  console.log(`SENSITIVE commission_baht=${data.commission_baht}`);
  console.log(`SENSITIVE total_commission_baht=${data.total_commission_baht}`);
  console.log(`SENSITIVE commission_min_baht=${data.commission_min_baht}`);
  console.log(`SENSITIVE commission_max_baht=${data.commission_max_baht}`);
}

function pathOnly(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

async function humanPause() {
  const delay = 3000 + Math.random() * 2000;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

async function withOwnedPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const browser: Browser = await Promise.race([
    chromium.connectOverCDP(CDP_URL, { noDefaults: true }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('CDP connect timed out')), 10000);
    }),
  ]);
  let page: Page | null = null;
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error('No browser context. Is Chrome running with remote debugging?');
    page = await context.newPage();
    return await fn(page);
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function watch(page: Page) {
  const endpoints: EndpointHit[] = [];
  let loads = 0;
  let blockedShortLink = false;
  const onResponse = (response: Response) => {
    try {
      const type = response.request().resourceType();
      if (type !== 'xhr' && type !== 'fetch') return;
      const url = new URL(response.url());
      const hit: EndpointHit = { method: response.request().method(), host: url.host, path: url.pathname };
      const queryKeys = [...url.searchParams.keys()].filter((key) => key.length > 0 && key.length < 40);
      if (queryKeys.length > 0) hit.query_keys = queryKeys;
      const post = response.request().postData();
      if (post) {
        try {
          const body = JSON.parse(post);
          const name = typeof body?.operationName === 'string'
            ? body.operationName
            : (Array.isArray(body) ? body.find((item) => typeof item?.operationName === 'string')?.operationName : undefined);
          if (typeof name === 'string' && name.length > 0 && name.length < 80) hit.operation = name;
        } catch {
          // Non-JSON bodies stay path-only.
        }
      }
      if (!endpoints.some((item) => item.method === hit.method && item.host === hit.host && item.path === hit.path && item.operation === hit.operation && JSON.stringify(item.query_keys || []) === JSON.stringify(hit.query_keys || []))) {
        endpoints.push(hit);
      }
    } catch {
      // Ignore non-URL responses.
    }
  };
  const onNavigate = (frame: { url: () => string; parentFrame: () => unknown }) => {
    if (frame.parentFrame()) return;
    loads += 1;
    if (frame.url().includes('s.shopee.co.th')) blockedShortLink = true;
  };
  page.on('response', onResponse);
  page.on('framenavigated', onNavigate as (frame: unknown) => void);
  return {
    endpoints,
    loads: () => loads,
    blockedShortLink: () => blockedShortLink,
  };
}

async function pageVerdict(page: Page, flows: BrowserFlows): Promise<'ok' | 'captcha' | 'login' | 'ratelimit'> {
  const blockers = await flows.checkForBlockers();
  if (blockers.captcha) return 'captcha';
  if (blockers.login) return 'login';
  const text = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  const sample = text.slice(0, 1500);
  if (/too many requests|rate limit|ลองใหม่ภายหลัง|ถูกจำกัด/i.test(sample)) return 'ratelimit';
  if (/verify you are human|please verify|ยืนยันตัวตน|ไม่ใช่หุ่นยนต์/i.test(sample)) return 'captcha';
  return 'ok';
}

async function outline(page: Page) {
  return page.evaluate(`(() => {
    const clip = (value) => (value || '').trim().slice(0, 80);
    return {
      path: location.pathname,
      title: clip(document.title),
      inputs: Array.from(document.querySelectorAll('input, textarea, select')).slice(0, 40).map((el) => ({
        tag: el.tagName,
        type: el.getAttribute('type'),
        name: el.getAttribute('name'),
        id: el.id || '',
        placeholder: el.getAttribute('placeholder'),
        aria: el.getAttribute('aria-label'),
      })),
      buttons: Array.from(document.querySelectorAll('button, [role="button"]')).slice(0, 30).map((el) => clip(el.innerText)),
      headings: Array.from(document.querySelectorAll('h1,h2,h3,h4')).slice(0, 15).map((el) => clip(el.innerText)),
    };
  })()`);
}

function requireProductUrl(): { productUrl: string; shopId: string; itemId: string } {
  const productUrl = arg('--product-url');
  if (!productUrl) {
    throw new Error('Missing --product-url');
  }
  const parsed = parseProductUrl(productUrl);
  if (!parsed) throw new Error('Product URL must be https://shopee.co.th/product/{shop}/{item} or a slug -i.{shop}.{item} URL');
  return { productUrl, shopId: parsed.shopId, itemId: parsed.itemId };
}

async function commandConnectionStatus() {
  return withOwnedPage(async (page) => {
  const flows = new BrowserFlows(page);
  const verdict = await pageVerdict(page, flows);
  print({
    ok: verdict === 'ok',
    chrome_connected: true,
    cdp_url: CDP_URL,
    current_path: pathOnly(page.url()),
    verdict,
  });
  if (verdict === 'login') return 2;
  if (verdict !== 'ok') return 3;
  return 0;
  });
}

async function commandGetOffer() {
  const { itemId } = requireProductUrl();
  return withOwnedPage(async (page) => {
  const flows = new BrowserFlows(page);
  const result = await flows.getOfferData(itemId);
  print({
    ok: result.ok,
    status: result.status,
    error: result.error,
    endpoint_path: result.data?.endpoint_path || null,
    endpoints: result.data?.endpoints || [],
    source: result.data?.source || null,
    commission_captured: result.data?.commission_rate != null,
  });
  printOfferAmounts(result.data);
  return result.ok ? 0 : 1;
  });
}

async function commandCreateLink() {
  const dryRun = has('--dry-run');
  const { productUrl } = requireProductUrl();
  return withOwnedPage(async (page) => {
  const seen = watch(page);
  const flows = new BrowserFlows(page);
  const subIds = {
    sub_id1: arg('--sub-id1') || null,
    sub_id2: arg('--sub-id2') || null,
    sub_id3: arg('--sub-id3') || null,
    sub_id4: arg('--sub-id4') || null,
    sub_id5: arg('--sub-id5') || null,
  };
  const result = await flows.createCustomLink({
    product_url: productUrl,
    channel: arg('--channel') || 'test',
    sub_ids: subIds,
  }, { dryRun });
  const dryData = result.data && 'selectors' in result.data ? result.data : null;
  const created = result.data && 'short_link' in result.data ? result.data : null;
  print({
    ok: result.ok,
    status: result.status,
    error: result.error,
    dry_run: dryRun,
    submitted: dryRun ? false : result.submitted === true,
    all_required_resolved: dryData?.all_required_resolved ?? null,
    create_request_seen: dryData?.create_request_seen ?? Boolean(created),
    filled: dryData?.filled ?? {},
    selectors: (dryData?.selectors || []).map((item) => ({ name: item.name, resolved: item.resolved, count: item.count })),
    endpoints: dryData?.endpoints || [],
    fail_code: created?.fail_code ?? null,
    history_seen: created?.history_seen ?? false,
    page_loads: seen.loads(),
    short_link_opened: seen.blockedShortLink(),
    current_path: pathOnly(page.url()),
  });
  if (created?.short_link) {
    console.log(`SENSITIVE short_link=${created.short_link}`);
    console.log(`SENSITIVE sub_ids=${JSON.stringify(created.sub_ids)}`);
  }
  if (!result.ok) {
    console.log(`OUTLINE ${JSON.stringify(await outline(page))}`);
    if (result.status === 'captcha_detected') return 3;
  }
  return result.ok ? 0 : 1;
  });
}

async function commandReports() {
  return withOwnedPage(async (page) => {
  const flows = new BrowserFlows(page);
  const result = await flows.inspectReports();
  print({
    ok: result.ok,
    status: result.status,
    error: result.error,
    download_clicked: false,
    export_request_seen: result.data?.export_request_seen ?? false,
    selectors: (result.data?.selectors || []).map((item) => ({ name: item.name, resolved: item.resolved, count: item.count })),
    endpoints: result.data?.endpoints || [],
    current_path: pathOnly(page.url()),
  });
  if (!result.ok) {
    console.log(`OUTLINE ${JSON.stringify(await outline(page))}`);
  }
  return result.ok ? 0 : 1;
  });
}

async function commandSmoke() {
  const { productUrl, itemId } = requireProductUrl();
  return withOwnedPage(async (page) => {
  const flows = new BrowserFlows(page);
  const seen = watch(page);

  if (seen.loads() >= PAGE_LOAD_BUDGET) throw new Error('page load budget exceeded');
  await page.goto('https://affiliate.shopee.co.th/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  await page.waitForTimeout(2500);
  const initial = await pageVerdict(page, flows);
  const connection = {
    ok: initial === 'ok',
    chrome_connected: true,
    cdp_url: CDP_URL,
    current_path: pathOnly(page.url()),
    verdict: initial,
  };
  print({ step: 'get_connection_status', ...connection });
  if (initial === 'login') {
    console.log('LOGIN_REQUIRED: this Chrome is not logged in to affiliate.shopee.co.th. The new tab was closed. Existing tabs were left as they were.');
    return 2;
  }
  if (initial !== 'ok') {
    console.log(`STOPPED: ${initial}`);
    return 3;
  }
  if (seen.blockedShortLink()) {
    console.log('STOPPED: a short link host was opened');
    return 3;
  }

  let failed = false;
  await humanPause();
  const offer = await flows.getOfferData(itemId);
  const offerVerdict = await pageVerdict(page, flows);
  print({
    step: 'get_offer',
    ok: offer.ok && offerVerdict === 'ok',
    status: offerVerdict !== 'ok' ? offerVerdict : offer.status,
    error: offer.error,
    endpoint_path: offer.data?.endpoint_path || null,
    endpoints: seen.endpoints,
    source: offer.data?.source || null,
    commission_captured: offer.data?.store_commission_percent != null,
    page_loads: seen.loads(),
  });
  printOfferAmounts(offer.data);
  if (offerVerdict !== 'ok' || seen.blockedShortLink() || seen.loads() > PAGE_LOAD_BUDGET) {
    console.log(`OUTLINE ${JSON.stringify(await outline(page))}`);
    console.log(`STOPPED: ${seen.blockedShortLink() ? 'short_link' : offerVerdict !== 'ok' ? offerVerdict : 'page_budget'}`);
    return 3;
  }
  if (!offer.ok) {
    console.log(`OUTLINE ${JSON.stringify(await outline(page))}`);
    failed = true;
  }

  await humanPause();
  const created = await flows.createCustomLink({
    product_url: productUrl,
    channel: 'test',
    sub_ids: { sub_id1: 'test', sub_id2: 'smoke', sub_id3: null, sub_id4: null, sub_id5: null },
  }, { dryRun: true });
  const createdData = created.data && 'selectors' in created.data ? created.data : null;
  const createVerdict = await pageVerdict(page, flows);
  print({
    step: 'create_link_dry_run',
    ok: created.ok && createVerdict === 'ok' && createdData?.submitted === false,
    status: createVerdict !== 'ok' ? createVerdict : created.status,
    error: created.error,
    submitted: false,
    all_required_resolved: createdData?.all_required_resolved ?? false,
    create_request_seen: createdData?.create_request_seen ?? false,
    selectors: (createdData?.selectors || []).map((item) => ({ name: item.name, resolved: item.resolved, count: item.count })),
    endpoints: seen.endpoints,
    page_loads: seen.loads(),
  });
  if (createVerdict !== 'ok' || seen.blockedShortLink() || seen.loads() > PAGE_LOAD_BUDGET) {
    console.log(`OUTLINE ${JSON.stringify(await outline(page))}`);
    console.log(`STOPPED: ${seen.blockedShortLink() ? 'short_link' : createVerdict !== 'ok' ? createVerdict : 'page_budget'}`);
    return 3;
  }
  if (!created.ok || createdData?.submitted !== false) {
    console.log(`OUTLINE ${JSON.stringify(await outline(page))}`);
    failed = true;
  }

  await humanPause();
  const reports = await flows.inspectReports();
  const reportVerdict = await pageVerdict(page, flows);
  print({
    step: 'reports',
    ok: reports.ok && reportVerdict === 'ok' && reports.data?.download_clicked === false,
    status: reportVerdict !== 'ok' ? reportVerdict : reports.status,
    error: reports.error,
    download_clicked: false,
    export_request_seen: reports.data?.export_request_seen ?? false,
    selectors: (reports.data?.selectors || []).map((item) => ({ name: item.name, resolved: item.resolved, count: item.count })),
    endpoints: seen.endpoints,
    page_loads: seen.loads(),
  });
  if (!reports.ok || reportVerdict !== 'ok') {
    console.log(`OUTLINE ${JSON.stringify(await outline(page))}`);
  }
  if (seen.blockedShortLink()) {
    console.log('STOPPED: a short link host was opened');
    return 3;
  }
  if (seen.loads() > PAGE_LOAD_BUDGET) {
    console.log('STOPPED: page load budget exceeded');
    return 3;
  }
  return !failed && reports.ok && reportVerdict === 'ok' ? 0 : 1;
  });
}

function dbPath(): string {
  return process.env.SHOPKUD_DB_PATH || './shopkud.db';
}

async function commandGetConversions() {
  const from = arg('--from');
  const to = arg('--to');
  if (!from || !to) throw new Error('Missing --from or --to');
  const status = arg('--status');
  return withOwnedPage(async (page) => {
    const seen = watch(page);
    const flows = new BrowserFlows(page);
    const result = await flows.getConversions(from, to);
    if (result.status === 'captcha_detected') {
      print({ ok: false, status: result.status, error: result.error, page_loads: seen.loads() });
      return 3;
    }
    const asOf = new Date().toISOString();
    let rows = result.data?.rows || [];
    if (status) {
      const needle = status.toLowerCase();
      rows = rows.filter((row) => row.status.toLowerCase().includes(needle));
    }
    const db = new ShopkudDatabase(dbPath());
    if (result.ok && result.data) {
      db.saveConversions(rows, result.data.source, asOf);
      if (result.data.affiliate_id) db.saveAccountMarker(result.data.affiliate_id, asOf);
    }
    db.close();
    print({
      ok: result.ok,
      status: result.status,
      error: result.error,
      source: result.data?.source || null,
      endpoint_path: result.data?.endpoint_path || null,
      download_clicked: result.data?.download_clicked ?? false,
      row_count: rows.length,
      empty: rows.length === 0,
      page_loads: seen.loads(),
      short_link_opened: seen.blockedShortLink(),
      current_path: pathOnly(page.url()),
    });
    return result.ok ? 0 : 1;
  });
}

async function commandSalesBy() {
  const dim = arg('--dim') as SalesDim | undefined;
  const from = arg('--from');
  const to = arg('--to');
  const dims: SalesDim[] = ['sub_id', 'platform', 'clip', 'product'];
  if (!dim || !dims.includes(dim) || !from || !to) throw new Error('Usage: sales-by --dim sub_id|platform|clip|product --from YYYY-MM-DD --to YYYY-MM-DD');
  const status = arg('--status');
  const db = new ShopkudDatabase(dbPath());
  let rows = db.listConversions(from, to);
  db.close();
  if (status) {
    const needle = status.toLowerCase();
    rows = rows.filter((row) => row.status.toLowerCase().includes(needle));
  }
  print({
    ok: true,
    source: 'sqlite',
    dim,
    from,
    to,
    buckets: salesBy(rows, dim, from, to),
  });
  return 0;
}

async function commandVerifyLink() {
  const url = arg('--url');
  if (!url) throw new Error('Missing --url');
  const db = new ShopkudDatabase(dbPath());
  const marker = db.getAccountMarker();
  db.close();
  const head = await headNoRedirect(url);
  const decision = ownershipFromLocation(head.location, marker, head.status);
  print({
    ok: true,
    source: 'head',
    ownership_verified: decision.ownership_verified,
    target_verified: decision.target_verified,
    reason: decision.reason,
    http_status: decision.http_status,
    item_id_present: decision.item_id != null,
    marker_present: marker != null,
  });
  return 0;
}

async function main() {
  const command = process.argv[2];
  if (!command || command === '--help') {
    console.log('Usage: tsx src/cli.ts <connection-status|get-offer|create-link|reports|smoke|get-conversions|sales-by|verify-link>');
    return 0;
  }
  if (command === 'connection-status') return commandConnectionStatus();
  if (command === 'get-offer') return commandGetOffer();
  if (command === 'create-link') return commandCreateLink();
  if (command === 'reports') return commandReports();
  if (command === 'smoke') return commandSmoke();
  if (command === 'get-conversions') return commandGetConversions();
  if (command === 'sales-by') return commandSalesBy();
  if (command === 'verify-link') return commandVerifyLink();
  throw new Error(`Unknown command: ${command}`);
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
