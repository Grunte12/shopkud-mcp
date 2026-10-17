import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import type { ConversionRow } from './conversions.js';

export interface Link {
  link_id: string;
  product_id: string;
  item_id: string;
  short_link: string;
  long_link: string;
  channel: string;
  clip_id: string | null;
  sub_ids: SubIds;
  created_at: string;
  updated_at: string;
  ownership_verified: 'true' | 'false' | 'unknown';
  target_verified: 'true' | 'false' | 'unknown';
  last_verified_at: string | null;
}

export interface SubIds {
  sub_id1: string | null;
  sub_id2: string | null;
  sub_id3: string | null;
  sub_id4: string | null;
  sub_id5: string | null;
}

export interface Product {
  item_id: string;
  shop_id: string;
  title: string;
  price_min: number;
  price_max: number;
  first_seen: string;
  last_seen: string;
}

export interface Offer {
  item_id: string;
  as_of: string;
  price: number;
  commission_rate_social: number;
  commission_rate_video: number | null;
  extra_comm: boolean;
  stock_available: boolean;
  source: 'api' | 'cdp';
}

export class ShopkudDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate() {
    const userVersion = this.db.pragma('user_version', { simple: true }) as number;

    if (userVersion === 0) {
      this.db.exec(`
        CREATE TABLE products (
          item_id TEXT PRIMARY KEY,
          shop_id TEXT NOT NULL,
          title TEXT NOT NULL,
          price_min REAL NOT NULL,
          price_max REAL NOT NULL,
          first_seen TEXT NOT NULL,
          last_seen TEXT NOT NULL
        );

        CREATE TABLE offers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id TEXT NOT NULL,
          as_of TEXT NOT NULL,
          price REAL NOT NULL,
          commission_rate_social REAL NOT NULL,
          commission_rate_video REAL,
          extra_comm INTEGER NOT NULL,
          stock_available INTEGER NOT NULL,
          source TEXT NOT NULL CHECK (source IN ('api', 'cdp')),
          FOREIGN KEY (item_id) REFERENCES products(item_id) ON DELETE CASCADE
        );
        CREATE INDEX offers_item_time ON offers(item_id, as_of DESC);

        CREATE TABLE links (
          link_id TEXT PRIMARY KEY,
          product_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          short_link TEXT UNIQUE NOT NULL,
          long_link TEXT NOT NULL,
          channel TEXT NOT NULL,
          clip_id TEXT,
          sub_id1 TEXT,
          sub_id2 TEXT,
          sub_id3 TEXT,
          sub_id4 TEXT,
          sub_id5 TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          ownership_verified TEXT NOT NULL DEFAULT 'unknown' CHECK (ownership_verified IN ('true', 'false', 'unknown')),
          target_verified TEXT NOT NULL DEFAULT 'unknown' CHECK (target_verified IN ('true', 'false', 'unknown')),
          last_verified_at TEXT,
          FOREIGN KEY (item_id) REFERENCES products(item_id) ON DELETE CASCADE
        );
        CREATE INDEX links_channel ON links(channel, clip_id);
        CREATE INDEX links_product ON links(product_id);
        CREATE INDEX links_item ON links(item_id);

        CREATE TABLE job_queue (
          job_id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          params TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'captcha_stopped')),
          created_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          result TEXT,
          error TEXT
        );
        CREATE INDEX job_queue_status ON job_queue(status, created_at);

        PRAGMA user_version = 1;
      `);
    }

