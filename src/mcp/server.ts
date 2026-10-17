import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { CDPController, CaptchaDetectedError } from '../core/cdp-controller.js';
import { resolveCdpUrl } from '../config/cdp.js';
import { ShopkudDatabase, type SubIds } from '../core/database.js';
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

  constructor(dbPath: string, cdpUrl?: string) {
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
          name: 'verify_link',
          description: 'Verify affiliate link ownership and target WITHOUT following redirects (no tracking clicks). Reports ownership_verified and target_verified separately.',
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
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const args = request.params.arguments || {};
        switch (request.params.name) {
          case 'find_link':
            return await this.findLink(args as any as FindLinkParams);
          case 'create_link':
            return await this.createLink(args as any as CreateLinkParams);
          case 'create_links_batch':
            return await this.createLinksBatch(args as any as { items: CreateLinkParams[] });
          case 'verify_link':
            return await this.verifyLink(args as any as VerifyLinkParams);
          case 'get_offer':
            return await this.getOffer(args as any as GetOfferParams);
          case 'get_connection_status':
            return await this.getConnectionStatus();
          case 'import_report_csv':
            return await this.importReportCsv(args as any as ImportReportParams);
          default:
            throw new Error(`Unknown tool: ${request.params.name}`);
        }
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
    const productMatch = params.product_url.match(/shopee\.co\.th\/.*-i\.(\d+)\.(\d+)/);
    if (!productMatch) {
      throw new Error('Invalid Shopee product URL format');
    }

    const [, shopId, itemId] = productMatch;
    const productId = params.clip_id ? `${params.clip_id}-${itemId}` : itemId;

    const existing = this.db.findLinks({ 
      product_id: productId, 
      channel: params.channel,
    });

    if (existing.length > 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: true,
            created: false,
            source: 'cache',
            as_of: new Date().toISOString(),
            link: existing[0],
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

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          created: true,
          source: 'cdp',
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
      const productMatch = item.product_url.match(/shopee\.co\.th\/.*-i\.(\d+)\.(\d+)/);
      if (!productMatch) {
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
          source: 'cdp',
          as_of: new Date().toISOString(),
          total: params.items.length,
          successful: successCount,
          failed: failCount,
          results,
        }),
      }],
    };
  }

  private async verifyLink(params: VerifyLinkParams) {
    if (!params.url.includes('s.shopee.co.th/')) {
      throw new Error('Only Shopee short links (s.shopee.co.th) can be verified');
    }

    try {
      await this.cdp.ensureConnected();
      
      const response = await this.cdp.navigateAndCapture(
        params.url,
        /affiliate\.shopee\.co\.th/,
        10000
      );

      const itemIdMatch = response?.url?.match(/item\.(\d+)/);
      const itemId = itemIdMatch ? itemIdMatch[1] : null;

      const existing = this.db.findLinks({ item_id: itemId || undefined });
      const ownedByUs = existing.some(link => link.short_link === params.url);

      if (existing.length > 0) {
        this.db.updateLinkVerification(
          existing[0].link_id,
          ownedByUs ? 'true' : 'false',
          itemId ? 'true' : 'unknown'
        );
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: true,
            source: 'cdp',
            as_of: new Date().toISOString(),
            resolves_to: {
              item_id: itemId,
              title: 'Unknown',
            },
            ownership_verified: ownedByUs ? 'true' : 'false',
            target_verified: itemId ? 'true' : 'unknown',
            warnings: itemId ? [] : ['Could not extract item ID from redirect'],
          }),
        }],
      };
    } catch (error) {
      throw error;
    }
  }

  private async getOffer(params: GetOfferParams) {
    const cachedOffer = this.db.getLatestOffer(params.item_id);
    
    if (cachedOffer) {
      const ageMinutes = (Date.now() - new Date(cachedOffer.as_of).getTime()) / 60000;
      if (ageMinutes < 360) {
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

      this.db.saveOffer({
        ...saved,
        as_of: new Date().toISOString(),
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
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: true,
            source: 'cdp',
            as_of: new Date().toISOString(),
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

      const headers = lines[0].split(',').map(h => h.trim());
      const { sub_id, commission, clicks, orders, status } = params.mapping;

      const subIdIndex = headers.indexOf(sub_id);
      const commissionIndex = headers.indexOf(commission);
      const clicksIndex = clicks ? headers.indexOf(clicks) : -1;
      const ordersIndex = orders ? headers.indexOf(orders) : -1;
      const statusIndex = status ? headers.indexOf(status) : -1;

      if (subIdIndex === -1 || commissionIndex === -1) {
        throw new Error('Required columns not found in CSV');
      }

      const rows = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim());
        return {
          sub_id: values[subIdIndex],
          commission: parseFloat(values[commissionIndex]) || 0,
          clicks: clicksIndex >= 0 ? parseInt(values[clicksIndex]) || 0 : 0,
          orders: ordersIndex >= 0 ? parseInt(values[ordersIndex]) || 0 : 0,
          status: statusIndex >= 0 ? values[statusIndex] : 'unknown',
        };
      });

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

  const server = new ShopkudMCPServer(dbPath, cdpUrl);

  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });

  await server.start();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
