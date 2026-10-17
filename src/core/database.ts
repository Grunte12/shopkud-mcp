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
  /** placeholder = local registry row. shopee = captured from the real custom-link form. */
  origin: string;
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

    if (userVersion < 4) {
      const addColumn = (table: string, column: string, ddl: string) => {
        const exists = this.db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column);
        if (!exists) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
      };
      addColumn('links', 'origin', `origin TEXT NOT NULL DEFAULT 'placeholder'`);
      addColumn('products', 'category', 'category TEXT');
      addColumn('products', 'image_urls', 'image_urls TEXT');
      addColumn('products', 'official', 'official INTEGER NOT NULL DEFAULT 0');
      addColumn('conversions', 'category', 'category TEXT');
      addColumn('conversions', 'reason_hint', 'reason_hint TEXT');
      addColumn('conversions', 'buyer_class', 'buyer_class TEXT');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS offer_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id TEXT NOT NULL,
          as_of TEXT NOT NULL,
          price REAL,
          store_rate REAL,
          shopee_rate REAL,
          xtra_rate REAL,
          total_rate REAL,
          extra_comm INTEGER NOT NULL DEFAULT 0,
          stock INTEGER,
          category TEXT,
          title TEXT,
          image_urls TEXT,
          official INTEGER NOT NULL DEFAULT 0,
          excluded_category INTEGER NOT NULL DEFAULT 0,
          excluded_match TEXT,
          source TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS offer_snapshots_item ON offer_snapshots(item_id, as_of);

        CREATE TABLE IF NOT EXISTS clips (
          clip_id TEXT PRIMARY KEY,
          channel TEXT,
          title TEXT,
          status TEXT NOT NULL DEFAULT 'known',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS posts (
          post_id TEXT PRIMARY KEY,
          clip_id TEXT,
          channel TEXT NOT NULL,
          link_id TEXT,
          posted_on TEXT,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at TEXT NOT NULL,
          kind TEXT NOT NULL,
          item_id TEXT,
          status TEXT NOT NULL,
          detail TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS earnings_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          as_of TEXT NOT NULL,
          pending REAL,
          validated REAL,
          paid REAL,
          next_payout TEXT,
          kyc_status TEXT,
          balance_since TEXT,
          source TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS missions (
          mission_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          reward TEXT,
          requirements TEXT,
          deadline TEXT,
          status TEXT NOT NULL,
          enrolled INTEGER NOT NULL DEFAULT 0,
          progress TEXT,
          enrolled_at TEXT,
          completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS video_clips (
          video_id TEXT PRIMARY KEY,
          title TEXT,
          status TEXT,
          cart_items TEXT,
          commission_flag INTEGER NOT NULL DEFAULT 0,
          as_of TEXT NOT NULL,
          source TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS posting_caps (
          platform TEXT PRIMARY KEY,
          daily_cap INTEGER NOT NULL,
          evidence TEXT NOT NULL
        );
      `);
      this.db.pragma('user_version = 4');
    }
  }

  createLink(link: Omit<Link, 'link_id' | 'created_at' | 'updated_at' | 'ownership_verified' | 'target_verified' | 'last_verified_at' | 'origin'>): Link {
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
      origin: row.origin || 'placeholder',
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
      origin: row.origin || 'placeholder',
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

  saveProduct(product: Omit<Product, 'first_seen' | 'last_seen'> & { category?: string | null; image_urls?: string[]; official?: boolean }): void {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT 1 FROM products WHERE item_id = ?').get(product.item_id);
    const images = product.image_urls ? JSON.stringify(product.image_urls) : null;

    if (existing) {
      this.db.prepare(`
        UPDATE products SET shop_id = ?, title = ?, price_min = ?, price_max = ?, last_seen = ?,
          category = COALESCE(?, category), image_urls = COALESCE(?, image_urls), official = CASE WHEN ? IS NULL THEN official ELSE ? END
        WHERE item_id = ?
      `).run(
        product.shop_id, product.title, product.price_min, product.price_max, now,
        product.category ?? null, images, product.official == null ? null : (product.official ? 1 : 0), product.official ? 1 : 0,
        product.item_id,
      );
    } else {
      this.db.prepare(`
        INSERT INTO products (item_id, shop_id, title, price_min, price_max, first_seen, last_seen, category, image_urls, official)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(product.item_id, product.shop_id, product.title, product.price_min, product.price_max, now, now, product.category ?? null, images, product.official ? 1 : 0);
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
        orders, gmv, commission, cancelled, category, reason_hint, buyer_class
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        cancelled = excluded.cancelled,
        category = excluded.category,
        reason_hint = excluded.reason_hint,
        buyer_class = excluded.buyer_class
    `);
    const save = this.db.transaction((items: ConversionRow[]) => {
      for (const row of items) {
        statement.run(
          row.conversion_id, source, asOf, row.purchased_on, row.status, row.utm_content,
          row.sub_id1, row.sub_id2, row.sub_id3, row.sub_id4, row.sub_id5,
          row.orders, row.gmv, row.commission, row.cancelled,
          row.category ?? null, row.reason_hint ?? null, row.buyer_class ?? null,
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
        orders, gmv, commission, cancelled, category, reason_hint, buyer_class
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

  counts(): Record<string, number> {
    const count = (table: string) => (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    return {
      products: count('products'),
      offers: count('offers'),
      snapshots: count('offer_snapshots'),
      links: count('links'),
      clips: count('clips'),
      posts: count('posts'),
      conversions: count('conversions'),
      alerts: count('alerts'),
    };
  }

  upsertClip(clip: { clip_id: string; channel: string; title?: string | null }): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO clips (clip_id, channel, title, status, created_at, updated_at)
      VALUES (?, ?, ?, 'known', ?, ?)
      ON CONFLICT(clip_id) DO UPDATE SET channel = excluded.channel, title = COALESCE(excluded.title, clips.title), updated_at = excluded.updated_at
    `).run(clip.clip_id, clip.channel, clip.title ?? null, now, now);
  }

  listClips(): Array<{ clip_id: string; channel: string | null; title: string | null; status: string }> {
    return this.db.prepare('SELECT clip_id, channel, title, status FROM clips ORDER BY updated_at DESC').all() as any;
  }

  savePost(post: { post_id: string; clip_id?: string | null; channel: string; link_id?: string | null; posted_on?: string | null; status: string }): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO posts (post_id, clip_id, channel, link_id, posted_on, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(post_id) DO UPDATE SET status = excluded.status, posted_on = excluded.posted_on
    `).run(post.post_id, post.clip_id ?? null, post.channel, post.link_id ?? null, post.posted_on ?? null, post.status, now);
  }

  listPosts(): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT post_id, clip_id, channel, link_id, posted_on, status FROM posts ORDER BY created_at DESC').all() as any;
  }

  saveOfferSnapshot(row: OfferSnapshot): void {
    this.db.prepare(`
      INSERT INTO offer_snapshots (
        item_id, as_of, price, store_rate, shopee_rate, xtra_rate, total_rate, extra_comm, stock,
        category, title, image_urls, official, excluded_category, excluded_match, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.item_id, row.as_of, row.price, row.store_rate, row.shopee_rate, row.xtra_rate, row.total_rate,
      row.extra_comm ? 1 : 0, row.stock, row.category, row.title, JSON.stringify(row.image_urls),
      row.official ? 1 : 0, row.excluded_category ? 1 : 0, row.excluded_match, row.source,
    );
  }

  listOfferSnapshots(limit = 500, itemId?: string): OfferSnapshot[] {
    const rows = (itemId
      ? this.db.prepare('SELECT * FROM offer_snapshots WHERE item_id = ? ORDER BY as_of DESC LIMIT ?').all(itemId, limit)
      : this.db.prepare('SELECT * FROM offer_snapshots ORDER BY as_of DESC LIMIT ?').all(limit)) as any[];
    return rows.map((row) => ({
      item_id: row.item_id,
      as_of: row.as_of,
      price: row.price,
      store_rate: row.store_rate,
      shopee_rate: row.shopee_rate,
      xtra_rate: row.xtra_rate,
      total_rate: row.total_rate,
      extra_comm: Boolean(row.extra_comm),
      stock: row.stock,
      category: row.category,
      title: row.title,
      image_urls: safeJsonArray(row.image_urls),
      official: Boolean(row.official),
      excluded_category: Boolean(row.excluded_category),
      excluded_match: row.excluded_match,
      source: row.source,
    }));
  }

  saveAlert(alert: { at: string; kind: string; item_id?: string | null; status: string; detail: unknown }): void {
    this.db.prepare('INSERT INTO alerts (at, kind, item_id, status, detail) VALUES (?, ?, ?, ?, ?)')
      .run(alert.at, alert.kind, alert.item_id ?? null, alert.status, JSON.stringify(alert.detail));
  }

  listAlerts(limit = 100): Array<{ at: string; kind: string; item_id: string | null; status: string; detail: unknown }> {
    return (this.db.prepare('SELECT at, kind, item_id, status, detail FROM alerts ORDER BY id DESC LIMIT ?').all(limit) as any[])
      .map((row) => ({ ...row, detail: safeJson(row.detail) }));
  }

  saveEarnings(row: EarningsSnapshot): void {
    const previous = this.latestEarnings();
    const sameBalance = previous && previous.pending === row.pending && previous.validated === row.validated;
    const balanceSince = sameBalance ? previous.balance_since : row.as_of;
    this.db.prepare(`
      INSERT INTO earnings_snapshots (as_of, pending, validated, paid, next_payout, kyc_status, balance_since, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.as_of, row.pending, row.validated, row.paid, row.next_payout, row.kyc_status, balanceSince, row.source);
  }

  latestEarnings(): EarningsSnapshot | null {
    const row = this.db.prepare('SELECT * FROM earnings_snapshots ORDER BY id DESC LIMIT 1').get() as any;
    return row ? {
      as_of: row.as_of,
      pending: row.pending,
      validated: row.validated,
      paid: row.paid,
      next_payout: row.next_payout,
      kyc_status: row.kyc_status,
      balance_since: row.balance_since,
      source: row.source,
    } : null;
  }

  saveMission(row: { mission_id: string; name: string; reward?: string | null; requirements?: string | null; deadline?: string | null; status: string; enrolled: boolean }): void {
    this.db.prepare(`
      INSERT INTO missions (mission_id, name, reward, requirements, deadline, status, enrolled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mission_id) DO UPDATE SET
        name = excluded.name, reward = excluded.reward, requirements = excluded.requirements,
        deadline = excluded.deadline, status = excluded.status, enrolled = excluded.enrolled
    `).run(row.mission_id, row.name, row.reward ?? null, row.requirements ?? null, row.deadline ?? null, row.status, row.enrolled ? 1 : 0);
  }

  listMissions(status?: string): Array<Record<string, unknown>> {
    const rows = (status
      ? this.db.prepare('SELECT * FROM missions WHERE status = ? ORDER BY mission_id').all(status)
      : this.db.prepare('SELECT * FROM missions ORDER BY mission_id').all()) as any[];
    return rows.map((row) => ({ ...row, enrolled: Boolean(row.enrolled) }));
  }

  saveVideoClip(row: { video_id: string; title?: string | null; status?: string | null; cart_items?: unknown; as_of: string; source: string }): void {
    this.db.prepare(`
      INSERT INTO video_clips (video_id, title, status, cart_items, as_of, source)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET title = excluded.title, status = excluded.status, cart_items = excluded.cart_items, as_of = excluded.as_of
    `).run(row.video_id, row.title ?? null, row.status ?? null, JSON.stringify(row.cart_items ?? []), row.as_of, row.source);
  }

  listVideoClips(): Array<Record<string, unknown>> {
    return (this.db.prepare('SELECT video_id, title, status, cart_items, as_of, source FROM video_clips ORDER BY as_of DESC').all() as any[])
      .map((row) => ({ ...row, cart_items: safeJson(row.cart_items) }));
  }

  updateVideoCart(videoId: string, cart: unknown): boolean {
    const existing = this.db.prepare('SELECT 1 FROM video_clips WHERE video_id = ?').get(videoId);
    if (!existing) return false;
    this.db.prepare('UPDATE video_clips SET cart_items = ? WHERE video_id = ?').run(JSON.stringify(cart), videoId);
    return true;
  }

  setPostingCap(platform: string, dailyCap: number): void {
    this.db.prepare(`
      INSERT INTO posting_caps (platform, daily_cap, evidence) VALUES (?, ?, 'owner_set')
      ON CONFLICT(platform) DO UPDATE SET daily_cap = excluded.daily_cap, evidence = 'owner_set'
    `).run(platform, dailyCap);
  }

  getPostingCap(platform: string): { daily_cap: number; evidence: string } | null {
    return this.db.prepare('SELECT daily_cap, evidence FROM posting_caps WHERE platform = ?').get(platform) as any ?? null;
  }

  close() {
    this.db.close();
  }
}

export interface OfferSnapshot {
  item_id: string;
  as_of: string;
  price: number | null;
  store_rate: number | null;
  shopee_rate: number | null;
  xtra_rate: number | null;
  total_rate: number | null;
  extra_comm: boolean;
  stock: number | null;
  category: string | null;
  title: string | null;
  image_urls: string[];
  official: boolean;
  excluded_category: boolean;
  excluded_match: string | null;
  source: string;
}

export interface EarningsSnapshot {
  as_of: string;
  pending: number | null;
  validated: number | null;
  paid: number | null;
  next_payout: string | null;
  kyc_status: string | null;
  balance_since: string | null;
  source: string;
}

function safeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function safeJsonArray(value: unknown): string[] {
  const parsed = safeJson(value);
  return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
}
