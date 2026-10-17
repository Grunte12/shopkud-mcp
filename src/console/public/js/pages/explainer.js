import { h, icon, clear, put } from '../dom.js';
import { card, pageHeader, chipRow, slotLegend, segmented, tip, notice, chip } from '../components.js';
import { SLOTS, UNTRACKED_COLOR, DIM_LABEL, splitUtm } from '../subid.js';

const LINKS = [
  { utm: 'tiktok-P1-v6-a-202610', orders: 3 },
  { utm: 'tiktok-P1-v7-b-202610', orders: 2 },
  { utm: 'ig-P1-v6-a-202610', orders: 1 },
  { utm: 'fb-P2-v8-a-202610', orders: 2 },
  { utm: 'tiktok-P2--a-202610', orders: 1 },
];

const HERO = splitUtm(LINKS[0].utm);

const STAGES = [
  { th: 'สินค้า 1 ชิ้น', cap: 'สินค้าเดียวกัน', icon: 'box' },
  { th: 'ลิงก์หลายเส้น', cap: 'แต่ละเส้นติดชิปต่างกัน', icon: 'link' },
  { th: 'คนกดลิงก์', cap: 'ผู้ซื้อกดลิงก์ TikTok เส้นที่ 1', icon: 'cursor' },
  { th: 'ออเดอร์กลับมา', cap: 'ออเดอร์พกชิปชุดเดิมมาด้วย', icon: 'cart' },
  { th: 'แดชบอร์ดรวมตามชิป', cap: 'รวมยอดตามชิปที่เลือก', icon: 'chart' },
];

function stageBody(index) {
  if (index === 0) {
    return h('div', { class: 'xp-product' }, icon('box', 34), h('b', null, 'P1'));
  }
  if (index === 1) {
    return h('div', { class: 'xp-links' }, LINKS.slice(0, 3).map((link, i) => h('div', { class: `xp-link ${i === 0 ? 'xp-hot' : ''}`, dataset: { link: String(i) } },
      icon('link', 14), chipRow(splitUtm(link.utm), { size: 'sm' }))));
  }
  if (index === 2) {
    return h('div', { class: 'xp-buyer' }, h('span', { class: 'xp-person' }, icon('user', 34)), h('span', { class: 'xp-cursor' }, icon('cursor', 20)),
      h('div', { class: 'xp-link xp-hot' }, icon('link', 14), chipRow(HERO, { size: 'sm' })));
  }
  if (index === 3) {
    return h('div', { class: 'xp-order xp-hot' },
      h('div', { class: 'xp-order-head' }, icon('cart', 16), 'ออเดอร์ #1 · ฿590'),
      chipRow(HERO, { size: 'sm' }),
      h('small', { class: 'muted' }, 'ชิปเหมือนลิงก์ที่กดทุกตัว'));
  }
  return h('div', { class: 'xp-dash' }, h('span', { class: 'xp-dash-ic' }, icon('chart', 30)), h('small', { class: 'muted' }, 'ดูด้านล่าง ↓'));
}

function groupOrders(slotIndex) {
  const groups = new Map();
  for (const link of LINKS) {
    const value = splitUtm(link.utm)[slotIndex];
    const key = value || '';
    groups.set(key, (groups.get(key) || 0) + link.orders);
  }
  return [...groups.entries()].map(([key, orders]) => ({ key, orders })).sort((a, b) => b.orders - a.orders);
}

function dashboard(slotIndex) {
  const slot = SLOTS[slotIndex];
  const rows = groupOrders(slotIndex);
  const max = Math.max(...rows.map((r) => r.orders));
  return h('div', { class: 'xp-dash-table', id: 'xp-dash-table', dataset: { group: slot.dim } },
    rows.map((row) => h('div', { class: `xp-dash-row ${row.key ? '' : 'untracked'}`, dataset: { key: row.key || '(none)' } },
      row.key ? chip(row.key, slotIndex) : h('span', { class: 'badge badge-untracked' }, icon('alert', 13), 'ไม่มีชิป (ช่องว่าง)'),
      h('span', { class: 'hbar-track' }, h('span', { class: 'hbar-fill', style: { width: `${(row.orders / max) * 100}%`, background: row.key ? slot.color : UNTRACKED_COLOR } })),
      h('b', null, `${row.orders} ออเดอร์`))));
}

