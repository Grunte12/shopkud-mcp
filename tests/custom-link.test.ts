import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customLinksFromResponse } from '../src/core/custom-link.js';
import { isShortLink } from '../src/config/selectors.js';

/**
 * Redacted live POST /api/v3/gql?q=batchCustomLink body.
 * The real item has only shortLink, longLink, and failCode.
 * failCode 0 is success. utm_content is the five Sub ID slots joined by "-".
 * The tracking signature, affiliate id, and product ids are removed.
 */
const liveCreateResponse = {
  data: {
    batchCustomLink: [
      {
        shortLink: 'https://s.shopee.co.th/REDACTED',
        longLink: 'https://shopee.co.th/universal-link/product/SHOP/ITEM?utm_campaign=-&utm_content=test----&utm_medium=affiliates&utm_source=REDACTED',
        failCode: 0,
      },
    ],
  },
};

test('batchCustomLink response yields the short link and does not treat it as a page to open', () => {
  const item = liveCreateResponse.data.batchCustomLink[0];
  assert.deepStrictEqual(Object.keys(item), ['shortLink', 'longLink', 'failCode']);
  const [parsed] = customLinksFromResponse(liveCreateResponse);
  assert.strictEqual(parsed.failCode, 0);
  assert.strictEqual(parsed.shortLink, 'https://s.shopee.co.th/REDACTED');
  assert.strictEqual(isShortLink(parsed.shortLink || ''), true);
  assert.match(parsed.longLink || '', /utm_content=test----/);
  assert.strictEqual(isShortLink(parsed.longLink || ''), false);
});

test('a non-zero failCode stays on the item', () => {
  const [item] = customLinksFromResponse({
    data: { batchCustomLink: [{ shortLink: '', longLink: '', failCode: 2 }] },
  });
  assert.strictEqual(item.failCode, 2);
  assert.strictEqual(item.shortLink, null);
});

test('the mock create payload still yields its short link', () => {
  const [item] = customLinksFromResponse({
    ok: true,
    short_link: 'https://s.shopee.co.th/mockitem',
    data: { short_link: 'https://s.shopee.co.th/mockitem' },
  });
  assert.strictEqual(item.shortLink, 'https://s.shopee.co.th/mockitem');
  assert.strictEqual(item.failCode, null);
});
