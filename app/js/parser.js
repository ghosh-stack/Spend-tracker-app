// Pure parser pipeline: raw message -> normalize -> match rule -> extract
// fields -> categorize -> dedupe key. No DB, no DOM, so it runs under
// `node --test` (see tests/parser.test.js) — the one runnable check for the
// money/logic path.
import { toMinor } from './money.js';

const DEBIT_WORDS = /\b(debited|spent|sent|paid|withdrawn|purchase|debit)\b/i;
const CREDIT_WORDS = /\b(credited|received|credit|deposit|refund|cashback)\b/i;

export function normalize(text) {
  return String(text ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const yr = (y) => { y = parseInt(y, 10); return y < 100 ? 2000 + y : y; };

// Indian bank dates are a zoo: DD-MM-YY, DD-MM-YYYY, DD-Mon-YY, DDMonYY,
// DD/MM/YY, "28 Jun 2026, 2:32 pm", and HDFC's ISO-ish "2026-06-28:14:32:08".
// Always day-first (never month-first). Returns epoch ms, or fallback on junk.
export function parseDate(raw, fallbackMs = Date.now()) {
  if (!raw || typeof raw !== 'string') return fallbackMs;
  const s = raw.trim();
  let Y, Mo, D, hh = 0, mi = 0, se = 0;

  // ISO-ish year-first (handle up front so its ":14:32:08" time isn't misread).
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ :T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    Y = +m[1]; Mo = +m[2] - 1; D = +m[3];
    hh = +(m[4] || 0); mi = +(m[5] || 0); se = +(m[6] || 0);
    return build(Y, Mo, D, hh, mi, se, fallbackMs);
  }

  // Day-first date at the start of the string.
  m = s.match(/^(\d{1,2})[-/ ]?([A-Za-z]{3,})[-/, ]+(\d{2,4})/); // DD Mon YY(YY)
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] !== undefined) {
    D = +m[1]; Mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; Y = yr(m[3]);
  } else if ((m = s.match(/^(\d{1,2})([A-Za-z]{3})(\d{2,4})/))) {       // DDMonYY
    D = +m[1]; Mo = MONTHS[m[2].toLowerCase()]; Y = yr(m[3]);
  } else if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/))) {    // DD-MM-YY(YY)
    D = +m[1]; Mo = +m[2] - 1; Y = yr(m[3]);
  } else {
    return fallbackMs;
  }
  if (Mo === undefined) return fallbackMs;

  // Time from the remainder: 12h "2:32 pm" or 24h "18:45:12".
  const t = s.slice(m[0].length).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?m\.?/i)
          || s.slice(m[0].length).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (t) {
    hh = +t[1]; mi = +t[2]; se = +(t[3] || 0);
    if (t[4]) { const pm = /p/i.test(t[4]); if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
  }
  return build(Y, Mo, D, hh, mi, se, fallbackMs);
}

function build(Y, Mo, D, hh, mi, se, fallbackMs) {
  const d = new Date(Y, Mo, D, hh, mi, se);
  const ms = d.getTime();
  if (!Number.isFinite(ms) || Y < 2000 || Y > 2100) return fallbackMs;
  return ms;
}

// A single SMS can name both verbs (SBI IMPS: "your a/c is debited ... and
// a/c ... credited"). Anchor on the FIRST verb — that's the user's own account.
export function inferDirection(body) {
  const d = body.search(DEBIT_WORDS);
  const c = body.search(CREDIT_WORDS);
  if (d === -1) return c === -1 ? 'debit' : 'credit';
  if (c === -1) return 'debit';
  return d <= c ? 'debit' : 'credit';
}

export function normalizeMerchant(raw) {
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ').replace(/[.,;:]+$/, '').trim();
}

// First matching merchant/keyword rule wins (rules pre-sorted by priority).
export function categorize(merchant, body, rules) {
  const hay = (merchant + ' ' + body).toLowerCase();
  for (const r of rules) {
    if (r.enabled === false) continue;
    if (hay.includes(r.match)) return { category: r.categoryId, source: 'rule' };
  }
  return { category: 'uncategorized', source: 'default' };
}

// Transaction-level dedupe: the SAME spend can arrive via SMS *and* email, so
// content differs but it is one transaction. Prefer the bank reference (exact);
// fall back to a 1-minute bucket when no ref is present.
// ponytail: 60s bucket can merge two identical-amount payments to the same
// payee in the same minute (rare); upgrade = require ref strictly.
export function buildDedupeKey({ accountLast4, bankKey, amount, direction, ref, ts }) {
  const acct = accountLast4 || bankKey || 'na';
  return ref
    ? `${acct}|${amount}|${direction}|${ref}`
    : `${acct}|${amount}|${direction}|${Math.floor(ts / 60000)}`;
}

const reCache = new Map();
const compile = (src) => {
  let re = reCache.get(src);
  if (!re) { re = new RegExp(src, 'i'); reCache.set(src, re); }
  return re;
};

export function applyParseRules(normBody, sender, parseRules) {
  for (const r of parseRules) {
    if (r.enabled === false) continue;
    if (r.senderPattern && !compile(r.senderPattern).test(sender || '')) continue;
    const m = normBody.match(compile(r.pattern));
    if (m) return { rule: r, groups: m.groups || {} };
  }
  return null;
}

/**
 * Turn a raw message into a transaction-shaped object (no id/accountId — the
 * ingest layer assigns those). Returns { status, txn }.
 * @param msg {source, sender, body, receivedAt}
 */
export function parseMessage(msg, { parseRules, categorizeRules }) {
  const body = normalize(msg.body);
  const sender = (msg.sender || '').toUpperCase();
  const receivedAt = msg.receivedAt || Date.now();

  const hit = applyParseRules(body, sender, parseRules);
  if (!hit) return { status: 'unparsed', txn: null };

  const g = hit.groups;
  const r = hit.rule;
  const amount = toMinor(g.amount);
  if (amount == null) return { status: 'unparsed', txn: null };

  const direction = r.direction || inferDirection(body);
  const ts = g.datetime ? parseDate(g.datetime, receivedAt) : receivedAt;
  const rawMerchant = normalizeMerchant(g.merchant || '');
  const ref = (g.ref || '').trim();
  const accountLast4 = (g.acct || '').replace(/\D/g, '').slice(-4);

  const cat = r.setCategory
    ? { category: r.setCategory, source: 'rule' }
    : categorize(rawMerchant, body, categorizeRules);

  const txn = {
    amount,
    currency: 'INR',
    direction,
    ts,
    merchant: rawMerchant,
    rawMerchant,
    category: cat.category,
    categorySource: cat.source,
    ref,
    method: r.method || 'other',
    bankKey: r.bankKey === '*' ? '' : (r.bankKey || ''),
    accountLast4,
    ruleId: r.id,
  };
  txn.dedupeKey = buildDedupeKey(txn);
  return { status: 'parsed', txn };
}
