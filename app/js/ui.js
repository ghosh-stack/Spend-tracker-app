// View layer: render the dashboard from IndexedDB, react to live ingest events,
// and own the modals/menus. innerHTML templating is fine at this scale; the
// data layer (queries.js) does the thinking, this file just paints.
import * as db from './db.js';
import * as ingest from './ingest.js';
import * as lock from './lock.js';
import * as notify from './notify.js';
import { applyFilter, summarize, series, relativeTime, rangeStart, insights, detectRecurring, DAY } from './queries.js';
import { donut, bars, sparkline, sankey, calHeatmap, treemap, spendPace, esc } from './charts.js';
import { formatMoney, splitMoney, toMinor } from './money.js';
import { CATEGORIES, categoryById } from './rules.js';
import { checkForUpdate, openDownload, currentVersion } from './update.js';
import { icon, brandMark } from './icons.js';
import { exportReport, PRESETS } from './report.js';

const $ = (sel) => document.querySelector(sel);
const RANGES = [['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year'], ['all', 'All']];

const state = { view: 'overview', range: 'month', category: null, accountId: null, search: '', breakdown: 'treemap' };
let _flashId = null; // id of a just-arrived txn, gets the slide-in animation

// previous-period sums (for the delta pills) over the full transaction set
const sumSpend = (txns, from, to) => txns.reduce((s, t) =>
  (t.ts >= from && t.ts < to && t.direction === 'debit' && categoryById(t.category).kind === 'expense') ? s + t.amount : s, 0);
const sumIncome = (txns, from, to) => txns.reduce((s, t) =>
  (t.ts >= from && t.ts < to && t.direction === 'credit' && categoryById(t.category).kind === 'income') ? s + t.amount : s, 0);

// ── lifecycle ─────────────────────────────────────────────────────────────
export function initUI() {
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('scroll', () => $('.topbar').classList.toggle('scrolled', window.scrollY > 4), { passive: true });

  ingest.onChange((evt) => {
    if (evt.type === 'transaction') _flashId = evt.txn.id;
    render();
    if (evt.type === 'transaction' && evt.txn) toast(`${evt.txn.direction === 'credit' ? 'Received' : 'Spent'} ${formatMoney(evt.txn.amount)} · ${categoryById(evt.txn.category).label}`);
  });

  wireIcons();
}

// Swap the static unicode/emoji chrome glyphs for the cohesive inline-SVG set.
// Category emoji (in the feed/charts) intentionally stay.
function wireIcons() {
  document.querySelectorAll('.brand-mark').forEach((el) => { el.innerHTML = brandMark(el.closest('.lock-card') ? 44 : 30); });
  const viewIco = { overview: 'dashboard', transactions: 'txns', recurring: 'recurring', insights: 'insights', unparsed: 'review' };
  const actIco = { import: 'import', sample: 'sparkle', export: 'export', erase: 'trash' };
  document.querySelectorAll('.rail .nav-item').forEach((b) => {
    const sp = b.querySelector('.nav-ico'); if (!sp) return;
    const name = b.dataset.view ? viewIco[b.dataset.view] : actIco[b.dataset.action];
    if (name) sp.innerHTML = icon(name, 18);
  });
  document.querySelectorAll('.bn-item').forEach((b) => {
    const sp = b.querySelector('span[aria-hidden]'); if (!sp) return;
    const name = b.dataset.view ? viewIco[b.dataset.view] : (b.dataset.action === 'menu' ? 'more' : null);
    if (name) sp.innerHTML = icon(name, 22);
  });
  const fab = $('.bn-fab'); if (fab) fab.innerHTML = icon('add', 24);
  const tt = $('#themeToggle'); if (tt) tt.innerHTML = icon('theme', 18);
}

export async function render() {
  const [txns, accounts] = await Promise.all([db.getAll('transactions'), db.getAll('accounts')]);
  const acctMap = new Map(accounts.map((a) => [a.id, a]));
  const filtered = applyFilter(txns, state);
  const summary = summarize(filtered);
  const buckets = series(filtered, state.range);

  // previous-period spend for the delta pills
  const start = rangeStart(state.range);
  const winLen = Date.now() - start || 1;
  const prevSpent = sumSpend(txns, start - winLen, start);
  const prevIncome = sumIncome(txns, start - winLen, start);

  syncNav();
  updateContext(accounts.length, summary);

  if (state.view === 'unparsed') return renderUnparsed();
  if (state.view === 'recurring') return renderRecurring(txns);
  if (state.view === 'insights') return renderInsights(txns);

  const showCharts = state.view === 'overview';
  $('#filters').style.display = '';
  $('#kpis').style.display = showCharts ? '' : 'none';
  $('#charts').style.display = showCharts ? '' : 'none';

  renderFilters(accounts);
  if (showCharts) {
    renderKPIs(summary, buckets, prevSpent, prevIncome);
    renderCharts(summary, buckets, filtered, txns);
  }
  let feed = filtered;
  if (state.view === 'transactions' && state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    feed = filtered.filter((t) => (t.merchant || '').toLowerCase().includes(q)
      || (t.notes || '').toLowerCase().includes(q)
      || (t.amount / 100).toFixed(2).includes(q));
  }
  renderFeed(feed, acctMap, state.view === 'overview' ? 25 : 500);
}

// ── regions ───────────────────────────────────────────────────────────────
function renderFilters(accounts) {
  const seg = RANGES.map(([v, l]) => `<button role="radio" data-range="${v}" aria-checked="${state.range === v}" tabindex="${state.range === v ? 0 : -1}">${l}</button>`).join('');
  const cats = ['<option value="">All categories</option>']
    .concat(CATEGORIES.filter((c) => c.id !== 'uncategorized').map((c) => `<option value="${c.id}" ${state.category === c.id ? 'selected' : ''}>${c.icon} ${esc(c.label)}</option>`)).join('');
  const accs = ['<option value="">All accounts</option>']
    .concat(accounts.map((a) => `<option value="${a.id}" ${state.accountId === a.id ? 'selected' : ''}>${esc(a.label)}</option>`)).join('');
  const active = state.category || state.accountId;
  $('#filters').innerHTML = `
    <div class="segment" role="radiogroup" aria-label="Date range">${seg}</div>
    <span class="field"><select class="input" id="catFilter" aria-label="Category">${cats}</select></span>
    <span class="field"><select class="input" id="acctFilter" aria-label="Account">${accs}</select></span>
    <span class="spacer"></span>
    ${active ? '<button class="btn ghost sm" data-action="reset">Reset</button>' : ''}`;
}

