import { h, icon, clear, put } from '../dom.js';
import {
  card, pageHeader, badge, notice, errorState, emptyState, gauge, confirmDialog, toast, copyButton, errorText, chipRow,
} from '../components.js';
import { callTool, getExport, exportUrl, callLog } from '../api.js';
import { CHANNELS, CHANNEL_LABEL, slotValues } from '../subid.js';
import { thaiDateTime, num } from '../format.js';

const EXPORT_KINDS = [
  ['links', 'ลิงก์', 'link'], ['conversions', 'ออเดอร์', 'chart'], ['offers', 'ค่าคอม', 'percent'], ['alerts', 'เตือน', 'alert'],
  ['missions', 'มิชชั่น', 'trophy'], ['clips', 'คลิป', 'file'], ['posts', 'โพสต์', 'send'], ['earnings', 'รายได้', 'coin'], ['videos', 'วิดีโอ', 'play'],
];

const SAFETY = [
  ['lock', 'ใช้ได้เฉพาะเครื่องนี้ (localhost) — API ปฏิเสธ host อื่น'],
  ['eye', 'ไม่แสดง cookie, token, secret ในหน้านี้เลย'],
  ['link', 'ไม่เปิดลิงก์ s.shopee.co.th — แสดงเป็นข้อความ + ปุ่มคัดลอกเท่านั้น'],
  ['shield', 'ทุกการเขียนจริงต้องผ่านกล่องยืนยันก่อน'],
  ['hand', 'เจอ CAPTCHA แล้วหยุด รอให้คนแก้เอง ไม่พยายามข้าม'],
  ['flask', 'สร้างลิงก์เริ่มที่ dry-run เสมอ'],
];

function convertCard() {
  const text = h('textarea', { class: 'input', id: 'convert-text', rows: '5', placeholder: 'วางข้อความแคปชั่นที่มีลิงก์สินค้า Shopee...', 'aria-label': 'ข้อความ' });
  const channel = h('select', { class: 'input', id: 'convert-channel', 'aria-label': 'ช่องทาง' }, CHANNELS.map((c) => h('option', { value: c }, CHANNEL_LABEL[c])));
  const clip = h('input', { class: 'input', id: 'convert-clip', placeholder: 'clip id (ไม่บังคับ) เช่น v6', 'aria-label': 'clip id' });
  const out = h('div', { id: 'convert-out' });
  const go = h('button', { class: 'btn btn-primary', type: 'button', id: 'convert-go' }, icon('refresh', 16), 'แปลงลิงก์ในข้อความ');
  go.addEventListener('click', async () => {
    if (!text.value.trim()) { toast('วางข้อความก่อน', 'warn'); return; }
    const res = await callTool('convert_links_in_text', { text: text.value, channel: channel.value, ...(clip.value.trim() ? { clip_id: clip.value.trim() } : {}) });
    clear(out);
    if (res.ok === false) { out.append(errorState(res)); return; }
    out.append(
      h('div', { class: 'row' },
        badge(`พบ ${res.urls_found} ลิงก์`, 'info', 'link'), badge(`แทนที่ ${res.replaced}`, res.replaced ? 'ok' : 'warn', 'check'),
        badge('ไม่ได้เปิดลิงก์ใด ๆ', 'neutral', 'shield')),
      h('label', { class: 'field' }, h('span', null, 'ข้อความหลังแปลง'), h('textarea', { class: 'input', id: 'convert-result', rows: '5', readonly: true }, res.text)),
      copyButton(res.text, 'คัดลอกข้อความ'),
      res.conversions.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table table-tight', id: 'convert-table' },
        h('thead', null, h('tr', null, ['เดิม', '', 'ใหม่'].map((t) => h('th', null, t)))),
        h('tbody', null, res.conversions.map((c) => h('tr', { dataset: { replaced: c.replaced ? '1' : '0' } },
          h('td', null, h('code', { class: 'short-link' }, c.from)), h('td', null, icon('arrow', 14)),
          h('td', null, c.to ? h('code', { class: 'short-link' }, c.to) : badge('ไม่พบในทะเบียน — ไม่แปลง', 'warn', 'alert'))))))) : null);
  });
  return card('แปลงลิงก์ในข้อความ', 'link', h('p', { class: 'muted' }, 'เปลี่ยนลิงก์สินค้าในแคปชั่นเป็นลิงก์ที่ติด Sub ID ของเรา (ใช้ทะเบียนในเครื่อง ไม่เปิดลิงก์)'),
    text, h('div', { class: 'row' }, channel, clip, go), out);
}

