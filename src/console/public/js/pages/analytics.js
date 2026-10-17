import { h, icon, clear, put } from '../dom.js';
import {
  card, pageHeader, kpi, badge, notice, errorState, emptyState, segmented, chip, chipRow, confirmDialog, toast, errorText,
} from '../components.js';
import { callTool, getExport, callMany } from '../api.js';
import { timeSeries, hbars, donut, sankey } from '../charts.js';
import { SLOTS, DIM_LABEL, UNTRACKED_COLOR, slotForDim, splitUtm } from '../subid.js';
import { baht, bahtShort, num, pct, share, dayKey, addDays, thaiDate, thaiDateTime, monthLabel } from '../format.js';

const DIMS = ['sub_id', 'platform', 'product', 'clip', 'variant', 'month'];
const METRICS = [
  { value: 'orders', label: 'ออเดอร์', color: '#2563eb', fmt: num },
  { value: 'gmv', label: 'ยอดขาย GMV', color: '#0891b2', fmt: bahtShort },
  { value: 'commission', label: 'ค่าคอม', color: '#16a34a', fmt: bahtShort },
  { value: 'cancelled', label: 'ยกเลิก', color: '#dc2626', fmt: num },
];

const CANCEL = {
  self_or_household_purchase: { th: 'ซื้อเอง / คนในบ้านซื้อ', todo: 'Shopee ไม่นับค่าคอมการซื้อของตัวเอง — อย่ากดลิงก์ตัวเองเพื่อซื้อ', icon: 'user' },
  buyer_clicked_another_link: { th: 'ผู้ซื้อกดลิงก์ของคนอื่นทีหลัง', todo: 'ค่าคอมไปที่ลิงก์สุดท้ายที่กด — ทำคลิปให้ปิดการขายเร็วขึ้น', icon: 'cursor' },
  excluded_category: { th: 'สินค้าอยู่ในหมวดที่ไม่ได้ค่าคอม', todo: 'เช็กหมวดที่หน้า "ค่าคอม" ก่อนโพสต์ทุกครั้ง', icon: 'alert' },
  indirect_order: { th: 'ออเดอร์ทางอ้อม (ผู้ซื้อซื้อสินค้าอื่นในร้าน)', todo: 'ค่าคอมของสินค้าที่ซื้อจริงอาจต่ำกว่าที่โปรโมต', icon: 'box' },
  shop_cancel: { th: 'ร้านค้ายกเลิกออเดอร์', todo: 'เลือกร้านที่ส่งของเร็วและมีของพอ', icon: 'box' },
  voucher_fully_paid: { th: 'ใช้โค้ดส่วนลดจนจ่ายเป็น 0', todo: 'ค่าคอมคิดจากยอดที่จ่ายจริง จึงเป็น 0', icon: 'tag' },
  payment_failed: { th: 'ชำระเงินไม่สำเร็จ', todo: 'ไม่ต้องทำอะไร — ผู้ซื้อจ่ายไม่ผ่าน', icon: 'x' },
  order_cancelled_or_returned: { th: 'ผู้ซื้อยกเลิกหรือคืนสินค้า', todo: 'ปกติ ดูอัตราคืน ถ้าสูงผิดปกติให้ลองเปลี่ยนสินค้า', icon: 'refresh' },
  zero_commission_unclassified: { th: 'ค่าคอม 0 บาท แต่ไม่รู้สาเหตุ', todo: 'ข้อมูลไม่พอจะจัดกลุ่ม — เก็บไว้ดูต่อ', icon: 'help' },
  unknown: { th: 'ไม่ทราบสาเหตุ', todo: 'ข้อมูลไม่พอจะอธิบาย', icon: 'help' },
};

const HEALTH = {
  dropped: { th: 'ค่าคอมลดลง', tone: 'warn', icon: 'alert' },
  removed: { th: 'ค่าคอมหาย', tone: 'bad', icon: 'x' },
  oos: { th: 'ของหมด', tone: 'bad', icon: 'box' },
};

function sumRows(rows, key) {
  return rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
}

function bucketKeyNode(dim, key) {
  if (key === '(none)') return h('span', { class: 'badge badge-untracked' }, icon('alert', 13), 'ไม่มี Sub ID');
  if (dim === 'sub_id') return chipRow(splitUtm(key), { size: 'sm' });
  const slot = slotForDim(dim);
  return slot ? chip(key, slot.n - 1, { size: 'sm' }) : h('span', null, key);
}

