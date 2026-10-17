import { test } from 'node:test';
import assert from 'node:assert';
import { unlinkSync, existsSync } from 'fs';
import { ShopkudMCPServer } from '../src/mcp/server.js';

const TEST_DB = './test-mcp.db';

test('MCP find_link tool returns links from registry', async () => {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);

  const server = new ShopkudMCPServer(TEST_DB, 'http://127.0.0.1:9222');
  
  (server as any).db.createLink({
    product_id: 'P1-123',
    item_id: '123',
    short_link: 'https://s.shopee.co.th/test1',
    long_link: 'https://shopee.co.th/product-i.456.123',
    channel: 'tiktok',
    clip_id: 'v6',
    sub_ids: {
      sub_id1: 'tiktok',
      sub_id2: 'P1',
      sub_id3: 'v6',
      sub_id4: null,
      sub_id5: null,
    },
  });

  const result = await (server as any).findLink({ channel: 'tiktok' });
  const data = JSON.parse(result.content[0].text);

  assert.strictEqual(data.ok, true, 'Should return ok: true');
  assert.strictEqual(data.source, 'cache', 'Source should be cache');
  assert.strictEqual(data.links.length, 1, 'Should return 1 link');
  assert.strictEqual(data.links[0].channel, 'tiktok', 'Channel should be tiktok');

  await server.stop();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  console.log('✅ find_link tool test passed');
});

test('MCP create_link tool is idempotent', async () => {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);

  const server = new ShopkudMCPServer(TEST_DB, 'http://127.0.0.1:9222');

  const params = {
    product_url: 'https://shopee.co.th/product-i.456.123',
    channel: 'ig' as const,
    sub_ids: {
      sub_id1: 'ig',
      sub_id2: 'P1',
      sub_id3: 'v6',
      sub_id4: null,
      sub_id5: null,
    },
  };

  const result1 = await (server as any).createLink(params);
  const data1 = JSON.parse(result1.content[0].text);

  assert.strictEqual(data1.ok, true, 'First call should succeed');
  assert.strictEqual(data1.created, true, 'First call should create link');

  const result2 = await (server as any).createLink(params);
  const data2 = JSON.parse(result2.content[0].text);

  assert.strictEqual(data2.ok, true, 'Second call should succeed');
  assert.strictEqual(data2.created, false, 'Second call should not create (idempotent)');
  assert.strictEqual(data2.link.link_id, data1.link.link_id, 'Should return same link');

  await server.stop();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  console.log('✅ create_link idempotence test passed');
});

test('MCP create_links_batch validates all before processing', async () => {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);

  const server = new ShopkudMCPServer(TEST_DB, 'http://127.0.0.1:9222');

  const invalidParams = {
    items: [
      {
        product_url: 'https://shopee.co.th/product-i.456.123',
        channel: 'tiktok' as const,
        sub_ids: { sub_id1: 'tiktok', sub_id2: null, sub_id3: null, sub_id4: null, sub_id5: null },
      },
      {
        product_url: 'invalid-url',
        channel: 'ig' as const,
        sub_ids: { sub_id1: 'ig', sub_id2: null, sub_id3: null, sub_id4: null, sub_id5: null },
      },
    ],
  };

  try {
    await (server as any).createLinksBatch(invalidParams);
    assert.fail('Should throw error for invalid URL');
  } catch (error) {
    assert.ok(error instanceof Error, 'Should throw Error');
    assert.ok(error.message.includes('Invalid product URL'), 'Error should mention invalid URL');
  }

  const links = (server as any).db.findLinks({});
  assert.strictEqual(links.length, 0, 'No links should be created if validation fails');

  await server.stop();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  console.log('✅ create_links_batch validation test passed');
});

test('MCP get_offer returns cached data within TTL', async () => {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);

  const server = new ShopkudMCPServer(TEST_DB, 'http://127.0.0.1:9222');

  (server as any).db.saveProduct({
    item_id: '123',
    shop_id: '456',
    title: 'Test Product',
    price_min: 299.50,
    price_max: 299.50,
  });

  (server as any).db.saveOffer({
    item_id: '123',
    as_of: new Date().toISOString(),
    price: 299.50,
    commission_rate_social: 7.5,
    commission_rate_video: 9.0,
    extra_comm: true,
    stock_available: true,
    source: 'cdp',
  });

  const result = await (server as any).getOffer({ item_id: '123' });
  const data = JSON.parse(result.content[0].text);

  assert.strictEqual(data.ok, true, 'Should return ok: true');
  assert.strictEqual(data.source, 'cache', 'Should return cached data');
  assert.strictEqual(data.offer.price, 299.50, 'Price should match');
  assert.strictEqual(data.offer.commission_rate_social, 7.5, 'Commission rate should match');

  await server.stop();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  console.log('✅ get_offer cache test passed');
});

test('MCP get_connection_status returns status', async () => {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);

  const server = new ShopkudMCPServer(TEST_DB, 'http://127.0.0.1:9222');

  const result = await (server as any).getConnectionStatus();
  const data = JSON.parse(result.content[0].text);

  assert.strictEqual(data.ok, true, 'Should return ok: true');
  assert.ok('chrome_connected' in data, 'Should have chrome_connected field');
  assert.ok('cdp_url' in data, 'Should have cdp_url field');
  assert.ok('queue_status' in data, 'Should have queue_status field');

  await server.stop();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  console.log('✅ get_connection_status test passed');
});
