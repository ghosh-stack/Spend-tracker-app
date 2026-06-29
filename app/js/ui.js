// View layer: render the dashboard from IndexedDB, react to live ingest events,
// and own the modals/menus. innerHTML templating is fine at this scale; the
// data layer (queries.js) does the thinking, this file just paints.
import * as db from './db.js';
import * as ingest from './ingest.js';
import { applyFilter, summarize, series, relativeTime, rangeStart } from './queries.js';
import { donut, bars, sparkline } from './charts.js';
import { formatMoney, splitMoney, toMinor } from './money.js';
import { CATEGORIES, categoryById } from './rules.js';

const $ = (sel) => document.querySelector(sel);
const RANGES = [['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year'], ['all', 'All']];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = { view: 'overview', range: 'month', category: null, accountId: null };
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
  window.addEventListener('scroll', () => $('.topbar').classList.toggle('scrolled', window.scrollY > 4), { passive: true });

  ingest.onChange((evt) => {
    if (evt.type === 'transaction') _flashId = evt.txn.id;
    render();
    if (evt.type === 'transaction' && evt.txn) toast(`${evt.txn.direction === 'credit' ? 'Received' : 'Spent'} ${formatMoney(evt.txn.amount)} · ${categoryById(evt.txn.category).label}`);
  });
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

  const showCharts = state.view === 'overview';
  $('#filters').style.display = '';
  $('#kpis').style.display = showCharts ? '' : 'none';
  $('#charts').style.display = showCharts ? '' : 'none';

  renderFilters(accounts);
  if (showCharts) {
    renderKPIs(summary, buckets, prevSpent, prevIncome);
    renderCharts(summary, buckets);
  }
  renderFeed(filtered, acctMap, state.view === 'overview' ? 25 : 500);
}

// ── regions ───────────────────────────────────────────────────────────────
function renderFilters(accounts) {
  const seg = RANGES.map(([v, l]) => `<button data-range="${v}" aria-pressed="${state.range === v}">${l}</button>`).join('');
  const cats = ['<option value="">All categories</option>']
    .concat(CATEGORIES.filter((c) => c.id !== 'uncategorized').map((c) => `<option value="${c.id}" ${state.category === c.id ? 'selected' : ''}>${c.icon} ${esc(c.label)}</option>`)).join('');
  const accs = ['<option value="">All accounts</option>']
    .concat(accounts.map((a) => `<option value="${a.id}" ${state.accountId === a.id ? 'selected' : ''}>${esc(a.label)}</option>`)).join('');
  const active = state.category || state.accountId;
  $('#filters').innerHTML = `
    <div class="segment" role="group" aria-label="Date range">${seg}</div>
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

function renderCharts(s, buckets) {
  const legend = s.categories.slice(0, 7).map((c) => `
    <div class="legend-row"><span class="dot" style="background:${c.color}"></span>
      <span class="lg-label">${c.icon} ${esc(c.label)}</span>
      <span class="lg-amt">${formatMoney(c.amount)}</span>
      <span class="lg-pct">${c.pct.toFixed(0)}%</span></div>`).join('') || '<p class="hint">No spending in this period.</p>';
  $('#charts').innerHTML = `
    <div class="chart-card">
      <div class="chart-title"><span>Spending by category</span></div>
      <div class="donut-wrap">
        ${donut(s.categories, formatMoney(s.spent).replace(/\.\d+$/, ''), 'spent')}
        <div class="legend">${legend}</div>
      </div>
    </div>
    <div class="chart-card">
      <div class="chart-title"><span>Spending over time</span><span class="hint mono">${state.range}</span></div>
      ${bars(buckets)}
    </div>`;
}

function renderFeed(txns, acctMap, limit) {
  const head = `<div class="feed-head"><h2>${state.view === 'transactions' ? 'All transactions' : 'Recent activity'}</h2>
    <span class="hint mono">${txns.length} txns</span></div>`;
  if (!txns.length) {
    $('#feedCard').innerHTML = `<div class="card">${head}${emptyState()}</div>`;
    return;
  }
  const rows = txns.slice(0, limit).map((t) => {
    const cat = categoryById(t.category);
    const acct = acctMap.get(t.accountId);
    const credit = t.direction === 'credit';
    const flash = t.id === _flashId ? ' enter' : '';
    return `<div class="row${flash}" data-id="${t.id}">
      <div class="tile" style="background:${cat.color}22;color:${cat.color}">${cat.icon}</div>
      <div class="row-main">
        <div class="row-merchant">${esc(t.merchant || cat.label)}</div>
        <div class="row-meta">
          <span class="pill"><span class="dot" style="background:${cat.color}"></span>${esc(cat.label)}</span>
          ${acct ? `<span>${esc(acct.label)}</span>` : ''}
          <span>${esc((t.method || '').toUpperCase())}</span>
          <span>${relativeTime(t.ts)}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="row-amt ${credit ? 'credit' : ''}">${credit ? '+' : '−'}${formatMoney(t.amount)}</span>
        <span class="row-actions">
          <button class="mini" data-action="recat" data-id="${t.id}" title="Re-categorize">🏷</button>
          <button class="mini" data-action="del" data-id="${t.id}" title="Delete">✕</button>
        </span>
      </div>
    </div>`;
  }).join('');
  $('#feedCard').innerHTML = `<div class="card">${head}<div class="feed">${rows}</div>
    ${txns.length > limit ? `<p class="hint" style="text-align:center;margin-top:12px">Showing ${limit} of ${txns.length}.</p>` : ''}</div>`;
  _flashId = null;
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
        <button class="mini" data-action="delraw" data-id="${m.id}">✕</button></span></div>`).join('')
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
  $('#viewTitle').textContent = state.view === 'unparsed' ? 'Needs review' : state.view === 'transactions' ? 'Transactions' : 'Overview';
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
}

