// Native SVG charts — zero chart libraries (rung 4). Each function returns an
// SVG string. Hover behaviour (dim siblings, highlight bar) is pure CSS in
// styles.css, so these stay static and cheap to re-render.
import { formatMoney } from './money.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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

  // Emphasize the latest bucket that has actually started — the final bucket is
  // often an empty future period (e.g. tomorrow), so don't blindly take the last.
  const nowMs = Date.now();
  let emphIdx = buckets.length - 1;
  for (let i = 0; i < buckets.length; i++) if (buckets[i].ts <= nowMs) emphIdx = i;

  const rects = buckets.map((b, i) => {
    const h = Math.round((b.amount / max) * innerH);
    const x = padL + i * (innerW / n) + gap / 2;
    const y = padT + innerH - h;
    const last = i === emphIdx;
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

// Compact money label from minor units: ₹1.2L / ₹12k / ₹450.
function short(minor) {
  const n = Math.round((minor || 0) / 100);
  if (n >= 100000) return '₹' + (n / 100000).toFixed(n % 100000 ? 1 : 0) + 'L';
  if (n >= 1000) return '₹' + (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k';
  return '₹' + n;
}
const emptyViz = (glyph, msg) => `<div class="empty viz-empty"><div class="glyph">${glyph}</div><p>${esc(msg)}</p></div>`;

/** Vertical 3-tier Sankey money-flow. flow = {income, spent, saved, savingsRate,
 *  sources:[{label,amount,color}], cats:[{id,label,icon,amount,color}]} (minor units).
 *  Income → Spent/Saved → categories. Tap a category node/ribbon to filter (data-cat). */
export function sankey(flow, W = 640, H = 340) {
  const { income = 0, spent = 0, saved = 0, sources = [], cats = [] } = flow;
  if (spent <= 0 && income <= 0) return emptyViz('🌊', 'No flows yet — import or paste some transactions.');
  const PAD = 18;
  const availW = W - PAD * 2;
  const denom = Math.max(income, spent, 1);
  const scale = availW / denom;
  const yS = 40, ySh = 15, yH = Math.round(H * 0.45), yHh = 17, yC = H - 46, yCh = 17;
  const hasIncome = income > 0 && sources.length > 0;
  const spentFrac = income > 0 ? Math.min(1, spent / income) : 1;
  const savedFrac = income > 0 ? Math.max(0, saved / income) : 0;

  const ribbon = (x0, y0, x1, y1, w, color, cat) => {
    const ym = (y0 + y1) / 2;
    const d = `M ${x0.toFixed(1)} ${y0} C ${x0.toFixed(1)} ${ym}, ${x1.toFixed(1)} ${ym}, ${x1.toFixed(1)} ${y1} L ${(x1 + w).toFixed(1)} ${y1} C ${(x1 + w).toFixed(1)} ${ym}, ${(x0 + w).toFixed(1)} ${ym}, ${(x0 + w).toFixed(1)} ${y0} Z`;
    return `<path class="rib" d="${d}" fill="${color}" fill-opacity="0.32"${cat ? ` data-action="filtertxn" data-cat="${cat}"` : ''}>${cat ? `<title>${esc(cat)}</title>` : ''}</path>`;
  };

  const ribbons = [], nodes = [];
  const spentN = { x: PAD, w: spent * scale };
  const savedN = { x: PAD + spent * scale, w: saved * scale };

  // sources tier
  if (hasIncome) {
    let sx = PAD; let sTop = spentN.x, vTop = savedN.x;
    sources.forEach((n) => {
      const w = n.amount * scale;
      nodes.push(`<rect x="${sx.toFixed(1)}" y="${yS}" width="${Math.max(2, w - 1).toFixed(1)}" height="${ySh}" rx="3" fill="${n.color}"><title>${esc(n.label)} · ${esc(formatMoney(n.amount))}</title></rect>`);
      nodes.push(`<text class="vz-sl" x="${(sx + w / 2).toFixed(1)}" y="${yS - 6}" text-anchor="middle">${esc(n.label)}</text>`);
      const a = n.amount * spentFrac * scale, b = n.amount * savedFrac * scale;
      ribbons.push(ribbon(sx, yS + ySh, sTop, yH, a, 'var(--negative)')); sTop += a;
      if (b > 0.3) { ribbons.push(ribbon(sx + a, yS + ySh, vTop, yH, b, 'var(--positive)')); vTop += b; }
      sx += w;
    });
  }
  // hub tier
  nodes.push(`<rect x="${spentN.x}" y="${yH}" width="${Math.max(2, spentN.w - 1).toFixed(1)}" height="${yHh}" rx="3" fill="var(--negative)"/>`);
  nodes.push(`<text class="vz-hl" x="${spentN.x + 4}" y="${yH - 7}" fill="var(--negative)">Spent ${short(spent)}</text>`);
  if (saved > 0) {
    nodes.push(`<rect x="${savedN.x.toFixed(1)}" y="${yH}" width="${Math.max(2, savedN.w - 1).toFixed(1)}" height="${yHh}" rx="3" fill="var(--positive)"/>`);
    nodes.push(`<text class="vz-hl" x="${(savedN.x + savedN.w - 1).toFixed(1)}" y="${yH - 7}" text-anchor="end" fill="var(--positive)">Saved ${short(saved)}</text>`);
  }
  // categories tier
  let cBot = spentN.x, cx = spentN.x;
  cats.forEach((c) => {
    const w = c.amount * scale;
    ribbons.push(ribbon(cBot, yH + yHh, cx, yC, w, c.color, c.id)); cBot += w;
    nodes.push(`<rect x="${cx.toFixed(1)}" y="${yC}" width="${Math.max(2, w - 1).toFixed(1)}" height="${yCh}" rx="3" fill="${c.color}" data-action="filtertxn" data-cat="${c.id}"><title>${esc(c.label)} · ${esc(formatMoney(c.amount))}</title></rect>`);
    nodes.push(`<text class="vz-cl" x="${(cx + w / 2).toFixed(1)}" y="${yC + yCh + 13}" text-anchor="middle">${c.icon}</text>`);
    if (w > 48) nodes.push(`<text class="vz-ca" x="${(cx + w / 2).toFixed(1)}" y="${yC + yCh + 25}" text-anchor="middle">${short(c.amount)}</text>`);
    cx += w;
  });
  const badge = flow.savingsRate != null ? `<text class="vz-rate" x="${W / 2}" y="${yH + yHh + 26}" text-anchor="middle">${flow.savingsRate}% saved</text>` : '';

  return `<svg class="sankey" viewBox="0 0 ${W} ${H}" role="img" aria-label="Money flow from income to spending categories">
    <style>.sankey .vz-sl{font:600 11px var(--font-mono);fill:var(--text-dim)}.sankey .vz-hl{font:600 12px var(--font-mono)}.sankey .vz-cl{font-size:14px}.sankey .vz-ca{font:600 10px var(--font-mono);fill:var(--text-mute)}.sankey .vz-rate{font:600 12px var(--font-mono);fill:var(--accent-text)}.sankey [data-cat]{cursor:pointer}.sankey .rib{transition:fill-opacity .2s var(--ease)}.sankey:hover .rib{fill-opacity:.14}.sankey .rib:hover{fill-opacity:.6}</style>
    ${ribbons.join('')}${badge}${nodes.join('')}</svg>`;
}

/** Calendar heatmap of daily spend. daily = minor[] indexed by day-of-month-1.
 *  opts = {firstDow (0=Mon..6=Sun), todayDom, monthLabel}. */
export function calHeatmap(daily, { firstDow = 0, todayDom = 0 } = {}) {
  const cell = 15, gap = 4, gut = 18, top = 16, rows = 7;
  const max = Math.max(1, ...daily);
  const cols = Math.ceil((firstDow + daily.length) / 7);
  const dows = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  let cells = '', labels = '';
  for (let r = 0; r < rows; r++) labels += `<text class="vz-hd" x="6" y="${top + r * (cell + gap) + cell - 3}">${dows[r]}</text>`;
  for (let d = 0; d < daily.length; d++) {
    const off = firstDow + d, col = Math.floor(off / 7), row = off % 7;
    const X = gut + col * (cell + gap), Y = top + row * (cell + gap);
    const v = daily[d], step = v <= 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4));
    const today = (d + 1) === todayDom;
    cells += `<rect x="${X}" y="${Y}" width="${cell}" height="${cell}" rx="3" fill="var(--heat${step})"${today ? ' stroke="var(--accent)" stroke-width="1.5"' : ''}><title>${esc(formatMoney(v))} · ${d + 1}</title></rect>`;
  }
  const Wd = gut + cols * (cell + gap) + 4, Hd = top + rows * (cell + gap);
  let leg = '';
  for (let k = 0; k < 5; k++) leg += `<rect x="${Wd + 14 + k * 13}" y="${top + 8}" width="10" height="10" rx="2.5" fill="var(--heat${k})"/>`;
  return `<svg class="calheat" viewBox="0 0 ${Wd + 92} ${Hd + 4}" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Daily spending heatmap">
    <style>.calheat .vz-hd,.calheat .vz-lg{font:600 9px var(--font-mono);fill:var(--text-mute)}</style>
    ${labels}${cells}<text class="vz-lg" x="${Wd + 10}" y="${top + 4}">Less</text>${leg}<text class="vz-lg" x="${Wd + 14 + 5 * 13 + 2}" y="${top + 17}">More</text></svg>`;
}

/** Squarified treemap. cats = [{id,label,icon,amount,color}] (minor units). Tap to filter. */
export function treemap(cats, W = 420, H = 200) {
  const items = cats.filter((c) => c.amount > 0);
  if (!items.length) return emptyViz('🧩', 'No spend to break down this period.');
  const total = items.reduce((s, c) => s + c.amount, 0), area = W * H;
  const nodes = items.map((c) => ({ c, a: c.amount / total * area }));
  const worst = (row, side) => { if (!row.length) return Infinity; let s = 0, mx = -1, mn = 1e18; row.forEach((o) => { s += o.a; if (o.a > mx) mx = o.a; if (o.a < mn) mn = o.a; }); return Math.max(side * side * mx / (s * s), s * s / (side * side * mn)); };
  const out = []; let rx = 0, ry = 0, rw = W, rh = H, i = 0;
  while (i < nodes.length) {
    const side = Math.min(rw, rh); const row = [];
    while (i < nodes.length) { const test = row.concat(nodes[i]); if (!row.length || worst(test, side) <= worst(row, side)) { row.push(nodes[i]); i++; } else break; }
    const rowA = row.reduce((s, o) => s + o.a, 0);
    if (rw <= rh) { const sh = rowA / rw; let px = rx; row.forEach((o) => { const cw = o.a / sh; out.push({ ...o, x: px, y: ry, w: cw, h: sh }); px += cw; }); ry += sh; rh -= sh; }
    else { const sw = rowA / rh; let py = ry; row.forEach((o) => { const ch = o.a / sw; out.push({ ...o, x: rx, y: py, w: sw, h: ch }); py += ch; }); rx += sw; rw -= sw; }
  }
  const g = out.map(({ c, x, y, w, h }) => {
    const big = w > 64 && h > 34, med = w > 30 && h > 24;
    let inner = '';
    if (big) inner = `<text class="vz-tl" x="${(x + 9).toFixed(1)}" y="${(y + 20).toFixed(1)}">${c.icon} ${esc(c.label)}</text><text class="vz-tv" x="${(x + 9).toFixed(1)}" y="${(y + 36).toFixed(1)}">${short(c.amount)}</text>`;
    else if (med) inner = `<text class="vz-ti" x="${(x + w / 2).toFixed(1)}" y="${(y + h / 2 + 5).toFixed(1)}" text-anchor="middle">${c.icon}</text>`;
    return `<g data-action="filtertxn" data-cat="${c.id}" class="vz-tm"><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="5" fill="${c.color}" stroke="var(--bg-elev)" stroke-width="2"/>${inner}<title>${esc(c.label)} · ${esc(formatMoney(c.amount))}</title></g>`;
  }).join('');
  return `<svg class="treemap" viewBox="0 0 ${W} ${H}" role="img" aria-label="Spending breakdown treemap">
    <style>.treemap .vz-tm{cursor:pointer}.treemap .vz-tm rect{transition:filter .2s var(--ease)}.treemap .vz-tm:hover rect{filter:brightness(1.13)}.treemap .vz-tl{font:700 12px var(--font-sans);fill:#fff}.treemap .vz-tv{font:600 12px var(--font-mono);fill:rgba(255,255,255,.86)}.treemap .vz-ti{font-size:15px}.treemap text{paint-order:stroke;stroke:rgba(0,0,0,.35);stroke-width:.6px}</style>
    ${g}</svg>`;
}

/** Cumulative spending pace. data = {cum:minor[], dayOfMonth, daysInMonth,
 *  baseline (minor, last month or budget), projected (minor)}. */
export function spendPace(data, W = 640, H = 200) {
  const { cum = [], daysInMonth = 30, dayOfMonth = 0, baseline = 0, projected = 0 } = data;
  if (!cum.length || cum[cum.length - 1] <= 0) return emptyViz('📈', 'No spending yet this month.');
  const maxY = Math.max(baseline, projected, cum[cum.length - 1], 1) * 1.08;
  const pl = 46, pr = 14, pt = 14, pb = 24, iw = W - pl - pr, ih = H - pt - pb;
  const X = (d) => pl + (d / (daysInMonth - 1)) * iw;
  const Y = (v) => pt + ih - (v / maxY) * ih;
  let grid = '';
  [0, baseline, maxY].forEach((v) => { if (v == null) return; const y = Y(v); grid += `<line x1="${pl}" y1="${y.toFixed(1)}" x2="${W - pr}" y2="${y.toFixed(1)}" stroke="var(--hairline)"/><text class="vz-ax" x="${pl - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${short(v)}</text>`; });
  const pts = cum.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
  const line = 'M ' + pts.join(' L ');
  const areaP = `M ${X(0).toFixed(1)},${Y(0).toFixed(1)} L ${pts.join(' L ')} L ${X(dayOfMonth - 1).toFixed(1)},${Y(0).toFixed(1)} Z`;
  const lastX = X(dayOfMonth - 1), lastY = Y(cum[cum.length - 1]);
  const proj = baseline ? `<line x1="${lastX.toFixed(1)}" y1="${lastY.toFixed(1)}" x2="${X(daysInMonth - 1).toFixed(1)}" y2="${Y(projected).toFixed(1)}" stroke="var(--warn)" stroke-width="1.5" stroke-dasharray="2 3"/>` : '';
  const pace = baseline ? `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(daysInMonth - 1).toFixed(1)}" y2="${Y(baseline).toFixed(1)}" stroke="var(--text-mute)" stroke-width="1.5" stroke-dasharray="4 4"/><text class="vz-lg2" x="${W - pr}" y="${(Y(baseline) - 5).toFixed(1)}" text-anchor="end" fill="var(--text-mute)">last month</text>` : '';
  return `<svg class="pace" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative spending pace this month">
    <style>.pace .vz-ax{font:600 10px var(--font-mono);fill:var(--text-mute)}.pace .vz-lg2{font:600 10px var(--font-mono)}</style>
    ${grid}<path d="${areaP}" fill="var(--accent-soft)"/>${pace}${proj}
    <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linejoin="round"/>
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3.8" fill="var(--accent)" stroke="var(--bg)" stroke-width="2"><title>Spent ${esc(formatMoney(cum[cum.length - 1]))} · projected ${esc(formatMoney(projected))}</title></circle>
    ${projected ? `<text class="vz-lg2" x="${W - pr}" y="${(Y(projected) + 12).toFixed(1)}" text-anchor="end" fill="var(--warn)">proj ${short(projected)}</text>` : ''}</svg>`;
}
