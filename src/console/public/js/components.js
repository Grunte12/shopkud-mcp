import { h, icon, clear } from './dom.js';
import { SLOTS, UNTRACKED_COLOR } from './subid.js';

export function chip(value, slotIndex, { showName = false, size = '' } = {}) {
  const slot = SLOTS[slotIndex];
  const empty = !value;
  const el = h('span', {
    class: `chip ${size ? `chip-${size}` : ''} ${empty ? 'chip-empty' : ''}`,
    style: { '--chip': slot.color, '--chip-soft': slot.soft },
    dataset: { slot: String(slot.n), empty: empty ? '1' : '0' },
    title: empty ? `s${slot.n} ${slot.th}: ว่าง` : `s${slot.n} ${slot.th}: ${value}`,
  },
  showName ? h('small', { class: 'chip-name' }, `s${slot.n}`) : null,
  h('span', { class: 'chip-value' }, empty ? 'ว่าง' : value));
  return el;
}

export function chipRow(values, opts = {}) {
  return h('span', { class: 'chip-row', dataset: { chips: values.join('-') } },
    values.slice(0, 5).map((value, index) => chip(value, index, opts)));
}

export function slotLegend() {
  return h('div', { class: 'legend' }, SLOTS.map((slot) => h('span', { class: 'legend-item' },
    h('span', { class: 'chip chip-sm', style: { '--chip': slot.color, '--chip-soft': slot.soft } }, h('span', { class: 'chip-value' }, `s${slot.n}`)),
    h('span', null, slot.th))));
}

export function badge(text, tone = 'neutral', iconName = null, attrs = {}) {
  return h('span', { class: `badge badge-${tone}`, ...attrs }, iconName ? icon(iconName, 13) : null, text);
}

export function dot(tone) {
  return h('span', { class: `dot dot-${tone}`, 'aria-hidden': 'true' });
}

export function tip(child, text) {
  child.classList.add('has-tip');
  child.setAttribute('data-tip', text);
  child.setAttribute('aria-label', text);
  if (!child.hasAttribute('tabindex')) child.setAttribute('tabindex', '0');
  return child;
}

export function card(title, iconName, ...body) {
  return h('section', { class: 'card' },
    title ? h('header', { class: 'card-head' }, iconName ? icon(iconName, 18) : null, h('h3', null, title)) : null,
    ...body);
}

export function pageHeader(title, subtitle, iconName, ...actions) {
  return h('header', { class: 'page-head' },
    h('div', { class: 'page-title' },
      iconName ? h('span', { class: 'page-icon' }, icon(iconName, 24)) : null,
      h('div', null, h('h1', null, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null)),
    actions.length ? h('div', { class: 'page-actions' }, ...actions) : null);
}

export function kpi({ label, value, iconName, tone = 'neutral', sub = null, id = null }) {
  return h('div', { class: `kpi kpi-${tone}`, id },
    h('span', { class: 'kpi-icon' }, icon(iconName, 20)),
    h('div', { class: 'kpi-body' },
      h('span', { class: 'kpi-label' }, label),
      h('strong', { class: 'kpi-value' }, value),
      sub ? h('span', { class: 'kpi-sub' }, sub) : null));
}

/** Horizontal gauge: value out of max. max null means the cap is unknown. */
export function gauge({ value, max = null, label, unit = '', tone = null }) {
  const ratio = max ? Math.min(1, value / max) : 0;
  const auto = max ? (ratio >= 1 ? 'bad' : ratio >= 0.8 ? 'warn' : 'ok') : 'idle';
  const fill = h('span', { class: 'gauge-fill', style: { width: `${Math.max(max ? 2 : 0, ratio * 100)}%` } });
  return h('div', { class: `gauge gauge-${tone || auto}`, dataset: { value: String(value), max: max == null ? '' : String(max) } },
    h('div', { class: 'gauge-top' }, h('span', null, label),
      h('b', null, max == null ? `${value}${unit} / ?` : `${value}${unit} / ${max}${unit}`)),
    h('div', { class: 'gauge-track', role: 'progressbar', 'aria-valuenow': String(value), 'aria-valuemin': '0', 'aria-valuemax': max == null ? '' : String(max) }, fill));
}

/** Stacked bar. segments: [{ label, value, color, text }] */
export function stackedBar(segments, { height = 34 } = {}) {
  const total = segments.reduce((sum, seg) => sum + (seg.value || 0), 0);
  return h('div', { class: 'stack', style: { height: `${height}px` }, role: 'img', 'aria-label': segments.map((s) => `${s.label} ${s.text || s.value}`).join(', ') },
    segments.filter((seg) => seg.value > 0).map((seg) => h('div', {
      class: 'stack-seg', dataset: { seg: seg.key || seg.label },
      style: { flexGrow: String(total > 0 ? seg.value : 1), background: seg.color },
      title: `${seg.label}: ${seg.text || seg.value}`,
    }, h('span', null, seg.text || String(seg.value)))));
}

export function loading(text = 'กำลังโหลด...') {
  return h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spinner' }), text);
}

export function emptyState(title, hint, iconName = 'info') {
  return h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, icon(iconName, 28)), h('strong', null, title), hint ? h('p', { class: 'muted' }, hint) : null);
}