function kpiCard({ icon, label, valueMinor, delta, foot, spark }) {
  const m = splitMoney(valueMinor);
  return `<div class="card kpi">
    <div class="kpi-head"><span class="kpi-ico">${icon}</span>${esc(label)}</div>
    <div class="kpi-val">${m.sign}<span class="sym">${m.sym}</span>${m.whole}<span class="frac">${m.frac}</span></div>
    <div class="kpi-foot">${delta || '<span></span>'}${foot || spark || ''}</div>
  </div>`;
}

function deltaPill(curr, prev, lowerIsBetter) {
  if (!prev) return '<span class="delta flat">—</span>';
  const pct = Math.round(((curr - prev) / prev) * 100);
  const up = pct > 0, flat = pct === 0;
  const cls = flat ? 'flat' : lowerIsBetter ? (up ? 'up' : 'down') : (up ? 'good-up' : 'up');
  const arrow = flat ? '' : up ? '▲' : '▼';
  return `<span class="delta ${cls}">${arrow} ${Math.abs(pct)}%</span>`;
}

function renderKPIs(s, buckets, prevSpent, prevIncome) {
  const amts = buckets.map((b) => b.amount);
  let cum = 0; const cumAmts = amts.map((a) => (cum += a));
  const top = s.topCategory;
  const html = [
    kpiCard({ icon: '💸', label: 'Spent', valueMinor: s.spent, delta: deltaPill(s.spent, prevSpent, true), spark: sparkline(amts.length > 1 ? amts : [0, 0], { stroke: 'var(--accent)' }) }),
    kpiCard({ icon: '💰', label: 'Income', valueMinor: s.income, delta: deltaPill(s.income, prevIncome, false), foot: `<span class="hint mono">net ${formatMoney(s.net)}</span>` }),
    top
      ? `<div class="card kpi"><div class="kpi-head"><span class="kpi-ico">${top.icon}</span>Top category</div>
         <div class="kpi-val" style="font-size:1.5rem">${esc(top.label)}</div>
         <div class="kpi-foot"><span class="pill"><span class="dot" style="background:${top.color}"></span><span class="mono">${formatMoney(top.amount)}</span></span><span class="hint mono">${top.pct.toFixed(0)}% of spend</span></div></div>`
      : kpiCard({ icon: '📊', label: 'Top category', valueMinor: 0, foot: '<span class="hint">No spend yet</span>' }),
    kpiCard({ icon: s.net >= 0 ? '🟢' : '🔴', label: 'Net flow', valueMinor: s.net, foot: `<span class="hint mono">${s.net >= 0 ? 'saved' : 'overspent'}</span>`, spark: sparkline(cumAmts.length > 1 ? cumAmts : [0, 0], { area: true, stroke: 'var(--info)' }) }),
  ].join('');
  $('#kpis').innerHTML = html;
}

const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());

