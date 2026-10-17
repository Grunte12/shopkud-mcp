import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ShopkudDatabase } from '../src/core/database.js';
import { salesBy } from '../src/core/conversions.js';
import { excludedCategory, safeImageUrls } from '../src/core/excluded-categories.js';
import { neutralizeCell, toCsv } from '../src/core/csv-export.js';
import { classifyCancellation } from '../src/core/cancellations.js';
import { reportListCarriesStatus } from '../src/core/local-tools.js';
import { ShopkudMCPServer } from '../src/mcp/server.js';
import { createToolApi } from '../src/api/http.js';
import type { Server } from 'http';

function tempDb() {
  return join(mkdtempSync(join(tmpdir(), 'shopkud-')), 'shop.db');
}

test('excluded categories follow the cited list and ignore voucher guesses', () => {
  assert.strictEqual(excludedCategory('นมผงทุกชนิด'), 'นมผง');
  assert.strictEqual(excludedCategory('หมวดหมู่เครื่องประดับ'), 'เครื่องประดับ');
  assert.strictEqual(excludedCategory('Utilites'), 'utilites');
  assert.strictEqual(excludedCategory('utilities'), null);
  assert.strictEqual(excludedCategory('gift card'), null);
  assert.strictEqual(excludedCategory('E-Voucher'), null);
  assert.deepStrictEqual(safeImageUrls(['https://cf.shopee.co.th/a.jpg', 'https://evil.example/a.jpg', 'http://cf.shopee.co.th/a.jpg']), ['https://cf.shopee.co.th/a.jpg']);
});

test('csv cells that look like formulas are prefixed', () => {
  assert.strictEqual(neutralizeCell('=cmd|'), "'=cmd|");
  assert.strictEqual(neutralizeCell(' +1'), "' +1");
  assert.strictEqual(neutralizeCell('-2'), "'-2");
  assert.strictEqual(neutralizeCell('@sum'), "'@sum");
  assert.strictEqual(neutralizeCell('tiktok-P1'), 'tiktok-P1');
  assert.strictEqual(neutralizeCell(12), 12);
  const csv = toCsv([{ title: '=cmd|' }], ['title']);
  assert.ok(csv.includes("'=cmd|"));
});

test('cancellation classes use report fields and not order ids', () => {
  assert.strictEqual(classifyCancellation({ buyer_class: 'household', status: 'completed' }).likely_reason, 'self_or_household_purchase');
  assert.strictEqual(classifyCancellation({ reason_hint: 'another_link' }).likely_reason, 'buyer_clicked_another_link');
  assert.strictEqual(classifyCancellation({ category: 'บุหรี่', status: 'completed', commission: 10, orders: 1 }).likely_reason, 'excluded_category');
  assert.notStrictEqual(classifyCancellation({ category: 'gift card', status: 'completed' }).likely_reason, 'excluded_category');
  assert.strictEqual(classifyCancellation({ reason_hint: 'voucher', commission: 0, orders: 1 }).likely_reason, 'voucher_fully_paid');
  assert.strictEqual(classifyCancellation({ status: 'Cancelled', orders: 1, commission: 0 }).likely_reason, 'order_cancelled_or_returned');
  assert.strictEqual(JSON.stringify(classifyCancellation({ status: 'Cancelled' })).includes('order_sn'), false);
});

test('sales_by groups variant s4 and month s5', () => {
  const rows = [{
    conversion_id: 'a', purchased_on: '2026-10-01', status: 'COMPLETED', utm_content: 'tiktok-P1-v6-a-202610',
    sub_id1: 'tiktok', sub_id2: 'P1', sub_id3: 'v6', sub_id4: 'a', sub_id5: '202610',
    orders: 2, gmv: 10, commission: 1, cancelled: 0,
  }];
  assert.strictEqual(salesBy(rows, 'variant', '2026-10-01', '2026-10-31')[0].key, 'a');
  assert.strictEqual(salesBy(rows, 'month', '2026-10-01', '2026-10-31')[0].key, '202610');
  assert.strictEqual(salesBy(rows, 'variant', '2026-10-01', '2026-10-31')[0].orders, 2);
});

