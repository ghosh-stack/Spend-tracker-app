// Dashboard aggregations. Pure functions over an array of transactions so the
// view layer stays dumb. "Spend" = debits in expense-kind categories; transfers
// and investments are money movement, not spend, and are excluded from totals
// (but a transfer still appears in the feed).
import { categoryById } from './rules.js';

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

const isSpend = (t) => t.direction === 'debit' && categoryById(t.category).kind === 'expense';
const isIncome = (t) => t.direction === 'credit' && categoryById(t.category).kind === 'income';

export function summarize(txns) {
  let spent = 0, income = 0, transfers = 0;
  const byCat = new Map();
  for (const t of txns) {
    if (isSpend(t)) {
      spent += t.amount;
      const e = byCat.get(t.category) || { categoryId: t.category, amount: 0, count: 0 };
      e.amount += t.amount; e.count++;
      byCat.set(t.category, e);
    } else if (isIncome(t)) {
      income += t.amount;
    } else if (categoryById(t.category).kind === 'transfer') {
      transfers += t.amount;
    }
  }
  const categories = [...byCat.values()]
    .map((e) => ({ ...e, ...categoryById(e.categoryId), pct: spent ? (e.amount / spent) * 100 : 0 }))
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
  const start = rangeStart(range === 'all' ? 'year' : range, now);
  const buckets = [];
  const d0 = new Date(start);

  if (unit === 'month') {
    for (let i = 0; i < 12; i++) {
      const dt = new Date(d0.getFullYear(), d0.getMonth() + i, 1);
      if (dt.getTime() > now) break;
      buckets.push({ ts: dt.getTime(), label: dt.toLocaleString('en-IN', { month: 'short' }), amount: 0 });
    }
    for (const t of txns) {
      if (!isSpend(t)) continue;
      const dt = new Date(t.ts);
      const b = buckets.find((x) => new Date(x.ts).getMonth() === dt.getMonth() && new Date(x.ts).getFullYear() === dt.getFullYear());
      if (b) b.amount += t.amount;
    }
  } else {
    const step = unit === 'week' ? 7 * DAY : DAY;
    const n = unit === 'week' ? 13 : Math.max(7, Math.ceil((now - start) / DAY) + 1);
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