// Build the Sankey flow model from a summary + the period's transactions.
function buildFlow(s, txns) {
  const incomeTxns = txns.filter((t) => !t.excluded && t.direction === 'credit' && categoryById(t.category).kind === 'income');
  const map = new Map();
  for (const t of incomeTxns) {
    const k = ((t.merchant || 'Income').split('@')[0] || 'Income').trim();
    map.set(k, (map.get(k) || 0) + t.amount);
  }
  let arr = [...map.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
  const top = arr.slice(0, 3);
  const rest = arr.slice(3).reduce((x, o) => x + o.amount, 0);
  if (rest > 0) top.push({ label: 'Other', amount: rest });
  const shades = ['var(--positive)', '#36C98F', '#2BC6C6', '#57C98A'];
  const sources = top.map((o, i) => ({ label: titleCase(o.label).slice(0, 14), amount: o.amount, color: shades[i % shades.length] }));
  const cats = s.categories.slice(0, 6).map((c) => ({ id: c.id, label: c.label, icon: c.icon, amount: c.amount, color: c.color }));
  const restCat = s.categories.slice(6).reduce((x, c) => x + c.amount, 0);
  if (restCat > 0) cats.push({ id: 'other', label: 'Other', icon: '•', amount: restCat, color: 'var(--text-mute)' });
  const saved = Math.max(0, s.net);
  return { income: s.income, spent: s.spent, saved, savingsRate: s.income > 0 ? Math.round((saved / s.income) * 100) : null, sources, cats };
}

// Current calendar month's daily spend + cumulative (for heatmap & pace).
function monthDaily(txns) {
  const now = new Date(), y = now.getFullYear(), mo = now.getMonth();
  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const firstDow = (new Date(y, mo, 1).getDay() + 6) % 7; // 0 = Monday
  const daily = new Array(daysInMonth).fill(0);
  for (const t of txns) {
    if (t.excluded || t.direction !== 'debit' || categoryById(t.category).kind !== 'expense') continue;
    const d = new Date(t.ts);
    if (d.getFullYear() === y && d.getMonth() === mo) daily[d.getDate() - 1] += t.amount;
  }
  const cum = []; let acc = 0;
  for (let i = 0; i < dayOfMonth; i++) { acc += daily[i]; cum.push(acc); }
  return { daily, cum, dayOfMonth, daysInMonth, firstDow, monthLabel: now.toLocaleString('en-IN', { month: 'long' }) };
}

function legendHtml(s) {
  return s.categories.slice(0, 7).map((c) => `
    <div class="legend-row"><span class="dot" style="background:${c.color}"></span>
      <span class="lg-label">${c.icon} ${esc(c.label)}</span>
      <span class="lg-amt">${formatMoney(c.amount)}</span>
      <span class="lg-pct">${c.pct.toFixed(0)}%</span></div>`).join('') || '<p class="hint">No spending in this period.</p>';
}

function renderCharts(s, buckets, filtered, allTxns) {
  const ins = insights(allTxns);
  const flow = buildFlow(s, filtered);
  const mh = monthDaily(allTxns);
  const breakdownBody = state.breakdown === 'donut'
    ? `<div class="donut-wrap">${donut(s.categories, formatMoney(s.spent).replace(/\.\d+$/, ''), 'spent')}<div class="legend">${legendHtml(s)}</div></div>`
    : treemap(s.categories.slice(0, 8).map((c) => ({ id: c.id, label: c.label, icon: c.icon, amount: c.amount, color: c.color })), 420, 200);
  const trend = state.range === 'month'
    ? `<div class="chart-card chart-wide"><div class="chart-title"><span>Spending pace</span><span class="hint mono">${esc(mh.monthLabel)}</span></div>${spendPace({ cum: mh.cum, dayOfMonth: mh.dayOfMonth, daysInMonth: mh.daysInMonth, baseline: ins.lastSpent, projected: ins.projected })}</div>`
    : `<div class="chart-card chart-wide"><div class="chart-title"><span>Spending over time</span><span class="hint mono">${state.range}</span></div>${bars(buckets)}</div>`;
  $('#charts').innerHTML = `
    <div class="chart-card chart-hero">
      <div class="chart-title"><span>Money flow</span><span class="hint mono">${flow.savingsRate != null ? flow.savingsRate + '% saved' : 'income → spend'}</span></div>
      ${sankey(flow, 640, 340)}
    </div>
    <div class="chart-card">
      <div class="chart-title"><span>Breakdown</span>
        <span class="segment sm" role="group" aria-label="Breakdown style">
          <button data-action="breakdown" data-mode="treemap" aria-checked="${state.breakdown === 'treemap'}">Treemap</button>
          <button data-action="breakdown" data-mode="donut" aria-checked="${state.breakdown === 'donut'}">Donut</button>
        </span>
      </div>
      ${breakdownBody}
    </div>
    <div class="chart-card">
      <div class="chart-title"><span>Spending calendar</span><span class="hint mono">${esc(mh.monthLabel)}</span></div>
      <div class="heat-wrap">${calHeatmap(mh.daily, { firstDow: mh.firstDow, todayDom: mh.dayOfMonth })}</div>
    </div>
    ${trend}`;
}

function feedRow(t, acctMap) {
  const cat = categoryById(t.category);
  const acct = acctMap.get(t.accountId);
  const credit = t.direction === 'credit';
  const flash = t.id === _flashId ? ' enter' : '';
  return `<div class="row${flash}${t.excluded ? ' excluded' : ''}" data-id="${t.id}">
      <div class="tile" style="background:${cat.color}22;color:${cat.color}">${cat.icon}</div>
      <div class="row-main">
        <div class="row-merchant">${esc(t.merchant || cat.label)}</div>
        <div class="row-meta">
          <span class="pill"><span class="dot" style="background:${cat.color}"></span>${esc(cat.label)}</span>
          ${acct ? `<span>${esc(acct.label)}</span>` : ''}
          <span>${esc((t.method || '').toUpperCase())}</span>
          <span>${relativeTime(t.ts)}</span>
          ${t.channels && t.channels.length > 1 ? `<span class="pill" title="Matched across ${esc(t.channels.join(' + '))}">🔗 ${esc(t.channels.join('+'))}</span>` : ''}
          ${t.possibleDuplicateOf ? '<span class="pill" style="color:var(--warn);background:var(--warn-soft)">possible dup</span>' : ''}
          ${t.excluded ? '<span class="pill">excluded</span>' : ''}
        </div>
        ${t.notes ? `<div class="row-note">📝 ${esc(t.notes)}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="row-amt ${credit ? 'credit' : ''}${t.excluded ? ' struck' : ''}">${credit ? '+' : '−'}${formatMoney(t.amount)}</span>
        <span class="row-actions">
          <button class="mini" data-action="edit" data-id="${t.id}" aria-label="Edit transaction" title="Edit">✎</button>
          <button class="mini" data-action="del" data-id="${t.id}" aria-label="Delete transaction" title="Delete">✕</button>
        </span>
      </div>
    </div>`;
}

function renderFeed(txns, acctMap, limit) {
  const isTxnView = state.view === 'transactions';
  const search = isTxnView
    ? `<input class="input" id="txnSearch" placeholder="Search merchant, amount or note…" value="${esc(state.search)}" autocomplete="off" style="margin-bottom:12px">`
    : '';
  const head = `<div class="feed-head"><h2>${isTxnView ? 'All transactions' : 'Recent activity'}</h2>
    <span class="hint mono">${txns.length} txn${txns.length === 1 ? '' : 's'}</span></div>`;
  if (!txns.length) {
    const body = state.search ? '<p class="hint" style="text-align:center;padding:24px 0">No matches.</p>' : emptyState();
    $('#feedCard').innerHTML = `<div class="card">${head}${search}${body}</div>`;
    refocusSearch();
    return;
  }
  const rows = txns.slice(0, limit).map((t) => feedRow(t, acctMap)).join('');
  $('#feedCard').innerHTML = `<div class="card">${head}${search}<div class="feed">${rows}</div>
    ${txns.length > limit ? `<p class="hint" style="text-align:center;margin-top:12px">Showing ${limit} of ${txns.length}.</p>` : ''}</div>`;
  _flashId = null;
  refocusSearch();
}
function refocusSearch() {
  if (state.view !== 'transactions') return;
  const s = $('#txnSearch');
  if (s && state.search) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
}

function hideMainRegions() {
  $('#filters').style.display = 'none';
  $('#kpis').style.display = 'none';
  $('#charts').style.display = 'none';
}

function fmtNext(s) {
  const d = s.daysUntil;
  const ds = new Date(s.nextDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  if (d < 0) return `due ${Math.abs(d)}d ago · ${ds}`;
  if (d === 0) return `today · ${ds}`;
  if (d === 1) return `tomorrow · ${ds}`;
  return `in ${d} days · ${ds}`;
}

function seriesRow(s) {
  const cat = categoryById(s.category);
  const amt = s.amountKind === 'variable' ? `~${formatMoney(s.amountRange[0])}–${formatMoney(s.amountRange[1])}` : formatMoney(s.amountMinor);
  return `<div class="row" data-action="filtertxn" data-cat="${s.category}">
    <div class="tile" style="background:${cat.color}22;color:${cat.color}">${cat.icon}</div>
    <div class="row-main">
      <div class="row-merchant">${esc(s.displayName)}</div>
      <div class="row-meta">
        <span class="pill">${esc(s.kind)} · ${esc(s.cadenceLabel)}</span>
        <span>${s.occurrences}× since ${new Date(s.firstTs).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}</span>
        <span title="confidence ${(s.confidence * 100).toFixed(0)}%">${s.confidence >= 0.6 ? '● tracked' : '○ possible'}</span>
      </div>
    </div>
    <div style="text-align:right">
      <div class="row-amt">${amt}</div>
      <div class="hint mono">${formatMoney(s.monthlyEquivMinor)}/mo</div>
    </div>
  </div>`;
}

function renderRecurring(txns) {
  hideMainRegions();
  const all = detectRecurring(txns, Date.now()).filter((s) => s.status === 'active');
  if (!all.length) {
    $('#feedCard').innerHTML = `<div class="card"><div class="feed-head"><h2>Recurring</h2></div>${emptyState('No recurring payments yet', 'Subscriptions, SIPs and rent appear here automatically once there are a few months of history. Keep capturing.')}</div>`;
    return;
  }
  const confirmed = all.filter((s) => s.confidence >= 0.6);
  const possible = all.filter((s) => s.confidence >= 0.4 && s.confidence < 0.6);
  const monthly = confirmed.reduce((a, s) => a + s.monthlyEquivMinor, 0);
  const upcoming = confirmed.filter((s) => s.daysUntil >= -2 && s.daysUntil <= 30).sort((a, b) => a.daysUntil - b.daysUntil);
  const m = splitMoney(monthly);

  const upcomingHtml = upcoming.length ? `<div class="card"><div class="feed-head"><h2>Upcoming · next 30 days</h2></div>
    <div class="feed">${upcoming.map((s) => {
      const cat = categoryById(s.category);
      return `<div class="row"><div class="tile" style="background:${cat.color}22;color:${cat.color}">${cat.icon}</div>
        <div class="row-main"><div class="row-merchant">${esc(s.displayName)}</div>
        <div class="row-meta"><span class="${s.daysUntil <= 3 ? 'pill' : ''}" ${s.daysUntil <= 3 ? 'style="color:var(--warn);background:var(--warn-soft)"' : ''}>${fmtNext(s)}</span></div></div>
        <span class="row-amt">${formatMoney(s.amountMinor)}</span></div>`;
    }).join('')}</div></div>` : '';

  $('#feedCard').innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="kpi-head"><span class="kpi-ico">🔁</span>Monthly recurring</div>
      <div class="kpi-val">${m.sign}<span class="sym">${m.sym}</span>${m.whole}<span class="frac">${m.frac}</span></div>
      <div class="hint mono" style="margin-top:6px">${confirmed.length} subscription${confirmed.length === 1 ? '' : 's'} · ${formatMoney(monthly * 12)}/yr committed</div>
    </div>
    ${upcomingHtml}
    <div class="card" style="margin-top:16px"><div class="feed-head"><h2>All subscriptions</h2></div>
      <div class="feed">${confirmed.map(seriesRow).join('')}</div>
      ${possible.length ? `<p class="hint" style="margin:16px 0 8px">Might be recurring — confirm by leaving them, or they'll drop off:</p><div class="feed">${possible.map(seriesRow).join('')}</div>` : ''}
    </div>`;
}

async function renderInsights(txns) {
  hideMainRegions();
  const ins = insights(txns, Date.now());
  const budgets = await db.getAll('budgets');
  const bMap = new Map(budgets.map((b) => [b.categoryId, b.monthly]));
  const monthTx = txns.filter((t) => t.ts >= rangeStart('month'));
  const spendByCat = new Map(summarize(monthTx).categories.map((c) => [c.categoryId, c.amount]));

  const kpi = (icon, label, value, sub) => `<div class="card kpi" style="min-height:104px">
    <div class="kpi-head"><span class="kpi-ico">${icon}</span>${label}</div>
    <div class="kpi-val" style="font-size:1.6rem">${value}</div>
    ${sub ? `<div class="kpi-foot">${sub}</div>` : ''}</div>`;
  const momPill = ins.momPct == null ? '<span class="hint">no prior month</span>'
    : `<span class="delta ${ins.momPct > 0 ? 'up' : ins.momPct < 0 ? 'down' : 'flat'}">${ins.momPct > 0 ? '▲' : ins.momPct < 0 ? '▼' : ''} ${Math.abs(ins.momPct)}% vs last mo</span>`;

  const expenseCats = CATEGORIES.filter((c) => c.kind === 'expense' && c.id !== 'uncategorized');
  const budgetRows = expenseCats.map((c) => {
    const spent = spendByCat.get(c.id) || 0;
    const budget = bMap.get(c.id) || 0;
    if (!spent && !budget) return '';
    const pct = budget ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
    const over = budget && spent > budget;
    return `<div class="budget-row">
      <div class="budget-head"><span class="pill"><span class="dot" style="background:${c.color}"></span>${c.icon} ${esc(c.label)}</span>
        <span class="mono">${formatMoney(spent)}${budget ? ` / ${formatMoney(budget)}` : ''} ${over ? '<span style="color:var(--negative)">over</span>' : ''}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${budget ? pct : 0}%;background:${over ? 'var(--negative)' : c.color}"></div></div>
      <input class="input bsm" data-action="setbudget" data-cat="${c.id}" type="number" min="0" step="100" inputmode="numeric" placeholder="Set monthly budget ₹" value="${budget ? budget / 100 : ''}">
    </div>`;
  }).join('');

  const maxMerchant = Math.max(1, ...ins.topMerchants.map((m) => m.amount));
  const merchantRows = ins.topMerchants.map((mm) => `<div class="mrow">
    <span class="mname">${esc(mm.merchant)}</span>
    <div class="bar-track" style="flex:1"><div class="bar-fill" style="width:${Math.round((mm.amount / maxMerchant) * 100)}%;background:var(--accent)"></div></div>
    <span class="mono">${formatMoney(mm.amount)}</span></div>`).join('') || '<p class="hint">No spending yet this month.</p>';

  $('#feedCard').innerHTML = `
    <div class="kpis" style="margin-bottom:16px">
      ${kpi('💸', 'Spent this month', formatMoney(ins.thisSpent), momPill)}
      ${kpi('📈', 'Projected month-end', formatMoney(ins.projected), `<span class="hint mono">at ${formatMoney(ins.dailyAvg)}/day</span>`)}
      ${kpi('💰', 'Income', formatMoney(ins.income), ins.savingsRate == null ? '' : `<span class="hint mono">${ins.savingsRate}% saved</span>`)}
      ${kpi('🧾', 'Biggest spend', ins.biggest ? formatMoney(ins.biggest.amount) : '—', ins.biggest ? `<span class="hint">${esc(ins.biggest.merchant || categoryById(ins.biggest.category).label)}</span>` : '')}
    </div>
    <div class="card" style="margin-bottom:16px"><div class="feed-head"><h2>Budgets · this month</h2></div>
      ${budgetRows || '<p class="hint">Set a monthly budget on any category to track it here.</p>'}
      ${budgetRows ? '' : expenseCats.slice(0, 6).map((c) => `<div class="budget-row"><div class="budget-head"><span class="pill"><span class="dot" style="background:${c.color}"></span>${c.icon} ${esc(c.label)}</span></div><input class="input bsm" data-action="setbudget" data-cat="${c.id}" type="number" min="0" step="100" placeholder="Set monthly budget ₹"></div>`).join('')}
    </div>
    <div class="card"><div class="feed-head"><h2>Top merchants · this month</h2></div>${merchantRows}</div>`;
}

async function renderUnparsed() {
  $('#kpis').style.display = 'none';
  $('#charts').style.display = 'none';
  $('#filters').style.display = 'none';
  const msgs = (await db.getAllByIndex('raw_messages', 'by_status', 'unparsed')).reverse();
  const body = msgs.length
    ? msgs.map((m) => `<div class="row" data-id="${m.id}" style="grid-template-columns:1fr auto">
        <div class="row-main"><div class="row-merchant" style="font-family:var(--font-mono);font-size:13px;white-space:normal">${esc(m.body)}</div>
        <div class="row-meta"><span class="pill">${esc(m.source)}</span>${esc(m.sender || '')}<span>${relativeTime(m.receivedAt)}</span></div></div>
        <span class="row-actions" style="opacity:1"><button class="mini" data-action="addfrom" data-id="${m.id}">Add manually</button>
        <button class="mini" data-action="delraw" data-id="${m.id}" aria-label="Delete message">✕</button></span></div>`).join('')
    : `${emptyState('All clear', 'No messages failed to parse. Anything we can\'t read shows up here so you can add it by hand or write a rule.')}`;
  $('#feedCard').innerHTML = `<div class="card"><div class="feed-head"><h2>Needs review</h2><span class="hint mono">${msgs.length}</span></div>
    ${msgs.length ? `<p class="hint" style="margin-bottom:12px">These didn't match any bank format. Add them manually, or extend <code>app/js/rules.js</code>.</p>` : ''}
    <div class="feed">${body}</div></div>`;
}

function emptyState(title = 'No spend yet this month', msg = 'Paste a bank SMS or email, add an expense, or load the demo data to see your dashboard come alive.') {
  return `<div class="empty"><div class="glyph">✦</div><h3>${esc(title)}</h3><p>${esc(msg)}</p>
    <button class="btn primary" data-action="add">+ Add expense</button>
    <button class="btn ghost" data-action="sample">Load demo data</button></div>`;
}

function updateContext(nAccounts, s) {
  const now = new Date();
  const period = state.range === 'month' ? now.toLocaleString('en-IN', { month: 'long', year: 'numeric' })
    : state.range === 'all' ? 'All time' : `Last ${state.range}`;
  $('#viewTitle').textContent = { overview: 'Overview', transactions: 'Transactions', recurring: 'Recurring', insights: 'Insights', unparsed: 'Needs review' }[state.view] || 'Overview';
  $('#contextLine').textContent = `${period} · ${nAccounts} account${nAccounts === 1 ? '' : 's'} · ${formatMoney(s.spent)} spent`;
}

function syncNav() {
  document.querySelectorAll('[data-view]').forEach((b) => {
    if (b.dataset.view === state.view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

// ── events ──────────────────────────────────────────────────────────────────
function onChange(e) {
  if (e.target.id === 'catFilter') { state.category = e.target.value || null; render(); }
  if (e.target.id === 'acctFilter') { state.accountId = e.target.value || null; render(); }
  if (e.target.dataset && e.target.dataset.action === 'setbudget') {
    const cat = e.target.dataset.cat;
    const rupees = parseFloat(e.target.value);
    const done = () => render();
    if (e.target.value === '' || isNaN(rupees) || rupees <= 0) db.del('budgets', cat).then(done);
    else db.put('budgets', { categoryId: cat, monthly: Math.round(rupees * 100) }).then(done);
  }
}

function onInput(e) {
  if (e.target.id === 'txnSearch') { state.search = e.target.value; render(); }
}

// Arrow-key navigation for the date-range radiogroup (single tab stop).
function onKeydown(e) {
  const btn = e.target.closest && e.target.closest('.segment [role="radio"]');
  if (!btn) return;
  const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!delta) return;
  e.preventDefault();
  const idx = RANGES.findIndex(([v]) => v === state.range);
  state.range = RANGES[(idx + delta + RANGES.length) % RANGES.length][0];
  render().then(() => $('.segment [role="radio"][aria-checked="true"]')?.focus());
}

async function onClick(e) {
  const t = e.target.closest('[data-view],[data-range],[data-action]');
  if (!t) return;
  if (t.dataset.view) { state.view = t.dataset.view; if (state.view !== 'transactions') state.search = ''; closeModal(); render(); return; }
  if (t.dataset.range) { state.range = t.dataset.range; render(); return; }
  const id = t.dataset.id;
  switch (t.dataset.action) {
    case 'reset': state.category = null; state.accountId = null; render(); break;
    case 'add': openAddModal(); break;
    case 'paste': openPasteModal(); break;
    case 'menu': openMenuModal(); break;
    case 'settings': openSettingsModal(); break;
    case 'updates': openUpdatesModal(); break;
    case 'report': openReportModal(); break;
    case 'breakdown': if (state.breakdown !== t.dataset.mode) { state.breakdown = t.dataset.mode; render(); } break;
    case 'edit': openEditModal(id); break;
    case 'filtertxn': state.view = 'transactions'; state.category = t.dataset.cat; state.search = ''; render(); break;
    case 'addfrom': { const m = await db.get('raw_messages', id); openAddModal(m?.body); break; }
    case 'del': await ingest.deleteTxn(id); toast('Deleted'); render(); break;
    case 'delraw': await db.del('raw_messages', id); render(); break;
    case 'import': $('#fileInput').click(); break;
    case 'sample': await loadSample(); break;
    case 'export': exportData(); break;
    case 'erase': eraseAll(); break;
    case 'close': closeModal(); break;
  }
}

// ── modals ────────────────────────────────────────────────────────────────
function openModal(html) {
  const m = $('#modal');
  m.innerHTML = html;
  // Name the dialog from its heading (so AT announces it), then move focus to the
  // first actionable control rather than the close button.
  const h = m.querySelector('.modal-head h3, .modal-head h2');
  if (h) { h.id = h.id || 'modalTitle'; m.setAttribute('aria-labelledby', h.id); }
  m.showModal();
  const focusTarget = m.querySelector('[autofocus]') ||
    m.querySelector('.modal-body button, .modal-body input, .modal-body select, .modal-body textarea');
  focusTarget?.focus();
}
function closeModal() { $('#modal').close(); }

function catOptions(selected = 'uncategorized') {
  return CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${c.icon} ${esc(c.label)}</option>`).join('');
}