function dimView(buckets, dim, metric) {
  const m = METRICS.find((x) => x.value === metric);
  const slot = slotForDim(dim);
  const sorted = [...buckets].sort((a, b) => (b[metric] || 0) - (a[metric] || 0)).slice(0, 12);
  const rows = sorted.map((b) => ({
    key: b.key, value: b[metric] || 0, color: b.key === '(none)' ? UNTRACKED_COLOR : (slot ? slot.color : '#64748b'),
    untracked: b.key === '(none)',
    node: bucketKeyNode(dim, b.key),
  }));
  return h('div', { id: 'dim-view', dataset: { dim } },
    hbars(rows, { formatValue: m.fmt, empty: 'ไม่มีออเดอร์ในช่วงนี้' }),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table table-tight', id: 'dim-table' },
      h('thead', null, h('tr', null, ['กลุ่ม', 'ออเดอร์', 'GMV', 'ค่าคอม', 'ยกเลิก'].map((t) => h('th', null, t)))),
      h('tbody', null, sorted.map((b) => h('tr', { dataset: { key: b.key } },
        h('td', null, bucketKeyNode(dim, b.key)), h('td', null, num(b.orders)), h('td', null, baht(b.gmv)), h('td', null, baht(b.commission)), h('td', null, num(b.cancelled))))))));
}

function dailySeries(rows, metric, from, to) {
  const map = new Map();
  for (const r of rows) map.set(r.purchased_on, (map.get(r.purchased_on) || 0) + (Number(r[metric]) || 0));
  const points = [];
  for (let d = from; d <= to; d = addDays(d, 1)) points.push({ day: d, value: Math.round((map.get(d) || 0) * 100) / 100 });
  return points;
}

function sankeyView(rows) {
  const clipTotals = new Map();
  for (const r of rows) {
    const c = r.sub_id3 || '(none)';
    clipTotals.set(c, (clipTotals.get(c) || 0) + (Number(r.orders) || 0));
  }
  const topClips = new Set([...clipTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k));
  const platCol = new Map();
  const clipCol = new Map();
  const pc = new Map();
  const co = new Map();
  for (const r of rows) {
    const plat = r.sub_id1 || '(none)';
    const clipRaw = r.sub_id3 || '(none)';
    const clip = topClips.has(clipRaw) ? clipRaw : 'อื่น ๆ';
    const orders = Number(r.orders) || 0;
    const cancelled = Math.min(orders, Number(r.cancelled) || 0);
    platCol.set(plat, true);
    clipCol.set(clip, true);
    pc.set(`${plat}|${clip}`, (pc.get(`${plat}|${clip}`) || 0) + orders);
    co.set(`${clip}|ok`, (co.get(`${clip}|ok`) || 0) + (orders - cancelled));
    co.set(`${clip}|cancel`, (co.get(`${clip}|cancel`) || 0) + cancelled);
  }
  if (pc.size === 0) return emptyState('ยังไม่มีออเดอร์ในช่วงนี้', null, 'chart');
  const platColor = (p) => (p === '(none)' ? UNTRACKED_COLOR : SLOTS[0].color);
  const clipColor = (c) => (c === '(none)' ? UNTRACKED_COLOR : c === 'อื่น ๆ' ? '#94a3b8' : SLOTS[2].color);
  const columns = [
    [...platCol.keys()].sort().map((p) => ({ id: `p:${p}`, label: p === '(none)' ? 'ไม่มี Sub ID' : p, color: platColor(p) })),
    [...clipCol.keys()].sort().map((c) => ({ id: `c:${c}`, label: c === '(none)' ? 'ไม่มีคลิป' : c, color: clipColor(c) })),
    [{ id: 'o:ok', label: 'ออเดอร์สำเร็จ', color: '#16a34a' }, { id: 'o:cancel', label: 'ยกเลิก', color: '#dc2626' }],
  ];
  const links = [];
  for (const [key, value] of pc) {
    const [p, c] = key.split('|');
    if (value > 0) links.push({ from: `p:${p}`, to: `c:${c}`, value, color: platColor(p), untracked: p === '(none)' || c === '(none)', fromLabel: p, toLabel: c });
  }
  for (const [key, value] of co) {
    const [c, o] = key.split('|');
    if (value > 0) links.push({ from: `c:${c}`, to: `o:${o}`, value, color: o === 'ok' ? '#16a34a' : '#dc2626', untracked: c === '(none)', fromLabel: c, toLabel: o === 'ok' ? 'สำเร็จ' : 'ยกเลิก' });
  }
  return sankey(columns, links, { labels: ['แพลตฟอร์ม (s1)', 'คลิป (s3)', 'ผลออเดอร์'], height: 320 });
}

