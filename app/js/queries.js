// Dashboard aggregations. Pure functions over an array of transactions so the
// view layer stays dumb. "Spend" = debits in expense-kind categories; transfers
// and investments are money movement, not spend, and are excluded from totals
// (but a transfer still appears in the feed).
import { categoryById, CATEGORIZE_RULES } from './rules.js';

export const DAY = 86400000;

export function rangeStart(range, now = Date.now()) {
  const d = new Date(now);
  switch (range) {
    case 'week': return now - 7 * DAY;
    case 'month': return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    case 'quarter': return new Date(d.getFullYear(), d.getMonth() - 2, 1).getTime();
    case 'year': return new Date(d.getFullYear(), 0, 1).getTime();
    default: return 0; // 'all'
  }
}

export function applyFilter(txns, { range = 'month', category = null, accountId = null, now = Date.now() } = {}) {
  const start = rangeStart(range, now);
  return txns
    .filter((t) => t.ts >= start)
    .filter((t) => (category ? t.category === category : true))
    .filter((t) => (accountId ? t.accountId === accountId : true))
    .sort((a, b) => b.ts - a.ts);
}

const isSpend = (t) => !t.excluded && t.direction === 'debit' && categoryById(t.category).kind === 'expense';

export function summarize(txns) {
  let spent = 0, income = 0, transfers = 0;
  const byCat = new Map();
  for (const t of txns) {
    if (t.excluded) continue; // user marked "not my spend" (reimbursable, etc.)
    const kind = categoryById(t.category).kind;
    if (kind === 'income') {
      income += t.direction === 'credit' ? t.amount : -t.amount;
    } else if (kind === 'transfer') {
      transfers += t.amount;
    } else {
      // expense category: a debit is spend; a credit (refund/reversal) reduces it,
      // so net reconciles with the feed instead of silently dropping the credit.
      const signed = t.direction === 'debit' ? t.amount : -t.amount;
      spent += signed;
      const e = byCat.get(t.category) || { categoryId: t.category, amount: 0, count: 0 };
      e.amount += signed; e.count++;
      byCat.set(t.category, e);
    }
  }
  const categories = [...byCat.values()]
    .filter((e) => e.amount > 0) // a net-negative category (refunds exceed spend) drops off the donut
    .map((e) => ({ ...e, ...categoryById(e.categoryId), pct: spent > 0 ? (e.amount / spent) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);
  return {
    spent, income, transfers, net: income - spent,
    count: txns.length,
    categories,
    topCategory: categories[0] || null,
  };
}

/** Time buckets for the trend chart. unit: 'day' | 'week' | 'month'. */
export function series(txns, range, now = Date.now()) {
  const unit = range === 'year' || range === 'all' ? 'month' : range === 'quarter' ? 'week' : 'day';
  // For 'all', span from the earliest spend (not just this calendar year) so the
  // chart reconciles with the 'All time' KPI; otherwise use the range window.
  let start;
  if (range === 'all') {
    const spends = txns.filter(isSpend);
    const min = spends.length ? Math.min(...spends.map((t) => t.ts)) : now;
    const md = new Date(min);
    start = new Date(md.getFullYear(), md.getMonth(), 1).getTime();
  } else {
    start = rangeStart(range, now);
  }
  const buckets = [];
  const d0 = new Date(start);

  if (unit === 'month') {
    const span = (new Date(now).getFullYear() - d0.getFullYear()) * 12 + (new Date(now).getMonth() - d0.getMonth()) + 1;
    for (let i = 0; i < Math.max(1, span); i++) {
      const dt = new Date(d0.getFullYear(), d0.getMonth() + i, 1);
      if (dt.getTime() > now) break;
      const label = dt.toLocaleString('en-IN', { month: 'short' }) + (span > 12 ? ` '${String(dt.getFullYear()).slice(-2)}` : '');
      buckets.push({ ts: dt.getTime(), label, amount: 0 });
    }
    for (const t of txns) {
      if (!isSpend(t)) continue;
      const dt = new Date(t.ts);
      const b = buckets.find((x) => new Date(x.ts).getMonth() === dt.getMonth() && new Date(x.ts).getFullYear() === dt.getFullYear());
      if (b) b.amount += t.amount;
    }
  } else {
    const step = unit === 'week' ? 7 * DAY : DAY;
    // Size from the actual window so the final period is never dropped.
    const n = Math.max(unit === 'week' ? 4 : 7, Math.ceil((now - start) / step) + 1);
    for (let i = 0; i < n; i++) {
      const ts = start + i * step;
      if (ts > now + step) break;
      const dt = new Date(ts);
      buckets.push({
        ts,
        label: unit === 'week'
          ? `${dt.getDate()}/${dt.getMonth() + 1}`
          : dt.toLocaleString('en-IN', { day: 'numeric', month: 'short' }),
        amount: 0,
      });
    }
    for (const t of txns) {
      if (!isSpend(t)) continue;
      const idx = Math.floor((t.ts - start) / step);
      if (idx >= 0 && idx < buckets.length) buckets[idx].amount += t.amount;
    }
  }
  return buckets;
}

// ── insights (month-over-month, projection, top merchants) ────────────────────
export function insights(txns, now = Date.now()) {
  const d = new Date(now);
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const lastStart = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
  const thisMonth = txns.filter((t) => t.ts >= monthStart);
  const lastMonth = txns.filter((t) => t.ts >= lastStart && t.ts < monthStart);
  const sThis = summarize(thisMonth), sLast = summarize(lastMonth);
  const dayOfMonth = d.getDate();
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const projected = dayOfMonth ? Math.round((sThis.spent / dayOfMonth) * daysInMonth) : sThis.spent;

  const mMap = new Map();
  for (const t of thisMonth) {
    if (isSpend(t)) {
      const k = t.merchant || categoryById(t.category).label;
      mMap.set(k, (mMap.get(k) || 0) + t.amount);
    }
  }
  const topMerchants = [...mMap.entries()].map(([merchant, amount]) => ({ merchant, amount }))
    .sort((a, b) => b.amount - a.amount).slice(0, 5);
  const biggest = thisMonth.filter(isSpend).sort((a, b) => b.amount - a.amount)[0] || null;

  return {
    thisSpent: sThis.spent, lastSpent: sLast.spent,
    momPct: sLast.spent ? Math.round(((sThis.spent - sLast.spent) / sLast.spent) * 100) : null,
    projected, dailyAvg: dayOfMonth ? Math.round(sThis.spent / dayOfMonth) : 0,
    income: sThis.income, savingsRate: sThis.income ? Math.round(((sThis.income - sThis.spent) / sThis.income) * 100) : null,
    topMerchants, biggest, daysInMonth, dayOfMonth,
  };
}

// ── recurring / subscription detection (derived, never stored) ────────────────
const med = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a) => { if (a.length < 2) return 0; const m = avg(a); return Math.sqrt(avg(a.map((x) => (x - m) ** 2))); };
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const STOP = new Set(['upi', 'the', 'pvt', 'ltd', 'limited', 'india', 'payments', 'payment', 'bank']);

function canonMerchant(t) {
  let m = (t.merchant || t.rawMerchant || '').toLowerCase().trim();
  if (!m) return '';
  if (m.includes('@')) m = m.split('@')[0]; // VPA local part
  for (const r of CATEGORIZE_RULES) {
    if (new RegExp('\\b' + escRe(r.match) + '\\b', 'i').test(m)) return r.match; // reuse curated brand list
  }
  const toks = m.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
  return toks.slice(0, 2).join(' ') || m;
}

const CADENCES = [
  { id: 'weekly', label: 'Weekly', lo: 6, hi: 8, perMonth: 4.345 },
  { id: 'fortnightly', label: 'Fortnightly', lo: 13, hi: 16, perMonth: 2.17 },
  { id: 'monthly', label: 'Monthly', lo: 27, hi: 34, perMonth: 1 },
  { id: 'quarterly', label: 'Quarterly', lo: 85, hi: 95, perMonth: 1 / 3 },
  { id: 'yearly', label: 'Yearly', lo: 350, hi: 380, perMonth: 1 / 12 },
];

function advance(ts, cadence) {
  const d = new Date(ts), day = Math.min(d.getDate(), 28);
  if (cadence === 'weekly') return ts + 7 * DAY;
  if (cadence === 'fortnightly') return ts + 14 * DAY;
  if (cadence === 'monthly') return new Date(d.getFullYear(), d.getMonth() + 1, day).getTime();
  if (cadence === 'quarterly') return new Date(d.getFullYear(), d.getMonth() + 3, day).getTime();
  if (cadence === 'yearly') return new Date(d.getFullYear() + 1, d.getMonth(), day).getTime();
  return ts + 30 * DAY;
}

function labelKind(category, days) {
  const text = days.map((t) => `${t.merchant} ${t.notes || ''}`).join(' ').toLowerCase();
  if (category === 'investments') return 'SIP';
  if (category === 'housing') return /loan|emi/.test(text) ? 'EMI' : 'Rent';
  if (category === 'bills' && /insurance|lic|premium/.test(text)) return 'Insurance';
  if (category === 'entertainment') return 'Subscription';
  return 'Recurring';
}

/** Detect recurring debits (subscriptions, SIPs, rent, EMIs). Pure, run over all txns. */
export function detectRecurring(txns, now = Date.now()) {
  const groups = new Map();
  for (const t of txns) {
    if (t.direction !== 'debit' || t.excluded) continue;
    if (t.category === 'transfers' || t.category === 'cash') continue; // money movement / cash, not subscriptions
    const cm = canonMerchant(t);
    if (!cm) continue;
    const key = cm + '|' + (t.accountId || '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const out = [];
  for (const [groupKey, list] of groups) {
    if (list.length < 3) continue;
    list.sort((a, b) => a.ts - b.ts);
    const days = [];
    for (const t of list) { const last = days[days.length - 1]; if (!(last && Math.abs(t.ts - last.ts) < DAY)) days.push(t); }
    if (days.length < 3) continue;
    const gaps = days.slice(1).map((t, i) => (t.ts - days[i].ts) / DAY);
    const g = med(gaps);
    const dispersion = g ? sd(gaps) / g : 1;
    const cad = CADENCES.find((c) => g >= c.lo && g <= c.hi);
    if (!cad || dispersion > 0.35) continue; // not regular enough
    const amounts = days.map((t) => t.amount);
    const amtMed = med(amounts);
    const cv = amtMed ? sd(amounts) / avg(amounts) : 1;
    const amountKind = cv < 0.02 ? 'fixed' : cv < 0.15 ? 'near-fixed' : 'variable';
    const category = days[days.length - 1].category;
    const discretionary = ['food', 'shopping', 'groceries', 'transport'].includes(category);
    if (discretionary && !(amountKind === 'fixed' && (cad.id === 'monthly' || cad.id === 'weekly'))) continue;
    if (amountKind === 'variable' && !['bills', 'housing', 'investments'].includes(category)) continue;
    const last = days[days.length - 1];
    const cm = canonMerchant(last);
    const displayName = (last.merchant && !last.merchant.includes('@'))
      ? last.merchant
      : cm.replace(/\b\w/g, (ch) => ch.toUpperCase()); // VPA/brand -> Title Case
    const nextDate = advance(last.ts, cad.id);
    const confidence = +(0.3 * Math.min(1, days.length / 6) + 0.3 * (1 - Math.min(1, dispersion))
      + 0.25 * (1 - Math.min(1, cv)) + 0.15 * (discretionary ? 0.5 : 1)).toFixed(2);
    out.push({
      key: groupKey, displayName,
      category, kind: labelKind(category, days), cadence: cad.id, cadenceLabel: cad.label,
      occurrences: days.length, firstTs: days[0].ts, lastTs: last.ts,
      amountMinor: amtMed, amountKind, amountRange: [Math.min(...amounts), Math.max(...amounts)],
      monthlyEquivMinor: Math.round(amtMed * cad.perMonth),
      nextDate, daysUntil: Math.round((nextDate - now) / DAY),
      confidence, status: now - nextDate > 7 * DAY ? 'lapsed' : 'active',
      txnIds: days.map((t) => t.id),
    });
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil);
}

export function relativeTime(ts, now = Date.now()) {
  const s = Math.round((now - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
