import { h, icon, clear, put } from '../dom.js';
import {
  card, pageHeader, badge, chipRow, notice, errorState, emptyState, tip, copyButton, confirmDialog, toast, segmented, errorText,
} from '../components.js';
import { callTool } from '../api.js';
import { SLOTS, CHANNELS, CHANNEL_LABEL, slotValues, valuesToSubIds, toUtm, validateSubIds, issueText } from '../subid.js';
import { thaiDate, thaiDateTime } from '../format.js';

const OWNER = {
  true: { th: 'ของเรา (owned_by_us)', tone: 'ok', icon: 'check' },
  false: { th: 'ไม่ใช่ของเรา', tone: 'bad', icon: 'x' },
  unknown: { th: 'ยังไม่ตรวจ', tone: 'neutral', icon: 'help' },
};

export function parseProductUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'shopee.co.th') return null;
    const slug = u.pathname.match(/-i\.(\d+)\.(\d+)(?:\/|$)/);
    if (slug) return { shopId: slug[1], itemId: slug[2] };
    const product = u.pathname.match(/^\/product\/(\d+)\/(\d+)(?:\/|$)/);
    if (product) return { shopId: product[1], itemId: product[2] };
    return null;
  } catch {
    return null;
  }
}

function currentMonth() {
  const d = new Date(Date.now() + 7 * 3600_000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function ownerBadge(link) {
  const info = OWNER[link.ownership_verified] || OWNER.unknown;
  return badge(info.th, info.tone, info.icon, { 'data-owned-by-us': link.ownership_verified, class: `badge badge-${info.tone} owner-badge` });
}

function registryTable(links, filters) {
  const q = filters.q.trim().toLowerCase();
  const rows = links.filter((link) => {
    if (filters.channel && link.channel !== filters.channel) return false;
    if (filters.gaps && !Object.values(link.sub_ids || {}).some((v) => !v)) return false;
    if (filters.owner && link.ownership_verified !== filters.owner) return false;
    if (q && !`${link.item_id} ${link.product_id} ${link.short_link} ${Object.values(link.sub_ids || {}).join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  });
  if (rows.length === 0) return emptyState('ไม่พบลิงก์', 'ลองล้างตัวกรอง หรือสร้างลิงก์ใหม่ในแท็บ "สร้างลิงก์"', 'link');
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table', id: 'links-table' },
    h('thead', null, h('tr', null, ['สินค้า', 'ช่องทาง', 'Sub ID (s1–s5)', 'ความเป็นเจ้าของ', 'ที่มา', 'ลิงก์สั้น', 'สร้างเมื่อ'].map((t) => h('th', null, t)))),
    h('tbody', null, rows.map((link) => {
      const values = slotValues(link.sub_ids);
      const gaps = values.filter((v) => !v).length;
      return h('tr', { dataset: { link: link.link_id, item: link.item_id } },
        h('td', null, h('strong', null, `#${link.item_id}`), h('div', { class: 'muted small' }, link.product_id)),
        h('td', null, badge(CHANNEL_LABEL[link.channel] || link.channel, 'info')),
        h('td', null, chipRow(values), gaps > 0 ? h('div', { class: 'gap-note' }, icon('alert', 12), `ว่าง ${gaps} ช่อง`) : null),
        h('td', null, ownerBadge(link), h('div', { class: 'muted small' }, `ปลายทาง: ${OWNER[link.target_verified]?.th.replace(' (owned_by_us)', '') || '–'}`)),
        h('td', null, badge(link.origin === 'shopee' ? 'จาก Shopee' : 'placeholder', link.origin === 'shopee' ? 'ok' : 'warn')),
        h('td', null, h('code', { class: 'short-link', title: 'แสดงเป็นข้อความเท่านั้น ไม่ใช่ลิงก์ที่กดได้' }, link.short_link), copyButton(link.short_link, 'คัดลอก')),
        h('td', { title: link.created_at }, thaiDate(link.created_at)));
    }))));
}

