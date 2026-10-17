import { h, icon, clear, put } from '../dom.js';
import { card, pageHeader, badge, notice, errorState, emptyState, confirmDialog, toast, tip } from '../components.js';
import { callTool, getExport, callMany } from '../api.js';
import { relTime, thaiDateTime, num } from '../format.js';

const STEPS = [
  { id: 'product', th: 'สินค้า', en: 'Product', icon: 'box', page: 'offers', what: 'เลือกสินค้าที่จะโปรโมต แล้วเก็บข้อมูลสินค้าไว้', next: 'เปิดหน้า "ค่าคอม" เพื่อดูสินค้าที่มี' },
  { id: 'offer', th: 'ตรวจ offer', en: 'Offer check', icon: 'percent', page: 'offers', what: 'ดูค่าคอมร้าน/Shopee/Xtra และเช็กหมวดที่ไม่ได้ค่าคอม', next: 'ดูแถบค่าคอมและคำเตือนหมวด excluded' },
  { id: 'create', th: 'สร้างลิงก์', en: 'Create link', icon: 'link', page: 'links', what: 'สร้างลิงก์ติด Sub ID 5 ช่อง (ตอนนี้บันทึกในเครื่องเป็น placeholder)', next: 'ไปหน้า "ลิงก์" ใช้ตัวสร้างที่ dry-run ก่อนเสมอ' },
  { id: 'verify', th: 'ตรวจลิงก์', en: 'Verify', icon: 'shield', page: 'links', what: 'เช็กว่าลิงก์เป็นของบัญชีเรา (owned_by_us) และชี้ถูกสินค้า', next: 'ดูป้ายในตารางลิงก์ — ปุ่มตรวจจริงยังรันผ่าน CLI' },
  { id: 'post', th: 'โพสต์', en: 'Post', icon: 'send', page: 'tools', what: 'นำลิงก์ไปโพสต์ตามแพลตฟอร์ม โดยไม่เกินโควต้าต่อวัน', next: 'เช็กโควต้าที่หน้า "เครื่องมือ"' },
  { id: 'orders', th: 'ออเดอร์', en: 'Conversions', icon: 'chart', page: 'analytics', what: 'ออเดอร์กลับมาพร้อมชิปเดิม แล้วนำมารวมตามชิป', next: 'ดูยอดตามชิปที่หน้า "ยอดขาย"' },
];

const JOB_STEP = [[/offer/i, 'offer'], [/conversion|report/i, 'orders'], [/verify/i, 'verify'], [/link/i, 'create'], [/post/i, 'post']];

function jobStep(type) {
  const found = JOB_STEP.find(([re]) => re.test(type));
  return found ? found[1] : null;
}

const JOB_STATUS = {
  pending: { th: 'รอคิว', tone: 'neutral', icon: 'clock' },
  running: { th: 'กำลังทำ', tone: 'info', icon: 'play' },
  captcha_stopped: { th: 'หยุดที่ CAPTCHA', tone: 'bad', icon: 'hand' },
};

const CONTROLS = [
  { tool: 'queue_pause', th: 'Pause', icon: 'pause', applies: (job) => job.status === 'pending' || job.status === 'running', confirmTitle: 'พักงานนี้?' },
  { tool: 'queue_resume', th: 'Resume', icon: 'play', applies: (job) => job.status === 'captcha_stopped' || job.status === 'pending', confirmTitle: 'ทำงานนี้ต่อ?' },
  { tool: 'queue_stop', th: 'Stop', icon: 'stop', applies: () => true, confirmTitle: 'หยุดงานนี้ถาวร?' },
];

function stepNode(step, info, index) {
  return h('button', {
    class: `pnode pnode-${info.tone}`, type: 'button', id: `step-${step.id}`,
    dataset: { step: step.id, tone: info.tone }, style: { '--i': String(index) },
    'aria-pressed': 'false',
  },
  h('span', { class: 'pnode-ring' }, icon(step.icon, 28)),
  h('strong', null, step.th),
  h('small', { class: 'muted' }, step.en),
  h('span', { class: 'pnode-metric' }, info.metric),
  h('span', { class: 'pnode-state' }, info.label));
}

function arrow(tone) {
  return h('span', { class: `parrow parrow-${tone}`, 'aria-hidden': 'true' }, h('span', { class: 'parrow-line' }), icon('arrow', 16));
}