function openAddModal(prefillNote = '') {
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  openModal(`<form method="dialog" id="addForm">
    <div class="modal-head"><h3>Add expense</h3><button class="btn ghost icon" type="button" data-action="close" aria-label="Close">✕</button></div>
    <div class="modal-body">
      <div class="grid2">
        <label class="lab">Amount (₹)<input class="input mono" name="amount" type="number" min="0" step="0.01" required autofocus></label>
        <label class="lab">Type<select class="input" name="direction"><option value="debit">Expense</option><option value="credit">Income</option></select></label>
      </div>
      <label class="lab">Merchant / note<input class="input" name="merchant" value="${esc(prefillNote)}" placeholder="e.g. Auto rickshaw"></label>
      <div class="grid2">
        <label class="lab">Category<select class="input" name="category">${catOptions()}</select></label>
        <label class="lab">When<input class="input" name="when" type="datetime-local" value="${nowLocal}"></label>
      </div>
    </div>
    <div class="modal-foot"><button class="btn ghost" type="button" data-action="close">Cancel</button>
      <button class="btn primary" type="submit">Add</button></div>
  </form>`);
  $('#addForm').addEventListener('submit', async (ev) => {
    const f = new FormData(ev.target);
    const minor = toMinor(f.get('amount'));
    if (!minor) return;
    await ingest.addManualTxn({
      amount: minor, direction: f.get('direction'),
      merchant: f.get('merchant').trim(), category: f.get('category'),
      ts: f.get('when') ? new Date(f.get('when')).getTime() : Date.now(),
      method: f.get('direction') === 'credit' ? 'other' : 'cash',
    });
    closeModal(); toast('Added'); render();
  });
}