const ERROR_TH = {
  network_error: 'ติดต่อ console ไม่ได้ ลองเช็กว่า npm run console ยังทำงานอยู่',
  captcha_detected: 'Shopee ขึ้น CAPTCHA ต้องไปแก้ใน Chrome ด้วยมือก่อน',
  local_only: 'เปิดได้เฉพาะจากเครื่องนี้ (localhost)',
  missing_console_header: 'ไม่มี header ของ console',
  bad_origin: 'Origin ไม่ใช่ localhost',
  unknown_tool: 'ยังไม่มี API นี้ใน backend',
};

export function errorText(result) {
  const code = String(result?.error || 'error');
  return ERROR_TH[code] || result?.message || code;
}

export function errorState(result, onRetry) {
  return h('div', { class: 'error-box', role: 'alert' },
    icon('alert', 20),
    h('div', null, h('strong', null, 'โหลดไม่สำเร็จ'), h('p', null, errorText(result)),
      h('code', { class: 'muted' }, String(result?.error || ''))),
    onRetry ? h('button', { class: 'btn btn-small', type: 'button', onclick: onRetry }, icon('refresh', 14), 'ลองใหม่') : null);
}

export function notice(tone, iconName, ...children) {
  return h('div', { class: `notice notice-${tone}`, role: tone === 'bad' ? 'alert' : 'note' }, icon(iconName, 18), h('div', null, ...children));
}

export function copyButton(text, label = 'คัดลอก') {
  const btn = h('button', { class: 'btn btn-small btn-ghost', type: 'button', 'aria-label': `${label} ${text}` }, icon('copy', 14), label);
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('คัดลอกแล้ว', 'ok');
    } catch {
      toast('คัดลอกไม่ได้ ลองเลือกข้อความเอง', 'warn');
    }
  });
  return btn;
}

let toastHost = null;
export function toast(message, tone = 'info') {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const el = h('div', { class: `toast toast-${tone}` }, message);
  toastHost.append(el);
  setTimeout(() => el.remove(), 3800);
}

/**
 * Modal confirm. Resolves true only when the owner presses the confirm button
 * (and ticks the checkbox when `requireCheck` is set).
 */
export function confirmDialog({ title, body, confirmLabel = 'ยืนยัน', cancelLabel = 'ยกเลิก', tone = 'warn', iconName = 'alert', requireCheck = null, details = null }) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: `modal modal-${tone}`, id: 'confirm-dialog', 'aria-labelledby': 'confirm-title' });
    const okBtn = h('button', { class: `btn btn-${tone === 'bad' ? 'danger' : 'primary'}`, type: 'button', id: 'confirm-ok', disabled: Boolean(requireCheck) }, confirmLabel);
    const cancelBtn = h('button', { class: 'btn', type: 'button', id: 'confirm-cancel' }, cancelLabel);
    const check = requireCheck ? h('input', { type: 'checkbox', id: 'confirm-check' }) : null;
    if (check) check.addEventListener('change', () => { okBtn.disabled = !check.checked; });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    okBtn.addEventListener('click', () => finish(true));
    cancelBtn.addEventListener('click', () => finish(false));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(false); });
    dialog.append(
      h('div', { class: 'modal-head' }, h('span', { class: 'modal-icon' }, icon(iconName, 22)), h('h2', { id: 'confirm-title' }, title)),
      h('div', { class: 'modal-body' }, body, details ? h('dl', { class: 'modal-details' }, details.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])) : null,
        check ? h('label', { class: 'check-row' }, check, h('span', null, requireCheck)) : null),
      h('div', { class: 'modal-foot' }, cancelBtn, okBtn));
    document.body.append(dialog);
    dialog.showModal();
    cancelBtn.focus();
  });
}

export function segmented(options, value, onChange, { name = 'seg' } = {}) {
  const root = h('div', { class: 'segmented', role: 'tablist', dataset: { name } });
  const paint = (current) => {
    clear(root);
    options.forEach((opt) => root.append(h('button', {
      type: 'button', role: 'tab', class: `seg-btn ${opt.value === current ? 'active' : ''}`,
      'aria-selected': opt.value === current ? 'true' : 'false', dataset: { value: opt.value },
      onclick: () => { paint(opt.value); onChange(opt.value); },
    }, opt.icon ? icon(opt.icon, 14) : null, opt.label)));
  };
  paint(value);
  return root;
}

export function untrackedBadge() {
  return h('span', { class: 'badge badge-untracked' }, icon('alert', 13), 'ไม่มี Sub ID');
}

export { UNTRACKED_COLOR };
