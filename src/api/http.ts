import express, { type NextFunction, type Request, type Response } from 'express';
import type { ShopkudMCPServer } from '../mcp/server.js';
import { LOCAL_TOOL_NAMES, exportData } from '../core/local-tools.js';
import { SALES_DIMS } from '../core/conversions.js';
import { redactJson } from '../core/redact.js';
import type { ShopkudDatabase } from '../core/database.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function hostName(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname;
  } catch {
    return null;
  }
}

const TOOLS = [
  'find_link', 'create_link', 'create_links_batch', 'get_conversions', 'sales_by', 'verify_link',
  'get_offer', 'get_connection_status', 'import_report_csv', ...LOCAL_TOOL_NAMES,
];

/**
 * JSON API for every ShopKud tool. POST /api/v1/tools/:name calls ShopkudMCPServer.invoke,
 * the same dispatch as MCP. This router does not serve a page.
 */
export function mountToolApi(app: express.Express, core: ShopkudMCPServer, db: ShopkudDatabase) {
  app.use('/api/v1', (req: Request, res: Response, next: NextFunction) => {
    const host = hostName(req.headers.host);
    if (!host || !LOCAL_HOSTS.has(host)) {
      res.status(403).json({ ok: false, error: 'local_only' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = hostName(typeof req.headers.origin === 'string' ? req.headers.origin : undefined);
      if (req.headers.origin && (!origin || !LOCAL_HOSTS.has(origin))) {
        res.status(403).json({ ok: false, error: 'bad_origin' });
        return;
      }
      if (req.headers['x-shopkud-console'] !== '1') {
        res.status(403).json({ ok: false, error: 'missing_console_header' });
        return;
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.get('/api/v1/tools', (_req, res) => {
    res.json({
      ok: true,
      tools: TOOLS,
      sales_dims: SALES_DIMS,
      writes_require_confirm: ['enroll_mission', 'prepare_cart_swap', 'set_posting_cap'],
      never_submits: ['enroll_mission', 'prepare_cart_swap', 'convert_links_in_text'],
    });
  });

  app.post('/api/v1/tools/:name', async (req, res) => {
    const name = String(req.params.name);
    if (!TOOLS.includes(name)) {
      res.status(404).json({ ok: false, error: 'unknown_tool' });
      return;
    }
    const args = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    const result = redactJson(await core.invoke(name, args));
    const failed = result && typeof result === 'object' && (result as { ok?: boolean }).ok === false;
    res.status(failed ? 400 : 200).json(result);
  });

  app.get('/api/v1/export/:kind', (req, res) => {
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const exported = exportData(db, String(req.params.kind), format, from, to);
    if (!exported.ok) {
      res.status(404).json(exported);
      return;
    }
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.send(`\uFEFF${exported.body}`);
      return;
    }
    res.json(redactJson(exported));
  });
}

export function createToolApi(core: ShopkudMCPServer) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  mountToolApi(app, core, core.getDatabase());
  return app;
}