function openPasteModal() {
  openModal(`<form id="pasteForm">
    <div class="modal-head"><h3>Paste a bank alert</h3><button class="btn ghost icon" type="button" data-action="close" aria-label="Close">✕</button></div>
    <div class="modal-body">
      <p class="hint">Paste the exact SMS or email text. SpendLens parses it locally — nothing is sent anywhere.</p>
      <label class="lab">Source<select class="input" name="source"><option value="sms">SMS</option><option value="email">Email</option><option value="manual">Other</option></select></label>
      <label class="lab">Message<textarea class="input" name="body" required placeholder="Sent Rs.499.00 From HDFC Bank A/C x1234 To SWIGGY On 28-06-26 Ref 451234567890"></textarea></label>
    </div>
    <div class="modal-foot"><button class="btn ghost" type="button" data-action="close">Cancel</button>
      <button class="btn primary" type="submit">Parse</button></div>
  </form>`);
  $('#pasteForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const r = await ingest.ingestText(f.get('body'), f.get('source'));
    closeModal();
    toast({ parsed: 'Parsed & added ✓', unparsed: "Couldn't read that — added to Needs review", duplicate: 'Already recorded', 'duplicate-txn': 'Already recorded' }[r] || 'Done');
    render();
  });
}

async function openEditModal(id) {
  const t = await db.get('transactions', id);
  if (!t) return;
  openModal(`<form id="editForm">
    <div class="modal-head"><h3>Edit transaction</h3><button class="btn ghost icon" type="button" data-action="close" aria-label="Close">✕</button></div>
    <div class="modal-body">
      <div class="lab">Category
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">
          ${CATEGORIES.filter((c) => c.id !== 'uncategorized').map((c) => `<button type="button" class="btn sm cat-pick${c.id === t.category ? ' primary' : ''}" data-cat="${c.id}">${c.icon} ${esc(c.label)}</button>`).join('')}
        </div>
        <span class="hint" style="margin-top:6px">Re-categorizing also tags other transactions from this merchant.</span>
      </div>
      <label class="lab">Note<input class="input" name="notes" value="${esc(t.notes || '')}" placeholder="e.g. work reimbursable"></label>
      <label class="lab" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="excluded" ${t.excluded ? 'checked' : ''}> Exclude from spending totals</label>
    </div>
    <div class="modal-foot"><button class="btn ghost" type="button" data-action="close">Cancel</button>
      <button class="btn primary" type="submit">Save</button></div>
  </form>`);
  let chosenCat = t.category;
  $('#modal').querySelectorAll('.cat-pick').forEach((b) => b.addEventListener('click', () => {
    chosenCat = b.dataset.cat;
    $('#modal').querySelectorAll('.cat-pick').forEach((x) => x.classList.toggle('primary', x === b));
  }));
  $('#editForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    let applied = 0;
    if (chosenCat !== t.category) { const r = await ingest.recategorize(id, chosenCat); applied = r.applied || 0; }
    await ingest.updateTxn(id, { notes: (f.get('notes') || '').trim(), excluded: f.get('excluded') === 'on' });
    closeModal();
    toast(applied ? `Saved · +${applied} more re-categorized` : 'Saved');
    render();
  });
}