async function budgetCard() {
  const host = h('div', { id: 'budget-host' });
  async function load() {
    put(host, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'กำลังโหลด...'));
    const results = await Promise.all(CHANNELS.map((c) => callTool('posting_budget', { platform: c })));
    put(host, 
      notice('info', 'info', 'เพดานต่อวันเป็นค่าที่ตั้งในเครื่อง ไม่ใช่กฎของ Shopee'),
      h('div', { class: 'cap-grid', id: 'cap-grid' }, results.map((b, i) => {
        const platform = CHANNELS[i];
        if (b.ok === false) return h('div', { class: 'cap-row' }, errorState(b));
        const input = h('input', { class: 'input input-sm', type: 'number', min: '1', max: '10000', value: String(b.cap), id: `cap-${platform}`, 'aria-label': `เพดาน ${platform}` });
        const save = h('button', { class: 'btn btn-small', type: 'button', dataset: { save: platform } }, icon('check', 14), 'บันทึก');
        save.addEventListener('click', async () => {
          const value = Number(input.value);
          if (!Number.isInteger(value) || value < 1 || value > 10000) { toast('ต้องเป็นเลข 1–10000', 'warn'); return; }
          const ok = await confirmDialog({
            title: 'เปลี่ยนเพดานโพสต์?', tone: 'warn', iconName: 'sliders', confirmLabel: 'บันทึกเพดาน',
            body: h('p', null, 'เขียนค่าเพดานใหม่ลงฐานข้อมูลของเครื่องนี้'), details: [['แพลตฟอร์ม', CHANNEL_LABEL[platform]], ['เพดานเดิม → ใหม่', `${b.cap} → ${value}`]],
          });
          if (!ok) return;
          const res = await callTool('set_posting_cap', { platform, daily_cap: value });
          if (res.ok === false) toast(errorText(res), 'bad'); else { toast('บันทึกเพดานแล้ว', 'ok'); load(); }
        });
        return h('div', { class: 'cap-row', dataset: { platform } },
          gauge({ value: b.today, max: b.cap, label: CHANNEL_LABEL[platform] }),
          h('div', { class: 'row' }, input, save, badge(b.cap_evidence === 'owner_set' ? 'ตั้งเอง' : 'ค่าเริ่มต้นในเครื่อง', b.cap_evidence === 'owner_set' ? 'ok' : 'neutral')));
      })),
      h('p', { class: 'muted small', id: 'pageload-cap-note' }, 'เพดาน page load ต่อวันยังตั้งผ่าน API ไม่ได้ (ยังไม่มี endpoint)'));
  }
  await load();
  return card('โควต้าโพสต์ / เพดานความปลอดภัย', 'sliders', host);
}

function exportCard() {
  return card('ส่งออกข้อมูล', 'download',
    h('p', { class: 'muted' }, 'ดาวน์โหลดจากฐานข้อมูลในเครื่อง CSV เปิดใน Excel ได้ (กันสูตรอัตโนมัติ)'),
    h('div', { class: 'export-grid', id: 'export-grid' }, EXPORT_KINDS.map(([kind, label, ic]) => h('div', { class: 'export-item', dataset: { kind } },
      h('span', { class: 'export-ic' }, icon(ic, 18)), h('b', null, label),
      h('div', { class: 'btn-group' },
        h('a', { class: 'btn btn-small', href: exportUrl(kind, 'csv'), download: `shopkud-${kind}.csv`, dataset: { format: 'csv' } }, 'CSV'),
        h('a', { class: 'btn btn-small', href: exportUrl(kind, 'json'), download: `shopkud-${kind}.json`, dataset: { format: 'json' } }, 'JSON'))))));
}

