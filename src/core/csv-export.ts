/** Prefix a spreadsheet formula so Excel and Sheets treat the cell as text. */
export function neutralizeCell(value: unknown): string | number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function escapeCell(value: string | number): string {
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const header = columns.map((column) => escapeCell(neutralizeCell(column))).join(',');
  const body = rows.map((row) => columns.map((column) => escapeCell(neutralizeCell(row[column]))).join(','));
  return [header, ...body].join('\r\n');
}