    if (userVersion < 2) {
      const oldLinksExist = this.db.prepare(`
        SELECT 1 FROM sqlite_master WHERE type='table' AND name='old_links'
      `).get();

      if (!oldLinksExist) {
        const hasSubIdColumn = this.db.prepare(`
          SELECT 1 FROM pragma_table_info('links') WHERE name='sub_id'
        `).get();

        if (hasSubIdColumn) {
          this.db.exec(`
            ALTER TABLE links RENAME TO old_links;
            
            CREATE TABLE links (
              link_id TEXT PRIMARY KEY,
              product_id TEXT NOT NULL,
              item_id TEXT NOT NULL,
              short_link TEXT UNIQUE NOT NULL,
              long_link TEXT NOT NULL,
              channel TEXT NOT NULL,
              clip_id TEXT,
              sub_id1 TEXT,
              sub_id2 TEXT,
              sub_id3 TEXT,
              sub_id4 TEXT,
              sub_id5 TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              ownership_verified TEXT NOT NULL DEFAULT 'unknown',
              target_verified TEXT NOT NULL DEFAULT 'unknown',
              last_verified_at TEXT
            );
            
            INSERT INTO links (
              link_id, product_id, item_id, short_link, long_link,
              channel, clip_id, sub_id1, created_at, updated_at,
              ownership_verified, target_verified, last_verified_at
            )
            SELECT 
              link_id, product_id, item_id, short_link, long_link,
              channel, clip_id, sub_id, created_at, updated_at,
              'unknown', 'unknown', NULL
            FROM old_links;
            
            DROP TABLE old_links;
          `);
        }
      }
      
      this.db.pragma('user_version = 2');
    }

