import { h, svg } from './dom.js';
import { thaiDate, num } from './format.js';

/** Daily series as columns plus a smooth line. points: [{ day, value }] */
export function timeSeries(points, { color = '#2563eb', formatValue = num, height = 220 } = {}) {
  const width = 720;
  const pad = { l: 44, r: 12, t: 14, b: 28 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = points.length > 1 ? innerW / (points.length - 1) : innerW;
  const x = (i) => pad.l + (points.length > 1 ? i * step : innerW / 2);
  const y = (v) => pad.t + innerH - (v / max) * innerH;
  const ticks = [0, 0.5, 1].map((t) => max * t);
  const barW = Math.max(3, Math.min(18, innerW / Math.max(points.length, 1) - 3));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));

  return h('div', { class: 'chart', dataset: { chart: 'timeseries', points: String(points.length) } },
    svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'กราฟตามวัน', class: 'chart-svg' },
      ticks.map((t) => svg('g', null,
        svg('line', { x1: pad.l, x2: width - pad.r, y1: y(t), y2: y(t), class: 'grid' }),
        svg('text', { x: pad.l - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'axis' }, formatValue(Math.round(t * 100) / 100)))),
      points.map((p, i) => svg('rect', {
        x: x(i) - barW / 2, y: y(p.value), width: barW, height: Math.max(0, pad.t + innerH - y(p.value)),
        rx: 2, fill: color, opacity: '0.22', class: 'bar',
      }, svg('title', null, `${thaiDate(p.day)}: ${formatValue(p.value)}`))),
      points.length > 1 ? svg('path', { d: linePath, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }) : null,
      points.map((p, i) => svg('circle', { cx: x(i), cy: y(p.value), r: 3, fill: color }, svg('title', null, `${thaiDate(p.day)}: ${formatValue(p.value)}`))),
      points.map((p, i) => (i % labelEvery === 0 ? svg('text', { x: x(i), y: height - 8, 'text-anchor': 'middle', class: 'axis' }, thaiDate(p.day)) : null))));
}

/** Horizontal bars. rows: [{ key, value, color, label, sub }] */
export function hbars(rows, { formatValue = num, empty = 'ยังไม่มีข้อมูล' } = {}) {
  if (rows.length === 0) return h('p', { class: 'muted' }, empty);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h('div', { class: 'hbars' }, rows.map((row) => h('div', { class: `hbar ${row.untracked ? 'hbar-untracked' : ''}`, dataset: { key: row.key } },
    h('span', { class: 'hbar-label' }, row.node || row.label || row.key),
    h('span', { class: 'hbar-track' }, h('span', { class: 'hbar-fill', style: { width: `${Math.max(2, (row.value / max) * 100)}%`, background: row.color } })),
    h('b', { class: 'hbar-value' }, formatValue(row.value)),
    row.sub ? h('small', { class: 'hbar-sub muted' }, row.sub) : null)));
}

/** Donut with a big centered label. */
export function donut({ parts, centerTop, centerBottom, size = 168 }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const r = 60;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return h('div', { class: 'donut', style: { width: `${size}px`, height: `${size}px` }, dataset: { chart: 'donut' } },
    svg('svg', { viewBox: '0 0 160 160', role: 'img', 'aria-label': parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(', ') },
      svg('circle', { cx: 80, cy: 80, r, fill: 'none', stroke: '#e2e8f0', 'stroke-width': 22 }),
      parts.filter((p) => p.value > 0).map((p) => {
        const len = (p.value / total) * c;
        const el = svg('circle', {
          cx: 80, cy: 80, r, fill: 'none', stroke: p.color, 'stroke-width': 22,
          'stroke-dasharray': `${len} ${c - len}`, 'stroke-dashoffset': -offset, transform: 'rotate(-90 80 80)',
        }, svg('title', null, `${p.label}: ${Math.round((p.value / total) * 100)}%`));
        offset += len;
        return el;
      })),
    h('div', { class: 'donut-center' }, h('strong', null, centerTop), h('span', null, centerBottom)));
}

