/**
 * The only door to the backend. Everything goes through the documented JSON API (docs/API.md):
 *   POST /api/v1/tools/:name   (needs the X-ShopKud-Console header)
 *   GET  /api/v1/tools
 *   GET  /api/v1/export/:kind
 */

const SECRET_KEY = /cookie|token|secret|password|authorization|signature|websocket|debugger/i;

/** Defense in depth: the server already redacts, this drops secret-shaped keys again. */
export function scrub(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (!SECRET_KEY.test(key)) out[key] = scrub(item, depth + 1);
  }
  return out;
}

const LOG_LIMIT = 150;
export const callLog = [];

function record(entry) {
  callLog.unshift(entry);
  if (callLog.length > LOG_LIMIT) callLog.length = LOG_LIMIT;
  window.dispatchEvent(new CustomEvent('shopkud:api-log', { detail: entry }));
}

export async function callTool(name, args = {}) {
  const started = performance.now();
  let result;
  let status = 0;
  try {
    const response = await fetch(`/api/v1/tools/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-ShopKud-Console': '1' },
      body: JSON.stringify(args),
    });
    status = response.status;
    result = scrub(await response.json());
  } catch (error) {
    result = { ok: false, error: 'network_error', message: error instanceof Error ? error.message : String(error) };
  }
  if (!result || typeof result !== 'object') result = { ok: false, error: 'bad_response' };
  record({
    at: new Date().toISOString(),
    tool: name,
    args: Object.keys(args),
    ok: result.ok !== false,
    status,
    error: result.ok === false ? String(result.error || 'error') : null,
    ms: Math.round(performance.now() - started),
  });
  return result;
}

export async function listTools() {
  try {
    const response = await fetch('/api/v1/tools');
    return scrub(await response.json());
  } catch {
    return { ok: false, tools: [] };
  }
}

export async function getExport(kind, { from, to } = {}) {
  const params = new URLSearchParams({ format: 'json' });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const started = performance.now();
  let result;
  let status = 0;
  try {
    const response = await fetch(`/api/v1/export/${encodeURIComponent(kind)}?${params}`);
    status = response.status;
    result = scrub(await response.json());
  } catch (error) {
    result = { ok: false, error: 'network_error', message: error instanceof Error ? error.message : String(error) };
  }
  record({
    at: new Date().toISOString(), tool: `export:${kind}`, args: [], ok: result.ok !== false,
    status, error: result.ok === false ? String(result.error || 'error') : null, ms: Math.round(performance.now() - started),
  });
  return result;
}

export function exportUrl(kind, format, { from, to } = {}) {
  const params = new URLSearchParams({ format });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return `/api/v1/export/${encodeURIComponent(kind)}?${params}`;
}

/** Calls many tools in parallel. Never throws. */
export function callMany(calls) {
  return Promise.all(calls.map(([name, args]) => callTool(name, args)));
}
