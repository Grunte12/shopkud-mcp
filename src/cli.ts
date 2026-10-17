#!/usr/bin/env node
/**
 * Read-only / dry-run CLI for the dedicated affiliate Chrome.
 *
 * create-link refuses to submit unless --dry-run is set. This CLI never
 * clicks a short link (s.shopee.co.th) and never types a password.
 */
import { chromium, type Browser, type Page, type Response } from 'patchright';
import { BrowserFlows } from './core/browser-flows.js';
import { parseProductUrl } from './config/selectors.js';
import { resolveCdpUrl } from './config/cdp.js';

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
  if (result.data?.store_commission_percent != null) {
    console.log(`SENSITIVE store_commission_percent=${result.data.store_commission_percent}`);
    console.log(`SENSITIVE price_baht=${result.data.price_baht}`);
    console.log(`SENSITIVE commission_baht=${result.data.commission_baht}`);
    console.log(`SENSITIVE commission_min_baht=${result.data.commission_min_baht}`);
    console.log(`SENSITIVE commission_max_baht=${result.data.commission_max_baht}`);
  }
  return result.ok ? 0 : 1;
  });
}

async function commandCreateLink() {
  if (!has('--dry-run')) {
    print({
      ok: false,
      error: 'refusing_to_submit',
      message: 'create-link will not submit. Re-run with --dry-run.',
    });
    return 1;
  }
  const { productUrl } = requireProductUrl();
  return withOwnedPage(async (page) => {
  const flows = new BrowserFlows(page);
  const result = await flows.createCustomLink({
    product_url: productUrl,
    channel: arg('--channel') || 'test',
    sub_ids: {
      sub_id1: arg('--sub-id1') || null,
      sub_id2: arg('--sub-id2') || null,
      sub_id3: arg('--sub-id3') || null,
      sub_id4: arg('--sub-id4') || null,
      sub_id5: arg('--sub-id5') || null,
    },
  }, { dryRun: true });
  const data = result.data && 'selectors' in result.data ? result.data : null;
  print({
    ok: result.ok,
    status: result.status,
    error: result.error,
    dry_run: true,
    submitted: false,
    all_required_resolved: data?.all_required_resolved ?? false,
    create_request_seen: data?.create_request_seen ?? false,
    filled: data?.filled ?? {},
    selectors: (data?.selectors || []).map((item) => ({ name: item.name, resolved: item.resolved, count: item.count })),
    endpoints: data?.endpoints || [],
    current_path: pathOnly(page.url()),
  });
  if (!result.ok) {
    console.log(`OUTLINE ${JSON.stringify(await outline(page))}`);
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
  if (offer.data?.store_commission_percent != null) {
    console.log(`SENSITIVE store_commission_percent=${offer.data.store_commission_percent}`);
    console.log(`SENSITIVE price_baht=${offer.data.price_baht}`);
    console.log(`SENSITIVE commission_baht=${offer.data.commission_baht}`);
    console.log(`SENSITIVE commission_min_baht=${offer.data.commission_min_baht}`);
    console.log(`SENSITIVE commission_max_baht=${offer.data.commission_max_baht}`);
  }
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

async function main() {
  const command = process.argv[2];
  if (!command || command === '--help') {
    console.log('Usage: tsx src/cli.ts <connection-status|get-offer|create-link|reports|smoke> [--product-url URL] [--dry-run] [--sub-id1] [--sub-id2]');
    return 0;
  }
  if (command === 'connection-status') return commandConnectionStatus();
  if (command === 'get-offer') return commandGetOffer();
  if (command === 'create-link') return commandCreateLink();
  if (command === 'reports') return commandReports();
  if (command === 'smoke') return commandSmoke();
  throw new Error(`Unknown command: ${command}`);
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
