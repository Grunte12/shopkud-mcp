import { h, icon, put } from '../dom.js';
import { card, pageHeader, badge, dot, gauge, notice, errorState, emptyState, kpi } from '../components.js';
import { callTool, getExport, callMany } from '../api.js';
import { CHANNELS, CHANNEL_LABEL } from '../subid.js';
import { relTime, thaiDateTime, num, dayKey } from '../format.js';

const STEP_TH = {
  database: ['ฐานข้อมูล', 'database'],
  chrome: ['Chrome (CDP)', 'plug'],
  session: ['ล็อกอิน Shopee', 'user'],
  links: ['มีลิงก์ในระบบ', 'link'],
  offers: ['มีข้อมูลค่าคอม', 'percent'],
  conversions: ['มีรายงานออเดอร์', 'chart'],
};

function statusTile({ id, tone, iconName, title, headline, detail, action }) {
  return h('div', { class: `tile tile-${tone}`, id, dataset: { tone } },
    h('div', { class: 'tile-top' }, h('span', { class: 'tile-icon' }, icon(iconName, 26)), dot(tone)),
    h('span', { class: 'tile-title' }, title),
    h('strong', { class: 'tile-headline' }, headline),
    detail ? h('p', { class: 'tile-detail' }, detail) : null,
    action || null);
}

function stopGuide(job, chromeUp) {
  if (job) {
    return h('div', { class: 'stop-guide', id: 'stop-guide' },
      h('h4', null, icon('hand', 18), 'ต้องทำอะไรต่อ'),
      h('ol', { class: 'steps' },
        h('li', null, h('span', { class: 'step-ic' }, icon('eye', 16)), 'เปิดหน้าต่าง Chrome ที่ ShopKud ใช้ แล้วดูหน้า Shopee ที่ค้างอยู่'),
        h('li', null, h('span', { class: 'step-ic' }, icon('hand', 16)), 'แก้ CAPTCHA ด้วยมือเอง (ShopKud ไม่แก้ให้ ไม่คลิกแทน)'),
        h('li', null, h('span', { class: 'step-ic' }, icon('play', 16)), 'กลับมาที่หน้า "ขั้นตอนงาน" แล้วกด Resume เมื่อมีปุ่มพร้อม'),
        h('li', null, h('span', { class: 'step-ic' }, icon('clock', 16)), 'พักสัก 30–60 นาทีก่อนทำต่อ เพื่อลดโอกาสโดนเช็กซ้ำ')));
  }
  if (!chromeUp) {
    return h('div', { class: 'stop-guide', id: 'stop-guide' },
      h('h4', null, icon('plug', 18), 'ต้องทำอะไรต่อ'),
      h('ol', { class: 'steps' },
        h('li', null, h('span', { class: 'step-ic' }, icon('plug', 16)), 'เปิด Chrome ของ ShopKud ที่เปิดพอร์ต debug ไว้'),
        h('li', null, h('span', { class: 'step-ic' }, icon('user', 16)), 'ล็อกอิน Shopee Affiliate ใน Chrome ตัวนั้น'),
        h('li', null, h('span', { class: 'step-ic' }, icon('refresh', 16)), 'กลับมากด "รีเฟรช" ที่หน้านี้')));
  }
  return null;
}

