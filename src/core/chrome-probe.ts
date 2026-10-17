import { cdpPortOf, isReservedLiveCdpUrl } from '../config/cdp.js';

export interface ChromeProbe {
  reachable: boolean;
  port: number | null;
  browser: string | null;
  skipped?: boolean;
  error?: string;
}

/**
 * Reads Chrome's local /json/version. The websocket URL is a session id, so it is never returned.
 * Reserved live ports are skipped unless the caller is the real server or the live CLI.
 */
export async function probeChrome(cdpUrl: string, options: { allowReserved?: boolean } = {}): Promise<ChromeProbe> {
  const port = Number(cdpPortOf(cdpUrl) || '');
  const portValue = Number.isFinite(port) && port > 0 ? port : null;
  let parsed: URL;
  try {
    parsed = new URL(cdpUrl);
  } catch {
    return { reachable: false, port: portValue, browser: null, error: 'bad_cdp_url' };
  }
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    return { reachable: false, port: portValue, browser: null, error: 'local_only' };
  }
  if (isReservedLiveCdpUrl(cdpUrl) && !options.allowReserved) {
    return { reachable: false, port: portValue, browser: null, skipped: true, error: 'reserved_live_port' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(new URL('/json/version', parsed).toString(), { signal: controller.signal });
    if (!response.ok) return { reachable: false, port: portValue, browser: null, error: `HTTP ${response.status}` };
    const body = await response.json() as { Browser?: string };
    return { reachable: true, port: portValue, browser: typeof body.Browser === 'string' ? body.Browser : null };
  } catch (error) {
    return { reachable: false, port: portValue, browser: null, error: error instanceof Error ? error.name : 'probe_failed' };
  } finally {
    clearTimeout(timer);
  }
}