async function missionsCard() {
  const listHost = h('div', { id: 'missions-list' });
  const planHost = h('div', { id: 'mission-plan' });
  async function loadList() {
    const res = await callTool('list_missions', {});
    clear(listHost);
    if (res.ok === false) { listHost.append(errorState(res, loadList)); return; }
    listHost.append(
      notice('info', 'info', 'อ่านอย่างเดียว: ShopKud ไม่สมัครมิชชั่นใน Shopee ให้ ทำได้แค่ "เตรียม" บันทึกในเครื่อง'),
      res.missions.length === 0 ? emptyState('ยังไม่มีมิชชั่นในเครื่อง', null, 'trophy')
        : h('div', { class: 'table-wrap' }, h('table', { class: 'table table-tight', id: 'missions-table' },
          h('thead', null, h('tr', null, ['มิชชั่น', 'รางวัล', 'เส้นตาย', 'สถานะ'].map((t) => h('th', null, t)))),
          h('tbody', null, res.missions.map((m) => h('tr', { dataset: { mission: m.mission_id } },
            h('td', null, h('strong', null, m.name), h('div', { class: 'muted small' }, m.requirements || '')),
            h('td', null, m.reward || '–'), h('td', null, m.deadline || '–'),
            h('td', null, badge(m.status, m.status === 'prepared' ? 'warn' : 'neutral'), m.enrolled ? badge('สมัครแล้ว', 'ok') : badge('ยังไม่ได้สมัครใน Shopee', 'neutral'))))))));
  }
  const f = {
    id: h('input', { class: 'input', id: 'mission-id', placeholder: 'mission id เช่น m-oct', 'aria-label': 'mission id' }),
    name: h('input', { class: 'input', id: 'mission-name', placeholder: 'ชื่อมิชชั่น', 'aria-label': 'ชื่อ' }),
    reward: h('input', { class: 'input', id: 'mission-reward', placeholder: 'รางวัล (ไม่บังคับ)', 'aria-label': 'รางวัล' }),
    deadline: h('input', { class: 'input', id: 'mission-deadline', type: 'date', 'aria-label': 'เส้นตาย' }),
  };
  const args = () => ({
    mission_id: f.id.value.trim(), name: f.name.value.trim(),
    ...(f.reward.value.trim() ? { reward: f.reward.value.trim() } : {}), ...(f.deadline.value ? { deadline: f.deadline.value } : {}),
  });
  const preview = h('button', { class: 'btn', type: 'button', id: 'mission-preview' }, icon('flask', 16), 'ดูตัวอย่างก่อน (ไม่เขียน)');
  preview.addEventListener('click', async () => {
    clear(planHost);
    const res = await callTool('enroll_mission', args());
    if (res.ok === false) { planHost.append(notice('bad', 'x', errorText(res))); return; }
    const prepare = h('button', { class: 'btn btn-primary', type: 'button', id: 'mission-prepare' }, icon('check', 16), 'เตรียมมิชชั่นนี้ (ในเครื่อง)');
    prepare.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'เตรียมสมัครมิชชั่น?', tone: 'warn', iconName: 'trophy', confirmLabel: 'เตรียมในเครื่อง',
        requireCheck: 'เข้าใจว่านี่แค่บันทึกในเครื่อง ยังไม่ได้สมัครใน Shopee',
        body: h('p', null, 'จะเขียนแถวสถานะ "prepared" ลงฐานข้อมูล'), details: [['มิชชั่น', res.name], ['ส่งไป Shopee', 'ไม่ส่ง (submitted_to_shopee = false)']],
      });
      if (!ok) return;
      const done = await callTool('enroll_mission', { ...args(), confirm: res.confirm });
      if (done.ok === false) { toast(errorText(done), 'bad'); return; }
      toast('บันทึกเป็น prepared แล้ว', 'ok');
      put(planHost, notice('ok', 'check', 'เตรียมแล้ว (prepared) — ยังไม่ได้สมัครจริงใน Shopee'));
      loadList();
    });
    planHost.append(h('div', { class: 'plan', id: 'mission-plan-box', dataset: { submitted: String(res.submitted_to_shopee) } },
      h('h4', null, icon('flask', 18), 'ตัวอย่าง (dry-run)'),
      h('ul', { class: 'plan-list' }, h('li', null, icon('trophy', 16), res.name), h('li', null, icon('shield', 16), 'ไม่ส่งอะไรไป Shopee')), prepare));
  });
  await loadList();
  return card('มิชชั่น (Missions)', 'trophy', listHost,
    h('h4', { class: 'sub-h' }, 'เตรียมสมัคร (ไม่ส่งไป Shopee)'),
    h('div', { class: 'form-grid' }, f.id, f.name, f.reward, f.deadline), h('div', { class: 'row' }, preview), planHost);
}