export async function render(ctx) {
  const root = h('div', { class: 'page', id: 'page-overview' });
  const refreshBtn = h('button', { class: 'btn', type: 'button', id: 'refresh' }, icon('refresh', 16), 'รีเฟรช');
  root.append(pageHeader('ภาพรวมระบบ', 'ดูว่าทุกอย่างพร้อมทำงานหรือยัง', 'home', refreshBtn));
  const body = h('div', { class: 'stack-v' });
  root.append(body);

  async function load() {
    put(body, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'กำลังตรวจสถานะ...'));
    const [setup, conn] = await callMany([['setup_status', {}], ['get_connection_status', {}]]);
    if (setup.ok === false) { put(body, errorState(setup, load)); return; }
    const [conversions, ...budgets] = await Promise.all([
      getExport('conversions'),
      ...CHANNELS.map((channel) => callTool('posting_budget', { platform: channel })),
    ]);
    window.dispatchEvent(new Event('shopkud:refresh-pill'));

    const steps = Object.fromEntries((setup.steps || []).map((s) => [s.key, s]));
    const chromeUp = steps.chrome?.state === 'done';
    const loggedIn = steps.session?.state === 'done';
    const jobs = conn.ok === false ? [] : (conn.queued_jobs || []);
    const stopped = jobs.find((job) => job.status === 'captcha_stopped') || null;
    const running = jobs.filter((job) => job.status === 'running').length;
    const pending = jobs.filter((job) => job.status === 'pending').length;
    const sessionOpen = conn.ok !== false && conn.chrome_connected;

    const tiles = h('div', { class: 'tiles' },
      statusTile({
        id: 'tile-chrome', tone: chromeUp ? 'ok' : 'bad', iconName: 'plug', title: 'Chrome / CDP',
        headline: chromeUp ? 'เชื่อมต่อได้' : 'ติดต่อ Chrome ไม่ได้',
        detail: chromeUp
          ? `พอร์ต ${steps.chrome.port ?? '?'} ตอบสนอง · แท็บของ ShopKud: ${sessionOpen ? 'เปิดอยู่' : 'ปิด (เปิดเมื่อใช้งานเท่านั้น)'}`
          : 'ShopKud ยังไม่เห็นหน้าต่าง Chrome ที่เปิดพอร์ต debug',
      }),
      statusTile({
        id: 'tile-login', tone: loggedIn ? 'ok' : 'warn', iconName: 'user', title: 'ล็อกอิน Shopee',
        headline: loggedIn ? 'ล็อกอินแล้ว' : 'ยังไม่ยืนยัน',
        detail: loggedIn ? 'พบ account marker จากรอบดึงรายงานล่าสุด' : 'ล็อกอินใน Chrome แล้วดึงรายงานออเดอร์ 1 ครั้ง ระบบจะจำ marker ให้',
      }),
      statusTile({
        id: 'tile-queue', tone: stopped ? 'bad' : (running + pending > 0 ? 'info' : 'ok'), iconName: 'list', title: 'คิวงาน',
        headline: stopped ? 'หยุดรอคนแก้' : running + pending > 0 ? `${running + pending} งานรอ/กำลังทำ` : 'คิวว่าง',
        detail: `กำลังทำ ${running} · รอ ${pending} · หยุด CAPTCHA ${jobs.filter((j) => j.status === 'captcha_stopped').length}`,
      }),
      statusTile({
        id: 'tile-stop', tone: stopped ? 'bad' : 'ok', iconName: stopped ? 'hand' : 'shield', title: 'เหตุผลที่หยุดล่าสุด',
        headline: stopped ? 'ติด CAPTCHA' : 'ไม่มีการหยุด',
        detail: stopped
          ? `งาน ${stopped.type} เริ่ม ${relTime(stopped.created_at)} ถูกหยุดเพราะ Shopee ขอให้ยืนยันตัวตน`
          : 'ไม่มีงานที่ถูกหยุดด้วย CAPTCHA ในคิวตอนนี้',
      }));

    const guide = stopGuide(stopped, chromeUp);
    const alertBox = stopped
      ? notice('bad', 'hand', h('strong', null, 'หยุดที่ CAPTCHA: '), 'ShopKud หยุดรอ ไม่พยายามข้าม กรุณาแก้ด้วยมือก่อน')
      : (!chromeUp ? notice('warn', 'plug', h('strong', null, 'Chrome ยังไม่พร้อม: '), 'งานที่ต้องเปิดหน้า Shopee จะยังทำไม่ได้ แต่ดูข้อมูลที่เก็บไว้ได้ตามปกติ') : null);

    const pageLoads = setup.page_loads ?? 0;
    const loadCard = card('การเปิดหน้า Shopee วันนี้', 'cart',
      gauge({ value: pageLoads, max: null, label: 'page loads วันนี้', unit: '' }),
      h('p', { class: 'muted small', id: 'page-load-note' }, 'เพดาน (cap) ของ page load ยังไม่มีใน API จึงแสดงเฉพาะจำนวน · setup_status ตอบ 0 เสมอ'),
      badge('ไม่เปิดหน้าเอง ตอนนี้ 0 หน้า', 'neutral', 'shield'));

    const rowsRaw = conversions.ok === false ? [] : (conversions.rows || []);
    const days = rowsRaw.map((row) => row.purchased_on).filter(Boolean).sort();
    const latestDay = days[days.length - 1] || null;
    const ageDays = latestDay ? Math.round((Date.parse(`${dayKey()}T00:00:00Z`) - Date.parse(`${latestDay}T00:00:00Z`)) / 86_400_000) : null;
    const syncTone = ageDays === null ? 'idle' : ageDays <= 1 ? 'ok' : ageDays <= 3 ? 'warn' : 'bad';
    const syncCard = card('รายงานออเดอร์ล่าสุด', 'clock',
      h('div', { class: 'sync', id: 'sync-card', dataset: { tone: syncTone } },
        dot(syncTone),
        h('div', null,
          h('strong', { class: 'big' }, latestDay ? `ออเดอร์ล่าสุด ${latestDay}` : 'ยังไม่มีรายงาน'),
          h('p', { class: 'muted' }, `${num(setup.counts?.conversions)} แถวในฐานข้อมูล${ageDays !== null ? ` · ห่างจากวันนี้ ${ageDays} วัน` : ''}`))),
      h('p', { class: 'muted small' }, 'เวลาที่ดึงรายงาน (as_of) ยังไม่มีใน API จึงใช้วันของออเดอร์ล่าสุดแทน'));

    const budgetCard = card('โควต้าโพสต์วันนี้', 'send',
      h('div', { class: 'gauges', id: 'budgets' }, budgets.map((b, i) => (b.ok === false
        ? h('span', { class: 'muted' }, CHANNELS[i])
        : gauge({ value: b.today, max: b.cap, label: CHANNEL_LABEL[CHANNELS[i]], unit: '' })))),
      h('p', { class: 'muted small' }, 'นับลิงก์ที่สร้างวันนี้ เทียบเพดานที่ตั้งเอง (ไม่ใช่กฎของ Shopee)'));

    const checklist = card('เช็กลิสต์เริ่มใช้งาน', 'check',
      h('ul', { class: 'checklist', id: 'checklist' }, (setup.steps || []).map((step) => {
        const [label, iconName] = STEP_TH[step.key] || [step.key, 'info'];
        const tone = step.state === 'done' ? 'ok' : step.state === 'skipped' ? 'idle' : 'warn';
        return h('li', { class: `check-item check-${tone}`, dataset: { step: step.key, state: step.state } },
          h('span', { class: 'check-ic' }, icon(step.state === 'done' ? 'check' : iconName, 16)),
          h('span', { class: 'check-label' }, label),
          h('small', { class: 'muted' }, step.detail || ''),
          badge(step.state === 'done' ? 'พร้อม' : step.state === 'skipped' ? 'ข้าม' : 'ยังไม่พร้อม', tone === 'ok' ? 'ok' : tone === 'idle' ? 'neutral' : 'warn'));
      })));

    const counts = setup.counts || {};
    const mini = h('div', { class: 'kpis' },
      kpi({ label: 'ลิงก์', value: num(counts.links), iconName: 'link', tone: 'blue' }),
      kpi({ label: 'สินค้า', value: num(counts.products), iconName: 'box', tone: 'orange' }),
      kpi({ label: 'Offer snapshot', value: num(counts.snapshots), iconName: 'percent', tone: 'green' }),
      kpi({ label: 'แถวออเดอร์', value: num(counts.conversions), iconName: 'chart', tone: 'pink' }));

    put(body, 
      alertBox, tiles, guide ? card(null, null, guide) : null, mini,
      h('div', { class: 'grid-2' }, loadCard, syncCard),
      h('div', { class: 'grid-2' }, budgetCard, checklist),
      h('p', { class: 'muted small' }, `ข้อมูล ณ ${thaiDateTime(setup.as_of)} · ข้อมูลทั้งหมดอ่านจาก setup_status และ get_connection_status`));
    if (jobs.length === 0 && counts.links === 0) body.append(emptyState('ยังไม่มีข้อมูล', 'เริ่มจากสร้างลิงก์แรกในหน้า "ลิงก์"', 'link'));
  }

  refreshBtn.addEventListener('click', load);
  await load();
  return { element: root };
}
