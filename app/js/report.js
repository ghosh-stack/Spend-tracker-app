// PDF report export. Builds a polished, print-optimized standalone HTML document
// for a chosen period and hands it to the platform's print-to-PDF:
//  - native APK: SpendLensNative.printContent() → Android PrintManager
//  - browser PWA: a hidden iframe + window.print() ("Save as PDF")
// No PDF library (CSP/offline) — the browser/OS renders the PDF from HTML.
import * as db from './db.js';
import { summarize, detectRecurring, rangeStart } from './queries.js';
import { categoryById } from './rules.js';
import { formatMoney } from './money.js';
import { sankey, esc } from './charts.js';
import { APP_VERSION } from './version.js';

export const PRESETS = [
  ['week', 'Last 7 days'], ['month', 'This month'], ['quarter', 'This quarter'],
  ['year', 'This year'], ['all', 'All time'], ['custom', 'Custom range'],
];

const DAY = 86400000;

function periodWindow(preset, fromStr, toStr, now = Date.now()) {
  if (preset === 'custom') {
    let from = fromStr ? new Date(fromStr + 'T00:00:00').getTime() : 0;
    let to = toStr ? new Date(toStr + 'T23:59:59').getTime() : now;
    // A reversed range (from > to) would silently yield an empty/misleading report
    // with a backwards label — normalize so the window is always [earlier, later].
    let lf = fromStr, lt = toStr;
    if (from > to) { [from, to] = [to, from]; [lf, lt] = [lt, lf]; }
    const fmt = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    return { from, to, label: `${lf ? fmt(from) : 'start'} – ${lt ? fmt(to) : 'now'}` };
  }
  const labels = { week: 'Last 7 days', month: 'This month', quarter: 'This quarter', year: 'This year', all: 'All time' };
  return { from: rangeStart(preset, now), to: now, label: labels[preset] || preset };
}

// Same flow model the dashboard uses (replicated to avoid a view-layer import).
function buildFlow(s, txns) {
  const inc = txns.filter((t) => !t.excluded && t.direction === 'credit' && categoryById(t.category).kind === 'income');
  const map = new Map();
  for (const t of inc) { const k = ((t.merchant || 'Income').split('@')[0] || 'Income').trim(); map.set(k, (map.get(k) || 0) + t.amount); }
  let arr = [...map.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
  const top = arr.slice(0, 3);
  const rest = arr.slice(3).reduce((x, o) => x + o.amount, 0);
  if (rest > 0) top.push({ label: 'Other', amount: rest });
  const shades = ['#0E9E74', '#2BC6C6', '#36C98F', '#57C98A'];
  const sources = top.map((o, i) => ({ label: o.label.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 14), amount: o.amount, color: shades[i % shades.length] }));
  const cats = s.categories.slice(0, 6).map((c) => ({ id: c.id, label: c.label, icon: c.icon, amount: c.amount, color: c.color }));
  const restCat = s.categories.slice(6).reduce((x, c) => x + c.amount, 0);
  if (restCat > 0) cats.push({ id: 'other', label: 'Other', icon: '•', amount: restCat, color: '#9AA3B2' });
  const saved = Math.max(0, s.net);
  return { income: s.income, spent: s.spent, saved, savingsRate: s.income > 0 ? Math.round((saved / s.income) * 100) : null, sources, cats };
}

function topMerchants(txns) {
  const m = new Map();
  for (const t of txns) {
    if (t.excluded || t.direction !== 'debit' || categoryById(t.category).kind !== 'expense') continue;
    const k = t.merchant || categoryById(t.category).label;
    m.set(k, (m.get(k) || 0) + t.amount);
  }
  return [...m.entries()].map(([merchant, amount]) => ({ merchant, amount })).sort((a, b) => b.amount - a.amount).slice(0, 8);
}