async function onClick(e) {
  const t = e.target.closest('[data-view],[data-range],[data-action]');
  if (!t) return;
  if (t.dataset.view) { state.view = t.dataset.view; render(); return; }
  if (t.dataset.range) { state.range = t.dataset.range; render(); return; }
  const id = t.dataset.id;
  switch (t.dataset.action) {
    case 'reset': state.category = null; state.accountId = null; render(); break;
    case 'add': openAddModal(); break;
    case 'paste': openPasteModal(); break;
    case 'menu': openMenuModal(); break;
    case 'recat': openRecatModal(id); break;
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
function openModal(html) { const m = $('#modal'); m.innerHTML = html; m.showModal(); }
function closeModal() { $('#modal').close(); }

function catOptions(selected = 'uncategorized') {
  return CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${c.icon} ${esc(c.label)}</option>`).join('');
}

function openAddModal(prefillNote = '') {
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  openModal(`<form method="dialog" id="addForm">
    <div class="modal-head"><h3>Add expense</h3><button class="btn ghost icon" type="button" data-action="close">✕</button></div>
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
    <div class="modal-head"><h3>Paste a bank alert</h3><button class="btn ghost icon" type="button" data-action="close">✕</button></div>
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

function openRecatModal(id) {
  openModal(`<div class="modal-head"><h3>Re-categorize</h3><button class="btn ghost icon" data-action="close">✕</button></div>
    <div class="modal-body"><div style="display:flex;flex-wrap:wrap;gap:8px">
      ${CATEGORIES.filter((c) => c.id !== 'uncategorized').map((c) => `<button class="btn" data-action="setcat" data-id="${id}" data-cat="${c.id}">${c.icon} ${esc(c.label)}</button>`).join('')}
    </div></div>`);
  $('#modal').querySelectorAll('[data-action="setcat"]').forEach((b) =>
    b.addEventListener('click', async () => { await ingest.recategorize(b.dataset.id, b.dataset.cat); closeModal(); toast('Re-categorized'); render(); }));
}

function openMenuModal() {
  openModal(`<div class="modal-head"><h3>More</h3><button class="btn ghost icon" data-action="close">✕</button></div>
    <div class="modal-body" style="gap:8px">
      <button class="btn" data-action="paste">Paste a bank alert</button>
      <button class="btn" data-action="import">Import file (.json / .csv)</button>
      <button class="btn" data-action="sample">Load demo data</button>
      <button class="btn" data-action="export">Export my data</button>
      <button class="btn" data-action="erase" style="color:var(--negative)">Erase all data</button>
    </div>`);
}

// ── data actions ────────────────────────────────────────────────────────────
async function loadSample() {
  closeModal();
  toast('Loading demo data…');
  const res = await fetch('data/sample-notifications.json').catch(() => null);
  if (!res || !res.ok) return toast('Could not load demo data');
  const msgs = await res.json();
  let n = 0;
  for (const m of msgs) { if ((await ingest.ingestRaw(m)) === 'parsed') n++; }
  toast(`Loaded ${n} sample transactions`);
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
const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;

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
  openModal(`<div class="modal-head"><h3>Erase all data?</h3><button class="btn ghost icon" data-action="close">✕</button></div>
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
