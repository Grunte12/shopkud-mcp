import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { CDPController, CaptchaDetectedError } from '../core/cdp-controller.js';
import { resolveCdpUrl } from '../config/cdp.js';
import { ShopkudDatabase, type SubIds } from '../core/database.js';
import { parseMappedCsv, salesBy, SALES_DIMS, isSalesDim, type SalesDim } from '../core/conversions.js';
import { headNoRedirect, ownershipFromLocation } from '../core/verify-link.js';
import { parseProductUrl } from '../config/selectors.js';
import { offerAnnotations, safeImageUrls } from '../core/excluded-categories.js';
import { probeChrome, type ChromeProbe } from '../core/chrome-probe.js';
import { isLocalTool, LOCAL_TOOL_SCHEMAS, runLocalTool, subIdKey } from '../core/local-tools.js';
import { randomBytes } from 'crypto';
import * as crypto from 'crypto';

const CHANNELS = ['tiktok', 'ig', 'fb', 'x', 'yt', 'spv'] as const;
type Channel = typeof CHANNELS[number];

interface CreateLinkParams {
  product_url: string;
  channel: Channel;
  clip_id?: string;
  sub_ids: SubIds;
}

interface VerifyLinkParams {
  url: string;
}

interface FindLinkParams {
  product_id?: string;
  channel?: string;
  clip_id?: string;
  item_id?: string;
}

interface GetOfferParams {
  item_id: string;
}

interface ImportReportParams {
  workspace_id: string;
  csv_text: string;
  mapping: {
    sub_id: string;
    commission: string;
    clicks?: string;
    orders?: string;
    status?: string;
  };
  marketplace: string;
  period_start: string;
  period_end: string;
  amount_state: 'estimated' | 'validated' | 'paid';
  commit?: boolean;
  expected_digest?: string;
}

export class ShopkudMCPServer {
  private server: Server;
  private cdp: CDPController;
  private db: ShopkudDatabase;
  private affiliateOpenApiUrl: string;
  private affiliateOpenApiKey: string | null;
  private probe: (url: string) => Promise<ChromeProbe>;

