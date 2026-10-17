import { createHash } from 'crypto';

/**
 * Conversion rows from GET /api/v3/report/list, or from a CSV download.
 * Money values at or above 100000 are baht × 100000. Smaller numbers are already baht.
 * utm_content slots are platform, product, clip, variant, yyyymm.
 */

export interface CsvColumnMapping {
  sub_id: string;
  commission: string;
  clicks?: string;
  orders?: string;
  status?: string;
  gmv?: string;
}

export interface MappedCsvRow {
  sub_id: string;
  commission: number;
  clicks: number;
  orders: number;
  status: string;
  gmv: number;
}

export interface ConversionRow {
  conversion_id: string;
  purchased_on: string;
  status: string;
  utm_content: string;
  sub_id1: string | null;
  sub_id2: string | null;
  sub_id3: string | null;
  sub_id4: string | null;
  sub_id5: string | null;
  orders: number;
  gmv: number;
  commission: number;
  cancelled: number;
}

export interface SalesBucket {
  key: string;
  orders: number;
  gmv: number;
  commission: number;
  cancelled: number;
}

export type SalesDim = 'sub_id' | 'platform' | 'clip' | 'product';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function money(value: unknown): number {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/,/g, '')) : NaN;
  if (!Number.isFinite(amount)) return 0;
  const baht = Math.abs(amount) >= 100000 ? amount / 100000 : amount;
  return Math.round(baht * 100) / 100;
}

export function splitSubIds(utmContent: string): [string | null, string | null, string | null, string | null, string | null] {
  const parts = utmContent.split('-');
  const pick = (index: number): string | null => {
    const value = parts[index];
    return value ? value : null;
  };
  if (parts.length <= 5) return [pick(0), pick(1), pick(2), pick(3), pick(4)];
  const tail = parts.slice(4).join('-');
  return [pick(0), pick(1), pick(2), pick(3), tail || null];
}

export function purchasedOn(value: unknown): string {
  const time = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(time) || time <= 0) return '';
  const ms = time > 1e12 ? time : time * 1000;
  const bangkok = new Date(ms + 7 * 60 * 60 * 1000);
  return bangkok.toISOString().slice(0, 10);
}

function cancelledStatus(status: string): boolean {
  return /cancel|ยกเลิก|refund/i.test(status);
}