export async function render() {
  const root = h('div', { class: 'page', id: 'page-subid' });
  const replay = h('button', { class: 'btn btn-primary', type: 'button', id: 'xp-replay' }, icon('play', 16), 'เล่นอีกครั้ง');
  root.append(pageHeader('Sub ID ทำงานยังไง', 'ลิงก์แต่ละเส้นติด "ชิปสี" เพื่อให้รู้ว่าออเดอร์มาจากไหน', 'bulb', replay));

  const flow = h('div', { class: 'xp', id: 'xp', dataset: { step: '0' } });
  const stageEls = STAGES.map((stage, index) => {
    const el = h('button', { class: 'xp-stage', type: 'button', dataset: { stage: String(index + 1) }, 'aria-label': `ขั้น ${index + 1} ${stage.th}` },
      h('span', { class: 'xp-num' }, String(index + 1)),
      h('span', { class: 'xp-title' }, icon(stage.icon, 18), stage.th),
      h('div', { class: 'xp-body' }, stageBody(index)),
      h('small', { class: 'xp-cap' }, stage.cap));
    el.addEventListener('click', () => show(index + 1));
    return el;
  });
  stageEls.forEach((el, index) => {
    flow.append(el);
    if (index < stageEls.length - 1) flow.append(h('span', { class: 'xp-arrow', dataset: { after: String(index + 1) }, 'aria-hidden': 'true' }, h('span', { class: 'xp-token' }), icon('arrow', 18)));
  });

  let timer = null;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function show(step) {
    flow.dataset.step = String(step);
    stageEls.forEach((el, i) => el.classList.toggle('is-on', i < step));
    stageEls.forEach((el, i) => el.classList.toggle('is-current', i === step - 1));
    flow.querySelectorAll('.xp-arrow').forEach((el) => el.classList.toggle('is-on', Number(el.dataset.after) < step));
  }
  function play() {
    clearInterval(timer);
    if (reduce) { show(STAGES.length); return; }
    show(0);
    let step = 0;
    timer = setInterval(() => {
      step += 1;
      show(step);
      if (step >= STAGES.length) clearInterval(timer);
    }, 1000);
  }
  replay.addEventListener('click', play);

  const dashHost = h('div', { id: 'dash-host' });
  let groupIndex = 0;
  const paintDash = () => put(dashHost, dashboard(groupIndex));
  const groupSeg = segmented(SLOTS.map((slot, i) => ({ value: String(i), label: `จัดกลุ่มตาม s${slot.n} ${slot.th}` })), '0', (value) => { groupIndex = Number(value); paintDash(); }, { name: 'group' });
  paintDash();

  const anatomy = h('div', { class: 'anatomy', id: 'anatomy' },
    h('div', { class: 'anatomy-chips' }, SLOTS.map((slot, i) => h('div', { class: 'anatomy-slot', style: { '--chip': slot.color, '--chip-soft': slot.soft } },
      h('span', { class: 'anatomy-n' }, `s${slot.n}`),
      tip(h('span', { class: 'chip chip-lg' }, h('span', { class: 'chip-value' }, slot.example)), slot.tip),
      h('b', null, slot.th),
      h('small', { class: 'muted' }, slot.hint)))),
    h('p', { class: 'muted center' }, 'ต่อกันด้วยขีด ',
      h('code', { id: 'anatomy-utm' }, SLOTS.map((s) => s.example).join('-')), ' → นี่คือสิ่งที่ Shopee ส่งกลับมาพร้อมออเดอร์'));

  const lessons = h('div', { class: 'grid-3' },
    card('1 สินค้า → หลายลิงก์', 'link', h('p', null, 'สินค้าเดียวกัน แต่ทำลิงก์หลายเส้น เส้นละคลิป เส้นละแพลตฟอร์ม')),
    card('ชิปเดินทางไปกลับ', 'cart', h('p', null, 'ชิปติดไปกับลิงก์ และกลับมากับออเดอร์ ไม่ต้องเดา')),
    card('ช่องว่าง = มองไม่เห็น', 'alert', h('p', null, 'ถ้าช่องไหนว่าง ยอดจะไปกองรวมที่ "ไม่มีชิป" แยกไม่ได้ว่ามาจากไหน')));

  root.append(
    card('ดูการเดินทางของ 1 ออเดอร์', 'flow', flow,
      h('div', { class: 'xp-foot' }, slotLegend(), h('span', { class: 'muted small' }, 'ตัวอย่างข้อมูลสมมติ — ไม่ใช่ยอดจริง'))),
    card('ชิป 5 ช่องคืออะไร', 'tag', anatomy),
    card('แดชบอร์ดรวมยอดตามชิป', 'chart',
      h('p', { class: 'muted' }, 'เลือกช่องที่อยากดู ยอดเดียวกันจะถูกจัดกลุ่มใหม่ตามสีของช่องนั้น'),
      groupSeg, dashHost,
      notice('warn', 'alert', h('strong', null, 'ลองดู s3 (คลิป): '), 'มี 1 ออเดอร์มาจากลิงก์ที่ s3 ว่าง → ไปกองที่ "ไม่มีชิป" ทั้งที่จริงมาจาก TikTok')),
    lessons);

  play();
  return { element: root, cleanup: () => clearInterval(timer) };
}

export { DIM_LABEL };
