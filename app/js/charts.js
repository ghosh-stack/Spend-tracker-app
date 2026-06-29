// Native SVG charts — zero chart libraries (rung 4). Each function returns an
// SVG string. Hover behaviour (dim siblings, highlight bar) is pure CSS in
// styles.css, so these stay static and cheap to re-render.
import { formatMoney } from './money.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Donut from category slices [{label,color,amount,pct}]. pathLength=100 lets
 *  stroke-dasharray use percentages directly regardless of radius. */
export function donut(categories, centerTop = '', centerSub = '') {
  const slices = categories.filter((c) => c.pct > 0);
  let acc = 0;
  const ring = slices.length
    ? slices.map((c) => {
        const seg = `<circle class="slice" cx="21" cy="21" r="15.915" fill="none"
          stroke="${c.color}" stroke-width="5.4" pathLength="100"
          stroke-dasharray="${c.pct.toFixed(2)} ${(100 - c.pct).toFixed(2)}"
          stroke-dashoffset="${(-acc).toFixed(2)}"><title>${esc(c.label)} · ${c.pct.toFixed(1)}% · ${esc(formatMoney(c.amount))}</title></circle>`;
        acc += c.pct;
        return seg;
      }).join('')
    : `<circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--surface3)" stroke-width="5.4"></circle>`;
  return `<svg class="donut" viewBox="0 0 42 42" role="img" aria-label="Spending by category">
    <g transform="rotate(-90 21 21)">
      <circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--surface2)" stroke-width="5.4"></circle>
      ${ring}
    </g>
    <text class="donut-top" x="21" y="20.2" text-anchor="middle">${esc(centerTop)}</text>
    <text class="donut-sub" x="21" y="25" text-anchor="middle">${esc(centerSub)}</text>
  </svg>`;
}

/** Vertical bar chart from [{label, amount}]. Most-recent bar is emphasized. */
export function bars(buckets) {
  const W = 640, H = 240, padL = 8, padR = 8, padT = 16, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const max = Math.max(1, ...buckets.map((b) => b.amount));
  const n = buckets.length || 1;
  const gap = n > 30 ? 1 : 6;
  const bw = Math.max(2, innerW / n - gap);
  const labelEvery = Math.ceil(n / 6);

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const y = padT + innerH * (1 - f);
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="grid"></line>`;
  }).join('');

  const rects = buckets.map((b, i) => {
    const h = Math.round((b.amount / max) * innerH);
    const x = padL + i * (innerW / n) + gap / 2;
    const y = padT + innerH - h;
    const last = i === buckets.length - 1;
    return `<rect class="bar${last ? ' bar-emph' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}"
      width="${bw.toFixed(1)}" height="${Math.max(h, b.amount > 0 ? 2 : 0).toFixed(1)}" rx="${Math.min(4, bw / 2).toFixed(1)}">
      <title>${esc(b.label)} · ${esc(formatMoney(b.amount))}</title></rect>`;
  }).join('');

  const labels = buckets.map((b, i) =>
    i % labelEvery === 0
      ? `<text class="axis" x="${(padL + i * (innerW / n) + (innerW / n) / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(b.label)}</text>`
      : ''
  ).join('');

  return `<svg class="bars" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Spending over time">
    ${grid}${rects}${labels}</svg>`;
}

/** Tiny KPI sparkline. values: number[]. */
export function sparkline(values, { area = false, stroke = 'var(--accent)' } = {}) {
  const W = 120, H = 30, n = values.length;
  if (n < 2) return `<svg class="spark" viewBox="0 0 ${W} ${H}"></svg>`;
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (n - 1)) * W, H - 3 - ((v - min) / span) * (H - 6)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const fill = area
    ? `<path d="${line} L${W} ${H} L0 ${H} Z" fill="${stroke}" opacity="0.12"></path>`
    : '';
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    ${fill}<path d="${line}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
}
