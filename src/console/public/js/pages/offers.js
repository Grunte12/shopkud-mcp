import { h, icon, clear, put } from '../dom.js';
import { card, pageHeader, badge, notice, errorState, emptyState, stackedBar, confirmDialog, errorText, copyButton } from '../components.js';
import { callTool, getExport } from '../api.js';
import { sparkline } from '../charts.js';
import { baht, pct, thaiDateTime, relTime, num } from '../format.js';

export const OFFER_COLORS = { store: '#0891b2', shopee: '#4f46e5', xtra: '#84cc16' };
const CACHE_MINUTES = 360;

const REASON_TH = {
  same_category: 'หมวดเดียวกัน', official_shop: 'ร้านทางการ', extra_comm: 'มี Xtra', out_of_stock: 'ของหมด', title_overlap: 'ชื่อคล้ายกัน',
};

function bahtOf(price, percent, given) {
  if (given !== null && given !== undefined && Number.isFinite(Number(given))) return { value: Number(given), computed: false };
  if (price == null || percent == null) return { value: null, computed: false };
  return { value: Math.round(Number(price) * Number(percent)) / 100, computed: true };
}

export function commissionParts(offer, snap) {
  const price = offer.price ?? snap?.price ?? null;
  const store = offer.store_commission_percent ?? snap?.store_rate ?? null;
  const shopee = offer.shopee_commission_percent ?? snap?.shopee_rate ?? null;
  const xtra = offer.xtra_commission_percent ?? snap?.xtra_rate ?? null;
  const parts = [
    { key: 'store', label: 'ร้านค้า (Store)', percent: store, ...bahtOf(price, store, offer.store_commission_baht ?? offer.commission_baht), color: OFFER_COLORS.store },
    { key: 'shopee', label: 'Shopee', percent: shopee, ...bahtOf(price, shopee, offer.shopee_commission_baht), color: OFFER_COLORS.shopee },
    { key: 'xtra', label: 'Xtra', percent: xtra, ...bahtOf(price, xtra, null), color: OFFER_COLORS.xtra },
  ];
  const totalPercent = parts.reduce((s, p) => s + (p.percent || 0), 0);
  const totalBaht = parts.reduce((s, p) => s + (p.value || 0), 0);
  return { price, parts, totalPercent, totalBaht };
}

