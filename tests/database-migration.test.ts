import { test } from 'node:test';
import assert from 'node:assert';
import { unlinkSync, existsSync } from 'fs';
import Database from 'better-sqlite3';
import { ShopkudDatabase } from '../src/core/database.js';

const TEST_DB = './test-migration.db';

test('Database migration from single sub_id to 5 slots', async () => {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);

  const legacyDb = new Database(TEST_DB);
  legacyDb.pragma('journal_mode = WAL');
  
  legacyDb.exec(`
    CREATE TABLE products (
      item_id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      title TEXT NOT NULL,
      price_min REAL NOT NULL,
      price_max REAL NOT NULL,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL
    );

    CREATE TABLE links (
      link_id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      short_link TEXT UNIQUE NOT NULL,
      long_link TEXT NOT NULL,
      channel TEXT NOT NULL,
      clip_id TEXT,
      sub_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO products VALUES 
      ('123', '456', 'Test Product', 100.0, 200.0, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z');
    
    INSERT INTO links VALUES 
      ('link1', 'P1-123', '123', 'https://s.shopee.co.th/test1', 'https://shopee.co.th/product-i.456.123', 
       'tiktok', 'v6', 'tiktok,P1,v6', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z'),
      ('link2', 'P1-123', '123', 'https://s.shopee.co.th/test2', 'https://shopee.co.th/product-i.456.123', 
       'ig', 'v6', 'ig,P1,v6', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z');
    
    PRAGMA user_version = 1;
  `);
  
  legacyDb.close();

  const db = new ShopkudDatabase(TEST_DB);

  const links = db.findLinks({ item_id: '123' });
  assert.strictEqual(links.length, 2, 'Should have migrated 2 links');

  const tiktokLink = links.find(l => l.channel === 'tiktok');
  assert.ok(tiktokLink, 'Should have TikTok link');
  assert.strictEqual(tiktokLink.sub_ids.sub_id1, 'tiktok,P1,v6', 'Sub ID should be preserved in sub_id1');
  assert.strictEqual(tiktokLink.sub_ids.sub_id2, null, 'sub_id2 should be null');
  assert.strictEqual(tiktokLink.sub_ids.sub_id3, null, 'sub_id3 should be null');
  assert.strictEqual(tiktokLink.sub_ids.sub_id4, null, 'sub_id4 should be null');
  assert.strictEqual(tiktokLink.sub_ids.sub_id5, null, 'sub_id5 should be null');

  const newLink = db.createLink({
    product_id: 'P2-789',
    item_id: '789',
    short_link: 'https://s.shopee.co.th/new',
    long_link: 'https://shopee.co.th/product-i.456.789',
    channel: 'fb',
    clip_id: 'v7',
    sub_ids: {
      sub_id1: 'fb',
      sub_id2: 'P2',
      sub_id3: 'v7',
      sub_id4: 'a',
      sub_id5: '202610',
    },
  });

  assert.strictEqual(newLink.sub_ids.sub_id1, 'fb', 'sub_id1 should be set');
  assert.strictEqual(newLink.sub_ids.sub_id2, 'P2', 'sub_id2 should be set');
  assert.strictEqual(newLink.sub_ids.sub_id3, 'v7', 'sub_id3 should be set');
  assert.strictEqual(newLink.sub_ids.sub_id4, 'a', 'sub_id4 should be set');
  assert.strictEqual(newLink.sub_ids.sub_id5, '202610', 'sub_id5 should be set');

  db.close();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  console.log('✅ Database migration test passed');
});