function openMenuModal() {
  openModal(`<div class="modal-head"><h3>More</h3><button class="btn ghost icon" data-action="close" aria-label="Close">✕</button></div>
    <div class="modal-body" style="gap:8px">
      <button class="btn" data-view="insights">📊 Insights & budgets</button>
      <button class="btn" data-view="unparsed">⚠ Needs review</button>
      <button class="btn" data-action="settings">🔒 Privacy & alerts</button>
      <button class="btn" data-action="paste">Paste a bank alert</button>
      <button class="btn" data-action="import">Import file (.json / .csv)</button>
      <button class="btn" data-action="sample">Load demo data</button>
      <button class="btn" data-action="export">Export my data</button>
      <button class="btn" data-action="report">📄 Export PDF report</button>
      <button class="btn" data-action="updates">⟳ Check for updates</button>
      <button class="btn" data-action="erase" style="color:var(--negative)">Erase all data</button>
    </div>`);
}

// PDF report export: pick a period, build the report on-device, open print → Save as PDF.
function openReportModal() {
  const presets = PRESETS.map(([v, l], i) => `<button type="button" class="rp-preset" data-preset="${v}" aria-pressed="${i === 1}">${esc(l)}</button>`).join('');
  openModal(`<div class="modal-head"><h3>Export PDF report</h3><button class="btn ghost icon" data-action="close" aria-label="Close">✕</button></div>
    <div class="modal-body">
      <p class="hint">Pick a period. SpendLens builds the report on-device and opens your print dialog — choose “Save as PDF”.</p>
      <div class="rp-presets">${presets}</div>
      <div id="rpCustom" hidden class="grid2">
        <label class="lab">From<input class="input" type="date" id="rpFrom"></label>
        <label class="lab">To<input class="input" type="date" id="rpTo"></label>
      </div>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-action="close">Cancel</button>
      <button class="btn primary" id="rpGo">Generate PDF</button></div>`);
  const m = $('#modal');
  let preset = 'month';
  m.querySelectorAll('.rp-preset').forEach((b) => b.addEventListener('click', () => {
    preset = b.dataset.preset;
    m.querySelectorAll('.rp-preset').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    m.querySelector('#rpCustom').hidden = preset !== 'custom';
  }));
  m.querySelector('#rpGo').addEventListener('click', async () => {
    const from = m.querySelector('#rpFrom') ? m.querySelector('#rpFrom').value : '';
    const to = m.querySelector('#rpTo') ? m.querySelector('#rpTo').value : '';
    if (preset === 'custom' && !from && !to) { toast('Pick a date range'); return; }
    closeModal();
    toast('Building report…');
    try { await exportReport(preset, from, to); } catch (e) { toast("Couldn't build the report"); }
  });
}

