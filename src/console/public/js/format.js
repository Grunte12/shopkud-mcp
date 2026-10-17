const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

export function num(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '–';
  return Number(value).toLocaleString('en-US');
}

export function baht(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '–';
  return `฿${Number(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function bahtShort(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '–';
  if (Math.abs(n) >= 1_000_000) return `฿${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `฿${(n / 1000).toFixed(1)}k`;
  return baht(n, n % 1 === 0 ? 0 : 2);
}

export function pct(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '–';
  const n = Number(value);
  return `${n % 1 === 0 ? n : n.toFixed(digits)}%`;
}

export function share(part, total) {
  return total > 0 ? (part / total) * 100 : 0;
}

export function dayKey(date = new Date()) {
  return new Date(date.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

export function addDays(day, delta) {
  const t = Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function thaiDate(value) {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return value || '–';
  const d = new Date(t + 7 * 3600_000);
  return `${d.getUTCDate()} ${THAI_MONTHS[d.getUTCMonth()]}`;
}

export function thaiDateTime(value) {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return value || '–';
  const d = new Date(t + 7 * 3600_000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${THAI_MONTHS[d.getUTCMonth()]} ${hh}:${mm}`;
}

export function relTime(value, now = Date.now()) {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return '–';
  const sec = Math.round((now - t) / 1000);
  if (sec < 45) return 'เมื่อสักครู่';
  if (sec < 3600) return `${Math.round(sec / 60)} นาทีที่แล้ว`;
  if (sec < 86_400) return `${Math.round(sec / 3600)} ชม.ที่แล้ว`;
  return `${Math.round(sec / 86_400)} วันที่แล้ว`;
}

export function monthLabel(yyyymm) {
  const m = /^(\d{4})(\d{2})$/.exec(String(yyyymm));
  if (!m) return String(yyyymm);
  return `${THAI_MONTHS[Number(m[2]) - 1] || m[2]} ${m[1]}`;
}
