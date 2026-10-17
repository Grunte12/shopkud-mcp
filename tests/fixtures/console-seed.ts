import { ShopkudDatabase } from '../../src/core/database.js';
import { commissionHealth } from '../../src/core/local-tools.js';
import type { ConversionRow } from '../../src/core/conversions.js';

export interface SeedOptions {
  /** Leave the database empty (fresh install). */
  empty?: boolean;
  /** Add a job that stopped on a CAPTCHA. */
  captcha?: boolean;
}

const DAY = 86_400_000;

function bangkokDay(offsetDays: number): string {
  return new Date(Date.now() + 7 * 3600_000 - offsetDays * DAY).toISOString().slice(0, 10);
}

function lcg(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const ITEMS = [
  { id: '111', shop: '9001', title: 'หูฟังบลูทูธ รุ่น A1', category: 'อุปกรณ์อิเล็กทรอนิกส์', price: 590, store: 8, shopee: 3, xtra: 1.5, official: true, stock: 120 },
  { id: '222', shop: '9002', title: 'ครีมกันแดด SPF50 หลอดใหญ่', category: 'ความงาม', price: 249, store: 12, shopee: 3, xtra: 0, official: false, stock: 300 },
  { id: '333', shop: '9003', title: 'แหวนเงินแท้ ลายเรียบ', category: 'เครื่องประดับ > แหวน', price: 1290, store: 5, shopee: 2, xtra: 0, official: false, stock: 15 },
  { id: '444', shop: '9004', title: 'เคสมือถือ ใสกันกระแทก', category: 'อุปกรณ์เสริมมือถือ', price: 129, store: 0, shopee: 0, xtra: 0, official: false, stock: 40 },
  { id: '555', shop: '9005', title: 'ที่ชาร์จเร็ว 65W', category: 'อุปกรณ์อิเล็กทรอนิกส์', price: 449, store: 6, shopee: 2, xtra: 0, official: true, stock: 0 },
];

const LINKS: Array<{ item: string; channel: string; ids: [string, string, string, string, string]; owner: 'true' | 'false' | 'unknown' }> = [
  { item: '111', channel: 'tiktok', ids: ['tiktok', 'P1', 'v6', 'a', '202610'], owner: 'true' },
  { item: '111', channel: 'tiktok', ids: ['tiktok', 'P1', 'v7', 'b', '202610'], owner: 'true' },
  { item: '111', channel: 'ig', ids: ['ig', 'P1', 'v6', 'a', '202610'], owner: 'true' },
  { item: '222', channel: 'fb', ids: ['fb', 'P2', 'v8', 'a', '202610'], owner: 'unknown' },
  { item: '222', channel: 'tiktok', ids: ['tiktok', 'P2', '', 'a', '202610'], owner: 'false' },
  { item: '333', channel: 'yt', ids: ['yt', 'P3', 'v9', '', '202610'], owner: 'unknown' },
  { item: '444', channel: 'x', ids: ['x', 'P4', 'v10', 'a', ''], owner: 'unknown' },
];

function conversionRows(): ConversionRow[] {
  const rand = lcg(20261017);
  const combos = [
    ['tiktok', 'P1', 'v6', 'a', '202610'], ['tiktok', 'P1', 'v6', 'a', '202610'], ['tiktok', 'P1', 'v7', 'b', '202610'],
    ['ig', 'P1', 'v6', 'a', '202610'], ['fb', 'P2', 'v8', 'a', '202610'], ['tiktok', 'P2', 'v8', 'a', '202609'],
    ['yt', 'P3', 'v9', 'a', '202610'], ['tiktok', 'P2', '', 'a', '202610'], ['', '', '', '', ''], ['', '', '', '', ''],
  ];
  const rows: ConversionRow[] = [];
  let n = 0;
  for (let back = 0; back < 40; back += 1) {
    const day = bangkokDay(back);
    const count = Math.floor(rand() * 5);
    for (let i = 0; i < count; i += 1) {
      const combo = combos[Math.floor(rand() * combos.length)];
      const gmv = Math.round((120 + rand() * 900) * 100) / 100;
      const roll = rand();
      const cancelled = roll < 0.14 ? 1 : 0;
      const status = cancelled ? 'Cancelled' : roll < 0.4 ? 'Pending' : 'Completed';
      const utm = combo.join('-') === '----' ? '' : combo.join('-');
      const hint = cancelled ? (rand() < 0.4 ? 'another_link' : null) : null;
      rows.push({
        conversion_id: `seed-${n += 1}`,
        purchased_on: day,
        status,
        utm_content: utm,
        sub_id1: combo[0] || null, sub_id2: combo[1] || null, sub_id3: combo[2] || null, sub_id4: combo[3] || null, sub_id5: combo[4] || null,
        orders: 1,
        gmv,
        commission: cancelled ? 0 : Math.round(gmv * 0.09 * 100) / 100,
        cancelled,
        category: null,
        reason_hint: hint,
        buyer_class: cancelled && rand() < 0.25 ? 'self' : null,
      });
    }
  }
  rows.push({
    conversion_id: 'seed-excluded', purchased_on: bangkokDay(2), status: 'Cancelled', utm_content: 'yt-P3-v9--202610',
    sub_id1: 'yt', sub_id2: 'P3', sub_id3: 'v9', sub_id4: null, sub_id5: '202610', orders: 1, gmv: 1290, commission: 0, cancelled: 1,
    category: 'เครื่องประดับ > แหวน', reason_hint: null, buyer_class: null,
  });
  return rows;
}

/** Deterministic demo data. Dates are relative to now so charts always have a recent range. */
export function seedConsoleDb(dbPath: string, options: SeedOptions = {}): void {
  const db = new ShopkudDatabase(dbPath);
  try {
    if (options.empty) return;
    const now = new Date();
    for (const item of ITEMS) {
      db.saveProduct({ item_id: item.id, shop_id: item.shop, title: item.title, price_min: item.price, price_max: item.price, category: item.category, official: item.official });
    }
    LINKS.forEach((link, index) => {
      const created = db.createLink({
        product_id: link.ids[2] ? `${link.ids[2]}-${link.item}` : link.item,
        item_id: link.item,
        short_link: `https://s.shopee.co.th/seed${index}x${link.item}`,
        long_link: `https://shopee.co.th/product-i.9000.${link.item}?subid=${link.ids.filter(Boolean).join(',')}`,
        channel: link.channel,
        clip_id: link.ids[2] || null,
        sub_ids: { sub_id1: link.ids[0] || null, sub_id2: link.ids[1] || null, sub_id3: link.ids[2] || null, sub_id4: link.ids[3] || null, sub_id5: link.ids[4] || null },
      });
      if (link.owner !== 'unknown') db.updateLinkVerification(created.link_id, link.owner, link.owner === 'true' ? 'true' : 'unknown');
      if (link.ids[2]) db.upsertClip({ clip_id: link.ids[2], channel: link.channel });
      if (index < 3) db.savePost({ post_id: `post-${index}`, clip_id: link.ids[2], channel: link.channel, link_id: created.link_id, posted_on: now.toISOString().slice(0, 10), status: 'posted' });
    });

    for (const item of ITEMS) {
      if (item.id === '111') {
        db.saveOfferSnapshot({
          item_id: item.id, as_of: new Date(now.getTime() - 5 * DAY).toISOString(), price: 620, store_rate: 10, shopee_rate: 3, xtra_rate: 1.5, total_rate: 14.5,
          extra_comm: true, stock: 130, category: item.category, title: item.title, image_urls: [], official: true, excluded_category: false, excluded_match: null, source: 'cdp',
        });
      }
      const excluded = item.id === '333';
      db.saveOfferSnapshot({
        item_id: item.id, as_of: now.toISOString(), price: item.price, store_rate: item.store, shopee_rate: item.shopee, xtra_rate: item.xtra,
        total_rate: item.store + item.shopee + item.xtra, extra_comm: item.xtra > 0, stock: item.stock, category: item.category, title: item.title,
        image_urls: [], official: item.official, excluded_category: excluded, excluded_match: excluded ? 'เครื่องประดับ' : null, source: 'cdp',
      });
      db.saveOffer({
        item_id: item.id, as_of: now.toISOString(), price: item.price, commission_rate_social: item.store, commission_rate_video: null,
        extra_comm: item.xtra > 0, stock_available: item.stock > 0, source: 'cdp',
      });
    }
    commissionHealth(db);

    db.saveConversions(conversionRows(), 'report_list', now.toISOString());
    db.saveAccountMarker('1234567', now.toISOString());

    db.saveEarnings({ as_of: new Date(now.getTime() - 175 * DAY).toISOString(), pending: 1000, validated: 500, paid: 4200, next_payout: null, kyc_status: 'verified', balance_since: null, source: 'seed' });
    db.saveEarnings({ as_of: now.toISOString(), pending: 1000, validated: 500, paid: 5400, next_payout: bangkokDay(-9), kyc_status: 'verified', balance_since: null, source: 'seed' });

    db.saveMission({ mission_id: 'm-oct', name: 'มิชชั่นเดือนตุลา: ขาย 20 ออเดอร์', reward: '฿500', requirements: 'ออเดอร์สำเร็จ 20 รายการ', deadline: bangkokDay(-14), status: 'available', enrolled: false });
    db.saveMission({ mission_id: 'm-beauty', name: 'แคมเปญความงาม', reward: '฿200', requirements: 'โพสต์คลิปสินค้าความงาม 3 คลิป', deadline: bangkokDay(-5), status: 'prepared', enrolled: false });

    db.setPostingCap('fb', 5);

    const stopped = db.enqueueJob('create_link', { item_id: '222', channel: 'tiktok' });
    const pendingJob = db.enqueueJob('get_offer', { item_id: '111' });
    const runningJob = db.enqueueJob('get_conversions', { from: bangkokDay(7), to: bangkokDay(0) });
    db.updateJobStatus(runningJob, 'running');
    if (options.captcha) db.updateJobStatus(stopped, 'captcha_stopped', undefined, 'captcha');
    else db.updateJobStatus(stopped, 'completed');
    void pendingJob;
  } finally {
    db.close();
  }
}