test('report list status key is detected only when the sample URL has it', () => {
  assert.strictEqual(reportListCarriesStatus('https://affiliate.shopee.co.th/api/v3/report/list?page_num=1&checkout_status='), 'checkout_status');
  assert.strictEqual(reportListCarriesStatus('https://affiliate.shopee.co.th/api/v3/report/list?page_num=1'), null);
});

test('sqlite v4 stores the spec tables and create_link fills the registry', async () => {
  const dbPath = tempDb();
  const server = new ShopkudMCPServer(dbPath, 'http://127.0.0.1:9', {
    probe: async () => ({ reachable: false, port: 9, browser: null, skipped: true }),
  });
  const db = server.getDatabase();
  const created = await server.invoke('create_link', {
    product_url: 'https://shopee.co.th/product/200/1000000001',
    channel: 'tiktok',
    clip_id: 'v6',
    sub_ids: { sub_id1: 'tiktok', sub_id2: 'P1', sub_id3: 'v6', sub_id4: 'a', sub_id5: '202610' },
  }) as any;
  assert.strictEqual(created.created, true);
  assert.strictEqual(created.origin, 'placeholder');
  assert.strictEqual(created.clip_saved, true);
  assert.strictEqual(created.link.sub_ids.sub_id4, 'a');
  assert.strictEqual(db.listClips().length, 1);
  const again = await server.invoke('create_link', {
    product_url: 'https://shopee.co.th/product/200/1000000001',
    channel: 'tiktok',
    clip_id: 'v6',
    sub_ids: { sub_id1: 'tiktok', sub_id2: 'P1', sub_id3: 'v6', sub_id4: 'b', sub_id5: '202610' },
  }) as any;
  assert.strictEqual(again.created, true);
  assert.notStrictEqual(again.link.link_id, created.link.link_id);
  const counts = db.counts();
  assert.ok(counts.products >= 1);
  assert.strictEqual(counts.links, 2);
  assert.strictEqual(counts.clips, 1);
  const status = await server.invoke('setup_status') as any;
  assert.strictEqual(status.ok, true);
  assert.strictEqual(status.page_loads, 0);
  assert.ok(status.steps.some((step: { key: string }) => step.key === 'database'));
  await server.stop();
});

