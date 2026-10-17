import { excludedCategory } from './excluded-categories.js';

export const REASON_HINTS = [
  'cancelled', 'returned', 'self', 'household', 'another_link', 'voucher',
  'excluded_category', 'indirect', 'shop_cancel', 'seller_cancel',
  'payment_failed', 'buyer_cancel', 'unknown', 'unrecognized',
] as const;

export interface CancellationInput {
  status?: string | null;
  reason_hint?: string | null;
  category?: string | null;
  buyer_class?: string | null;
  commission?: number | null;
  orders?: number | null;
}

export interface CancellationClass {
  likely_reason: string;
  confidence: string;
  evidence_fields: string[];
}

function classified(reason: string, confidence: string, evidence: string[]): CancellationClass {
  return { likely_reason: reason, confidence, evidence_fields: evidence };
}

/** One row in, one class out. Order ids and buyer names are not read. */
export function classifyCancellation(row: CancellationInput): CancellationClass {
  const status = (row.status || '').toLowerCase();
  const reason = (row.reason_hint || '').toLowerCase();
  const buyer = (row.buyer_class || '').toLowerCase();
  const commission = Number(row.commission ?? 0);
  const orders = Number(row.orders ?? 0);

  if (buyer === 'self' || buyer === 'household') return classified('self_or_household_purchase', '0.80', ['buyer_class']);
  if (reason === 'another_link') return classified('buyer_clicked_another_link', '0.75', ['reason_hint']);
  const categoryMatch = excludedCategory(row.category);
  if (reason === 'excluded_category' || categoryMatch) {
    return classified('excluded_category', '0.85', [categoryMatch ? 'category' : 'reason_hint']);
  }
  if (reason === 'indirect') return classified('indirect_order', '0.70', ['reason_hint']);
  if (reason === 'shop_cancel' || reason === 'seller_cancel' || status.includes('shop') || status.includes('seller')) {
    const fromStatus = status.includes('shop') || status.includes('seller');
    return classified('shop_cancel', '0.75', [fromStatus ? 'status' : 'reason_hint']);
  }
  if (reason === 'voucher' || (commission === 0 && reason === 'payment_failed')) {
    if (reason === 'payment_failed') return classified('payment_failed', '0.70', ['reason_hint']);
    return classified('voucher_fully_paid', '0.65', ['reason_hint']);
  }
  if (reason === 'payment_failed') return classified('payment_failed', '0.70', ['reason_hint']);
  if (
    reason === 'cancelled' || reason === 'returned' || reason === 'buyer_cancel'
    || status === 'cancelled' || status === 'returned' || status === 'refunded'
    || status.includes('cancel') || status.includes('return') || status.includes('ยกเลิก')
  ) {
    return classified('order_cancelled_or_returned', '0.70', [status ? 'status' : 'reason_hint']);
  }
  if (commission === 0 && orders > 0) return classified('zero_commission_unclassified', '0.30', ['commission']);
  return classified('unknown', '0.20', []);
}