// Build the full standalone report document for [from, to].
async function buildReportHTML(win) {
  const [allTxns, accounts] = await Promise.all([db.getAll('transactions'), db.getAll('accounts')]);
  const acctMap = new Map(accounts.map((a) => [a.id, a]));
  const txns = allTxns.filter((t) => t.ts >= win.from && t.ts <= win.to).sort((a, b) => b.ts - a.ts);
  const s = summarize(txns);
  const flow = buildFlow(s, txns);
  const merchants = topMerchants(txns);
  const recurring = detectRecurring(allTxns).filter((r) => r.status === 'active').slice(0, 8);
  const recurMonthly = recurring.reduce((x, r) => x + r.monthlyEquivMinor, 0);
  const genDate = new Date(win.to).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  const kpi = (label, val, accent) => `<div class="kpi"><div class="kl">${label}</div><div class="kv"${accent ? ` style="color:${accent}"` : ''}>${val}</div></div>`;
  const catRows = s.categories.map((c) => `<tr><td><span class="dot" style="background:${c.color}"></span>${c.icon} ${esc(c.label)}</td><td class="num">${esc(formatMoney(c.amount))}</td><td class="num mut">${c.pct.toFixed(1)}%</td><td class="barcell"><span class="bar" style="width:${Math.min(100, c.pct).toFixed(1)}%;background:${c.color}"></span></td></tr>`).join('') || '<tr><td colspan="4" class="mut">No spending in this period.</td></tr>';
  const merchRows = merchants.map((m) => `<tr><td>${esc(m.merchant)}</td><td class="num">${esc(formatMoney(m.amount))}</td></tr>`).join('') || '<tr><td colspan="2" class="mut">—</td></tr>';
  const recurRows = recurring.map((r) => `<tr><td>${esc(r.displayName)}</td><td>${esc(r.cadenceLabel)}</td><td class="num">${esc(formatMoney(r.amountMinor))}</td><td class="num mut">${esc(formatMoney(r.monthlyEquivMinor))}/mo</td></tr>`).join('') || '<tr><td colspan="4" class="mut">None detected.</td></tr>';
  const txnRows = txns.slice(0, 200).map((t) => {
    const c = categoryById(t.category), credit = t.direction === 'credit';
    return `<tr><td class="mut">${new Date(t.ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td><td>${esc(t.merchant || c.label)}</td><td><span class="dot" style="background:${c.color}"></span>${esc(c.label)}</td><td class="num${credit ? ' cr' : ''}">${credit ? '+' : '−'}${esc(formatMoney(t.amount))}</td></tr>`;
  }).join('') || '<tr><td colspan="4" class="mut">No transactions.</td></tr>';
  const more = txns.length > 200 ? `<p class="mut sm">+ ${txns.length - 200} more transactions not shown.</p>` : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>SpendLens Report — ${esc(win.label)}</title>
<style>
  :root{--ink:#10131A;--dim:#4F5A6B;--mut:#6B7686;--line:#E2E7F0;--accent:#5B4BD6;--accent-text:#5B4BD6;
    --positive:#0E9E74;--negative:#C8313A;--bg-elev:#fff;--text-dim:#4F5A6B;--text-mute:#6B7686;
    --font-mono:ui-monospace,"SF Mono","Cascadia Code",Consolas,monospace;--ease:ease;}
  *{box-sizing:border-box}
  html,body{margin:0;background:#fff;color:var(--ink);font:14px/1.5 "Segoe UI",system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .doc{max-width:760px;margin:0 auto;padding:36px 32px 56px}
  .num{font-family:var(--font-mono);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
  .mut{color:var(--mut)} .sm{font-size:12px}
  .cr{color:var(--positive)}
  header{display:flex;align-items:center;gap:14px;border-bottom:2px solid var(--ink);padding-bottom:18px;margin-bottom:8px}
  header .mk{width:42px;height:42px;flex:none}
  header h1{margin:0;font-size:22px;letter-spacing:-.02em}
  header .sub{color:var(--mut);font-size:13px;margin-top:2px}
  header .period{margin-left:auto;text-align:right}
  header .period .p{font-weight:650;font-size:15px} header .period .g{color:var(--mut);font-size:12px;margin-top:2px}
  h2{font-size:14px;letter-spacing:.04em;text-transform:uppercase;color:var(--accent-text);margin:30px 0 12px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:22px}
  .kpi{border:1px solid var(--line);border-radius:12px;padding:14px}
  .kpi .kl{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
  .kpi .kv{font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:21px;font-weight:650;margin-top:6px;letter-spacing:-.02em}
  .flowwrap{border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;justify-content:center}
  .flowwrap svg{max-width:420px;width:100%;height:auto}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);font-weight:600;padding:0 10px 8px;border-bottom:1px solid var(--line)}
  th.num{text-align:right}
  td{padding:8px 10px;border-bottom:1px solid var(--line)}
  .dot{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:7px;vertical-align:middle}
  .barcell{width:120px} .bar{display:block;height:7px;border-radius:4px}
  section{break-inside:avoid}
  footer{margin-top:36px;padding-top:16px;border-top:1px solid var(--line);color:var(--mut);font-size:12px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
  @page{margin:14mm}
</style></head><body><div class="doc">
  <header>
    <svg class="mk" viewBox="0 0 30 30"><defs><linearGradient id="rmk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C6CFF"/><stop offset="1" stop-color="#3FD9A4"/></linearGradient></defs><rect width="30" height="30" rx="9" fill="url(#rmk)"/><circle cx="15" cy="15" r="8.4" fill="none" stroke="rgba(10,11,18,.30)" stroke-width="1.3"/><path d="M11.4 9.6h6.2M11.4 12.6h6.2M16.6 9.6c0 3.2-2 4.6-4.8 4.9 1.6 1.5 3.4 3.4 5 5.9" fill="none" stroke="#0A0B12" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div><h1>SpendLens</h1><div class="sub">Spending report</div></div>
    <div class="period"><div class="p">${esc(win.label)}</div><div class="g">Generated ${esc(genDate)}</div></div>
  </header>

  <div class="kpis">
    ${kpi('Spent', formatMoney(s.spent))}
    ${kpi('Income', formatMoney(s.income), 'var(--positive)')}
    ${kpi(s.net >= 0 ? 'Saved' : 'Overspent', formatMoney(Math.abs(s.net)), s.net >= 0 ? 'var(--positive)' : 'var(--negative)')}
    ${kpi('Savings rate', flow.savingsRate != null ? flow.savingsRate + '%' : '—')}
  </div>

  <section><h2>Money flow</h2><div class="flowwrap">${sankey(flow, 420, 360)}</div></section>

  <section><h2>By category</h2><table><thead><tr><th>Category</th><th class="num">Amount</th><th class="num">Share</th><th></th></tr></thead><tbody>${catRows}</tbody></table></section>

  <section><h2>Top merchants</h2><table><thead><tr><th>Merchant</th><th class="num">Spent</th></tr></thead><tbody>${merchRows}</tbody></table></section>

  <section><h2>Recurring &amp; subscriptions${recurMonthly ? ` · ${esc(formatMoney(recurMonthly))}/mo` : ''}</h2><table><thead><tr><th>Name</th><th>Cadence</th><th class="num">Amount</th><th class="num">Monthly</th></tr></thead><tbody>${recurRows}</tbody></table></section>

  <section><h2>Transactions · ${txns.length}</h2><table><thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th class="num">Amount</th></tr></thead><tbody>${txnRows}</tbody></table>${more}</section>

  <footer><span>Generated on-device by SpendLens v${esc(APP_VERSION)} — your data never left this device.</span><span class="num">${esc(genDate)}</span></footer>
</div></body></html>`;
}

function printHTML(html, jobName) {
  const native = window.SpendLensNative && window.SpendLensNative.printContent;
  if (native) { native(html, jobName); return; }
  // Browser: render in a hidden iframe and invoke the print dialog (Save as PDF).
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;';
  f.srcdoc = html;
  f.onload = () => {
    const w = f.contentWindow;
    const done = () => setTimeout(() => f.remove(), 500);
    try { w.addEventListener('afterprint', done); w.focus(); w.print(); }
    catch (e) { done(); }
  };
  document.body.appendChild(f);
}

/** Generate + print/export the report for the given preset (and custom dates). */
export async function exportReport(preset, fromStr, toStr) {
  const win = periodWindow(preset, fromStr, toStr);
  const html = await buildReportHTML(win);
  printHTML(html, `SpendLens — ${win.label}`);
}