function rowId(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

export function conversionsFromReportList(payload: unknown): ConversionRow[] {
  const data = asRecord(asRecord(payload).data);
  const list = Array.isArray(data.list) ? data.list : [];
  const rows: ConversionRow[] = [];
  list.forEach((checkoutValue, checkoutIndex) => {
    const checkout = asRecord(checkoutValue);
    const utm = typeof checkout.utm_content === 'string' ? checkout.utm_content : '';
    const [sub1, sub2, sub3, sub4, sub5] = splitSubIds(utm);
    const purchased = purchasedOn(checkout.purchase_time);
    const checkoutStatus = typeof checkout.checkout_status === 'string' ? checkout.checkout_status : '';
    const orders = Array.isArray(checkout.orders) ? checkout.orders : [];
    const orderRows = orders.length > 0 ? orders : [null];
    orderRows.forEach((orderValue, orderIndex) => {
      const order = asRecord(orderValue);
      const orderStatus = typeof order.order_status === 'string' ? order.order_status : checkoutStatus;
      const items = Array.isArray(order.items) ? order.items : [];
      const gmv = items.reduce((sum, item) => sum + money(asRecord(item).actual_amount || asRecord(item).item_price), 0);
      const itemCommission = items.reduce((sum, item) => sum + money(asRecord(item).item_commission), 0);
      const checkoutCommission = money(checkout.estimated_total_commission);
      const commission = orders.length <= 1 && checkoutCommission > 0 ? checkoutCommission : itemCommission;
      const status = orderStatus || checkoutStatus || 'unknown';
      const cancelled = cancelledStatus(status) || cancelledStatus(checkoutStatus) ? 1 : 0;
      const orderKey = typeof order.order_sn === 'string' && order.order_sn ? order.order_sn : String(orderIndex);
      const itemKey = items.map((item) => String(asRecord(item).item_id ?? '')).join(',');
      rows.push({
        conversion_id: rowId([String(checkoutIndex), orderKey, itemKey, utm, purchased]),
        purchased_on: purchased,
        status,
        utm_content: utm,
        sub_id1: sub1,
        sub_id2: sub2,
        sub_id3: sub3,
        sub_id4: sub4,
        sub_id5: sub5,
        orders: 1,
        gmv,
        commission,
        cancelled,
      });
    });
  });
  return rows;
}

export function csvMappingFromHeader(headerLine: string): CsvColumnMapping {
  const headers = headerLine.split(',').map((header) => header.trim());
  const find = (...names: string[]) => names.find((name) => headers.includes(name));
  const subId = find('utm_content', 'Sub ID', 'sub_id');
  const commission = find('commission', 'Commission');
  if (!subId || !commission) throw new Error('Required columns not found in CSV');
  return {
    sub_id: subId,
    commission,
    clicks: find('clicks', 'Clicks'),
    orders: find('orders', 'Orders'),
    status: find('status', 'Status'),
    gmv: find('gmv', 'GMV'),
  };
}

export function parseMappedCsv(csvText: string, mapping: CsvColumnMapping): MappedCsvRow[] {
  const lines = csvText.trim().split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((header) => header.trim());
  const index = (name?: string) => (name ? headers.indexOf(name) : -1);
  const subIdIndex = index(mapping.sub_id);
  const commissionIndex = index(mapping.commission);
  if (subIdIndex === -1 || commissionIndex === -1) {
    throw new Error('Required columns not found in CSV');
  }
  const clicksIndex = index(mapping.clicks);
  const ordersIndex = index(mapping.orders);
  const statusIndex = index(mapping.status);
  const gmvIndex = index(mapping.gmv);
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((value) => value.trim());
    return {
      sub_id: values[subIdIndex] || '',
      commission: Number(values[commissionIndex]) || 0,
      clicks: clicksIndex >= 0 ? Number(values[clicksIndex]) || 0 : 0,
      orders: ordersIndex >= 0 ? Number(values[ordersIndex]) || 0 : 0,
      status: statusIndex >= 0 ? values[statusIndex] || 'unknown' : 'unknown',
      gmv: gmvIndex >= 0 ? Number(values[gmvIndex]) || 0 : 0,
    };
  });
}

export function conversionsFromMappedCsv(rows: MappedCsvRow[], purchasedOnDay: string): ConversionRow[] {
  return rows.map((row) => {
    const [sub1, sub2, sub3, sub4, sub5] = splitSubIds(row.sub_id);
    return {
      conversion_id: rowId([row.sub_id, purchasedOnDay, row.status, String(row.commission), String(row.gmv)]),
      purchased_on: purchasedOnDay,
      status: row.status,
      utm_content: row.sub_id,
      sub_id1: sub1,
      sub_id2: sub2,
      sub_id3: sub3,
      sub_id4: sub4,
      sub_id5: sub5,
      orders: row.orders > 0 ? row.orders : 1,
      gmv: money(row.gmv),
      commission: money(row.commission),
      cancelled: cancelledStatus(row.status) ? (row.orders > 0 ? row.orders : 1) : 0,
    };
  });
}

export function salesBy(rows: ConversionRow[], dim: SalesDim, from: string, to: string): SalesBucket[] {
  const buckets = new Map<string, SalesBucket>();
  for (const row of rows) {
    if (row.purchased_on && (row.purchased_on < from || row.purchased_on > to)) continue;
    const key = dim === 'platform' ? row.sub_id1
      : dim === 'product' ? row.sub_id2
        : dim === 'clip' ? row.sub_id3
          : row.utm_content;
    const name = key || '(none)';
    const bucket = buckets.get(name) || { key: name, orders: 0, gmv: 0, commission: 0, cancelled: 0 };
    bucket.orders += row.orders;
    bucket.gmv = Math.round((bucket.gmv + row.gmv) * 100) / 100;
    bucket.commission = Math.round((bucket.commission + row.commission) * 100) / 100;
    bucket.cancelled += row.cancelled;
    buckets.set(name, bucket);
  }
  return [...buckets.values()];
}

export function reportAffiliateId(payload: unknown): string | null {
  const data = asRecord(asRecord(payload).data);
  const list = Array.isArray(data.list) ? data.list : [];
  return affiliateMarker(asRecord(list[0]).affiliate_id);
}

export function affiliateMarker(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(?:an_)?(\d+)$/);
  return match ? match[1] : null;
}