    if (userVersion < 3) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS conversions (
          conversion_id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          as_of TEXT NOT NULL,
          purchased_on TEXT NOT NULL,
          status TEXT NOT NULL,
          utm_content TEXT NOT NULL,
          sub_id1 TEXT,
          sub_id2 TEXT,
          sub_id3 TEXT,
          sub_id4 TEXT,
          sub_id5 TEXT,
          orders INTEGER NOT NULL,
          gmv REAL NOT NULL,
          commission REAL NOT NULL,
          cancelled INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS conversions_day ON conversions(purchased_on);

        CREATE TABLE IF NOT EXISTS account_marker (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          affiliate_id TEXT NOT NULL,
          as_of TEXT NOT NULL
        );
      `);
      this.db.pragma('user_version = 3');
    }
  }

  createLink(link: Omit<Link, 'link_id' | 'created_at' | 'updated_at' | 'ownership_verified' | 'target_verified' | 'last_verified_at'>): Link {
    const existing = this.db.prepare('SELECT link_id FROM links WHERE short_link = ?').get(link.short_link) as { link_id: string } | undefined;
    
    if (existing) {
      return this.getLink(existing.link_id)!;
    }

    const productExists = this.db.prepare('SELECT 1 FROM products WHERE item_id = ?').get(link.item_id);
    if (!productExists) {
      const productMatch = link.long_link.match(/i\.(\d+)\.(\d+)/);
      const shopId = productMatch ? productMatch[1] : '0';
      this.saveProduct({
        item_id: link.item_id,
        shop_id: shopId,
        title: `Product ${link.item_id}`,
        price_min: 0,
        price_max: 0,
      });
    }

    const linkId = randomBytes(16).toString('hex');
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO links (
        link_id, product_id, item_id, short_link, long_link, channel, clip_id,
        sub_id1, sub_id2, sub_id3, sub_id4, sub_id5, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      linkId, link.product_id, link.item_id, link.short_link, link.long_link,
      link.channel, link.clip_id,
      link.sub_ids.sub_id1, link.sub_ids.sub_id2, link.sub_ids.sub_id3,
      link.sub_ids.sub_id4, link.sub_ids.sub_id5,
      now, now
    );

    return this.getLink(linkId)!;
  }

  getLink(linkId: string): Link | null {
    const row = this.db.prepare(`
      SELECT * FROM links WHERE link_id = ?
    `).get(linkId) as any;

    if (!row) return null;

    return {
      link_id: row.link_id,
      product_id: row.product_id,
      item_id: row.item_id,
      short_link: row.short_link,
      long_link: row.long_link,
      channel: row.channel,
      clip_id: row.clip_id,
      sub_ids: {
        sub_id1: row.sub_id1,
        sub_id2: row.sub_id2,
        sub_id3: row.sub_id3,
        sub_id4: row.sub_id4,
        sub_id5: row.sub_id5,
      },
      created_at: row.created_at,
      updated_at: row.updated_at,
      ownership_verified: row.ownership_verified,
      target_verified: row.target_verified,
      last_verified_at: row.last_verified_at,
    };
  }

  findLinks(filter: { product_id?: string; channel?: string; clip_id?: string; item_id?: string }): Link[] {
    let query = 'SELECT * FROM links WHERE 1=1';
    const params: any[] = [];

    if (filter.product_id) {
      query += ' AND product_id = ?';
      params.push(filter.product_id);
    }
    if (filter.channel) {
      query += ' AND channel = ?';
      params.push(filter.channel);
    }
    if (filter.clip_id) {
      query += ' AND clip_id = ?';
      params.push(filter.clip_id);
    }
    if (filter.item_id) {
      query += ' AND item_id = ?';
      params.push(filter.item_id);
    }

    query += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(row => ({
      link_id: row.link_id,
      product_id: row.product_id,
      item_id: row.item_id,
      short_link: row.short_link,
      long_link: row.long_link,
      channel: row.channel,
      clip_id: row.clip_id,
      sub_ids: {
        sub_id1: row.sub_id1,
        sub_id2: row.sub_id2,
        sub_id3: row.sub_id3,
        sub_id4: row.sub_id4,
        sub_id5: row.sub_id5,
      },
      created_at: row.created_at,
      updated_at: row.updated_at,
      ownership_verified: row.ownership_verified,
      target_verified: row.target_verified,
      last_verified_at: row.last_verified_at,
    }));
  }

  updateLinkVerification(linkId: string, ownership: 'true' | 'false' | 'unknown', target: 'true' | 'false' | 'unknown') {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE links
      SET ownership_verified = ?, target_verified = ?, last_verified_at = ?, updated_at = ?
      WHERE link_id = ?
    `).run(ownership, target, now, now, linkId);
  }

  saveProduct(product: Omit<Product, 'first_seen' | 'last_seen'>): void {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT 1 FROM products WHERE item_id = ?').get(product.item_id);

    if (existing) {
      this.db.prepare(`
        UPDATE products SET shop_id = ?, title = ?, price_min = ?, price_max = ?, last_seen = ?
        WHERE item_id = ?
      `).run(product.shop_id, product.title, product.price_min, product.price_max, now, product.item_id);
    } else {
      this.db.prepare(`
        INSERT INTO products (item_id, shop_id, title, price_min, price_max, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(product.item_id, product.shop_id, product.title, product.price_min, product.price_max, now, now);
    }
  }

  saveOffer(offer: Omit<Offer, 'id'>): void {
    this.db.prepare(`
      INSERT INTO offers (item_id, as_of, price, commission_rate_social, commission_rate_video, extra_comm, stock_available, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      offer.item_id, offer.as_of, offer.price, offer.commission_rate_social,
      offer.commission_rate_video, offer.extra_comm ? 1 : 0,
      offer.stock_available ? 1 : 0, offer.source
    );
  }

  getLatestOffer(itemId: string): Offer | null {
    const row = this.db.prepare(`
      SELECT * FROM offers WHERE item_id = ? ORDER BY as_of DESC LIMIT 1
    `).get(itemId) as any;

    if (!row) return null;

    return {
      item_id: row.item_id,
      as_of: row.as_of,
      price: row.price,
      commission_rate_social: row.commission_rate_social,
      commission_rate_video: row.commission_rate_video,
      extra_comm: Boolean(row.extra_comm),
      stock_available: Boolean(row.stock_available),
      source: row.source,
    };
  }

  enqueueJob(type: string, params: any): string {
    const jobId = randomBytes(16).toString('hex');
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO job_queue (job_id, type, params, status, created_at)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(jobId, type, JSON.stringify(params), now);

    return jobId;
  }

  getQueuedJobs(limit = 50): Array<{ job_id: string; type: string; params: any; status: string; created_at: string }> {
    const rows = this.db.prepare(`
      SELECT * FROM job_queue WHERE status IN ('pending', 'running', 'captcha_stopped')
      ORDER BY created_at ASC LIMIT ?
    `).all(limit) as any[];

    return rows.map(row => ({
      job_id: row.job_id,
      type: row.type,
      params: JSON.parse(row.params),
      status: row.status,
      created_at: row.created_at,
    }));
  }

  updateJobStatus(jobId: string, status: string, result?: any, error?: string) {
    const now = new Date().toISOString();
    const updates: string[] = ['status = ?'];
    const params: any[] = [status];

    if (status === 'running') {
      updates.push('started_at = ?');
      params.push(now);
    }

    if (status === 'completed' || status === 'failed' || status === 'captcha_stopped') {
      updates.push('completed_at = ?');
      params.push(now);
    }

    if (result !== undefined) {
      updates.push('result = ?');
      params.push(JSON.stringify(result));
    }

    if (error !== undefined) {
      updates.push('error = ?');
      params.push(error);
    }

    params.push(jobId);

    this.db.prepare(`
      UPDATE job_queue SET ${updates.join(', ')} WHERE job_id = ?
    `).run(...params);
  }

  saveConversions(rows: ConversionRow[], source: string, asOf: string): number {
    const statement = this.db.prepare(`
      INSERT INTO conversions (
        conversion_id, source, as_of, purchased_on, status, utm_content,
        sub_id1, sub_id2, sub_id3, sub_id4, sub_id5,
        orders, gmv, commission, cancelled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversion_id) DO UPDATE SET
        source = excluded.source,
        as_of = excluded.as_of,
        purchased_on = excluded.purchased_on,
        status = excluded.status,
        utm_content = excluded.utm_content,
        sub_id1 = excluded.sub_id1,
        sub_id2 = excluded.sub_id2,
        sub_id3 = excluded.sub_id3,
        sub_id4 = excluded.sub_id4,
        sub_id5 = excluded.sub_id5,
        orders = excluded.orders,
        gmv = excluded.gmv,
        commission = excluded.commission,
        cancelled = excluded.cancelled
    `);
    const save = this.db.transaction((items: ConversionRow[]) => {
      for (const row of items) {
        statement.run(
          row.conversion_id, source, asOf, row.purchased_on, row.status, row.utm_content,
          row.sub_id1, row.sub_id2, row.sub_id3, row.sub_id4, row.sub_id5,
          row.orders, row.gmv, row.commission, row.cancelled,
        );
      }
    });
    save(rows);
    return rows.length;
  }

  listConversions(from?: string, to?: string): ConversionRow[] {
    const rows = this.db.prepare(`
      SELECT conversion_id, purchased_on, status, utm_content,
        sub_id1, sub_id2, sub_id3, sub_id4, sub_id5,
        orders, gmv, commission, cancelled
      FROM conversions
      WHERE (? IS NULL OR purchased_on >= ?)
        AND (? IS NULL OR purchased_on <= ?)
      ORDER BY purchased_on, conversion_id
    `).all(from ?? null, from ?? null, to ?? null, to ?? null) as ConversionRow[];
    return rows;
  }

  saveAccountMarker(affiliateId: string, asOf: string): void {
    this.db.prepare(`
      INSERT INTO account_marker (id, affiliate_id, as_of) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET affiliate_id = excluded.affiliate_id, as_of = excluded.as_of
    `).run(affiliateId, asOf);
  }

  getAccountMarker(): string | null {
    const row = this.db.prepare('SELECT affiliate_id FROM account_marker WHERE id = 1').get() as { affiliate_id: string } | undefined;
    return row?.affiliate_id ?? null;
  }

  close() {
    this.db.close();
  }
}