export async function render(ctx) {
  const root = h('div', { class: 'page', id: 'page-workflow' });
  const refresh = h('button', { class: 'btn', type: 'button', id: 'refresh' }, icon('refresh', 16), 'รีเฟรช');
  root.append(pageHeader('ขั้นตอนงาน', 'จากสินค้า ไปจนถึงออเดอร์ — ดูว่าติดตรงไหน', 'flow', refresh));
  const body = h('div', { class: 'stack-v' });
  root.append(body);

  async function load() {
    put(body, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'กำลังโหลด...'));
    const [setup, conn, linkRes] = await callMany([['setup_status', {}], ['get_connection_status', {}], ['find_link', {}]]);
    if (setup.ok === false) { put(body, errorState(setup, load)); return; }
    const [posts, offersExport] = await Promise.all([getExport('posts'), getExport('offers')]);

    const counts = setup.counts || {};
    const links = linkRes.ok === false ? [] : (linkRes.links || []);
    const jobs = conn.ok === false ? [] : (conn.queued_jobs || []);
    const excluded = (offersExport.rows || []).filter((row) => row.excluded_category).length;
    const emptySlotLinks = links.filter((link) => Object.values(link.sub_ids || {}).some((value) => !value)).length;
    const verified = links.filter((link) => link.ownership_verified === 'true').length;
    const notOurs = links.filter((link) => link.ownership_verified === 'false').length;
    const postCount = posts.ok === false ? 0 : (posts.count || 0);
    const stoppedStep = jobStep(jobs.find((job) => job.status === 'captcha_stopped')?.type || '');
    const anyStopped = jobs.some((job) => job.status === 'captcha_stopped');

    const info = {
      product: { tone: counts.products > 0 ? 'ok' : 'idle', metric: `${num(counts.products)} ชิ้น`, label: counts.products > 0 ? 'พร้อม' : 'ยังไม่มี' },
      offer: excluded > 0
        ? { tone: 'warn', metric: `${num(counts.snapshots)} snapshot`, label: `${excluded} หมวดไม่ได้ค่าคอม` }
        : { tone: counts.snapshots > 0 ? 'ok' : 'idle', metric: `${num(counts.snapshots)} snapshot`, label: counts.snapshots > 0 ? 'พร้อม' : 'ยังไม่ตรวจ' },
      create: emptySlotLinks > 0
        ? { tone: 'warn', metric: `${num(counts.links)} ลิงก์`, label: `${emptySlotLinks} มีช่องว่าง` }
        : { tone: counts.links > 0 ? 'ok' : 'idle', metric: `${num(counts.links)} ลิงก์`, label: counts.links > 0 ? 'พร้อม' : 'ยังไม่มี' },
      verify: notOurs > 0
        ? { tone: 'bad', metric: `${verified}/${links.length}`, label: `${notOurs} ไม่ใช่ของเรา` }
        : verified === links.length && links.length > 0
          ? { tone: 'ok', metric: `${verified}/${links.length}`, label: 'ตรวจครบ' }
          : { tone: links.length ? 'warn' : 'idle', metric: `${verified}/${links.length}`, label: links.length ? 'ตรวจไม่ครบ' : 'ยังไม่มีลิงก์' },
      post: { tone: postCount > 0 ? 'ok' : 'idle', metric: `${num(postCount)} โพสต์`, label: postCount > 0 ? 'บันทึกแล้ว' : 'ยังไม่บันทึก' },
      orders: { tone: counts.conversions > 0 ? 'ok' : 'idle', metric: `${num(counts.conversions)} แถว`, label: counts.conversions > 0 ? 'มีออเดอร์' : 'ยังไม่มี' },
    };
    if (stoppedStep && info[stoppedStep]) info[stoppedStep] = { ...info[stoppedStep], tone: 'bad', label: 'หยุดที่ CAPTCHA' };

    const diagram = h('div', { class: 'pipeline', id: 'pipeline', role: 'group', 'aria-label': 'ขั้นตอนงาน' });
    const detail = h('div', { class: 'pdetail', id: 'step-detail' }, h('p', { class: 'muted' }, 'กดที่ขั้นตอนเพื่อดูว่าทำอะไร และควรทำอะไรต่อ'));
    STEPS.forEach((step, index) => {
      const node = stepNode(step, info[step.id], index);
      node.addEventListener('click', () => {
        diagram.querySelectorAll('.pnode').forEach((n) => n.setAttribute('aria-pressed', n === node ? 'true' : 'false'));
        put(detail, 
          h('div', { class: 'pdetail-head' }, h('span', { class: `pnode-ring small pnode-${info[step.id].tone}` }, icon(step.icon, 20)), h('strong', null, `${step.th} · ${step.en}`), badge(info[step.id].label, info[step.id].tone === 'ok' ? 'ok' : info[step.id].tone === 'bad' ? 'bad' : info[step.id].tone === 'warn' ? 'warn' : 'neutral')),
          h('p', null, step.what),
          h('p', { class: 'muted' }, `ต่อไป: ${step.next}`),
          h('a', { class: 'btn btn-small', href: `#/${step.page}`, id: 'step-go' }, 'ไปหน้านี้', icon('arrow', 14)));
      });
      diagram.append(node);
      if (index < STEPS.length - 1) diagram.append(arrow(info[step.id].tone === 'ok' && info[STEPS[index + 1].id].tone !== 'idle' ? 'ok' : info[step.id].tone === 'bad' ? 'bad' : 'idle'));
    });

    const legend = h('div', { class: 'legend' },
      [['ok', 'เสร็จ/พร้อม'], ['warn', 'ต้องดู'], ['bad', 'ติดปัญหา'], ['idle', 'ยังไม่เริ่ม']].map(([tone, label]) => h('span', { class: 'legend-item' }, h('span', { class: `dot dot-${tone}` }), label)));

    const queueCard = card('คิวงาน', 'list', jobsTable(jobs, ctx, load));
    put(body, 
      anyStopped ? notice('bad', 'hand', h('strong', null, 'มีงานหยุดที่ CAPTCHA: '), 'แก้ใน Chrome ด้วยมือ แล้วกลับมาทำต่อ') : null,
      card('ภาพรวมขั้นตอน', 'flow', diagram, legend, detail),
      queueCard,
      h('p', { class: 'muted small' }, `ข้อมูล ณ ${thaiDateTime(setup.as_of)} · คำนวณจาก setup_status, find_link, export posts/offers, get_connection_status`));
  }

  refresh.addEventListener('click', load);
  await load();
  return { element: root };
}

