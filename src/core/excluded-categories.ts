/**
 * Prohibited affiliate categories from Shopee TH help article 132895.
 * The article spells the utilities row "utilites". Unverified guesses are not applied.
 * https://help.shopee.co.th/portal/10/article/132895
 */
export const EXCLUDED_CATEGORY_CITATION = 'https://help.shopee.co.th/portal/10/article/132895';

export const OFFICIAL_EXCLUDED_CATEGORIES = [
  'เครื่องประดับ',
  'โลหะมีค่าเพื่อการลงทุน',
  'แหวน',
  'ต่างหู',
  'กำไลข้อมือ',
  'กำไลข้อเท้า',
  'ชาร์ม & จี้',
  'ชาร์ม',
  'จี้',
  'อาวุธ',
  'บุหรี่',
  'ยาสูบ',
  'สิ่งมีชีวิตและซากสัตว์',
  'การบริการ',
  'utilites',
  'donation',
  'local service',
  'investment',
  'นมผง',
] as const;

/** Not in article 132895. Kept only so tests can show they are not applied. */
export const UNVERIFIED_CATEGORY_GUESSES = [
  'voucher',
  'vouchers',
  'e-voucher',
  'gift card',
  'giftcard',
  'digital code',
  'คูปอง',
  'บัตรกำนัล',
  'ตั๋ว',
] as const;

function labelIn(folded: string, label: string): boolean {
  const needle = label.toLowerCase();
  if (needle.length <= 2) {
    const pattern = new RegExp(`(?:^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s)`, 'i');
    return pattern.test(folded);
  }
  return folded.toLowerCase().includes(needle);
}

/** Returns the matched official label, or null. */
export function excludedCategory(category: string | null | undefined): string | null {
  if (!category) return null;
  const folded = category.toLowerCase();
  for (const label of OFFICIAL_EXCLUDED_CATEGORIES) {
    if (labelIn(folded, label)) return label;
  }
  return null;
}

const IMAGE_HOST = /(^|\.)((susercontent|shopeemobile)\.com|shopee\.co\.th)$/i;

export function safeImageUrls(value: unknown, limit = 30): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string' || out.length >= limit) continue;
    try {
      const url = new URL(item);
      if (url.protocol !== 'https:' || !IMAGE_HOST.test(url.hostname)) continue;
      out.push(url.toString());
    } catch {
      // Drop anything that is not an https URL.
    }
  }
  return out;
}

export function offerAnnotations(category: string | null | undefined): {
  category: string | null;
  excluded_category: boolean;
  excluded_match: string | null;
  commission_eligible: boolean;
  warnings: string[];
} {
  const match = excludedCategory(category);
  return {
    category: category || null,
    excluded_category: Boolean(match),
    excluded_match: match,
    commission_eligible: !match,
    warnings: match ? ['excluded_category'] : [],
  };
}
