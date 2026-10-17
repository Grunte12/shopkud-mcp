import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync, existsSync } from 'fs';
import {
  conversionsFromMappedCsv,
  conversionsFromReportList,
  csvMappingFromHeader,
  parseMappedCsv,
  salesBy,
} from '../src/core/conversions.js';
import { ownershipFromLocation } from '../src/core/verify-link.js';
import { ShopkudDatabase } from '../src/core/database.js';

/** Redacted GET /api/v3/report/list item. Ids and names are placeholders. */
const liveList = {
  code: 0,
  msg: 'success',
  data: {
    page_num: 1,
    page_size: 20,
    total_count: 2,
    list: [
      {
        purchase_time: 1760000000,
        checkout_status: 'Waiting for payment',
        affiliate_id: 42,
        utm_content: 'tiktok-P1-clip-blue-202610',
        estimated_total_commission: 10,
        orders: [{
          order_sn: 'REDACTED',
          order_status: 'COMPLETED',
          items: [{ item_id: 1, actual_amount: 100, qty: 1, item_commission: 8 }],
        }],
      },
      {
        purchase_time: 1760000000,
        checkout_status: 'Cancelled',
        affiliate_id: 42,
        utm_content: 'test----',
        estimated_total_commission: 0,
        orders: [{
          order_sn: 'REDACTED-2',
          order_status: 'CANCELLED',
          items: [{ item_id: 2, actual_amount: 49800000, qty: 1, item_commission: 0 }],
        }],
      },
    ],
  },
};

test('report list JSON keeps sub-id slots, scales large amounts, and allows an empty list', () => {
  const rows = conversionsFromReportList(liveList);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].sub_id1, 'tiktok');
  assert.strictEqual(rows[0].sub_id2, 'P1');
  assert.strictEqual(rows[0].sub_id3, 'clip');
  assert.strictEqual(rows[0].sub_id4, 'blue');
  assert.strictEqual(rows[0].sub_id5, '202610');
  assert.strictEqual(rows[0].orders, 1);
  assert.strictEqual(rows[0].gmv, 100);
  assert.strictEqual(rows[0].commission, 10);
  assert.strictEqual(rows[0].cancelled, 0);
  assert.strictEqual(rows[1].sub_id1, 'test');
  assert.strictEqual(rows[1].sub_id2, null);
  assert.strictEqual(rows[1].gmv, 498);
  assert.strictEqual(rows[1].cancelled, 1);
  assert.strictEqual(conversionsFromReportList({ data: { total_count: 0, list: [] } }).length, 0);
});

test('CSV download reuses the mapped report parser', () => {
  const csv = 'Sub ID,Orders,Commission,Status,GMV\ntest----,1,0,CANCELLED,498\n';
  const mapped = parseMappedCsv(csv, csvMappingFromHeader(csv.split('\n')[0]));
  const [row] = conversionsFromMappedCsv(mapped, '2026-10-01');
  assert.strictEqual(row.sub_id1, 'test');
  assert.strictEqual(row.cancelled, 1);
  assert.strictEqual(row.gmv, 498);
});

test('sales_by groups stored conversions by platform, product, and clip', () => {
  const rows = conversionsFromReportList(liveList);
  const platform = salesBy(rows, 'platform', '2020-01-01', '2030-01-01');
  assert.deepStrictEqual(platform.map((bucket) => bucket.key).sort(), ['test', 'tiktok']);
  const tiktok = platform.find((bucket) => bucket.key === 'tiktok');
  assert.strictEqual(tiktok?.orders, 1);
  assert.strictEqual(tiktok?.gmv, 100);
  assert.strictEqual(tiktok?.commission, 10);
  assert.strictEqual(tiktok?.cancelled, 0);
  assert.strictEqual(salesBy(rows, 'product', '2020-01-01', '2030-01-01').find((bucket) => bucket.key === 'P1')?.orders, 1);
  assert.strictEqual(salesBy(rows, 'clip', '2020-01-01', '2030-01-01').find((bucket) => bucket.key === 'clip')?.orders, 1);
  const empty = conversionsFromReportList({
    data: {
      list: [{
        purchase_time: 1760000000,
        checkout_status: 'Completed',
        affiliate_id: 42,
        utm_content: '----',
        estimated_total_commission: 1,
        orders: [{ order_status: 'COMPLETED', items: [{ actual_amount: 10, item_commission: 1 }] }],
      }],
    },
  });
  assert.strictEqual(empty[0].sub_id1, null);
  assert.strictEqual(salesBy(empty, 'platform', '2020-01-01', '2030-01-01')[0].key, '(none)');
  assert.strictEqual(salesBy(empty, 'sub_id', '2020-01-01', '2030-01-01')[0].key, '----');
  const dbPath = './test-conversions.db';
  if (existsSync(dbPath)) unlinkSync(dbPath);
  const db = new ShopkudDatabase(dbPath);
  assert.strictEqual(db.saveConversions(rows, 'report_list', '2026-10-17T00:00:00Z'), 2);
  assert.strictEqual(db.saveConversions(rows, 'report_list', '2026-10-17T01:00:00Z'), 2);
  assert.strictEqual(db.listConversions('2020-01-01', '2030-01-01').length, 2);
  db.close();
  if (existsSync(dbPath)) unlinkSync(dbPath);
});

test('ownership uses the HEAD location marker and does not need the link opened', () => {
  const ours = ownershipFromLocation(
    'https://shopee.co.th/opaanlp/1/2?utm_source=an_42&utm_content=test----',
    '42',
    301,
  );
  assert.strictEqual(ours.ownership_verified, 'true');
  assert.strictEqual(ours.target_verified, 'true');
  assert.strictEqual(ours.item_id, '2');
  const other = ownershipFromLocation(
    'https://shopee.co.th/opaanlp/9/8?utm_source=an_99',
    '42',
    301,
  );
  assert.strictEqual(other.ownership_verified, 'false');
  assert.strictEqual(ownershipFromLocation(null, '42', 301).ownership_verified, 'unknown');
  assert.strictEqual(ownershipFromLocation('https://shopee.co.th/opaanlp/1/2?utm_source=an_42', null, 301).ownership_verified, 'unknown');
  const sameAccount = ownershipFromLocation(
    'https://shopee.co.th/opaanlp/1/2?mmp_pid=an_42&utm_content=----',
    '42',
    301,
  );
  assert.strictEqual(sameAccount.ownership_verified, 'true');
  assert.strictEqual(sameAccount.reason, 'mmp_pid');
});
