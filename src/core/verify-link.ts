import { isShortLink } from '../config/selectors.js';
import { affiliateMarker } from './conversions.js';

export interface HeadResult {
  status: number;
  location: string | null;
}

export interface OwnershipResult {
  ownership_verified: 'true' | 'false' | 'unknown';
  target_verified: 'true' | 'false' | 'unknown';
  reason: string;
  item_id: string | null;
  http_status: number;
}

/** HEAD only. redirect: 'manual' so the short link is not opened. */
export async function headNoRedirect(url: string): Promise<HeadResult> {
  if (!isShortLink(url)) {
    throw new Error('Only Shopee short links (s.shopee.co.th) can be verified');
  }
  const response = await fetch(url, {
    method: 'HEAD',
    redirect: 'manual',
    headers: { 'user-agent': 'ShopKud/0.9' },
  });
  return { status: response.status, location: response.headers.get('location') };
}

export function ownershipFromLocation(location: string | null, ourAffiliateId: string | null, httpStatus: number): OwnershipResult {
  if (!location) {
    return {
      ownership_verified: 'unknown',
      target_verified: 'unknown',
      reason: 'no_location',
      item_id: null,
      http_status: httpStatus,
    };
  }
  let target: URL;
  try {
    target = new URL(location);
  } catch {
    return {
      ownership_verified: 'unknown',
      target_verified: 'unknown',
      reason: 'bad_location',
      item_id: null,
      http_status: httpStatus,
    };
  }
  const product = target.pathname.match(/\/(?:product|opaanlp)\/(\d+)\/(\d+)/);
  const itemId = product ? product[2] : null;
  const fromSource = affiliateMarker(target.searchParams.get('utm_source'));
  const fromPid = affiliateMarker(target.searchParams.get('mmp_pid'));
  const marker = fromSource || fromPid;
  const ours = affiliateMarker(ourAffiliateId);
  if (!marker || !ours) {
    return {
      ownership_verified: 'unknown',
      target_verified: itemId ? 'true' : 'unknown',
      reason: marker ? 'no_account_marker' : 'no_location_marker',
      item_id: itemId,
      http_status: httpStatus,
    };
  }
  return {
    ownership_verified: marker === ours ? 'true' : 'false',
    target_verified: itemId ? 'true' : 'unknown',
    reason: fromSource ? 'utm_source' : 'mmp_pid',
    item_id: itemId,
    http_status: httpStatus,
  };
}