function untrackedView(buckets, rows) {
  const total = sumRows(buckets, 'orders');
  const none = buckets.find((b) => b.key === '(none)');
  const untracked = none ? none.orders : 0;
  const percent = share(untracked, total);
  const tone = percent === 0 ? 'ok' : percent < 10 ? 'warn' : 'bad';
  const slotGaps = SLOTS.map((slot) => {
    const missing = rows.filter((r) => !r[slot.key]).reduce((s, r) => s + (Number(r.orders) || 0), 0);
    return { key: `s${slot.n}`, value: share(missing, total), color: slot.color, node: h('span', { class: 'inline-ic' }, chip('', slot.n - 1, { size: 'sm' }), slot.th) };
  });
  return h('div', { class: `untracked untracked-${tone}`, id: 'untracked', dataset: { tone, percent: percent.toFixed(1) } },
    donut({
      parts: [{ label: 'ไม่มี Sub ID', value: untracked, color: UNTRACKED_COLOR }, { label: 'มี Sub ID', value: Math.max(0, total - untracked), color: '#16a34a' }],
      centerTop: pct(percent), centerBottom: 'ไม่มี Sub ID', size: 190,
    }),
    h('div', { class: 'untracked-text' },
      h('h4', null, icon('alert', 20), 'ออเดอร์ที่ "ไม่มี Sub ID"'),
      h('p', { class: 'big-number' }, h('b', { id: 'untracked-orders' }, num(untracked)), ` จาก ${num(total)} ออเดอร์`),
      h('p', null, percent === 0 ? 'ดีมาก ทุกออเดอร์มีชิปครบ' : 'ออเดอร์เหล่านี้บอกไม่ได้ว่ามาจากคลิปหรือแพลตฟอร์มไหน จึงเอาไปวิเคราะห์ไม่ได้ ตรวจว่าลิงก์ที่โพสต์ติด Sub ID หรือยัง'),
      h('div', { class: 'gap-bars' }, h('small', { class: 'muted' }, 'สัดส่วนออเดอร์ที่ช่องนั้นว่าง'), hbars(slotGaps, { formatValue: (v) => pct(v) }))));
}

function cancellationView(res) {
  if (res.ok === false) return errorState(res);
  const list = res.classifications || [];
  if (list.length === 0) return emptyState('ไม่มีออเดอร์ให้อธิบาย', null, 'check');
  return h('div', { class: 'cancel-list', id: 'cancel-list' }, list.sort((a, b) => b.count - a.count).map((c) => {
    const info = CANCEL[c.likely_reason] || { th: c.likely_reason, todo: '', icon: 'help' };
    return h('div', { class: 'cancel-item', dataset: { reason: c.likely_reason } },
      h('span', { class: 'cancel-ic' }, icon(info.icon, 20)),
      h('div', { class: 'cancel-main' }, h('strong', null, info.th), h('p', { class: 'muted' }, info.todo)),
      h('div', { class: 'cancel-num' }, h('b', null, `${num(c.count)} ออเดอร์`), h('small', { class: 'muted' }, `ค่าคอม ${baht(c.commission)} · มั่นใจ ${Math.round(Number(c.confidence) * 100)}%`)));
  }));
}

function earningsView(res) {
  if (res.ok === false) return errorState(res);
  const none = res.source === 'none';
  return h('div', { id: 'earnings' },
    h('div', { class: 'kpis' },
      kpi({ label: 'รอยืนยัน (pending)', value: baht(res.pending), iconName: 'clock', tone: 'orange' }),
      kpi({ label: 'ยืนยันแล้ว (validated)', value: baht(res.validated), iconName: 'check', tone: 'blue' }),
      kpi({ label: 'จ่ายแล้ว (paid)', value: baht(res.paid), iconName: 'coin', tone: 'green' }),
      kpi({ label: 'จ่ายรอบถัดไป', value: res.next_payout ? thaiDate(res.next_payout) : '–', iconName: 'send', tone: 'pink', sub: `KYC: ${res.kyc_status || 'unknown'}` })),
    (res.expiring || []).length > 0 ? notice('warn', 'alert', h('strong', null, 'ยอดค้างนานแล้ว: '), `ยอดที่ยังไม่จ่ายค้างมา ${res.expiring[0].age_days} วัน อาจใกล้หมดอายุ (เป็นข้อสันนิษฐาน ยังไม่ยืนยันกับ Shopee)`) : null,
    none ? h('p', { class: 'muted small' }, 'ยังไม่มี snapshot รายได้ในฐานข้อมูล') : h('p', { class: 'muted small' }, `snapshot ณ ${thaiDateTime(res.as_of)}`));
}

