import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ShopkudDatabase } from '../core/database.js';
import { CDPController } from '../core/cdp-controller.js';
import { resolveCdpUrl } from '../config/cdp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = parseInt(process.env.CONSOLE_PORT || '3000', 10);

const dbPath = process.env.SHOPKUD_DB_PATH || './shopkud.db';
const db = new ShopkudDatabase(dbPath);
const cdpUrl = resolveCdpUrl();
const cdp = new CDPController(cdpUrl);

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

app.get('/api/links', (req, res) => {
  try {
    const { product_id, channel, clip_id, item_id } = req.query;
    const links = db.findLinks({
      product_id: product_id as string,
      channel: channel as string,
      clip_id: clip_id as string,
      item_id: item_id as string,
    });
    res.json({ ok: true, links });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

app.post('/api/links', async (req, res) => {
  try {
    const { product_url, channel, clip_id, sub_ids } = req.body;
    
    const productMatch = product_url.match(/shopee\.co\.th\/.*-i\.(\d+)\.(\d+)/);
    if (!productMatch) {
      return res.status(400).json({ ok: false, error: 'Invalid product URL' });
    }

    const [, shopId, itemId] = productMatch;
    const productId = clip_id ? `${clip_id}-${itemId}` : itemId;

    const existing = db.findLinks({ product_id: productId, channel });
    if (existing.length > 0) {
      return res.json({ ok: true, created: false, link: existing[0] });
    }

    const link = db.createLink({
      product_id: productId,
      item_id: itemId,
      short_link: `https://s.shopee.co.th/mock-${Date.now()}`,
      long_link: product_url,
      channel,
      clip_id: clip_id || null,
      sub_ids,
    });

    res.json({ ok: true, created: true, link });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

app.post('/api/links/batch', async (req, res) => {
  try {
    const { items } = req.body;
    const results = [];

    for (const item of items) {
      const productMatch = item.product_url.match(/shopee\.co\.th\/.*-i\.(\d+)\.(\d+)/);
      if (!productMatch) {
        return res.status(400).json({ ok: false, error: `Invalid product URL: ${item.product_url}` });
      }
    }

    for (const item of items) {
      const [, shopId, itemId] = item.product_url.match(/shopee\.co\.th\/.*-i\.(\d+)\.(\d+)/)!;
      const productId = item.clip_id ? `${item.clip_id}-${itemId}` : itemId;

      const existing = db.findLinks({ product_id: productId, channel: item.channel });
      if (existing.length > 0) {
        results.push({ ok: true, created: false, link: existing[0] });
      } else {
        const link = db.createLink({
          product_id: productId,
          item_id: itemId,
          short_link: `https://s.shopee.co.th/mock-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          long_link: item.product_url,
          channel: item.channel,
          clip_id: item.clip_id || null,
          sub_ids: item.sub_ids,
        });
        results.push({ ok: true, created: true, link });
      }
    }

    res.json({ ok: true, results });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

app.get('/api/offers/:item_id', (req, res) => {
  try {
    const offer = db.getLatestOffer(req.params.item_id);
    if (!offer) {
      return res.status(404).json({ ok: false, error: 'Offer not found' });
    }
    res.json({ ok: true, offer });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

app.get('/api/queue', (req, res) => {
  try {
    const jobs = db.getQueuedJobs(50);
    res.json({ ok: true, jobs });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

app.get('/api/status', async (req, res) => {
  try {
    const connected = cdp.isConnected();
    const queueStatus = cdp.getQueueStatus();
    const jobs = db.getQueuedJobs(10);
    
    res.json({
      ok: true,
      chrome_connected: connected,
      cdp_url: cdpUrl,
      queue_status: queueStatus,
      queued_jobs: jobs,
      as_of: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

app.post('/api/connect', async (req, res) => {
  try {
    if (!cdp.isConnected()) {
      await cdp.connect();
    }
    res.json({ ok: true, message: 'Connected to Chrome' });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

app.listen(port, () => {
  console.log(`ShopKud Console running at http://localhost:${port}`);
});

process.on('SIGINT', () => {
  db.close();
  cdp.disconnect();
  process.exit(0);
});
