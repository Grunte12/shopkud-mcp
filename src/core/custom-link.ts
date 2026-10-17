/**
 * Read a custom-link create response.
 *
 * The live call is POST /api/v3/gql?q=batchCustomLink
 * (operation batchGetCustomLink). Each item has shortLink, longLink, and failCode.
 * failCode 0 is success. This module only reads the JSON. It does not open the short link.
 */

export interface CustomLinkItem {
  shortLink: string | null;
  longLink: string | null;
  failCode: number | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readLink(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readFailCode(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function customLinksFromResponse(response: unknown): CustomLinkItem[] {
  const root = asRecord(response);
  const data = asRecord(root.data);
  const batch = data.batchCustomLink;
  if (Array.isArray(batch)) {
    return batch.map((item) => {
      const row = asRecord(item);
      return {
        shortLink: readLink(row.shortLink),
        longLink: readLink(row.longLink),
        failCode: readFailCode(row.failCode),
      };
    });
  }

  const direct = readLink(root.short_link) || readLink(data.short_link) || readLink(data.link) || readLink(root.link);
  if (!direct) return [];
  return [{ shortLink: direct, longLink: readLink(data.long_link), failCode: readFailCode(root.failCode) }];
}
