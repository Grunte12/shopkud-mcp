import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commissionFromOfferPayload,
  percentFromScaledRate,
} from '../src/core/offer-commission.js';

/**
 * Redacted live offer shape. Shop, item, and account ids are omitted.
 * Rate integers are the live scale. Money strings are the page's own text twins.
 */
const liveOffer = {
  code: 0,
  data: {
    commission: '฿59.76',
    commission_rate: {
      seller_commission_rate: '10%',
      seller_commission: '฿49.80',
      shopee_commission_rate: '2%',
      shopee_commission: '฿9.96',
      default_commission_rate: '12%',
      default_commission: '฿59.76',
    },
    commission_rate_detail: {
      default_commission_rate: 12000,
      seller_commission_rate: 10000,
      shopee_commission_rate: 2000,
      social_media_check_out_base_commission_rate: 600,
    },
    batch_item_for_item_card_full: {
      price: '49800000',
      price_min: '49800000',
      price_max: '56900000',
    },
  },
};

test('scaled rate integers divide by 1000, including values under 1000', () => {
  assert.strictEqual(percentFromScaledRate(12000), 12);
  assert.strictEqual(percentFromScaledRate(10000), 10);
  assert.strictEqual(percentFromScaledRate(2000), 2);
  assert.strictEqual(percentFromScaledRate(600), 0.6);
  assert.strictEqual(percentFromScaledRate(0), 0);
  assert.strictEqual(percentFromScaledRate(10), 10);
  assert.strictEqual(percentFromScaledRate('12%'), 12);
  assert.strictEqual(percentFromScaledRate('฿59.76'), null);
});

test('live offer JSON keeps the store row separate from the 12% total', () => {
  const parsed = commissionFromOfferPayload(liveOffer);
  assert.ok(parsed);
  assert.strictEqual(parsed.total_commission_percent, 12);
  assert.strictEqual(parsed.store_commission_percent, 10);
  assert.strictEqual(parsed.shopee_commission_percent, 2);
  assert.strictEqual(parsed.xtra_commission_percent, 0);
  assert.strictEqual(parsed.commission_rate, 10);
  assert.strictEqual(parsed.checkout_commission_percent, 0.6);
  assert.strictEqual(parsed.price_baht, 498);
  assert.strictEqual(parsed.price_max_baht, 569);
  assert.strictEqual(parsed.store_commission_baht, 49.8);
  assert.strictEqual(parsed.commission_baht, 49.8);
  assert.strictEqual(parsed.shopee_commission_baht, 9.96);
  assert.strictEqual(parsed.total_commission_baht, 59.76);
  assert.strictEqual(parsed.commission_max_baht, 56.9);
  assert.strictEqual(
    (parsed.store_commission_percent ?? 0)
      + (parsed.shopee_commission_percent ?? 0)
      + (parsed.xtra_commission_percent ?? 0),
    parsed.total_commission_percent,
  );
});

test('the integer wins when the percent string disagrees', () => {
  const parsed = commissionFromOfferPayload({
    data: {
      commission_rate: {
        seller_commission_rate: '99%',
        default_commission_rate: '99%',
        shopee_commission_rate: '99%',
      },
      commission_rate_detail: {
        default_commission_rate: 12000,
        seller_commission_rate: 10000,
        shopee_commission_rate: 2000,
      },
    },
  });
  assert.strictEqual(parsed?.store_commission_percent, 10);
  assert.strictEqual(parsed?.total_commission_percent, 12);
  assert.strictEqual(parsed?.shopee_commission_percent, 2);
});

test('a payload that only has an already-percent value stays on that percent', () => {
  const parsed = commissionFromOfferPayload({
    data: { commission_pct: 10, price: 299 },
  });
  assert.strictEqual(parsed?.store_commission_percent, 10);
  assert.strictEqual(parsed?.price_baht, 299);
  assert.strictEqual(parsed?.commission_baht, 29.9);
  assert.strictEqual(parsed?.total_commission_percent, null);
});
