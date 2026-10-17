/**
 * Sub ID slots: one source of truth for names, colors and plain-Thai tips.
 * Every page uses these colors so a chip means the same thing everywhere.
 */

export const SLOTS = [
  { n: 1, key: 'sub_id1', dim: 'platform', en: 'platform', th: 'แพลตฟอร์ม', color: '#2563eb', soft: '#dbeafe', example: 'tiktok', hint: 'tiktok / ig / fb', tip: 'โพสต์ลงที่ไหน เช่น tiktok = TikTok, ig = Instagram, fb = Facebook' },
  { n: 2, key: 'sub_id2', dim: 'product', en: 'product', th: 'สินค้า', color: '#ea580c', soft: '#ffedd5', example: 'P1', hint: 'P1, P2 ...', tip: 'รหัสสินค้าที่ตั้งเอง เช่น P1 = สินค้าตัวแรกของเรา' },
  { n: 3, key: 'sub_id3', dim: 'clip', en: 'clip', th: 'คลิป', color: '#16a34a', soft: '#dcfce7', example: 'v6', hint: 'v1, v2 ...', tip: 'เลขคลิปวิดีโอที่ใช้โพสต์ เช่น v6 = คลิปที่ 6' },
  { n: 4, key: 'sub_id4', dim: 'variant', en: 'variant', th: 'แบบทดลอง', color: '#9333ea', soft: '#f3e8ff', example: 'a', hint: 'a / b', tip: 'ใช้เทียบหลายแบบของคลิปเดียวกัน เช่น a = ปกแบบแรก, b = ปกแบบสอง' },
  { n: 5, key: 'sub_id5', dim: 'month', en: 'month', th: 'เดือน', color: '#db2777', soft: '#fce7f3', example: '202610', hint: 'ปีเดือน 6 หลัก', tip: 'ปีและเดือน 6 หลัก 202610 = ตุลาคม 2026' },
];

export const CHANNELS = ['tiktok', 'ig', 'fb', 'x', 'yt', 'spv'];

export const CHANNEL_LABEL = {
  tiktok: 'TikTok', ig: 'Instagram', fb: 'Facebook', x: 'X', yt: 'YouTube', spv: 'Shopee Video',
};

export const UNTRACKED_COLOR = '#d97706';

export const DIM_LABEL = {
  sub_id: 'Sub ID เต็ม',
  platform: 'แพลตฟอร์ม (s1)',
  product: 'สินค้า (s2)',
  clip: 'คลิป (s3)',
  variant: 'แบบ (s4)',
  month: 'เดือน (s5)',
};

export function slotForDim(dim) {
  return SLOTS.find((slot) => slot.dim === dim) || null;
}

export function dimColor(dim) {
  return slotForDim(dim)?.color || '#475569';
}

export function slotValues(subIds) {
  return SLOTS.map((slot) => (subIds && typeof subIds[slot.key] === 'string' ? subIds[slot.key] : ''));
}

export function valuesToSubIds(values) {
  const out = {};
  SLOTS.forEach((slot, index) => {
    out[slot.key] = values[index] ? values[index] : null;
  });
  return out;
}

/** Mirrors the backend: utm_content = the five slots joined by "-". */
export function toUtm(values) {
  return values.join('-');
}

export function splitUtm(utm) {
  const parts = String(utm || '').split('-');
  const out = ['', '', '', '', ''];
  for (let i = 0; i < 4; i += 1) out[i] = parts[i] || '';
  out[4] = parts.slice(4).join('-');
  return out;
}

export function emptySlots(values) {
  return values.map((value, index) => (value ? null : index + 1)).filter(Boolean);
}

const SAFE = /^[A-Za-z0-9]+$/;

/**
 * Checks a builder's five values. level "error" blocks creation, "warn" does not.
 * Codes are turned into plain Thai by issueText.
 */
export function validateSubIds(values, channel) {
  const issues = [];
  const empties = emptySlots(values);
  if (empties.length === values.length) {
    issues.push({ code: 'all_empty', slot: 0, level: 'error' });
    return issues;
  }
  for (const slot of empties) issues.push({ code: 'empty_slot', slot, level: 'warn' });
  values.forEach((value, index) => {
    if (value && !SAFE.test(value)) issues.push({ code: 'bad_chars', slot: index + 1, level: 'error' });
  });
  const month = values[4];
  if (month && SAFE.test(month)) {
    const m = /^(\d{4})(0[1-9]|1[0-2])$/.exec(month);
    if (!m) issues.push({ code: 'bad_month', slot: 5, level: 'warn' });
  }
  const platform = values[0];
  if (platform && SAFE.test(platform) && !CHANNELS.includes(platform)) {
    issues.push({ code: 'unknown_platform', slot: 1, level: 'warn' });
  }
  if (platform && channel && CHANNELS.includes(platform) && platform !== channel) {
    issues.push({ code: 'platform_channel_mismatch', slot: 1, level: 'warn' });
  }
  return issues;
}

export function issueText(issue) {
  const s = `s${issue.slot}`;
  switch (issue.code) {
    case 'all_empty': return 'ทุกช่องว่าง ลิงก์นี้จะแยกยอดขายไม่ได้เลย';
    case 'empty_slot': {
      const slot = SLOTS[issue.slot - 1];
      return `ช่อง ${s} (${slot.th}) ว่าง จะแยกยอดตาม${slot.th}ไม่ได้`;
    }
    case 'bad_chars': return `ช่อง ${s} ใช้ได้เฉพาะ A-Z a-z 0-9 (ห้ามมี - เพราะใช้เป็นตัวคั่นช่อง)`;
    case 'bad_month': return 'ช่อง s5 ควรเป็นปีเดือน 6 หลัก เช่น 202610';
    case 'unknown_platform': return 'ช่อง s1 ไม่ใช่แพลตฟอร์มที่รู้จัก (tiktok, ig, fb, x, yt, spv)';
    case 'platform_channel_mismatch': return 'ช่อง s1 ไม่ตรงกับช่องทางที่เลือก';
    default: return issue.code;
  }
}