function logsCard() {
  const host = h('div', { id: 'logs-host' });
  const paint = async () => {
    clear(host);
    const alerts = await getExport('alerts');
    host.append(
      h('h4', { class: 'sub-h' }, 'การเรียก API ของหน้านี้ (เฉพาะเซสชันนี้)'),
      callLog.length === 0 ? emptyState('ยังไม่มีการเรียก', null, 'file') : h('div', { class: 'table-wrap log-wrap' }, h('table', { class: 'table table-tight', id: 'log-table' },
        h('thead', null, h('tr', null, ['เวลา', 'tool', 'ผล', 'ms'].map((t) => h('th', null, t)))),
        h('tbody', null, callLog.slice(0, 40).map((e) => h('tr', { dataset: { tool: e.tool, ok: e.ok ? '1' : '0' } },
          h('td', null, thaiDateTime(e.at)), h('td', null, h('code', null, e.tool)), h('td', null, e.ok ? badge('ok', 'ok') : badge(e.error || 'error', 'bad')), h('td', null, String(e.ms))))))),
      h('h4', { class: 'sub-h' }, 'บันทึกเตือนล่าสุดจากระบบ'),
      alerts.ok === false ? errorState(alerts) : (alerts.rows || []).length === 0 ? emptyState('ยังไม่มีบันทึกเตือน', null, 'check')
        : h('ul', { class: 'log-list', id: 'alert-log' }, alerts.rows.slice(0, 12).map((a) => h('li', null, h('span', { class: 'muted' }, thaiDateTime(a.at)), badge(a.status, a.status === 'ok' ? 'ok' : 'warn'), h('code', null, `#${a.item_id || '–'}`), a.kind))),
      h('p', { class: 'muted small' }, 'ยังไม่มี endpoint อ่าน log ของเซิร์ฟเวอร์ จึงแสดงเฉพาะ API call ในเบราว์เซอร์นี้และ alerts'));
  };
  const refresh = h('button', { class: 'btn btn-small', type: 'button', id: 'logs-refresh', onclick: paint }, icon('refresh', 14), 'รีเฟรช');
  paint();
  return card('บันทึก (Logs)', 'file', refresh, host);
}

export async function render(ctx) {
  const root = h('div', { class: 'page', id: 'page-tools' });
  root.append(pageHeader('เครื่องมือและตั้งค่า', 'แปลงลิงก์ ส่งออกข้อมูล มิชชั่น และเพดานความปลอดภัย', 'wrench'));
  const [budget, missions] = await Promise.all([budgetCard(), missionsCard()]);
  root.append(
    h('div', { class: 'grid-2' }, convertCard(), budget),
    exportCard(),
    missions,
    logsCard(),
    card('กฎความปลอดภัย', 'shield', h('ul', { class: 'safety', id: 'safety' }, SAFETY.map(([ic, text]) => h('li', null, h('span', { class: 'safety-ic' }, icon(ic, 18)), text)))));
  return { element: root };
}

export { chipRow, slotValues, num };
