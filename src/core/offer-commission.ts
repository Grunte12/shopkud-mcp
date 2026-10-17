/**
 * Convert a Shopee affiliate offer payload into percents and baht.
 *
 * Rate integers are percent × 1000: 12000 is 12, 600 is 0.6, and 0 stays 0.
 * A whole number under 100 is already a percent. A "12%" string is already a percent.
 * When an integer and a percent string both exist, the integer wins.
 *
 * default_commission_rate is the total. The page rows are the store (seller),
 * Shopee, and xtra. Xtra has no integer field: total − store − Shopee.
 * Price integers are baht × 100000.
 */

export interface OfferCommission {
  commission_rate: number;
  store_commission_percent: number;
  shopee_commission_percent: number | null;
  xtra_commission_percent: number | null;
  total_commission_percent: number | null;
  checkout_commission_percent: number | null;
  price: number | null;
  price_baht: number | null;
  price_min_baht: number | null;
  price_max_baht: number | null;
  commission_baht: number | null;
  store_commission_baht: number | null;
  shopee_commission_baht: number | null;
  total_commission_baht: number | null;
  commission_min_baht: number | null;
  commission_max_baht: number | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/,/g, '').replace(/%$/, '');
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  }
  return null;
}

/** "12%" or "12.5 %" → 12 or 12.5. Money text such as "฿59.76" is not a percent. */
export function percentFromPercentText(value: unknown): number | null {
  if (typeof value !== 'string' || !value.includes('%')) return null;
  const match = value.replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)\s*%/);
  return match ? round2(Number(match[1])) : null;
}

/**
 * 12000 → 12, 10000 → 10, 2000 → 2, 600 → 0.6, 0 → 0.
 * 10 and "10%" stay 10. "12%" stays 12.
 */
export function percentFromScaledRate(value: unknown): number | null {
  if (typeof value === 'string' && value.includes('%')) {
    return percentFromPercentText(value);
  }
  const rate = readNumber(value);
  if (rate == null) return null;
  const scaled = Number.isInteger(rate) && Math.abs(rate) >= 100;
  return round2(scaled ? rate / 1000 : rate);
}

/** 49800000 → 498. A plain baht amount under 100000 stays as-is. */
export function bahtFromScaledPrice(value: unknown): number | null {
  if (typeof value === 'string' && value.includes('-') && !value.trim().startsWith('-')) {
    return bahtFromScaledPrice(value.split('-')[0]);
  }
  const amount = readNumber(value);
  if (amount == null) return null;
  const scaled = Math.abs(amount) >= 100000;
  return round2(scaled ? amount / 100000 : amount);
}

export function bahtFromPercent(price: number | null, percent: number | null): number | null {
  if (price == null || percent == null) return null;
  return Math.round(price * percent) / 100;
}

function firstNumber(...values: Array<number | null>): number | null {
  for (const value of values) {
    if (value != null) return value;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function checkoutPercent(detail: Record<string, unknown>): number | null {
  for (const [key, value] of Object.entries(detail)) {
    if (/social_media_check_out_base/i.test(key)) {
      const percent = percentFromScaledRate(value);
      if (percent != null) return percent;
    }
  }
  return null;
}

export function commissionFromOfferPayload(response: unknown): OfferCommission | null {
  const root = asRecord(response);
  const data = asRecord(root.data && typeof root.data === 'object' ? root.data : root);
  if (Object.keys(data).length === 0) return null;

  const detail = asRecord(data.commission_rate_detail);
  const rates = asRecord(data.commission_rate);
  const flatRate = data.commission_rate;

  const total = firstNumber(
    percentFromScaledRate(detail.default_commission_rate),
    percentFromPercentText(rates.default_commission_rate),
  );
  const seller = firstNumber(
    percentFromScaledRate(detail.seller_commission_rate),
    percentFromPercentText(rates.seller_commission_rate),
  );
  const shopee = firstNumber(
    percentFromScaledRate(detail.shopee_commission_rate),
    percentFromPercentText(rates.shopee_commission_rate),
  );
  const store = firstNumber(
    seller,
    seller == null ? percentFromScaledRate(rates.max_commission_rate) : null,
    seller == null && (typeof flatRate === 'number' || typeof flatRate === 'string')
      ? percentFromScaledRate(flatRate)
      : null,
    seller == null ? percentFromScaledRate(data.commission_pct) : null,
    seller == null ? total : null,
  );
  if (store == null && total == null) return null;

  const storePercent = store ?? 0;
  const xtra = total == null ? null : round2(total - storePercent - (shopee ?? 0));
  const card = asRecord(data.batch_item_for_item_card_full);
  const priceBaht = bahtFromScaledPrice(card.price) ?? bahtFromScaledPrice(data.price);
  const priceMin = bahtFromScaledPrice(card.price_min) ?? priceBaht;
  const priceMax = bahtFromScaledPrice(card.price_max) ?? priceBaht;

  return {
    commission_rate: storePercent,
    store_commission_percent: storePercent,
    shopee_commission_percent: shopee,
    xtra_commission_percent: xtra,
    total_commission_percent: total,
    checkout_commission_percent: checkoutPercent(detail),
    price: priceBaht,
    price_baht: priceBaht,
    price_min_baht: priceMin,
    price_max_baht: priceMax,
    commission_baht: bahtFromPercent(priceBaht, storePercent),
    store_commission_baht: bahtFromPercent(priceBaht, storePercent),
    shopee_commission_baht: bahtFromPercent(priceBaht, shopee),
    total_commission_baht: bahtFromPercent(priceBaht, total),
    commission_min_baht: bahtFromPercent(priceMin, storePercent),
    commission_max_baht: bahtFromPercent(priceMax, storePercent),
  };
}