async function registryView(ctx) {
  const host = h('div', { class: 'stack-v', id: 'registry' });
  const filters = { q: '', channel: '', gaps: false, owner: '' };
  const tableHost = h('div', { id: 'registry-table' });
  let links = [];

  const search = h('input', { class: 'input', type: 'search', id: 'filter-q', placeholder: 'ค้นหา item / Sub ID', 'aria-label': 'ค้นหาลิงก์' });
  const channel = h('select', { class: 'input', id: 'filter-channel', 'aria-label': 'กรองช่องทาง' }, h('option', { value: '' }, 'ทุกช่องทาง'), CHANNELS.map((c) => h('option', { value: c }, CHANNEL_LABEL[c])));
  const owner = h('select', { class: 'input', id: 'filter-owner', 'aria-label': 'กรองเจ้าของ' },
    h('option', { value: '' }, 'ทุกสถานะเจ้าของ'), h('option', { value: 'true' }, 'ของเรา'), h('option', { value: 'false' }, 'ไม่ใช่ของเรา'), h('option', { value: 'unknown' }, 'ยังไม่ตรวจ'));
  const gaps = h('input', { type: 'checkbox', id: 'filter-gaps' });
  const paint = () => put(tableHost, registryTable(links, filters));
  search.addEventListener('input', () => { filters.q = search.value; paint(); });
  channel.addEventListener('change', () => { filters.channel = channel.value; paint(); });
  owner.addEventListener('change', () => { filters.owner = owner.value; paint(); });
  gaps.addEventListener('change', () => { filters.gaps = gaps.checked; paint(); });

  async function load() {
    put(tableHost, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'กำลังโหลดลิงก์...'));
    const result = await callTool('find_link', {});
    if (result.ok === false) { put(tableHost, errorState(result, load)); return; }
    links = result.links || [];
    summary.textContent = `${links.length} ลิงก์ · ${links.filter((l) => Object.values(l.sub_ids || {}).some((v) => !v)).length} ลิงก์มีช่องว่าง`;
    paint();
  }
  const summary = h('span', { class: 'muted', id: 'links-summary' });
  host.append(
    h('div', { class: 'toolbar' }, search, channel, owner,
      h('label', { class: 'check-row inline' }, gaps, h('span', null, 'เฉพาะที่มีช่องว่าง')), summary,
      h('button', { class: 'btn btn-small', type: 'button', id: 'reload-links', onclick: load }, icon('refresh', 14), 'รีโหลด')),
    tableHost);
  await load();
  host.reload = load;
  return host;
}