test('health, replacements, cancellations, history, budget, and prepare-only writes', async () => {
  const server = new ShopkudMCPServer(tempDb(), 'http://127.0.0.1:9');
  const db = server.getDatabase();
  const stamp = (asOf: string, item: string, rate: number, extra: Partial<Record<string, unknown>> = {}) => db.saveOfferSnapshot({
    item_id: item,
    as_of: asOf,
    price: 100,
    store_rate: rate,
    shopee_rate: 2,
    xtra_rate: 0,
    total_rate: rate + 2,
    extra_comm: false,
    stock: 5,
    category: 'เครื่องใช้ไฟฟ้า',
    title: 'Demo charger',
    image_urls: ['https://cf.shopee.co.th/demo.jpg'],
    official: true,
    excluded_category: false,
    excluded_match: null,
    source: 'fixture',
    ...extra,
  });
  stamp('2026-10-01T00:00:00.000Z', '100', 10);
  stamp('2026-10-16T00:00:00.000Z', '100', 4);
  stamp('2026-10-16T00:00:00.000Z', '200', 12, { title: 'Demo charger mini', official: true });
  stamp('2026-10-16T00:00:00.000Z', '999', 20, { category: 'บุหรี่', title: 'Demo charger smoke', excluded_category: true, excluded_match: 'บุหรี่' });

  const health = await server.invoke('check_commission_health', { item_ids: ['100'] }) as any;
  assert.strictEqual(health.results[0].status, 'dropped');
  assert.strictEqual(health.alert_count, 1);

  const suggestions = await server.invoke('suggest_replacement', { item_id: '100', k: 5 }) as any;
  assert.ok(suggestions.candidates.some((row: { item_id: string }) => row.item_id === '200'));
  assert.ok(!suggestions.candidates.some((row: { item_id: string }) => row.item_id === '999'));
  assert.ok(suggestions.candidates[0].reason.includes('official_shop'));
  assert.strictEqual(suggestions.live_search, '/api/v3/offer/product/list');

  db.saveConversions([{
    conversion_id: 'c1', purchased_on: '2026-10-02', status: 'COMPLETED', utm_content: '----',
    sub_id1: null, sub_id2: null, sub_id3: null, sub_id4: null, sub_id5: null,
    orders: 1, gmv: 10, commission: 1, cancelled: 0, category: 'บุหรี่', reason_hint: null, buyer_class: null,
  }, {
    conversion_id: 'c2', purchased_on: '2026-10-03', status: 'Cancelled', utm_content: '----',
    sub_id1: null, sub_id2: null, sub_id3: null, sub_id4: null, sub_id5: null,
    orders: 1, gmv: 0, commission: 0, cancelled: 1, category: null, reason_hint: null, buyer_class: null,
  }], 'fixture', '2026-10-17T00:00:00.000Z');
  const explained = await server.invoke('explain_cancellations', { from: '2026-10-01', to: '2026-10-16' }) as any;
  assert.ok(explained.classifications.some((row: { likely_reason: string }) => row.likely_reason === 'excluded_category'));
  assert.strictEqual(explained.order_level_data, 'omitted');
  assert.strictEqual(JSON.stringify(explained).includes('order_sn'), false);

  const history = await server.invoke('price_history', { item_id: '100' }) as any;
  assert.deepStrictEqual(history.points.map((point: { price: number }) => point.price), [100, 100]);
  const media = await server.invoke('product_media', { item_id: '100' }) as any;
  assert.deepStrictEqual(media.images, ['https://cf.shopee.co.th/demo.jpg']);

  const found = await server.invoke('search_offers', { keyword: 'charger', official: true, min_rate: 10 }) as any;
  assert.ok(found.items.every((row: { item_id: string }) => row.item_id !== '100' || row.store_rate >= 10));
  assert.ok(!found.items.some((row: { item_id: string }) => row.item_id === '999'));

  db.saveEarnings({ as_of: '2026-01-01T00:00:00.000Z', pending: 10, validated: 5, paid: 0, next_payout: null, kyc_status: 'unknown', balance_since: '2026-01-01T00:00:00.000Z', source: 'fixture' });
  const earnings = await server.invoke('get_earnings_summary') as any;
  assert.strictEqual(earnings.live, 'page_seen');
  assert.strictEqual(earnings.expiring[0].kind, 'six_month_window');

  const dry = await server.invoke('enroll_mission', { mission_id: 'm1', name: 'Demo mission' }) as any;
  assert.strictEqual(dry.submitted_to_shopee, false);
  assert.strictEqual(dry.confirm_required, true);
  const prepared = await server.invoke('enroll_mission', { mission_id: 'm1', name: 'Demo mission', confirm: 'ENROLL_MISSION' }) as any;
  assert.strictEqual(prepared.prepared, true);
  assert.strictEqual(prepared.submitted_to_shopee, false);
  assert.strictEqual(prepared.enrolled, false);

  db.saveVideoClip({ video_id: 'vid1', title: 'Demo clip', status: 'local', as_of: '2026-10-17T00:00:00.000Z', source: 'fixture' });
  const preview = await server.invoke('prepare_cart_swap', { video_id: 'vid1', old_product_id: '100', new_product_id: '200' }) as any;
  assert.strictEqual(preview.local_cart_updated, false);
  assert.strictEqual(preview.submitted_to_shopee, false);
  const swapped = await server.invoke('prepare_cart_swap', { video_id: 'vid1', old_product_id: '100', new_product_id: '200', confirm: 'PREPARE_CART_SWAP' }) as any;
  assert.strictEqual(swapped.local_cart_updated, true);
  assert.strictEqual(swapped.submitted_to_shopee, false);
  const clips = await server.invoke('list_video_clips') as any;
  assert.strictEqual(clips.live_verified, false);

  await server.invoke('create_link', {
    product_url: 'https://shopee.co.th/product/200/1000000002',
    channel: 'tiktok',
    sub_ids: { sub_id1: 'tiktok', sub_id2: 'P9', sub_id3: null, sub_id4: null, sub_id5: null },
  });
  const text = await server.invoke('convert_links_in_text', {
    text: 'buy https://shopee.co.th/product/200/1000000002 today',
    channel: 'tiktok',
  }) as any;
  assert.strictEqual(text.opens_links, false);
  assert.strictEqual(text.replaced, 1);
  assert.ok(text.text.includes('https://s.shopee.co.th/'));
  assert.ok(!text.text.includes('/product/200/1000000002'));

  await server.invoke('set_posting_cap', { platform: 'tiktok', daily_cap: 1 });
  const budget = await server.invoke('posting_budget', { platform: 'tiktok' }) as any;
  assert.strictEqual(budget.cap_evidence, 'owner_set');
  assert.strictEqual(budget.ok_to_post, false);

  db.saveOfferSnapshot({
    item_id: '300', as_of: '2026-10-17T00:00:00.000Z', price: 1, store_rate: 1, shopee_rate: null, xtra_rate: null, total_rate: null,
    extra_comm: false, stock: 1, category: null, title: '=cmd|', image_urls: [], official: false, excluded_category: false, excluded_match: null, source: 'fixture',
  });
  const exported = await server.invoke('export_data', { kind: 'offers', format: 'csv' }) as any;
  assert.strictEqual(exported.formula_neutralized, true);
  assert.ok(exported.body.includes("'=cmd|"));

  db.saveProduct({ item_id: '400', shop_id: '1', title: 'Cached', price_min: 50, price_max: 50 });
  db.saveOffer({ item_id: '400', as_of: new Date().toISOString(), price: 50, commission_rate_social: 8, commission_rate_video: null, extra_comm: false, stock_available: true, source: 'cdp' });
  db.saveOfferSnapshot({
    item_id: '400', as_of: new Date().toISOString(), price: 50, store_rate: 8, shopee_rate: 2, xtra_rate: 0, total_rate: 10,
    extra_comm: false, stock: 1, category: 'นมผง', title: 'Cached', image_urls: [], official: false, excluded_category: true, excluded_match: 'นมผง', source: 'fixture',
  });
  const offer = await server.invoke('get_offer', { item_id: '400' }) as any;
  assert.strictEqual(offer.source, 'cache');
  assert.ok(offer.offer.warnings.includes('excluded_category'));
  assert.strictEqual(offer.offer.excluded_match, 'นมผง');

  await server.stop();
});

test('json api is local, shares invoke, and strips secret fields', async () => {
  const server = new ShopkudMCPServer(tempDb(), 'http://127.0.0.1:9', {
    probe: async () => ({ reachable: true, port: 9, browser: 'Test', skipped: false }),
  });
  const app = createToolApi(server);
  const http = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;
  try {
    const denied = await fetch(`${base}/api/v1/tools/setup_status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.strictEqual(denied.status, 403);
    const ok = await fetch(`${base}/api/v1/tools/setup_status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-ShopKud-Console': '1', Host: '127.0.0.1' },
      body: JSON.stringify({ cookie: 'nope', password: 'nope' }),
    });
    const body = await ok.json() as any;
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(body.ok, true);
    assert.strictEqual(JSON.stringify(body).includes('nope'), false);
    const tools = await fetch(`${base}/api/v1/tools`);
    const listed = await tools.json() as any;
    assert.ok(listed.tools.includes('explain_cancellations'));
    assert.ok(listed.tools.includes('sales_by'));
  } finally {
    await new Promise((resolve) => http.close(resolve));
    await server.stop();
  }
});