function jobsTable(jobs, ctx, reload) {
  if (jobs.length === 0) return emptyState('คิวว่าง', 'ไม่มีงานรอหรือกำลังทำอยู่', 'check');
  const missing = CONTROLS.filter((control) => !ctx.hasTool(control.tool));
  const wrap = h('div', null);
  if (missing.length > 0) {
    wrap.append(notice('info', 'info', h('strong', null, 'ปุ่มคุมคิวยังใช้ไม่ได้: '),
      `backend ยังไม่มี API สำหรับ ${missing.map((c) => c.tool).join(', ')} — ปุ่มพร้อมใช้ทันทีเมื่อ backend เพิ่ม tool ชื่อเหล่านี้`));
  }
  wrap.append(h('div', { class: 'table-wrap' }, h('table', { class: 'table', id: 'jobs-table' },
    h('thead', null, h('tr', null, ['ประเภทงาน', 'สถานะ', 'ขั้นตอน', 'สร้างเมื่อ', 'คุมคิว'].map((t) => h('th', null, t)))),
    h('tbody', null, jobs.map((job) => {
      const st = JOB_STATUS[job.status] || { th: job.status, tone: 'neutral', icon: 'info' };
      const step = STEPS.find((s) => s.id === jobStep(job.type));
      return h('tr', { dataset: { job: job.job_id, status: job.status } },
        h('td', null, h('code', null, job.type)),
        h('td', null, badge(st.th, st.tone === 'info' ? 'info' : st.tone, st.icon)),
        h('td', null, step ? h('span', { class: 'inline-ic' }, icon(step.icon, 14), step.th) : h('span', { class: 'muted' }, '–')),
        h('td', { title: job.created_at }, relTime(job.created_at)),
        h('td', null, h('div', { class: 'btn-group' }, CONTROLS.filter((c) => c.applies(job)).map((control) => {
          const available = ctx.hasTool(control.tool);
          const btn = h('button', {
            class: `btn btn-small ${control.tool === 'queue_stop' ? 'btn-danger-ghost' : ''}`, type: 'button', disabled: !available,
            dataset: { action: control.th.toLowerCase() }, 'aria-label': `${control.th} ${job.type}`,
          }, icon(control.icon, 14), control.th);
          if (!available) tip(btn, `ยังไม่มี API ${control.tool} ใน backend`);
          btn.addEventListener('click', async () => {
            const ok = await confirmDialog({
              title: control.confirmTitle, tone: control.tool === 'queue_stop' ? 'bad' : 'warn',
              body: h('p', null, `งาน ${job.type} (${job.status})`), confirmLabel: control.th,
              details: [['job', job.job_id.slice(0, 8)]],
            });
            if (!ok) return;
            const result = await callTool(control.tool, { job_id: job.job_id });
            if (result.ok === false) toast(`ไม่สำเร็จ: ${result.error}`, 'bad'); else toast(`${control.th} แล้ว`, 'ok');
            reload();
          });
          return btn;
        }))));
    })))));
  return wrap;
}