function offerView(result, snap, history, suggestions) {
  const offer = result.offer || {};
  const { price, parts, totalPercent, totalBaht } = commissionParts(offer, snap);
  const excluded = Boolean(offer.excluded_category) || (offer.warnings || []).includes('excluded_category');
  const missingSplit = parts.every((p) => p.percent == null || p.key === 'store');
  const segs = parts.map((p) => ({ key: p.key, label: p.label, value: p.percent || 0, color: p.color, text: p.percent ? `${pct(p.percent)} · ${baht(p.value)}` : '' }));

  const box = h('div', { class: 'stack-v', id: 'offer-result', dataset: { item: offer.item_id || '', source: result.source || '', excluded: excluded ? '1' : '0' } });
  if (excluded) {
    box.append(notice('bad', 'alert', h('strong', null, 'หมวดนี้ไม่ได้ค่าคอม (excluded)'),
      h('div', null, `ตรงกับหมวดต้องห้าม: ${offer.excluded_match || offer.category || '–'}. อย่าโพสต์สินค้านี้เพื่อหวังค่าคอม`),
      offer.citation ? h('div', { class: 'cite' }, 'แหล่งอ้างอิง: ', h('code', null, String(offer.citation).replace(/^https?:\/\//, '')), copyButton(offer.citation, 'คัดลอกลิงก์')) : null));
  }
  box.append(card(snap?.title || `สินค้า #${offer.item_id}`, 'percent',
    h('div', { class: 'offer-head' },
      h('div', null, h('span', { class: 'muted' }, 'ราคา'), h('strong', { class: 'big', id: 'offer-price' }, baht(price))),
      h('div', null, h('span', { class: 'muted' }, 'ค่าคอมรวม'), h('strong', { class: 'big accent', id: 'offer-total' }, `${pct(totalPercent)} · ${baht(totalBaht)}`)),
      h('div', { class: 'offer-badges' },
        badge(result.source === 'cdp' ? 'ดึงสดจาก Chrome' : 'จากแคช', result.source === 'cdp' ? 'warn' : 'neutral', result.source === 'cdp' ? 'plug' : 'clock'),
        result.as_of ? badge(`ข้อมูล ณ ${thaiDateTime(result.as_of)}`, 'neutral', 'clock') : null,
        offer.stock_available === false ? badge('ของหมด', 'bad') : null,
        snap?.official ? badge('ร้านทางการ', 'ok') : null)),
    stackedBar(segs.length ? segs : [{ label: '-', value: 1, color: '#e2e8f0' }], { height: 44 }),
    h('div', { class: 'legend legend-big', id: 'offer-legend' }, parts.map((p) => h('span', { class: 'legend-item', dataset: { part: p.key } },
      h('span', { class: 'swatch', style: { background: p.color } }),
      h('b', null, p.label), ' ', h('span', null, p.percent == null ? 'ไม่มีข้อมูล' : `${pct(p.percent)} = ${baht(p.value)}${p.computed ? ' (คำนวณ)' : ''}`)))),
    missingSplit ? h('p', { class: 'muted small' }, 'แคชของ get_offer มีแต่ค่าคอมร้านค้า ส่วน Shopee/Xtra อ่านจาก snapshot ล่าสุด (ถ้ามี)') : null));

  if (history && history.length > 1) {
    box.append(card('ราคาย้อนหลัง', 'chart', h('div', { class: 'row' }, sparkline(history.map((p) => p.price || 0), { width: 220, height: 48 }),
      h('span', { class: 'muted' }, `${history.length} จุด · ${baht(history[0].price)} → ${baht(history[history.length - 1].price)}`))));
  }
  if (suggestions && suggestions.length > 0) {
    box.append(card(excluded ? 'สินค้าแทนที่แนะนำ' : 'สินค้าใกล้เคียงที่ค่าคอมดี', 'box',
      h('div', { class: 'cards-mini', id: 'suggestions' }, suggestions.slice(0, 3).map((s) => h('button', { class: 'mini-card', type: 'button', dataset: { item: s.item_id }, onclick: () => window.dispatchEvent(new CustomEvent('shopkud:offer-pick', { detail: s.item_id })) },
        h('strong', null, s.title || `#${s.item_id}`), h('span', null, `${pct(s.rate)} · ${baht(s.price)}`),
        h('small', { class: 'muted' }, String(s.reason || '').split(',').filter(Boolean).map((r) => REASON_TH[r] || r).join(' · ')))))));
  }
  return box;
}

export async function render(ctx) {
  const root = h('div', { class: 'page', id: 'page-offers' });
  root.append(pageHeader('ค่าคอมสินค้า', 'ค่าคอมแยกเป็นร้านค้า / Shopee / Xtra เป็น % และบาท', 'percent'));

  const input = h('input', { class: 'input', id: 'offer-item-id', inputmode: 'numeric', placeholder: 'รหัสสินค้า (item id) เช่น 111', autocomplete: 'off', 'aria-label': 'item id' });
  const go = h('button', { class: 'btn btn-primary', type: 'button', id: 'offer-go' }, icon('percent', 16), 'ดูค่าคอม');
  const out = h('div', { id: 'offer-out' }, emptyState('ใส่รหัสสินค้า หรือเลือกจากรายการด้านล่าง', null, 'percent'));
  const list = h('div', { id: 'offer-list' });
  let known = [];

  async function lookup(itemId) {
    const id = itemId.trim();
    if (!/^\d{1,20}$/.test(id)) { put(out, notice('bad', 'x', 'item id ต้องเป็นตัวเลข')); return; }
    const cached = known.find((row) => row.item_id === id);
    const fresh = cached && (Date.now() - Date.parse(cached.as_of)) / 60000 < CACHE_MINUTES;
    if (!fresh) {
      const ok = await confirmDialog({
        title: 'ข้อมูลเก่าหรือยังไม่มี', tone: 'warn', iconName: 'plug', confirmLabel: 'เปิดหน้า 1 หน้า',
        body: h('p', null, 'ต้องให้ ShopKud เปิดหน้าสินค้าใน Chrome 1 หน้าเพื่ออ่านค่าคอม (นับเป็น page load) ทำต่อไหม?'),
        details: [['สินค้า', `#${id}`], ['แคช', cached ? `เก่า (${relTime(cached.as_of)})` : 'ไม่มี']],
      });
      if (!ok) { put(out, emptyState('ยกเลิกแล้ว ไม่ได้เปิดหน้า Shopee', null, 'shield')); return; }
    }
    put(out, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'กำลังอ่านค่าคอม...'));
    const result = await callTool('get_offer', { item_id: id });
    if (result.ok === false) { put(out, errorState({ ...result, message: errorText(result) }, () => lookup(id))); return; }
    const [histRes, suggestRes] = await Promise.all([callTool('price_history', { item_id: id }), callTool('suggest_replacement', { item_id: id, k: 3 })]);
    const snap = known.find((row) => row.item_id === id) || null;
    put(out, offerView(result, snap, histRes.points, suggestRes.candidates));
  }

  function paintList() {
    clear(list);
    if (known.length === 0) { list.append(emptyState('ยังไม่มี snapshot ค่าคอม', null, 'box')); return; }
    list.append(h('div', { class: 'table-wrap' }, h('table', { class: 'table', id: 'offers-table' },
      h('thead', null, h('tr', null, ['สินค้า', 'ราคา', 'ร้าน', 'Shopee', 'Xtra', 'สถานะ', ''].map((t) => h('th', null, t)))),
      h('tbody', null, known.map((row) => h('tr', { dataset: { item: row.item_id, excluded: row.excluded_category ? '1' : '0' } },
        h('td', null, h('strong', null, row.title || `#${row.item_id}`), h('div', { class: 'muted small' }, `#${row.item_id} · ${row.category || '–'}`)),
        h('td', null, baht(row.price)),
        h('td', null, pct(row.store_rate)), h('td', null, pct(row.shopee_rate)), h('td', null, pct(row.xtra_rate)),
        h('td', null, row.excluded_category ? badge('หมวดไม่ได้ค่าคอม', 'bad', 'alert') : (row.stock === 0 ? badge('ของหมด', 'warn') : badge('ปกติ', 'ok', 'check'))),
        h('td', null, h('button', { class: 'btn btn-small', type: 'button', dataset: { pick: row.item_id }, onclick: () => pick(row.item_id) }, 'ดู')))))))); 
  }
  function pick(id) { input.value = id; lookup(id); out.scrollIntoView({ block: 'nearest' }); }

  go.addEventListener('click', () => lookup(input.value));
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') lookup(input.value); });
  const onPick = (event) => pick(String(event.detail));
  window.addEventListener('shopkud:offer-pick', onPick);

  root.append(card('ค้นหาสินค้า', 'tag', h('div', { class: 'row' }, input, go)), out,
    card(`สินค้าที่มี snapshot (${'จากแคช'})`, 'list', list));
  const exportRes = await getExport('offers');
  if (exportRes.ok === false) put(list, errorState(exportRes, () => location.reload()));
  else { known = exportRes.rows || []; paintList(); }
  return { element: root, cleanup: () => window.removeEventListener('shopkud:offer-pick', onPick) };
}

export { num };
