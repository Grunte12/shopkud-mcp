import { classifyCancellation } from './cancellations.js';
import type { ChromeProbe } from './chrome-probe.js';
import { toCsv } from './csv-export.js';
import type { ConversionRow } from './conversions.js';
import type { OfferSnapshot, ShopkudDatabase, SubIds } from './database.js';
import { EXCLUDED_CATEGORY_CITATION, excludedCategory } from './excluded-categories.js';
import { EARNINGS_LIVE, EARNINGS_NOTE, LIVE_SEARCH_NOTE, MISSIONS_LIVE, MISSIONS_NOTE, OFFER_LIST_PATH, VIDEO_CREATOR_NOTE } from './live-pages.js';

export const DEFAULT_POSTING_CAPS: Record<string, number> = {
  tiktok: 50,
  ig: 30,
  fb: 40,
  x: 100,
  yt: 20,
  spv: 20,
};

export const PAYOUT_CITATION = 'https://help.shopee.co.th/portal/10/article/142437';
const EARNINGS_EXPIRY_DAYS = 180;
const EARNINGS_WARN_DAYS = 30;
const ENROLL_CONFIRM = 'ENROLL_MISSION';
const CART_CONFIRM = 'PREPARE_CART_SWAP';

export const LOCAL_TOOL_NAMES = [
  'setup_status',
  'check_commission_health',
  'suggest_replacement',
  'explain_cancellations',
  'search_offers',
  'price_history',
  'product_media',
  'get_earnings_summary',
  'list_missions',
  'enroll_mission',
  'list_video_clips',
  'prepare_cart_swap',
  'convert_links_in_text',
  'posting_budget',
  'set_posting_cap',
  'export_data',
] as const;

export function isLocalTool(name: string): boolean {
  return (LOCAL_TOOL_NAMES as readonly string[]).includes(name);
}

