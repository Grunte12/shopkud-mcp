import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSubIds } from '../src/core/conversions.js';
import { parseProductUrl as backendParse } from '../src/config/selectors.js';
// @ts-expect-error plain browser modules, no type declarations
import * as subid from '../src/console/public/js/subid.js';
// @ts-expect-error plain browser modules
import { scrub } from '../src/console/public/js/api.js';
// @ts-expect-error plain browser modules
import * as fmt from '../src/console/public/js/format.js';
// @ts-expect-error plain browser modules
import { commissionParts, OFFER_COLORS } from '../src/console/public/js/pages/offers.js';
// @ts-expect-error plain browser modules
import { parseProductUrl as uiParse } from '../src/console/public/js/pages/links.js';

test('five Sub ID slots have unique colors and Thai names', () => {
  assert.equal(subid.SLOTS.length, 5);
  assert.equal(new Set(subid.SLOTS.map((s: { color: string }) => s.color)).size, 5);
  assert.deepEqual(subid.SLOTS.map((s: { dim: string }) => s.dim), ['platform', 'product', 'clip', 'variant', 'month']);
  for (const slot of subid.SLOTS) {
    assert.match(slot.th, /[\u0E00-\u0E7F]/, 'Thai label');
    assert.match(slot.tip, /[\u0E00-\u0E7F]/, 'plain-Thai tooltip');
  }
  assert.deepEqual(subid.SLOTS.map((s: { example: string }) => s.example), ['tiktok', 'P1', 'v6', 'a', '202610']);
});

test('splitUtm matches the backend splitSubIds', () => {
  for (const utm of ['tiktok-P1-v6-a-202610', 'tiktok-P1', '', 'a-b-c-d-e-f', '--v6--']) {
    const mine = subid.splitUtm(utm).map((v: string) => v || null);
    assert.deepEqual(mine, splitSubIds(utm), utm);
  }
  assert.equal(subid.toUtm(['tiktok', 'P1', 'v6', 'a', '202610']), 'tiktok-P1-v6-a-202610');
  assert.equal(subid.toUtm(['tiktok', '', '', '', '']), 'tiktok----');
});

test('validateSubIds warns on empty slots and blocks bad characters', () => {
  const good = subid.validateSubIds(['tiktok', 'P1', 'v6', 'a', '202610'], 'tiktok');
  assert.deepEqual(good, []);

  const gaps = subid.validateSubIds(['tiktok', 'P1', '', '', '202610'], 'tiktok');
  assert.deepEqual(gaps.map((i: { code: string; slot: number }) => `${i.code}:${i.slot}`), ['empty_slot:3', 'empty_slot:4']);
  assert.ok(gaps.every((i: { level: string }) => i.level === 'warn'));

  const allEmpty = subid.validateSubIds(['', '', '', '', ''], 'tiktok');
  assert.equal(allEmpty[0].code, 'all_empty');
  assert.equal(allEmpty[0].level, 'error');

  const bad = subid.validateSubIds(['tiktok', 'P-1', 'v6', 'a', '202610'], 'tiktok');
  assert.equal(bad.find((i: { code: string }) => i.code === 'bad_chars').level, 'error');

  assert.ok(subid.validateSubIds(['tiktok', 'P1', 'v6', 'a', '2026'], 'tiktok').some((i: { code: string }) => i.code === 'bad_month'));
  assert.ok(subid.validateSubIds(['tiktok', 'P1', 'v6', 'a', '202613'], 'tiktok').some((i: { code: string }) => i.code === 'bad_month'));
  assert.ok(subid.validateSubIds(['ig', 'P1', 'v6', 'a', '202610'], 'tiktok').some((i: { code: string }) => i.code === 'platform_channel_mismatch'));
  assert.ok(subid.validateSubIds(['myapp', 'P1', 'v6', 'a', '202610'], 'tiktok').some((i: { code: string }) => i.code === 'unknown_platform'));
  for (const issue of [...gaps, ...bad, ...allEmpty]) assert.match(subid.issueText(issue), /[\u0E00-\u0E7F]/);
});

test('valuesToSubIds maps five slots to sub_id1..sub_id5 with null for empty', () => {
  assert.deepEqual(subid.valuesToSubIds(['tiktok', 'P1', '', 'a', '202610']), {
    sub_id1: 'tiktok', sub_id2: 'P1', sub_id3: null, sub_id4: 'a', sub_id5: '202610',
  });
  assert.deepEqual(subid.slotValues({ sub_id1: 'x', sub_id2: null }), ['x', '', '', '', '']);
});

test('product URL parsing matches the backend rule', () => {
  const urls = [
    'https://shopee.co.th/หูฟัง-i.9001.111',
    'https://shopee.co.th/product/9001/111',
    'http://shopee.co.th/x-i.1.2',
    'https://s.shopee.co.th/abc',
    'https://evil.example/x-i.1.2',
    'not a url',
  ];
  for (const url of urls) assert.deepEqual(uiParse(url), backendParse(url), url);
});

test('scrub removes cookie, token, secret and signature fields at any depth', () => {
  const cleaned = scrub({
    ok: true, cookie: 'SESSION=abc', nested: { api_token: 't', keep: 1, list: [{ password: 'p', ok: 2 }] }, signature: 's', websocket_url: 'ws://x',
  });
  assert.deepEqual(cleaned, { ok: true, nested: { keep: 1, list: [{ ok: 2 }] } });
});

test('commissionParts uses offer fields first and falls back to the snapshot', () => {
  const live = commissionParts({
    price: 1000, store_commission_percent: 8, shopee_commission_percent: 2, xtra_commission_percent: 1, store_commission_baht: 80, shopee_commission_baht: 20,
  }, null);
  assert.equal(live.totalPercent, 11);
  assert.equal(live.parts[0].computed, false);
  assert.equal(live.parts[0].value, 80);
  assert.equal(live.parts[2].computed, true);
  assert.equal(live.parts[2].value, 10);
  assert.equal(live.totalBaht, 110);

  const cached = commissionParts({ price: 590, store_commission_percent: 8 }, { price: 590, store_rate: 8, shopee_rate: 3, xtra_rate: 1.5 });
  assert.equal(cached.parts[1].percent, 3);
  assert.equal(cached.parts[1].value, 17.7);
  assert.equal(cached.parts[2].value, 8.85);
  assert.deepEqual(cached.parts.map((p: { color: string }) => p.color), [OFFER_COLORS.store, OFFER_COLORS.shopee, OFFER_COLORS.xtra]);
});

test('format helpers', () => {
  assert.equal(fmt.baht(1234.5), '฿1,234.50');
  assert.equal(fmt.pct(12.5), '12.5%');
  assert.equal(fmt.pct(8), '8%');
  assert.equal(fmt.addDays('2026-10-01', -1), '2026-09-30');
  assert.equal(fmt.share(1, 4), 25);
  assert.equal(fmt.share(1, 0), 0);
  assert.equal(fmt.monthLabel('202610'), 'ต.ค. 2026');
});
