import { h, icon, clear, put } from './dom.js';
import { loading, errorState, slotLegend } from './components.js';
import { callTool, listTools } from './api.js';
import { thaiDateTime } from './format.js';
import * as overview from './pages/overview.js';
import * as workflow from './pages/workflow.js';
import * as explainer from './pages/explainer.js';
import * as links from './pages/links.js';
import * as offers from './pages/offers.js';
import * as analytics from './pages/analytics.js';
import * as tools from './pages/tools.js';

const PAGES = [
  { id: 'overview', label: 'ภาพรวม', en: 'Overview', icon: 'home', module: overview },
  { id: 'workflow', label: 'ขั้นตอนงาน', en: 'Workflow', icon: 'flow', module: workflow },
  { id: 'subid', label: 'Sub ID ทำงานยังไง', en: 'How Sub ID works', icon: 'bulb', module: explainer },
  { id: 'links', label: 'ลิงก์', en: 'Links', icon: 'link', module: links },
  { id: 'offers', label: 'ค่าคอม', en: 'Offers', icon: 'percent', module: offers },
  { id: 'analytics', label: 'ยอดขาย', en: 'Analytics', icon: 'chart', module: analytics },
  { id: 'tools', label: 'เครื่องมือ', en: 'Tools / Settings', icon: 'wrench', module: tools },
];

export const ctx = {
  toolList: null,
  setup: null,
  navigate(id) { location.hash = `#/${id}`; },
  hasTool(name) { return Boolean(this.toolList && this.toolList.tools && this.toolList.tools.includes(name)); },
  async refreshPill() { await updatePill(); },
};

let cleanup = null;
let renderToken = 0;

function buildNav() {
  const nav = document.getElementById('nav');
  clear(nav);
  PAGES.forEach((page) => nav.append(h('a', {
    href: `#/${page.id}`, class: 'nav-item', dataset: { page: page.id }, 'aria-label': `${page.label} ${page.en}`,
  }, icon(page.icon, 20), h('span', null, h('b', null, page.label), h('small', null, page.en)))));
  document.getElementById('side-foot').append(h('div', { class: 'side-legend' }, h('small', null, 'สีชิป Sub ID'), slotLegend()));
}

function currentId() {
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  return PAGES.some((p) => p.id === id) ? id : 'overview';
}

async function updatePill() {
  const pill = document.getElementById('conn-pill');
  const text = document.getElementById('conn-text');
  const result = await callTool('setup_status');
  ctx.setup = result;
  if (result.ok === false) {
    pill.dataset.state = 'bad';
    pill.firstChild.className = 'dot dot-bad';
    text.textContent = 'ติดต่อ console ไม่ได้';
    return;
  }
  const chrome = (result.steps || []).find((step) => step.key === 'chrome');
  const up = chrome && chrome.state === 'done';
  pill.dataset.state = up ? 'ok' : 'bad';
  pill.firstChild.className = `dot dot-${up ? 'ok' : 'bad'}`;
  text.textContent = up ? 'Chrome พร้อม (CDP)' : 'Chrome ยังไม่เชื่อม';
  document.getElementById('asof').textContent = result.as_of ? `ข้อมูล ณ ${thaiDateTime(result.as_of)}` : '';
}

export async function render() {
  const id = currentId();
  const token = ++renderToken;
  if (cleanup) { try { cleanup(); } catch { /* page cleanup must not break navigation */ } cleanup = null; }
  document.querySelectorAll('.nav-item').forEach((el) => {
    const active = el.dataset.page === id;
    el.classList.toggle('active', active);
    if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
  const main = document.getElementById('main');
  main.dataset.page = id;
  put(main, loading());
  const page = PAGES.find((p) => p.id === id);
  try {
    const result = await page.module.render(ctx);
    if (token !== renderToken) return;
    clear(main);
    main.append(result.element);
    cleanup = result.cleanup || null;
    main.dataset.ready = id;
  } catch (error) {
    if (token !== renderToken) return;
    put(main, errorState({ error: 'render_error', message: error instanceof Error ? error.message : String(error) }, render));
  }
}

async function start() {
  buildNav();
  ctx.toolList = await listTools();
  window.addEventListener('hashchange', render);
  window.addEventListener('shopkud:refresh-pill', updatePill);
  updatePill();
  await render();
  setInterval(updatePill, 45_000);
}

start();