// In-app updater: shows the running version and checks GitHub Releases for a
// newer sideloadable APK. One button that flips from "Check" to "Download".
function openUpdatesModal() {
  openModal(`<div class="modal-head"><h3>Updates</h3><button class="btn ghost icon" data-action="close" aria-label="Close">✕</button></div>
    <div class="modal-body" style="gap:12px">
      <p class="hint">You're running <b>SpendLens v${esc(currentVersion)}</b>. Tapping below asks GitHub for the latest release — a one-off version lookup; nothing about your data leaves the device.</p>
      <div id="updateStatus" class="hint" aria-live="polite" style="min-height:20px"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primary" id="updateBtn" type="button">Check for updates</button>
        <button class="btn ghost" id="updateNotes" type="button" hidden>Release notes ↗</button>
      </div>
    </div>`);
  const statusEl = $('#updateStatus');
  const btn = $('#updateBtn');
  const notesBtn = $('#updateNotes');
  let downloadUrl = null;
  btn.addEventListener('click', async () => {
    if (downloadUrl) { openDownload(downloadUrl); return; } // second tap = download
    btn.disabled = true;
    statusEl.textContent = 'Checking…';
    const r = await checkForUpdate();
    btn.disabled = false;
    if (r.status === 'available') {
      statusEl.innerHTML = `<span style="color:var(--positive)">Update available: <b>v${esc(r.latest)}</b></span> — you have v${esc(currentVersion)}. Download, then reinstall over the top to keep your data.`;
      btn.textContent = `Download v${esc(r.latest)}`;
      downloadUrl = r.downloadUrl;
      if (r.htmlUrl) { notesBtn.hidden = false; notesBtn.onclick = () => openDownload(r.htmlUrl); }
    } else if (r.status === 'current') {
      statusEl.innerHTML = `<span style="color:var(--positive)">You're up to date ✓</span> (v${esc(currentVersion)}).`;
    } else if (r.status === 'none') {
      statusEl.textContent = 'No published releases found yet.';
    } else if (r.status === 'offline') {
      statusEl.textContent = "Couldn't reach GitHub — check your connection and try again.";
    } else {
      statusEl.textContent = `Couldn't check for updates${r.code ? ' (HTTP ' + r.code + ')' : ''}.`;
    }
  });
}

