/**
 * Chrome DevTools endpoint.
 *
 * SHOPKUD_CDP_PORT overrides the port (default 9222).
 * CHROME_CDP_URL is a full URL used only when the port env is unset.
 * Ports 9222 and 9333 are live affiliate windows. Automated tests must
 * refuse both and use a throwaway profile on another port.
 */

const RESERVED_LIVE_PORTS = new Set(['9222', '9333']);

export function resolveCdpUrl(explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim();
  const port = process.env.SHOPKUD_CDP_PORT?.trim();
  if (port) {
    if (!/^\d{2,5}$/.test(port)) {
      throw new Error('SHOPKUD_CDP_PORT must be a numeric port');
    }
    return `http://127.0.0.1:${port}`;
  }
  const url = process.env.CHROME_CDP_URL?.trim();
  if (url) return url;
  return 'http://127.0.0.1:9222';
}

export function cdpPortOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.port) return parsed.port;
    if (parsed.protocol === 'https:') return '443';
    if (parsed.protocol === 'http:') return '80';
    return null;
  } catch {
    return null;
  }
}

export function isReservedLiveCdpUrl(url: string): boolean {
  const port = cdpPortOf(url);
  return port != null && RESERVED_LIVE_PORTS.has(port);
}

/** URL for automated checks. Null when unset or pointed at a live affiliate Chrome. */
export function throwawayCdpUrl(): string | null {
  const port = process.env.SHOPKUD_CDP_PORT?.trim();
  const url = port ? `http://127.0.0.1:${port}` : (process.env.CHROME_CDP_URL?.trim() || '');
  if (!url || isReservedLiveCdpUrl(url)) return null;
  return url;
}