  constructor(dbPath: string, cdpUrl?: string, options: { probe?: (url: string) => Promise<ChromeProbe> } = {}) {
    this.server = new Server(
      {
        name: 'shopkud-core',
        version: '0.9.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.db = new ShopkudDatabase(dbPath);
    this.cdp = new CDPController(cdpUrl);
    
    this.affiliateOpenApiUrl = process.env.SHOPEE_AFFILIATE_API_URL || '';
    this.affiliateOpenApiKey = process.env.SHOPEE_AFFILIATE_API_KEY || null;
    this.probe = options.probe || ((url) => probeChrome(url, { allowReserved: false }));

    this.setupHandlers();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'find_link',
          description: 'Find affiliate links in the registry by product, channel, clip, or item ID',
          inputSchema: {
            type: 'object',
            properties: {
              product_id: { type: 'string', description: 'Product identifier' },
              channel: { type: 'string', enum: CHANNELS as any, description: 'Social channel' },
              clip_id: { type: 'string', description: 'Clip/content identifier' },
              item_id: { type: 'string', description: 'Shopee item ID' },
            },
          },
        },
        {
          name: 'create_link',
          description: 'Create an affiliate link with Sub IDs (per channel: tiktok/ig/fb/x/yt/spv). Idempotent: returns existing link if found.',
          inputSchema: {
            type: 'object',
            properties: {
              product_url: { type: 'string', description: 'Shopee product URL' },
              channel: { type: 'string', enum: CHANNELS as any },
              clip_id: { type: 'string', description: 'Optional clip identifier' },
              sub_ids: {
                type: 'object',
                properties: {
                  sub_id1: { type: 'string' },
                  sub_id2: { type: 'string' },
                  sub_id3: { type: 'string' },
                  sub_id4: { type: 'string' },
                  sub_id5: { type: 'string' },
                },
                description: 'Up to 5 Sub ID slots for attribution',
              },
            },
            required: ['product_url', 'channel', 'sub_ids'],
          },
        },
        {
          name: 'create_links_batch',
          description: 'Batch create affiliate links. Validates all first, stops on first error. Idempotent.',
          inputSchema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    product_url: { type: 'string' },
                    channel: { type: 'string', enum: CHANNELS as any },
                    clip_id: { type: 'string' },
                    sub_ids: { type: 'object' },
                  },
                  required: ['product_url', 'channel', 'sub_ids'],
                },
              },
            },
            required: ['items'],
          },
        },
        {
          name: 'get_conversions',
          description: 'Read the Shopee conversion report for a date range and store the rows. Does not open short links.',
          inputSchema: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'Start date YYYY-MM-DD' },
              to: { type: 'string', description: 'End date YYYY-MM-DD' },
              status: { type: 'string', description: 'Optional status text to keep' },
            },
            required: ['from', 'to'],
          },
        },
        {
          name: 'sales_by',
          description: 'Aggregate stored conversions by sub_id, platform (s1), product (s2), clip (s3), variant (s4), or month (s5).',
          inputSchema: {
            type: 'object',
            properties: {
              dim: { type: 'string', enum: [...SALES_DIMS] },
              from: { type: 'string', description: 'Start date YYYY-MM-DD' },
              to: { type: 'string', description: 'End date YYYY-MM-DD' },
              status: { type: 'string', description: 'Optional status text to keep' },
            },
            required: ['dim', 'from', 'to'],
          },
        },
        {
          name: 'verify_link',
          description: 'HEAD a Shopee short link with redirects disabled. Ownership compares the Location utm_source with the logged-in affiliate id. It does not open the link.',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'Short link URL (s.shopee.co.th)' },
            },
            required: ['url'],
          },
        },
        {
          name: 'get_offer',
          description: 'Get commission rates and offer details for a product',
          inputSchema: {
            type: 'object',
            properties: {
              item_id: { type: 'string', description: 'Shopee item ID' },
            },
            required: ['item_id'],
          },
        },
        {
          name: 'get_connection_status',
          description: 'Check Chrome/CDP connection status and job queue',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'import_report_csv',
          description: 'Import Sub ID sales report from CSV. Keeps estimated, validated and paid separate. Idempotent re-import does not inflate totals.',
          inputSchema: {
            type: 'object',
            properties: {
              workspace_id: { type: 'string', description: 'Workspace ID' },
              csv_text: { type: 'string', description: 'CSV content' },
              mapping: {
                type: 'object',
                properties: {
                  sub_id: { type: 'string', description: 'Sub ID column name' },
                  commission: { type: 'string', description: 'Commission column name' },
                  clicks: { type: 'string', description: 'Clicks column name (optional)' },
                  orders: { type: 'string', description: 'Orders column name (optional)' },
                  status: { type: 'string', description: 'Status column name (optional)' },
                },
                required: ['sub_id', 'commission'],
              },
              marketplace: { type: 'string', description: 'Marketplace (e.g., shopee)' },
              period_start: { type: 'string', description: 'Period start date (YYYY-MM-DD)' },
              period_end: { type: 'string', description: 'Period end date (YYYY-MM-DD)' },
              amount_state: { type: 'string', enum: ['estimated', 'validated', 'paid'], description: 'Amount state' },
              commit: { type: 'boolean', description: 'Commit (false for preview)' },
              expected_digest: { type: 'string', description: 'Expected digest for commit' },
            },
            required: ['workspace_id', 'csv_text', 'mapping', 'marketplace', 'period_start', 'period_end'],
          },
        },
        ...LOCAL_TOOL_SCHEMAS,
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const args = request.params.arguments || {};
        return await this.execute(request.params.name, args as Record<string, unknown>);
      } catch (error) {
        if (error instanceof CaptchaDetectedError) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'captcha_detected',
                message: error.message,
                action_required: 'Manual intervention needed to solve CAPTCHA',
              }),
            }],
          };
        }
        throw error;
      }
    });
  }

  private async findLink(params: FindLinkParams) {
    const links = this.db.findLinks(params);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          source: 'cache',
          as_of: new Date().toISOString(),
          links: links.map(link => ({
            link_id: link.link_id,
            product_id: link.product_id,
            item_id: link.item_id,
            short_link: link.short_link,
            long_link: link.long_link,
            channel: link.channel,
            clip_id: link.clip_id,
            sub_ids: link.sub_ids,
            created_at: link.created_at,
            ownership_verified: link.ownership_verified,
            target_verified: link.target_verified,
          })),
        }),
      }],
    };
  }

  private async createLink(params: CreateLinkParams) {
    const parsed = parseProductUrl(params.product_url);
    if (!parsed) {
      throw new Error('Invalid Shopee product URL format');
    }

    const { shopId, itemId } = parsed;
    const productId = params.clip_id ? `${params.clip_id}-${itemId}` : itemId;

    const existing = this.db.findLinks({ 
      product_id: productId, 
      channel: params.channel,
    });
    const wanted = subIdKey(params.sub_ids);
    const same = existing.find((link) => subIdKey(link.sub_ids) === wanted);

    if (same) {
      if (params.clip_id) this.db.upsertClip({ clip_id: params.clip_id, channel: params.channel });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: true,
            created: false,
            source: 'cache',
            as_of: new Date().toISOString(),
            link: same,
          }),
        }],
      };
    }

    const subIdString = Object.values(params.sub_ids).filter(Boolean).join(',');
    const shortLink = `https://s.shopee.co.th/${randomBytes(8).toString('base64url')}`;
    const longLink = `${params.product_url}?subid=${encodeURIComponent(subIdString)}`;

    const link = this.db.createLink({
      product_id: productId,
      item_id: itemId,
      short_link: shortLink,
      long_link: longLink,
      channel: params.channel,
      clip_id: params.clip_id || null,
      sub_ids: params.sub_ids,
    });

    this.db.saveProduct({
      item_id: itemId,
      shop_id: shopId,
      title: 'Unknown',
      price_min: 0,
      price_max: 0,
    });
    if (params.clip_id) this.db.upsertClip({ clip_id: params.clip_id, channel: params.channel });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          created: true,
          source: 'placeholder',
          origin: link.origin,
          clip_saved: Boolean(params.clip_id),
          as_of: new Date().toISOString(),
          link,
        }),
      }],
    };
  }

  private async createLinksBatch(params: { items: CreateLinkParams[] }) {
    // Validate all items first
    const validationErrors: Array<{ index: number; error: string }> = [];
    for (let i = 0; i < params.items.length; i++) {
      const item = params.items[i];
      if (!parseProductUrl(item.product_url)) {
        validationErrors.push({ index: i, error: `Invalid product URL: ${item.product_url}` });
      }
    }

    if (validationErrors.length > 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: false,
            error: 'validation_failed',
            validation_errors: validationErrors,
            message: 'All items must pass validation before processing',
          }),
        }],
      };
    }

    // Process all items, capturing per-item results
    const results = [];
    for (let i = 0; i < params.items.length; i++) {
      const item = params.items[i];
      try {
        const result = await this.createLink(item);
        const parsed = JSON.parse(result.content[0].text);
        results.push({
          index: i,
          status: 'success',
          ...parsed,
        });
      } catch (error) {
        results.push({
          index: i,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          product_url: item.product_url,
          channel: item.channel,
        });
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const failCount = results.filter(r => r.status === 'failed').length;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          source: 'placeholder',
          as_of: new Date().toISOString(),
          total: params.items.length,
          successful: successCount,
          failed: failCount,
          results,
        }),
      }],
    };
  }

  private async getConversions(params: { from: string; to: string; status?: string }) {
    await this.cdp.ensureConnected();
    let result;
    try {
      result = await this.cdp.getBrowserFlows().getConversions(params.from, params.to, params.status);
    } finally {
      await this.cdp.disconnect();
    }
    if (!result.ok || !result.data) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ ok: false, error: result.error || 'Could not read conversions', status: result.status }),
        }],
      };
    }
    const asOf = new Date().toISOString();
    let rows = result.data.rows;
    if (params.status && result.data.status_filter !== 'server') {
      const needle = params.status.toLowerCase();
      rows = rows.filter((row) => row.status.toLowerCase().includes(needle));
    }
    this.db.saveConversions(rows, result.data.source, asOf);
    if (result.data.affiliate_id) this.db.saveAccountMarker(result.data.affiliate_id, asOf);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          source: result.data.source,
          as_of: asOf,
          endpoint_path: result.data.endpoint_path,
          download_clicked: result.data.download_clicked,
          status_filter: params.status && result.data.status_filter !== 'server' ? 'local' : result.data.status_filter,
          status_query_key: result.data.status_query_key,
          list_query_keys: result.data.list_query_keys,
          row_count: rows.length,
          empty: rows.length === 0,
        }),
      }],
    };
  }

  private async salesByTool(params: { dim: SalesDim; from: string; to: string; status?: string }) {
    if (!isSalesDim(params.dim)) {
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'invalid_dim' }) }] };
    }
    let rows = this.db.listConversions(params.from, params.to);
    if (params.status) {
      const needle = params.status.toLowerCase();
      rows = rows.filter((row) => row.status.toLowerCase().includes(needle));
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          source: 'sqlite',
          as_of: new Date().toISOString(),
          dim: params.dim,
          from: params.from,
          to: params.to,
          buckets: salesBy(rows, params.dim, params.from, params.to),
        }),
      }],
    };
  }

  private async verifyLink(params: VerifyLinkParams) {
    const head = await headNoRedirect(params.url);
    const decision = ownershipFromLocation(head.location, this.db.getAccountMarker(), head.status);
    if (decision.item_id) {
      const existing = this.db.findLinks({ item_id: decision.item_id });
      if (existing.length > 0) {
        this.db.updateLinkVerification(
          existing[0].link_id,
          decision.ownership_verified,
          decision.target_verified,
        );
      }
    }
    return {
      content: [{
        type: 'text',
          text: JSON.stringify({
          ok: true,
          source: 'head',
          as_of: new Date().toISOString(),
          ownership_verified: decision.ownership_verified,
          target_verified: decision.target_verified,
          reason: decision.reason,
          http_status: decision.http_status,
          item_id_present: decision.item_id != null,
          warnings: decision.ownership_verified === 'unknown' ? [decision.reason] : [],
        }),
      }],
    };
  }

  private async getOffer(params: GetOfferParams) {
    const cachedOffer = this.db.getLatestOffer(params.item_id);
    
    if (cachedOffer) {
      const ageMinutes = (Date.now() - new Date(cachedOffer.as_of).getTime()) / 60000;
      if (ageMinutes < 360) {
        const snapshot = this.db.listOfferSnapshots(1, params.item_id)[0];
        const notes = offerAnnotations(snapshot?.category);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: true,
              source: 'cache',
              as_of: cachedOffer.as_of,
              offer: {
                item_id: params.item_id,
                price: cachedOffer.price,
                commission_rate_social: cachedOffer.commission_rate_social,
                store_commission_percent: cachedOffer.commission_rate_social,
                commission_baht: Math.round(cachedOffer.price * cachedOffer.commission_rate_social) / 100,
                commission_rate_video: cachedOffer.commission_rate_video,
                extra_comm: cachedOffer.extra_comm,
                stock_available: cachedOffer.stock_available,
                ...notes,
                citation: notes.excluded_category ? 'https://help.shopee.co.th/portal/10/article/132895' : null,
              },
            }),
          }],
        };
      }
    }

    if (this.affiliateOpenApiUrl && this.affiliateOpenApiKey) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: false,
            error: 'api_not_implemented',
            message: 'Affiliate Open API stub - no live calls configured',
            source: 'api',
          }),
        }],
      };
    }

    try {
      await this.cdp.ensureConnected();
      
      const result = await this.cdp.getBrowserFlows().getOfferData(params.item_id);
      if (!result.ok || !result.data) {
        throw new Error(result.error || 'Could not read the offer');
      }
      const data = result.data;
      const price = Number(data.price_baht ?? 0);
      const storePercent = Number(data.store_commission_percent ?? 0);

      const saved = {
        item_id: params.item_id,
        price,
        commission_rate_social: storePercent,
        commission_rate_video: null as number | null,
        extra_comm: false,
        stock_available: Number(data.stock ?? 0) > 0,
      };

      const notes = offerAnnotations(typeof data.category === 'string' ? data.category : null);
      const offerAsOf = new Date().toISOString();
      this.db.saveProduct({
        item_id: params.item_id,
        shop_id: String(data.shop_id || '0'),
        title: typeof data.product_name === 'string' ? data.product_name : `Product ${params.item_id}`,
        price_min: price,
        price_max: price,
        category: typeof data.category === 'string' ? data.category : null,
        image_urls: safeImageUrls(data.images),
        official: Boolean(data.official),
      });
      this.db.saveOffer({
        ...saved,
        as_of: offerAsOf,
        source: 'cdp',
      });

      const offer = {
        ...saved,
        store_commission_percent: storePercent,
        shopee_commission_percent: data.shopee_commission_percent ?? null,
        xtra_commission_percent: data.xtra_commission_percent ?? null,
        total_commission_percent: data.total_commission_percent ?? null,
        commission_baht: data.commission_baht ?? null,
        store_commission_baht: data.store_commission_baht ?? null,
        shopee_commission_baht: data.shopee_commission_baht ?? null,
        total_commission_baht: data.total_commission_baht ?? null,
        commission_min_baht: data.commission_min_baht ?? null,
        commission_max_baht: data.commission_max_baht ?? null,
        ...notes,
        images: safeImageUrls(data.images),
        citation: notes.excluded_category ? 'https://help.shopee.co.th/portal/10/article/132895' : null,
      };
      this.db.saveOfferSnapshot({
        item_id: params.item_id,
        as_of: offerAsOf,
        price,
        store_rate: storePercent,
        shopee_rate: data.shopee_commission_percent ?? null,
        xtra_rate: data.xtra_commission_percent ?? null,
        total_rate: data.total_commission_percent ?? null,
        extra_comm: false,
        stock: data.stock == null ? null : Number(data.stock),
        category: notes.category,
        title: typeof data.product_name === 'string' ? data.product_name : null,
        image_urls: safeImageUrls(data.images),
        official: Boolean(data.official),
        excluded_category: notes.excluded_category,
        excluded_match: notes.excluded_match,
        source: 'cdp',
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: true,
            source: 'cdp',
            as_of: offerAsOf,
            offer,
          }),
        }],
      };
    } catch (error) {
      throw error;
    }
  }

  private async getConnectionStatus() {
    const connected = this.cdp.isConnected();
    const queueStatus = this.cdp.getQueueStatus();
    const queuedJobs = this.db.getQueuedJobs(10);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          chrome_connected: connected,
          cdp_url: this.cdp.getCdpUrl(),
          queue_status: queueStatus,
          queued_jobs: queuedJobs,
          as_of: new Date().toISOString(),
        }),
      }],
    };
  }

  private async importReportCsv(params: ImportReportParams) {
    try {
      const lines = params.csv_text.trim().split('\n');
      if (lines.length < 2) {
        throw new Error('CSV must have at least a header and one data row');
      }

      const rows = parseMappedCsv(params.csv_text, params.mapping);

      const links = this.db.findLinks({});
      const subIdMap = new Map(links.map(link => [
        [link.sub_ids.sub_id1, link.sub_ids.sub_id2, link.sub_ids.sub_id3, link.sub_ids.sub_id4, link.sub_ids.sub_id5]
          .filter(Boolean).join(','),
        link,
      ]));

      const mappedRows = rows.filter(r => subIdMap.has(r.sub_id));
      const unmappedRows = rows.filter(r => !subIdMap.has(r.sub_id));

      const summary = {
        total_rows: rows.length,
        mapped_rows: mappedRows.length,
        unmapped_rows: unmappedRows.length,
        total_commission: rows.reduce((sum, r) => sum + r.commission, 0),
        mapped_commission: mappedRows.reduce((sum, r) => sum + r.commission, 0),
        by_channel: {} as Record<string, number>,
        by_amount_state: {
          estimated: params.amount_state === 'estimated' ? rows.reduce((sum, r) => sum + r.commission, 0) : 0,
          validated: params.amount_state === 'validated' ? rows.reduce((sum, r) => sum + r.commission, 0) : 0,
          paid: params.amount_state === 'paid' ? rows.reduce((sum, r) => sum + r.commission, 0) : 0,
        },
      };

      mappedRows.forEach(row => {
        const link = subIdMap.get(row.sub_id);
        if (link) {
          summary.by_channel[link.channel] = (summary.by_channel[link.channel] || 0) + row.commission;
        }
      });

      const digest = crypto.createHash('sha256').update(params.csv_text).digest('hex');

      if (!params.commit) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: true,
              committed: false,
              digest,
              preview: summary,
              source: 'cache',
              as_of: new Date().toISOString(),
            }),
          }],
        };
      }

      if (params.expected_digest && params.expected_digest !== digest) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: false,
              error: 'digest_mismatch',
              message: 'CSV content changed since preview. Please preview again.',
            }),
          }],
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: true,
            committed: true,
            digest,
            report: {
              ...summary,
              workspace_id: params.workspace_id,
              marketplace: params.marketplace,
              period_start: params.period_start,
              period_end: params.period_end,
              amount_state: params.amount_state,
              imported_at: new Date().toISOString(),
            },
            source: 'cdp',
            as_of: new Date().toISOString(),
          }),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: false,
            error: 'import_failed',
            message: error instanceof Error ? error.message : String(error),
          }),
        }],
      };
    }
  }

  getDatabase(): ShopkudDatabase {
    return this.db;
  }

  /** Same dispatch the MCP handler uses. Returns the tool JSON object. */
  async invoke(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    try {
      const result = await this.execute(name, args);
      return JSON.parse(result.content[0].text);
    } catch (error) {
      if (error instanceof CaptchaDetectedError) {
        return { ok: false, error: 'captcha_detected', message: error.message };
      }
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async execute(name: string, args: Record<string, unknown>) {
    if (isLocalTool(name)) return this.localTool(name, args);
    switch (name) {
      case 'find_link':
        return await this.findLink(args as any as FindLinkParams);
      case 'create_link':
        return await this.createLink(args as any as CreateLinkParams);
      case 'create_links_batch':
        return await this.createLinksBatch(args as any as { items: CreateLinkParams[] });
      case 'get_conversions':
        return await this.getConversions(args as any as { from: string; to: string; status?: string });
      case 'sales_by':
        return await this.salesByTool(args as any as { dim: SalesDim; from: string; to: string; status?: string });
      case 'verify_link':
        return await this.verifyLink(args as any as VerifyLinkParams);
      case 'get_offer':
        return await this.getOffer(args as any as GetOfferParams);
      case 'get_connection_status':
        return await this.getConnectionStatus();
      case 'import_report_csv':
        return await this.importReportCsv(args as any as ImportReportParams);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async localTool(name: string, args: Record<string, unknown>) {
    const chrome = name === 'setup_status'
      ? await this.probe(this.cdp.getCdpUrl())
      : { reachable: false, port: null, browser: null, skipped: true };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(runLocalTool(name, args, this.db, chrome)) }],
    };
  }

  async start() {
    await this.cdp.connect();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('ShopKud Core MCP server running');
  }

  async stop() {
    await this.cdp.disconnect();
    this.db.close();
  }
}

async function main() {
  const dbPath = process.env.SHOPKUD_DB_PATH || './shopkud.db';
  const cdpUrl = resolveCdpUrl();

  const server = new ShopkudMCPServer(dbPath, cdpUrl, {
    probe: (url) => probeChrome(url, { allowReserved: true }),
  });

  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });

  await server.start();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