/**
 * Three-column Sankey. columns: [[{id,label,color}],...], links: [{from,to,value,color}]
 */
export function sankey(columns, links, { width = 760, height = 300, labels = [] } = {}) {
  const nodeW = 16;
  const gap = 10;
  const padTop = 26;
  const usable = height - padTop - 8;
  const colX = columns.map((_, i) => 8 + (i * (width - 16 - nodeW - 150)) / Math.max(1, columns.length - 1));

  const valueOf = new Map();
  for (const l of links) {
    valueOf.set(`o:${l.from}`, (valueOf.get(`o:${l.from}`) || 0) + l.value);
    valueOf.set(`i:${l.to}`, (valueOf.get(`i:${l.to}`) || 0) + l.value);
  }
  const nodeValue = (node) => Math.max(valueOf.get(`o:${node.id}`) || 0, valueOf.get(`i:${node.id}`) || 0);

  const maxColTotal = Math.max(1, ...columns.map((col) => col.reduce((s, n) => s + nodeValue(n), 0)));
  const maxGaps = Math.max(...columns.map((col) => Math.max(0, col.length - 1))) * gap;
  const scale = (usable - maxGaps) / maxColTotal;

  const pos = new Map();
  columns.forEach((col, ci) => {
    let y = padTop;
    col.forEach((node) => {
      const hgt = Math.max(3, nodeValue(node) * scale);
      pos.set(node.id, { x: colX[ci], y, h: hgt, outY: 0, inY: 0, node, ci });
      y += hgt + gap;
    });
  });

  const sorted = [...links].sort((a, b) => (pos.get(a.from)?.y - pos.get(b.from)?.y) || (pos.get(a.to)?.y - pos.get(b.to)?.y));
  const paths = [];
  for (const l of sorted) {
    const a = pos.get(l.from);
    const b = pos.get(l.to);
    if (!a || !b) continue;
    const w = Math.max(1.5, l.value * scale);
    const y0 = a.y + a.outY + w / 2;
    const y1 = b.y + b.inY + w / 2;
    a.outY += w;
    b.inY += w;
    const x0 = a.x + nodeW;
    const x1 = b.x;
    const mid = (x0 + x1) / 2;
    paths.push(svg('path', {
      d: `M${x0},${y0} C${mid},${y0} ${mid},${y1} ${x1},${y1}`,
      fill: 'none', stroke: l.color, 'stroke-width': w, opacity: l.untracked ? '0.55' : '0.4', class: 'sankey-link',
      dataset: { from: l.from, to: l.to, value: String(l.value) },
    }, svg('title', null, `${l.fromLabel} → ${l.toLabel}: ${l.value}`)));
  }

  const nodes = [...pos.values()].map((p) => svg('g', { class: 'sankey-node', dataset: { node: p.node.id } },
    svg('rect', { x: p.x, y: p.y, width: nodeW, height: p.h, rx: 3, fill: p.node.color }, svg('title', null, `${p.node.label}: ${nodeValue(p.node)}`)),
    svg('text', { x: p.x + nodeW + 6, y: p.y + Math.min(p.h / 2, 12) + 4, class: 'sankey-label' }, `${p.node.label} · ${nodeValue(p.node)}`)));

  const heads = labels.map((text, i) => svg('text', { x: colX[i], y: 14, class: 'sankey-head' }, text));

  return h('div', { class: 'chart', dataset: { chart: 'sankey' } },
    svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'แผนภาพ Sankey แพลตฟอร์ม คลิป ออเดอร์', class: 'chart-svg' }, paths, nodes, heads));
}

export function sparkline(values, { color = '#2563eb', width = 120, height = 32 } = {}) {
  if (values.length < 2) return h('span', { class: 'muted' }, '–');
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 4 - ((v - min) / span) * (height - 8)).toFixed(1)}`).join(' ');
  return svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'spark', role: 'img', 'aria-label': 'ประวัติราคา' },
    svg('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
}