function alertsView(alerts, onCheck, { offers = new Map(), checked = new Map() } = {}) {
  const latest = new Map();
  for (const a of alerts) if (!latest.has(a.item_id)) latest.set(a.item_id, a);
  const items = [...latest.values()];
  return h('div', { id: 'alerts' },
    h('div', { class: 'row' }, h('button', { class: 'btn btn-small', type: 'button', id: 'run-health', onclick: onCheck }, icon('refresh', 14), 'ตรวจค่าคอมใหม่'), h('span', { class: 'muted small' }, 'เทียบ snapshot ล่าสุดกับครั้งก่อน และบันทึกเตือนในเครื่อง')),
    items.length === 0 ? emptyState('ไม่มีเตือนค่าคอม', 'ค่าคอมทุกสินค้ายังปกติ', 'check')
      : h('div', { class: 'alert-cards' }, items.map((a) => {
        const info = HEALTH[a.status] || { th: a.status, tone: 'neutral', icon: 'info' };
        const result = checked.get(a.item_id);
        const now = offers.get(a.item_id);
        let line;
        if (a.status === 'dropped') {
          line = result && result.old_rate != null ? `ค่าคอมลดจาก ${pct(result.old_rate)} เหลือ ${pct(result.new_rate)}` : `ค่าคอมลดลง${now ? ` · ตอนนี้ ${pct(now.store_rate)}` : ''}`;
        } else if (a.status === 'removed') line = 'ค่าคอมเป็น 0 หรือหายไป';
        else line = 'สต็อกหมด ลูกค้าสั่งซื้อไม่ได้';
        return h('div', { class: `alert-card alert-${info.tone}`, dataset: { item: a.item_id, status: a.status } },
          h('span', { class: 'alert-ic' }, icon(info.icon, 22)),
          h('div', null, h('strong', null, now?.title ? `${now.title} (#${a.item_id})` : `สินค้า #${a.item_id}`), h('p', null, line),
            h('small', { class: 'muted' }, thaiDateTime(a.at))),
          badge(info.th, info.tone));
      })));
}