async function openSettingsModal() {
  const lockOn = await lock.isEnabled();
  const np = await notify.getPrefs();
  openModal(`<form id="settingsForm">
    <div class="modal-head"><h3>Privacy & alerts</h3><button class="btn ghost icon" type="button" data-action="close" aria-label="Close">✕</button></div>
    <div class="modal-body">
      <div class="lab">App lock
        ${lockOn
          ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="pill" style="color:var(--positive);background:var(--pos-soft)">PIN on</span>
             <button type="button" class="btn sm" id="changePin">Change PIN</button>
             <button type="button" class="btn sm" id="offPin">Turn off</button></div>`
          : `<div style="display:flex;gap:8px;flex-wrap:wrap"><input class="input mono" id="newPin" type="password" inputmode="numeric" maxlength="12" placeholder="Set a 4–12 digit PIN" style="max-width:220px">
             <button type="button" class="btn sm primary" id="setPinBtn">Enable</button></div>`}
        <span class="hint">Locks the app on this device and on every return to background. It's an access gate, not encryption — recovery is via your Export backup.</span>
      </div>
      <label class="lab" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="notifEnabled" ${np.enabled ? 'checked' : ''}> Spending alerts (large transactions & budgets)</label>
      <label class="lab">Large-transaction alert above (₹)<input class="input mono" id="largeTxn" type="number" min="0" step="500" value="${(np.largeTxn || 500000) / 100}"></label>
      <label class="lab" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="hideAmounts" ${np.hideAmounts ? 'checked' : ''}> Hide amounts in notifications (lock-screen privacy)</label>
    </div>
    <div class="modal-foot"><button class="btn primary" type="submit">Done</button></div>
  </form>`);
  const m = $('#modal');
  m.querySelector('#setPinBtn')?.addEventListener('click', async () => {
    const v = m.querySelector('#newPin').value.trim();
    if (!/^\d{4,12}$/.test(v)) return toast('PIN must be 4–12 digits');
    await lock.setPin(v); toast('App lock enabled'); openSettingsModal();
  });
  m.querySelector('#offPin')?.addEventListener('click', async () => { await lock.disable(); toast('App lock off'); openSettingsModal(); });
  m.querySelector('#changePin')?.addEventListener('click', async () => { await lock.disable(); openSettingsModal(); });
  $('#settingsForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const enabled = m.querySelector('#notifEnabled').checked;
    const largeTxn = Math.round((parseFloat(m.querySelector('#largeTxn').value) || 5000) * 100);
    if (enabled && !(await notify.requestPermission())) toast('Allow notifications in your browser/system settings');
    await notify.setPrefs({ ...np, enabled, largeTxn, hideAmounts: m.querySelector('#hideAmounts').checked });
    closeModal(); toast('Saved');
  });
}

// ── data actions ────────────────────────────────────────────────────────────
async function loadSample() {
  closeModal();
  toast('Loading demo data…');
  const res = await fetch('data/sample-notifications.json').catch(() => null);
  if (!res || !res.ok) return toast('Could not load demo data');
  const msgs = await res.json();
  let n = 0, merged = 0;
  for (const m of msgs) { const r = await ingest.ingestRaw(m); if (r === 'parsed') n++; else if (r === 'merged') merged++; }
  toast(`Loaded ${n} transactions${merged ? ` · merged ${merged} SMS+email` : ''}`);
  render();
}

async function exportData() {
  closeModal();
  const dump = {};
  for (const s of db.STORES) dump[s] = await db.getAll(s);
  dump.exportedAt = new Date().toISOString();
  download(`spendlens-export-${Date.now()}.json`, JSON.stringify(dump, null, 2), 'application/json');
  // also a friendly CSV of transactions
  const txns = dump.transactions || [];
  const csv = ['date,merchant,category,direction,amount_inr,method,account,ref']
    .concat(txns.map((t) => [new Date(t.ts).toISOString(), q(t.merchant), t.category, t.direction, (t.amount / 100).toFixed(2), t.method, t.accountId, t.ref].join(','))).join('\n');
  download(`spendlens-transactions-${Date.now()}.csv`, csv, 'text/csv');
  toast('Exported JSON + CSV');
}
const q = (s) => {
  let v = String(s ?? '');
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; // neutralize spreadsheet formula injection
  return `"${v.replace(/"/g, '""')}"`;
};

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click(); URL.revokeObjectURL(url);
}

async function importFile(file) {
  const text = await file.text();
  if (file.name.endsWith('.json')) {
    try {
      const data = JSON.parse(text);
      if (data.transactions) { // restore an export
        for (const s of db.STORES) for (const rec of data[s] || []) await db.put(s, rec);
        toast('Restored from backup'); return render();
      }
    } catch { /* fall through to line ingest */ }
  }
  // treat as newline-separated bank alerts
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length < 8) continue;
    if ((await ingest.ingestText(line.trim(), 'import-csv')) === 'parsed') n++;
  }
  toast(`Imported ${n} transactions`); render();
}

async function eraseAll() {
  closeModal();
  openModal(`<div class="modal-head"><h3>Erase all data?</h3><button class="btn ghost icon" data-action="close" aria-label="Close">✕</button></div>
    <div class="modal-body"><p>This permanently deletes every transaction, account, rule and raw message from this device. There is no cloud copy. This cannot be undone.</p></div>
    <div class="modal-foot"><button class="btn ghost" data-action="close">Cancel</button>
      <button class="btn primary" id="confirmErase" style="background:var(--negative)">Erase everything</button></div>`);
  $('#confirmErase').addEventListener('click', async () => { await db.deleteDatabase(); location.reload(); });
}

// ── toast ─────────────────────────────────────────────────────────────────
let toastTimer;
export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// wire the hidden file input + theme toggle once
export function wireGlobals() {
  $('#fileInput').addEventListener('change', (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; });
  $('#themeToggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('spendlens-theme', next);
    document.querySelector('meta[name=theme-color]').setAttribute('content', next === 'dark' ? '#0b1014' : '#f4f6f8');
  });
}

export function setLive(on) {
  const pill = $('#livePill');
  pill.classList.toggle('on', on);
  $('#liveText').textContent = on ? 'Live' : 'Offline';
}

export function setUnparsedBadge(n) {
  const b = $('#unparsedBadge');
  b.hidden = !n; b.textContent = n;
}