function builderView(ctx, onCreated) {
  const state = { url: '', channel: 'tiktok', values: ['tiktok', '', '', '', ''], dry: true, syncedPlatform: true };
  const host = h('div', { class: 'builder', id: 'builder' });

  const url = h('input', { class: 'input', id: 'product-url', type: 'url', placeholder: 'https://shopee.co.th/ชื่อสินค้า-i.123.456', autocomplete: 'off', 'aria-label': 'ลิงก์สินค้า Shopee' });
  const channelSel = h('select', { class: 'input', id: 'channel', 'aria-label': 'ช่องทาง' }, CHANNELS.map((c) => h('option', { value: c }, `${CHANNEL_LABEL[c]} (${c})`)));
  const inputs = SLOTS.map((slot, i) => {
    const input = h('input', {
      class: 'input slot-input', id: `slot-${slot.n}`, type: 'text', maxlength: '40', autocomplete: 'off',
      placeholder: slot.example, value: state.values[i], style: { '--chip': slot.color, '--chip-soft': slot.soft }, 'aria-label': `s${slot.n} ${slot.th}`,
    });
    input.addEventListener('input', () => {
      state.values[i] = input.value.trim();
      if (i === 0) state.syncedPlatform = false;
      refresh();
    });
    return input;
  });
  const slotFields = SLOTS.map((slot, i) => h('div', { class: 'slot-field', style: { '--chip': slot.color, '--chip-soft': slot.soft } },
    h('label', { for: `slot-${slot.n}`, class: 'slot-label' },
      h('span', { class: 'slot-badge' }, `s${slot.n}`), slot.th,
      tip(h('span', { class: 'help', id: `tip-${slot.n}`, role: 'img' }, icon('help', 14)), slot.tip)),
    inputs[i],
    h('small', { class: 'muted' }, `เช่น ${slot.example}`)));

  const preview = h('div', { class: 'preview', id: 'preview' });
  const issuesBox = h('div', { id: 'issues' });
  const dryToggle = h('input', { type: 'checkbox', id: 'dry-run', checked: true, role: 'switch' });
  const submit = h('button', { class: 'btn btn-primary', type: 'button', id: 'submit' });
  const result = h('div', { id: 'create-result' });

  channelSel.addEventListener('change', () => {
    state.channel = channelSel.value;
    if (state.syncedPlatform || !state.values[0]) { state.values[0] = state.channel; inputs[0].value = state.channel; state.syncedPlatform = true; }
    refresh();
  });
  url.addEventListener('input', () => { state.url = url.value.trim(); refresh(); });
  dryToggle.addEventListener('change', () => { state.dry = dryToggle.checked; refresh(); });

  function problems() {
    const list = validateSubIds(state.values, state.channel);
    const parsed = state.url ? parseProductUrl(state.url) : null;
    return { list, parsed };
  }

  function refresh() {
    const { list, parsed } = problems();
    const utm = toUtm(state.values);
    put(preview, 
      h('div', { class: 'preview-row' }, h('span', { class: 'preview-label' }, 'ตัวอย่างชิป'), chipRow(state.values, { showName: true })),
      h('div', { class: 'preview-row' }, h('span', { class: 'preview-label' }, 'ส่งไปเป็น'), h('code', { id: 'preview-utm', class: 'utm' }, utm || '(ว่างทั้งหมด)')));
    const errors = list.filter((i) => i.level === 'error');
    const warns = list.filter((i) => i.level === 'warn');
    const urlIssue = state.url && !parsed;
    put(issuesBox, 
      urlIssue ? notice('bad', 'x', 'ลิงก์สินค้าไม่ถูกรูปแบบ ต้องเป็น https://shopee.co.th/...-i.ร้าน.สินค้า') : null,
      ...errors.map((i) => notice('bad', 'x', issueText(i))),
      ...warns.map((i) => h('div', { class: 'notice notice-warn issue-warn', dataset: { code: i.code, slot: String(i.slot) } }, icon('alert', 16), h('div', null, issueText(i)))));
    inputs.forEach((input, i) => input.classList.toggle('slot-empty', !state.values[i]));
    const blocked = errors.length > 0 || !parsed;
    submit.disabled = blocked;
    put(submit, state.dry ? icon('flask', 16) : icon('send', 16), state.dry ? 'ตรวจสอบ (dry-run)' : 'สร้างลิงก์จริง...');
    submit.classList.toggle('btn-danger', !state.dry);
    submit.classList.toggle('btn-primary', state.dry);
    host.dataset.mode = state.dry ? 'dry' : 'real';
  }

  function fill(values) {
    state.values = [...values];
    inputs.forEach((input, i) => { input.value = values[i]; });
    state.syncedPlatform = false;
    if (CHANNELS.includes(values[0])) { state.channel = values[0]; channelSel.value = values[0]; }
    refresh();
  }

  async function run() {
    const { parsed } = problems();
    if (!parsed) return;
    const subIds = valuesToSubIds(state.values);
    const clip = state.values[2] || undefined;
    const payload = { product_url: state.url, channel: state.channel, sub_ids: subIds, ...(clip ? { clip_id: clip } : {}) };
    clear(result);
    if (state.dry) {
      const [found, budget] = await Promise.all([
        callTool('find_link', { item_id: parsed.itemId, channel: state.channel }),
        callTool('posting_budget', { platform: state.channel }),
      ]);
      const key = (ids) => SLOTS.map((s) => (ids && ids[s.key]) || '').join('\u0000');
      const same = (found.links || []).find((l) => key(l.sub_ids) === key(subIds));
      result.append(h('div', { class: 'plan', id: 'dry-result', dataset: { exists: same ? '1' : '0' } },
        h('h4', null, icon('flask', 18), 'ผล dry-run — ยังไม่ได้เขียนอะไรเลย'),
        h('ul', { class: 'plan-list' },
          h('li', null, icon(same ? 'check' : 'plus', 16), same ? `มีลิงก์นี้อยู่แล้ว (ระบบไม่สร้างซ้ำ): ${same.short_link}` : 'ยังไม่มี → จะสร้างลิงก์ใหม่ 1 เส้น'),
          h('li', null, icon('percent', 16), `สินค้า #${parsed.itemId} · ช่องทาง ${CHANNEL_LABEL[state.channel]}`),
          h('li', null, icon('send', 16), budget.ok === false ? 'เช็กโควต้าไม่ได้' : `โควต้า ${CHANNEL_LABEL[state.channel]} วันนี้ ${budget.today}/${budget.cap}${budget.ok_to_post ? '' : ' (เต็มแล้ว!)'}`)),
        chipRow(state.values),
        h('p', { class: 'muted small' }, 'ปิดสวิตช์ dry-run เพื่อสร้างจริง (ต้องยืนยันอีกครั้ง)')));
      return;
    }
    const ok = await confirmDialog({
      title: 'สร้างลิงก์จริง?', tone: 'warn', iconName: 'send', confirmLabel: 'สร้างลิงก์',
      requireCheck: 'เข้าใจว่าจะบันทึกลิงก์ลงทะเบียนในเครื่อง (placeholder) ยังไม่ส่งฟอร์มไป Shopee',
      body: h('div', null, h('p', null, 'จะเรียก create_link และเขียนแถวใหม่ในฐานข้อมูลของเครื่องนี้'), chipRow(state.values, { showName: true })),
      details: [['สินค้า', `#${parsed.itemId}`], ['ช่องทาง', CHANNEL_LABEL[state.channel]], ['Sub ID', toUtm(state.values)]],
    });
    if (!ok) { toast('ยกเลิกแล้ว ยังไม่มีอะไรถูกสร้าง', 'info'); return; }
    submit.disabled = true;
    const created = await callTool('create_link', payload);
    submit.disabled = false;
    if (created.ok === false) {
      result.append(notice('bad', 'x', h('strong', null, 'สร้างไม่สำเร็จ: '), errorText(created)));
      return;
    }
    const link = created.link || {};
    result.append(h('div', { class: 'plan plan-ok', id: 'create-ok', dataset: { created: created.created ? '1' : '0' } },
      h('h4', null, icon('check', 18), created.created ? 'สร้างลิงก์แล้ว (placeholder ในเครื่อง)' : 'มีลิงก์นี้อยู่แล้ว ไม่สร้างซ้ำ'),
      chipRow(slotValues(link.sub_ids)), h('code', { class: 'short-link' }, link.short_link || ''),
      h('p', { class: 'muted small' }, 'ลิงก์นี้ยังไม่ใช่ลิงก์จริงจาก Shopee — การส่งฟอร์มจริงทำผ่าน CLI create-link แยกต่างหาก')));
    toast(created.created ? 'บันทึกลิงก์แล้ว' : 'มีลิงก์อยู่แล้ว', 'ok');
    onCreated();
  }
  submit.addEventListener('click', run);

  host.append(
    h('div', { class: 'builder-grid' },
      h('div', { class: 'stack-v' },
        card('1) สินค้าและช่องทาง', 'box',
          h('label', { class: 'field' }, h('span', null, 'ลิงก์สินค้า Shopee ', h('small', { class: 'muted' }, '(แค่อ่านรหัส ไม่เปิดหน้า)')), url),
          h('label', { class: 'field' }, h('span', null, 'ช่องทางโพสต์'), channelSel)),
        card('2) Sub ID 5 ช่อง', 'tag',
          h('div', { class: 'slot-grid' }, slotFields),
          h('div', { class: 'btn-group' },
            h('button', { class: 'btn btn-small', type: 'button', id: 'fill-example', onclick: () => fill(SLOTS.map((s) => s.example)) }, icon('flask', 14), 'ใส่ตัวอย่าง tiktok / P1 / v6 / a / 202610'),
            h('button', { class: 'btn btn-small', type: 'button', id: 'fill-month', onclick: () => { state.values[4] = currentMonth(); inputs[4].value = state.values[4]; refresh(); } }, icon('clock', 14), 'ใส่เดือนนี้'),
            h('button', { class: 'btn btn-small btn-ghost', type: 'button', id: 'fill-clear', onclick: () => fill(['', '', '', '', '']) }, icon('trash', 14), 'ล้าง')))),
      h('div', { class: 'stack-v' },
        card('3) ดูตัวอย่างสด', 'eye', preview, issuesBox),
        card('4) สร้าง', 'send',
          h('label', { class: 'switch-row' }, dryToggle, h('span', { class: 'switch' }), h('span', null, h('b', null, 'dry-run (ค่าเริ่มต้น)'), h('small', { class: 'muted' }, ' — ตรวจอย่างเดียว ไม่เขียนอะไร'))),
          submit, result))));
  refresh();
  return host;
}

export async function render(ctx) {
  const root = h('div', { class: 'page', id: 'page-links' });
  root.append(pageHeader('ลิงก์', 'ทะเบียนลิงก์ และตัวสร้าง Sub ID แบบมีตัวอย่างสด', 'link'));
  const content = h('div', { id: 'links-content' });
  let registry = await registryView(ctx);
  const builder = builderView(ctx, () => registry.reload && registry.reload());
  const views = { registry, builder };
  let current = location.hash.includes('create') ? 'builder' : 'registry';
  const show = (name) => { current = name; put(content, views[name]); };
  const tabs = segmented([
    { value: 'registry', label: 'ตารางลิงก์', icon: 'list' },
    { value: 'builder', label: 'สร้างลิงก์ / Sub ID builder', icon: 'plus' },
  ], current, show, { name: 'links-tab' });
  root.append(tabs, content);
  show(current);
  return { element: root };
}

export { thaiDateTime };