export async function render(ctx) {
  const root = h('div', { class: 'page', id: 'page-analytics' });
  const today = dayKey();
  const state = { range: 30, dim: 'platform', metric: 'orders', seriesMetric: 'orders' };
  root.append(pageHeader('ยอดขายและการวิเคราะห์', 'ดูว่าชิปไหนทำเงิน และอะไรรั่วไหล', 'chart',
    segmented([{ value: '7', label: '7 วัน' }, { value: '30', label: '30 วัน' }, { value: '90', label: '90 วัน' }], '30', (v) => { state.range = Number(v); load(); }, { name: 'range' })));
  const body = h('div', { class: 'stack-v', id: 'analytics-body' });
  root.append(body);

  async function load() {
    const from = addDays(today, -(state.range - 1));
    const to = today;
    put(body, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'กำลังคำนวณ...'));
    const calls = DIMS.map((dim) => ['sales_by', { dim, from, to }]);
    const [results, conv, alertsRes, offersRes, cancel, earnings] = await Promise.all([
      callMany(calls),
      getExport('conversions', { from, to }),
      getExport('alerts'),
      getExport('offers'),
      callTool('explain_cancellations', { from, to }),
      callTool('get_earnings_summary', {}),
    ]);
    const failed = results.find((r) => r.ok === false);
    if (failed) { put(body, errorState(failed, load)); return; }
    const byDim = Object.fromEntries(DIMS.map((dim, i) => [dim, results[i].buckets || []]));
    const rows = conv.ok === false ? [] : (conv.rows || []);
    const all = byDim.sub_id;
    const orders = sumRows(all, 'orders');
    const gmv = sumRows(all, 'gmv');
    const commission = sumRows(all, 'commission');
    const cancelled = sumRows(all, 'cancelled');

    const kpis = h('div', { class: 'kpis', id: 'kpis' },
      kpi({ label: 'ออเดอร์', value: num(orders), iconName: 'cart', tone: 'blue', id: 'kpi-orders', sub: `${state.range} วันล่าสุด` }),
      kpi({ label: 'ยอดขาย GMV', value: baht(gmv, 0), iconName: 'coin', tone: 'cyan', id: 'kpi-gmv' }),
      kpi({ label: 'ค่าคอม', value: baht(commission), iconName: 'percent', tone: 'green', id: 'kpi-commission', sub: gmv > 0 ? `${pct(share(commission, gmv))} ของ GMV` : null }),
      kpi({ label: 'ยกเลิก', value: num(cancelled), iconName: 'x', tone: 'red', id: 'kpi-cancelled', sub: orders > 0 ? `${pct(share(cancelled, orders))} ของออเดอร์` : null }));

    const seriesHost = h('div', { id: 'series-host' });
    const paintSeries = () => {
      const m = METRICS.find((x) => x.value === state.seriesMetric);
      put(seriesHost, timeSeries(dailySeries(rows, state.seriesMetric, from, to), { color: m.color, formatValue: m.fmt }));
    };
    paintSeries();

    const dimHost = h('div', { id: 'dim-host' });
    const paintDim = () => put(dimHost, dimView(byDim[state.dim], state.dim, state.metric));
    paintDim();

    const dimTabs = segmented(DIMS.map((dim) => ({ value: dim, label: DIM_LABEL[dim] })), state.dim, (v) => { state.dim = v; paintDim(); }, { name: 'dim' });
    const metricTabs = segmented(METRICS.map((m) => ({ value: m.value, label: m.label })), state.metric, (v) => { state.metric = v; paintDim(); }, { name: 'metric' });
    const seriesTabs = segmented(METRICS.map((m) => ({ value: m.value, label: m.label })), state.seriesMetric, (v) => { state.seriesMetric = v; paintSeries(); }, { name: 'series' });

    const alerts = (alertsRes.rows || []).filter((a) => a.kind === 'commission_health');
    const alertHost = h('div', { id: 'alerts-host' });
    const offerMap = new Map((offersRes.rows || []).map((row) => [row.item_id, row]));
    const checked = new Map();
    const paintAlerts = (list) => put(alertHost, alertsView(list, runHealth, { offers: offerMap, checked }));
    async function runHealth() {
      const ok = await confirmDialog({
        title: 'ตรวจค่าคอมใหม่?', tone: 'warn', iconName: 'percent', confirmLabel: 'ตรวจ',
        body: h('p', null, 'จะเทียบ snapshot ในเครื่อง (ไม่เปิด Shopee) และบันทึกแถวเตือนใหม่ลงฐานข้อมูลเครื่องนี้'),
      });
      if (!ok) return;
      const res = await callTool('check_commission_health', {});
      if (res.ok === false) { toast(errorText(res), 'bad'); return; }
      for (const row of res.results || []) checked.set(row.item_id, row);
      toast(`ตรวจ ${res.checked_count} สินค้า พบเตือน ${res.alert_count}`, res.alert_count ? 'warn' : 'ok');
      const fresh = await getExport('alerts');
      paintAlerts((fresh.rows || []).filter((a) => a.kind === 'commission_health'));
    }
    paintAlerts(alerts);

    put(body, 
      h('p', { class: 'muted small', id: 'range-note' }, `ช่วง ${from} ถึง ${to} · อ่านจากออเดอร์ที่เก็บไว้ในเครื่อง (ไม่เปิด Shopee)`),
      kpis,
      card('ยอดตามวัน', 'chart', seriesTabs, seriesHost),
      card('ยอดแยกตามชิป', 'tag', h('div', { class: 'seg-stack' }, dimTabs, metricTabs), dimHost),
      card('เส้นทางออเดอร์: แพลตฟอร์ม → คลิป → ผล', 'flow', sankeyView(rows), slotKey()),
      card('ออเดอร์ที่ไม่มี Sub ID (untracked)', 'alert', untrackedView(byDim.sub_id, rows)),
      h('div', { class: 'grid-2' },
        card('เตือนค่าคอม', 'percent', alertHost),
        card('ทำไมถึงยกเลิก / ไม่ได้ค่าคอม', 'x', h('p', { class: 'muted small' }, 'อธิบายจากข้อมูลที่มี ไม่ใช่คำยืนยันจาก Shopee'), cancellationView(cancel))),
      card('สรุปรายได้', 'coin', earningsView(earnings)));
  }

  await load();
  return { element: root };
}

function slotKey() {
  return h('div', { class: 'legend' }, h('span', { class: 'legend-item' }, h('span', { class: 'swatch', style: { background: SLOTS[0].color } }), 'แพลตฟอร์ม (s1)'),
    h('span', { class: 'legend-item' }, h('span', { class: 'swatch', style: { background: SLOTS[2].color } }), 'คลิป (s3)'),
    h('span', { class: 'legend-item' }, h('span', { class: 'swatch', style: { background: UNTRACKED_COLOR } }), 'ไม่มี Sub ID'));
}

export { monthLabel, emptyState };
