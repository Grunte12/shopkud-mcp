const SECRET_KEY = /cookie|token|secret|password|authorization|signature|gads_t_sig|websocket|debugger/i;

/** Drops secret-shaped fields before a local API response is sent. */
export function redactJson(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redactJson(item, depth + 1));
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = redactJson(item, depth + 1);
  }
  return out;
}