function bangkokDay(date = new Date()): string {
  return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dayOf(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  return new Date(time + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function grams(text: string): Set<string> {
  const folded = text.toLowerCase();
  const words = folded.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 2);
  if (words.length >= 2) return new Set(words);
  const chars = [...folded].filter((char) => /\p{L}|\p{N}/u.test(char));
  const out = new Set<string>();
  for (let i = 0; i < chars.length - 1; i += 1) out.add(chars[i] + chars[i + 1]);
  return out;
}

function overlap(left: string, right: string): number {
  const a = grams(left);
  const b = grams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : shared / union;
}

function latestByItem(rows: OfferSnapshot[]): OfferSnapshot[] {
  const map = new Map<string, OfferSnapshot>();
  for (const row of rows) {
    const current = map.get(row.item_id);
    if (!current || row.as_of > current.as_of) map.set(row.item_id, row);
  }
  return [...map.values()];
}

export function setupStatus(db: ShopkudDatabase, chrome: ChromeProbe) {
  const counts = db.counts();
  const steps = [
    { key: 'database', state: 'done', detail: 'sqlite ready' },
    { key: 'chrome', state: chrome.reachable ? 'done' : chrome.skipped ? 'skipped' : 'pending', detail: chrome.error || (chrome.reachable ? 'reachable' : 'not reachable'), port: chrome.port },
    { key: 'session', state: db.getAccountMarker() ? 'done' : 'pending', detail: db.getAccountMarker() ? 'account marker stored' : 'run get_conversions once while logged in' },
    { key: 'links', state: counts.links > 0 ? 'done' : 'pending', detail: `${counts.links} links` },
    { key: 'offers', state: counts.snapshots > 0 || counts.offers > 0 ? 'done' : 'pending', detail: `${counts.snapshots} snapshots` },
    { key: 'conversions', state: counts.conversions > 0 ? 'done' : 'pending', detail: `${counts.conversions} rows` },
  ];
  return {
    ok: true,
    ready: steps.every((step) => step.state === 'done'),
    steps,
    counts,
    page_loads: 0,
    as_of: new Date().toISOString(),
  };
}

export function commissionHealth(db: ShopkudDatabase, itemIds?: string[]) {
  const wanted = itemIds && itemIds.length > 0 ? new Set(itemIds) : null;
  const grouped = new Map<string, OfferSnapshot[]>();
  for (const row of db.listOfferSnapshots(500)) {
    if (wanted && !wanted.has(row.item_id)) continue;
    grouped.set(row.item_id, [...(grouped.get(row.item_id) || []), row]);
  }
  const results = [...grouped.entries()].map(([itemId, rows]) => {
    const ordered = [...rows].sort((a, b) => a.as_of < b.as_of ? -1 : 1);
    const latest = ordered[ordered.length - 1];
    const previous = ordered.length > 1 ? ordered[ordered.length - 2] : null;
    const rate = latest.store_rate;
    let status = 'ok';
    if (latest.stock === 0) status = 'oos';
    else if (rate === null || rate === 0) status = 'removed';
    else if (previous && previous.store_rate != null && rate < previous.store_rate) status = 'dropped';
    return {
      item_id: itemId,
      status,
      old_rate: previous?.store_rate ?? null,
      new_rate: rate,
      as_of: latest.as_of,
    };
  });
  const alerts = results.filter((row) => row.status !== 'ok');
  const at = new Date().toISOString();
  for (const alert of alerts) {
    db.saveAlert({ at, kind: 'commission_health', item_id: alert.item_id, status: alert.status, detail: alert });
  }
  return {
    ok: true,
    source: 'snapshots',
    checked_count: results.length,
    alert_count: alerts.length,
    results,
    alerts,
    as_of: at,
  };
}

export function suggestReplacement(db: ShopkudDatabase, itemId: string, k = 5) {
  const limit = Math.min(Math.max(k, 1), 20);
  const latest = latestByItem(db.listOfferSnapshots(500));
  const source = latest.find((row) => row.item_id === itemId) || null;
  const candidates = latest
    .filter((row) => row.item_id !== itemId && !row.excluded_category)
    .map((row) => {
      const sameCategory = Boolean(source?.category && row.category && source.category === row.category);
      const titleOverlap = overlap(source?.title || '', row.title || '');
      if (!sameCategory && titleOverlap < 0.2) return null;
      const reasons = [];
      let score = row.store_rate || 0;
      if (sameCategory) {
        score += 30;
        reasons.push('same_category');
      }
      if (titleOverlap >= 0.2) reasons.push('title_overlap');
      if (row.official) {
        score += 10;
        reasons.push('official_shop');
      }
      if (row.extra_comm) {
        score += 10;
        reasons.push('extra_comm');
      }
      if ((row.stock ?? 0) > 0) score += 10;
      if (row.stock === 0) {
        score -= 20;
        reasons.push('out_of_stock');
      }
      return {
        item_id: row.item_id,
        title: row.title,
        rate: row.store_rate,
        extra_comm: row.extra_comm,
        price: row.price,
        stock: row.stock,
        similarity: Math.round(titleOverlap * 100) / 100,
        score: Math.round(score * 100) / 100,
        reason: reasons.join(','),
        source: 'cache',
        as_of: row.as_of,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return {
    ok: true,
    item_id: itemId,
    candidates,
    count: candidates.length,
    source: 'cache',
    live_search: OFFER_LIST_PATH,
    live_search_note: LIVE_SEARCH_NOTE,
    as_of: new Date().toISOString(),
  };
}

export function explainCancellations(db: ShopkudDatabase, from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { ok: false, error: 'from and to must be YYYY-MM-DD' };
  }
  const rows = db.listConversions(from, to);
  const groups = new Map<string, { likely_reason: string; count: number; confidence: string; evidence_fields: string[]; commission: number }>();
  let zeroCommission = 0;
  for (const row of rows) {
    const decision = classifyCancellation({
      status: row.status,
      reason_hint: row.reason_hint,
      category: row.category,
      buyer_class: row.buyer_class,
      commission: row.commission,
      orders: row.orders,
    });
    if (row.commission === 0) zeroCommission += 1;
    const current = groups.get(decision.likely_reason) || {
      likely_reason: decision.likely_reason,
      count: 0,
      confidence: decision.confidence,
      evidence_fields: decision.evidence_fields,
      commission: 0,
    };
    current.count += row.orders || 1;
    current.commission = Math.round((current.commission + row.commission) * 100) / 100;
    groups.set(decision.likely_reason, current);
  }
  return {
    ok: true,
    from,
    to,
    classifications: [...groups.values()],
    summary: { rows: rows.length, zero_commission_rows: zeroCommission },
    order_level_data: 'omitted',
    source: 'sqlite',
    as_of: new Date().toISOString(),
  };
}

export interface OfferSearchInput {
  keyword?: string;
  official?: boolean;
  extra_comm?: boolean;
  min_rate?: number;
  limit?: number;
  sort?: 'commission' | 'price';
}

export function searchOffers(db: ShopkudDatabase, input: OfferSearchInput = {}) {
  const keyword = (input.keyword || '').toLowerCase();
  const limit = Math.min(Math.max(input.limit || 20, 1), 100);
  let items = latestByItem(db.listOfferSnapshots(500)).filter((row) => {
    if (row.excluded_category) return false;
    if (keyword && !`${row.title || ''} ${row.category || ''}`.toLowerCase().includes(keyword)) return false;
    if (input.official && !row.official) return false;
    if (input.extra_comm && !row.extra_comm) return false;
    if (input.min_rate != null && (row.store_rate || 0) < input.min_rate) return false;
    return true;
  });
  items = items.sort((a, b) => input.sort === 'price'
    ? (a.price || 0) - (b.price || 0)
    : (b.store_rate || 0) - (a.store_rate || 0));
  return {
    ok: true,
    keyword: input.keyword || null,
    sort: input.sort || 'commission',
    items: items.slice(0, limit),
    count: Math.min(items.length, limit),
    source: 'cache',
    live_search: OFFER_LIST_PATH,
    live_search_note: LIVE_SEARCH_NOTE,
    as_of: new Date().toISOString(),
  };
}

export function priceHistory(db: ShopkudDatabase, itemId: string) {
  const points = db.listOfferSnapshots(500)
    .filter((row) => row.item_id === itemId)
    .sort((a, b) => a.as_of < b.as_of ? -1 : 1)
    .map((row) => ({ as_of: row.as_of, price: row.price, source: row.source }));
  return { ok: true, item_id: itemId, points, count: points.length, source: 'snapshots' };
}

export function productMedia(db: ShopkudDatabase, itemId: string) {
  const latest = db.listOfferSnapshots(50, itemId).sort((a, b) => a.as_of < b.as_of ? 1 : -1)[0];
  return {
    ok: true,
    item_id: itemId,
    images: latest?.image_urls || [],
    source: 'cache',
  };
}

export function earningsSummary(db: ShopkudDatabase) {
  const row = db.latestEarnings();
  if (!row) {
    return {
      ok: true,
      pending: null,
      validated: null,
      paid: null,
      next_payout: null,
      kyc_status: 'unknown',
      expiring: [],
      source: 'none',
      live: EARNINGS_LIVE,
      note: EARNINGS_NOTE,
      payout_citation: PAYOUT_CITATION,
      as_of: new Date().toISOString(),
    };
  }
  const ageDays = Math.floor((Date.now() - Date.parse(row.balance_since || row.as_of)) / 86_400_000);
  const unpaid = (row.pending || 0) + (row.validated || 0);
  const expiring = unpaid > 0 && ageDays >= EARNINGS_EXPIRY_DAYS - EARNINGS_WARN_DAYS
    ? [{ kind: 'six_month_window', age_days: ageDays, evidence: 'unverified' }]
    : [];
  return {
    ok: true,
    pending: row.pending,
    validated: row.validated,
    paid: row.paid,
    next_payout: row.next_payout,
    kyc_status: row.kyc_status,
    expiring,
    balance_since: row.balance_since,
    expiry_rule: { assumed_days: EARNINGS_EXPIRY_DAYS, warn_days: EARNINGS_WARN_DAYS, evidence: 'unverified' },
    payout_citation: PAYOUT_CITATION,
    source: row.source,
    live: EARNINGS_LIVE,
    note: EARNINGS_NOTE,
    as_of: row.as_of,
  };
}

export function listMissions(db: ShopkudDatabase, status?: string) {
  const missions = db.listMissions(status);
  return { ok: true, missions, count: missions.length, source: 'sqlite', live: MISSIONS_LIVE, note: MISSIONS_NOTE };
}

export function enrollMission(db: ShopkudDatabase, input: { mission_id?: string; name?: string; reward?: string; requirements?: string; deadline?: string; confirm?: string }) {
  const missionId = String(input.mission_id || '');
  const name = String(input.name || '');
  if (!missionId || !name) return { ok: false, error: 'mission_id and name are required', submitted_to_shopee: false };
  const plan = {
    ok: true,
    mission_id: missionId,
    name,
    reward: input.reward || null,
    requirements: input.requirements || null,
    deadline: input.deadline || null,
    submitted_to_shopee: false,
    live: MISSIONS_LIVE,
    note: MISSIONS_NOTE,
  };
  if (input.confirm !== ENROLL_CONFIRM) {
    return { ...plan, dry_run: true, confirm_required: true, confirm: ENROLL_CONFIRM, prepared: false };
  }
  db.saveMission({
    mission_id: missionId,
    name,
    reward: input.reward || null,
    requirements: input.requirements || null,
    deadline: input.deadline || null,
    status: 'prepared',
    enrolled: false,
  });
  return { ...plan, dry_run: false, confirm_required: false, prepared: true, enrolled: false };
}

export function listVideoClips(db: ShopkudDatabase) {
  return {
    ok: true,
    clips: db.listVideoClips(),
    live_verified: false,
    note: VIDEO_CREATOR_NOTE,
    source: 'sqlite',
  };
}

export function prepareCartSwap(db: ShopkudDatabase, input: { video_id?: string; old_product_id?: string; new_product_id?: string; confirm?: string }) {
  const videoId = String(input.video_id || '');
  if (!videoId || !input.new_product_id) {
    return { ok: false, error: 'video_id and new_product_id are required', submitted_to_shopee: false };
  }
  const plan = {
    ok: true,
    video_id: videoId,
    old_product_id: input.old_product_id || null,
    new_product_id: input.new_product_id,
    confirmation_required: true,
    submitted_to_shopee: false,
    live_verified: false,
    note: VIDEO_CREATOR_NOTE,
  };
  if (input.confirm !== CART_CONFIRM) {
    return { ...plan, confirmed: false, local_cart_updated: false };
  }
  const updated = db.updateVideoCart(videoId, { product_id: input.new_product_id, replaced: input.old_product_id || null });
  return { ...plan, confirmed: true, local_cart_updated: updated, confirmation_required: false };
}

const URL_PATTERN = /https:\/\/(?:s\.)?shopee\.co\.th\/[^\s<>"')]+/gi;

export function convertLinksInText(db: ShopkudDatabase, text: string, channel: string, clipId?: string | null) {
  const links = db.findLinks({});
  const conversions: Array<{ from: string; to: string | null; replaced: boolean }> = [];
  const replaced = text.replace(URL_PATTERN, (url) => {
    const clean = url.replace(/[.,]+$/, '');
    let match = links.find((link) => link.short_link === clean);
    if (!match) {
      const item = clean.match(/-i\.(\d+)\.(\d+)/) || clean.match(/\/product\/(\d+)\/(\d+)/);
      const itemId = item ? item[2] : null;
      if (itemId) {
        match = links.find((link) => link.item_id === itemId && link.channel === channel && (!clipId || link.clip_id === clipId));
      }
    }
    const next = match && match.short_link !== clean ? match.short_link : null;
    conversions.push({ from: clean, to: next, replaced: Boolean(next) });
    return next || url;
  });
  return {
    ok: true,
    channel,
    clip_id: clipId || null,
    text: replaced,
    conversions,
    urls_found: conversions.length,
    replaced: conversions.filter((row) => row.replaced).length,
    opens_links: false,
    source: 'registry',
    as_of: new Date().toISOString(),
  };
}

export function postingBudget(db: ShopkudDatabase, platform: string) {
  if (!/^[a-z0-9_]{1,32}$/.test(platform)) return { ok: false, error: 'invalid_platform' };
  const today = bangkokDay();
  const count = db.findLinks({}).filter((link) => dayOf(link.created_at) === today && (link.channel === platform || link.sub_ids.sub_id1 === platform)).length;
  const stored = db.getPostingCap(platform);
  const cap = stored?.daily_cap ?? DEFAULT_POSTING_CAPS[platform] ?? 20;
  return {
    ok: true,
    platform,
    today: count,
    cap,
    ok_to_post: count < cap,
    remaining: Math.max(0, cap - count),
    cap_evidence: stored ? 'owner_set' : 'unverified_local',
    source: 'sqlite',
    as_of: new Date().toISOString(),
  };
}

export function setPostingCap(db: ShopkudDatabase, platform: string, dailyCap: number) {
  if (!/^[a-z0-9_]{1,32}$/.test(platform)) return { ok: false, error: 'invalid_platform' };
  if (!Number.isInteger(dailyCap) || dailyCap < 1 || dailyCap > 10000) return { ok: false, error: 'daily_cap must be an integer from 1 to 10000' };
  db.setPostingCap(platform, dailyCap);
  return { ok: true, platform, daily_cap: dailyCap, cap_evidence: 'owner_set' };
}

const EXPORTS: Record<string, { columns: string[]; rows: (db: ShopkudDatabase, from?: string, to?: string) => Array<Record<string, unknown>> }> = {
  links: {
    columns: ['item_id', 'short_link', 'channel', 'clip_id', 'sub_id1', 'sub_id2', 'sub_id3', 'sub_id4', 'sub_id5', 'origin', 'created_at', 'ownership_verified'],
    rows: (db) => db.findLinks({}).map((link) => ({
      item_id: link.item_id,
      short_link: link.short_link,
      channel: link.channel,
      clip_id: link.clip_id,
      sub_id1: link.sub_ids.sub_id1,
      sub_id2: link.sub_ids.sub_id2,
      sub_id3: link.sub_ids.sub_id3,
      sub_id4: link.sub_ids.sub_id4,
      sub_id5: link.sub_ids.sub_id5,
      origin: link.origin,
      created_at: link.created_at,
      ownership_verified: link.ownership_verified,
    })),
  },
  conversions: {
    columns: ['purchased_on', 'status', 'utm_content', 'sub_id1', 'sub_id2', 'sub_id3', 'sub_id4', 'sub_id5', 'orders', 'gmv', 'commission', 'cancelled', 'category', 'reason_hint'],
    rows: (db, from, to) => db.listConversions(from, to).map((row) => ({ ...row })),
  },
  offers: {
    columns: ['item_id', 'as_of', 'price', 'store_rate', 'title', 'category', 'excluded_category', 'excluded_match', 'source'],
    rows: (db) => latestByItem(db.listOfferSnapshots(500)).map((row) => ({ ...row, image_urls: undefined })),
  },
  alerts: {
    columns: ['at', 'kind', 'item_id', 'status'],
    rows: (db) => db.listAlerts(500).map((row) => ({ at: row.at, kind: row.kind, item_id: row.item_id, status: row.status })),
  },
  missions: {
    columns: ['mission_id', 'name', 'status', 'deadline', 'enrolled'],
    rows: (db) => db.listMissions().map((row) => ({ ...row })),
  },
  clips: {
    columns: ['clip_id', 'channel', 'title', 'status'],
    rows: (db) => db.listClips(),
  },
  posts: {
    columns: ['post_id', 'clip_id', 'channel', 'link_id', 'posted_on', 'status'],
    rows: (db) => db.listPosts(),
  },
  earnings: {
    columns: ['as_of', 'pending', 'validated', 'paid', 'kyc_status', 'source'],
    rows: (db) => {
      const row = db.latestEarnings();
      return row ? [row as unknown as Record<string, unknown>] : [];
    },
  },
  videos: {
    columns: ['video_id', 'title', 'status', 'as_of'],
    rows: (db) => db.listVideoClips(),
  },
};

export function exportData(db: ShopkudDatabase, kind: string, format: string, from?: string, to?: string) {
  const spec = EXPORTS[kind];
  if (!spec) return { ok: false, error: 'unknown_export' };
  if (format !== 'csv' && format !== 'json') return { ok: false, error: 'format must be csv or json' };
  const rows = spec.rows(db, from, to).slice(0, 5000);
  if (format === 'json') {
    return { ok: true, kind, format, rows, count: rows.length, formula_neutralized: false, source: 'sqlite' };
  }
  return { ok: true, kind, format, body: toCsv(rows, spec.columns), count: rows.length, formula_neutralized: true, source: 'sqlite' };
}

export function subIdKey(subIds: Partial<SubIds> | null | undefined): string {
  return [1, 2, 3, 4, 5].map((slot) => {
    const value = subIds?.[`sub_id${slot}` as keyof SubIds];
    return typeof value === 'string' ? value : '';
  }).join('\u0000');
}

export function runLocalTool(
  name: string,
  args: Record<string, unknown>,
  db: ShopkudDatabase,
  chrome: ChromeProbe,
): Record<string, unknown> | null {
  if (!isLocalTool(name)) return null;
  if (name === 'setup_status') return setupStatus(db, chrome);
  if (name === 'check_commission_health') {
    const ids = Array.isArray(args.item_ids) ? args.item_ids.map(String).slice(0, 100) : undefined;
    return commissionHealth(db, ids);
  }
  if (name === 'suggest_replacement') return suggestReplacement(db, String(args.item_id || ''), Number(args.k || 5));
  if (name === 'explain_cancellations') return explainCancellations(db, String(args.from || ''), String(args.to || ''));
  if (name === 'search_offers') {
    return searchOffers(db, {
      keyword: typeof args.keyword === 'string' ? args.keyword : undefined,
      official: args.official === true,
      extra_comm: args.extra_comm === true,
      min_rate: args.min_rate == null ? undefined : Number(args.min_rate),
      limit: args.limit == null ? undefined : Number(args.limit),
      sort: args.sort === 'price' ? 'price' : 'commission',
    });
  }
  if (name === 'price_history') return priceHistory(db, String(args.item_id || ''));
  if (name === 'product_media') return productMedia(db, String(args.item_id || ''));
  if (name === 'get_earnings_summary') return earningsSummary(db);
  if (name === 'list_missions') return listMissions(db, typeof args.status === 'string' ? args.status : undefined);
  if (name === 'enroll_mission') return enrollMission(db, args as any);
  if (name === 'list_video_clips') return listVideoClips(db);
  if (name === 'prepare_cart_swap') return prepareCartSwap(db, args as any);
  if (name === 'convert_links_in_text') return convertLinksInText(db, String(args.text || ''), String(args.channel || ''), typeof args.clip_id === 'string' ? args.clip_id : null);
  if (name === 'posting_budget') return postingBudget(db, String(args.platform || ''));
  if (name === 'set_posting_cap') return setPostingCap(db, String(args.platform || ''), Number(args.daily_cap));
  if (name === 'export_data') return exportData(db, String(args.kind || ''), String(args.format || 'json'), typeof args.from === 'string' ? args.from : undefined, typeof args.to === 'string' ? args.to : undefined);
  return { ok: false, error: 'unknown_tool' };
}

export function reportListCarriesStatus(sampleUrl: string): string | null {
  try {
    const url = new URL(sampleUrl);
    return ['checkout_status', 'order_status', 'status'].find((key) => url.searchParams.has(key)) || null;
  } catch {
    return null;
  }
}

export { excludedCategory, EXCLUDED_CATEGORY_CITATION };
export type { ConversionRow };

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
});

export const LOCAL_TOOL_SCHEMAS = [
  { name: 'setup_status', description: 'Onboarding checklist: database, Chrome probe, stored session, links, offers, conversions. Does not open a page.', inputSchema: objectSchema({}) },
  { name: 'check_commission_health', description: 'Compare stored offer snapshots and write alerts for dropped, removed, or out-of-stock rates. Does not fetch Shopee.', inputSchema: objectSchema({ item_ids: { type: 'array', items: { type: 'string' } } }) },
  { name: 'suggest_replacement', description: 'Rank cached offers that could replace an item. Live catalog search is not verified, so it is not called.', inputSchema: objectSchema({ item_id: { type: 'string' }, k: { type: 'number' } }, ['item_id']) },
  { name: 'explain_cancellations', description: 'Classify stored conversion rows. Does not return order ids.', inputSchema: objectSchema({ from: { type: 'string' }, to: { type: 'string' } }, ['from', 'to']) },
  { name: 'search_offers', description: 'Search stored offer snapshots by keyword, official shop, extra commission, and minimum rate.', inputSchema: objectSchema({ keyword: { type: 'string' }, official: { type: 'boolean' }, extra_comm: { type: 'boolean' }, min_rate: { type: 'number' }, limit: { type: 'number' }, sort: { type: 'string', enum: ['commission', 'price'] } }) },
  { name: 'price_history', description: 'Price points from our own offer snapshots.', inputSchema: objectSchema({ item_id: { type: 'string' } }, ['item_id']) },
  { name: 'product_media', description: 'Image URLs kept from our snapshots. Only https Shopee image hosts are stored.', inputSchema: objectSchema({ item_id: { type: 'string' } }, ['item_id']) },
  { name: 'get_earnings_summary', description: 'Read the latest stored payout snapshot. Does not open the payout page.', inputSchema: objectSchema({}) },
  { name: 'list_missions', description: 'List missions stored locally. Does not fetch Shopee missions.', inputSchema: objectSchema({ status: { type: 'string' } }) },
  { name: 'enroll_mission', description: 'Prepare a mission enrollment. Never submits to Shopee. confirm must be ENROLL_MISSION to store a local prepared row.', inputSchema: objectSchema({ mission_id: { type: 'string' }, name: { type: 'string' }, reward: { type: 'string' }, requirements: { type: 'string' }, deadline: { type: 'string' }, confirm: { type: 'string' } }, ['mission_id', 'name']) },
  { name: 'list_video_clips', description: 'List locally stored video clips. The Shopee Video creator site is not verified.', inputSchema: objectSchema({}) },
  { name: 'prepare_cart_swap', description: 'Prepare a local cart swap. Never submits to Shopee. confirm must be PREPARE_CART_SWAP to update the local cart.', inputSchema: objectSchema({ video_id: { type: 'string' }, old_product_id: { type: 'string' }, new_product_id: { type: 'string' }, confirm: { type: 'string' } }, ['video_id', 'new_product_id']) },
  { name: 'convert_links_in_text', description: 'Replace Shopee URLs in text with registry short links. Does not open any URL.', inputSchema: objectSchema({ text: { type: 'string' }, channel: { type: 'string' }, clip_id: { type: 'string' } }, ['text', 'channel']) },
  { name: 'posting_budget', description: 'How many links were registered today for a platform, against a local cap. Caps are not a Shopee rule.', inputSchema: objectSchema({ platform: { type: 'string' } }, ['platform']) },
  { name: 'set_posting_cap', description: 'Store an owner-set daily cap for posting_budget.', inputSchema: objectSchema({ platform: { type: 'string' }, daily_cap: { type: 'number' } }, ['platform', 'daily_cap']) },
  { name: 'export_data', description: 'Export sqlite rows as CSV or JSON. CSV cells that start with = + - @ are prefixed so spreadsheets do not treat them as formulas.', inputSchema: objectSchema({ kind: { type: 'string' }, format: { type: 'string', enum: ['csv', 'json'] }, from: { type: 'string' }, to: { type: 'string' } }, ['kind', 'format']) },
];
