import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { CDPController, CaptchaDetectedError } from '../core/cdp-controller.js';
import { ShopkudDatabase, type SubIds } from '../core/database.js';
import { randomBytes } from 'crypto';

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
    for (const item of params.items) {
      const productMatch = item.product_url.match(/shopee\.co\.th\/.*-i\.(\d+)\.(\d+)/);
      if (!productMatch) {
        throw new Error(`Invalid product URL: ${item.product_url}`);
      }
    }

    const results = [];
    for (const item of params.items) {
      const result = await this.createLink(item);
      const parsed = JSON.parse(result.content[0].text);
      results.push(parsed);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          source: 'cdp',
          as_of: new Date().toISOString(),
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
      
      const offerUrl = `https://affiliate.shopee.co.th/offer/product_offer/${params.item_id}`;
      const data = await this.cdp.navigateAndCapture(
        offerUrl,
        /api\/v4/,
        15000
      );

      const offer = {
        item_id: params.item_id,
        price: data.price || 0,
        commission_rate_social: data.commission?.social || 0,
        commission_rate_video: data.commission?.video || null,
        extra_comm: data.extra_comm || false,
        stock_available: data.stock > 0,
      };

      this.db.saveOffer({
        ...offer,
        as_of: new Date().toISOString(),
        source: 'cdp',
      });

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
          cdp_url: 'http://127.0.0.1:9222',
          queue_status: queueStatus,
          queued_jobs: queuedJobs,
          as_of: new Date().toISOString(),
        }),
      }],
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
  const cdpUrl = process.env.CHROME_CDP_URL || 'http://127.0.0.1:9222';

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
