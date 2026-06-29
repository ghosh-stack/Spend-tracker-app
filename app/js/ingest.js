// Intake orchestration: raw message -> dedupe at intake -> parse -> resolve
// account -> dedupe at transaction -> store atomically -> notify the UI.
// The pure extraction lives in parser.js; this file is the side-effecting glue.
import * as db from './db.js';
import { parseMessage } from './parser.js';
import { PARSE_RULES, CATEGORIZE_RULES } from './rules.js';

// ── tiny pub/sub (one file, no state-management library — rung 1) ─────────────
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(evt) { for (const fn of listeners) try { fn(evt); } catch (e) { console.error(e); } }

// ── ids + hashing (native crypto on a secure/localhost origin, rung 4) ────────
function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0,4).join('')}-${h.slice(4,6).join('')}-${h.slice(6,8).join('')}-${h.slice(8,10).join('')}-${h.slice(10).join('')}`;
}

async function contentHash(str) {
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return 'raw:' + str; // exact fallback (no collisions) when SubtleCrypto is absent
}

// ── rule set: built-ins + user overrides from DB, cached for the session ──────
let _rules = null;
async function rules() {
  if (_rules) return _rules;
  const user = await db.getAll('rules').catch(() => []);
  const parseRules = [...PARSE_RULES, ...user.filter((r) => r.kind === 'parse')]
    .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));
  const userCats = user.filter((r) => r.kind === 'categorize');
  // user categorize rules take precedence (checked first)
  _rules = { parseRules, categorizeRules: [...userCats, ...CATEGORIZE_RULES] };
  return _rules;
}
export function invalidateRules() { _rules = null; }

// ── account resolution ────────────────────────────────────────────────────────
function accountTypeFor(method) {
  return method === 'card' ? 'card' : method === 'cash' ? 'cash' : 'bank';
}
async function resolveAccount(bankKey, last4, method) {
  const id = `${bankKey || 'unknown'}:${last4 || 'xxxx'}`;
  const existing = await db.get('accounts', id);
  if (existing) return existing.id;
  const label = bankKey
    ? `${bankKey.toUpperCase()} ••${last4 || '????'}`
    : last4 ? `Account ••${last4}` : 'Unassigned';
  await db.put('accounts', {
    id, label, bankKey: bankKey || '', last4: last4 || '',
    type: accountTypeFor(method), currency: 'INR', createdAt: Date.now(),
  });
  emit({ type: 'accounts' });
  return id;
}

/**
 * Ingest one raw message. Returns one of:
 *   'duplicate'      — identical message already seen (intake hash hit)
 *   'unparsed'       — stored, no rule matched (surfaced in UI for a new rule)
 *   'duplicate-txn'  — parsed but the same transaction already exists (dedupeKey)
 *   'parsed'         — new transaction stored
 * @param msg {source, sender, body, receivedAt}
 */
export async function ingestRaw(msg) {
  // HTTP ingest contract uses "text"; internal callers use "body". Accept both.
  const body = String(msg.body ?? msg.text ?? '');
  if (!body.trim()) return 'ignored';
  const source = msg.source || 'manual';
  const sender = msg.sender || '';
  // Adapters/sample may send an ISO string; everything downstream wants epoch ms.
  const receivedAt = typeof msg.receivedAt === 'string'
    ? (Date.parse(msg.receivedAt) || Date.now())
    : (msg.receivedAt || Date.now());
  const id = uuid();
  const hash = await contentHash(`${source}|${sender}|${body}`);

  const intake = await db.addUnique('raw_messages', {
    id, source, sender, body, receivedAt, ingestedAt: Date.now(),
    contentHash: hash, status: 'pending', producedTxnId: null,
  });
  if (!intake.ok) return 'duplicate'; // exact message already ingested

  const { status, txn } = parseMessage({ source, sender, body, receivedAt }, await rules());
  if (status !== 'parsed') {
    await db.put('raw_messages', {
      id, source, sender, body, receivedAt, ingestedAt: Date.now(),
      contentHash: hash, status: 'unparsed', producedTxnId: null,
    });
    emit({ type: 'unparsed' });
    return 'unparsed';
  }

  txn.id = uuid();
  txn.accountId = await resolveAccount(txn.bankKey, txn.accountLast4, txn.method);
  txn.rawMessageId = id;
  txn.createdAt = Date.now();
  txn.notes = '';

  // Transaction-level dedupe: the DB's unique by_dedupeKey index is the gate.
  const added = await db.addUnique('transactions', txn);
  if (!added.ok) {
    await db.put('raw_messages', {
      id, source, sender, body, receivedAt, ingestedAt: Date.now(),
      contentHash: hash, status: 'duplicate', producedTxnId: null,
    });
    return 'duplicate-txn';
  }

  // Flip the source message to parsed in the same record (atomic enough: the
  // txn is already committed; this only updates provenance).
  await db.put('raw_messages', {
    id, source, sender, body, receivedAt, ingestedAt: Date.now(),
    contentHash: hash, status: 'parsed', producedTxnId: txn.id,
  });
  emit({ type: 'transaction', txn });
  return 'parsed';
}

/** Manual paste path: parse free text the user pasted. */
export const ingestText = (text, source = 'manual', sender = '') =>
  ingestRaw({ source, sender, body: text, receivedAt: Date.now() });

/** Direct entry (cash / correction) — skips parsing, writes a transaction. */
export async function addManualTxn({ amount, direction = 'debit', merchant = '', category = 'uncategorized', ts = Date.now(), method = 'cash', notes = '' }) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('amount must be a positive integer (paise)');
  const accountId = await resolveAccount('', '', method);
  const txn = {
    id: uuid(), accountId, rawMessageId: null,
    amount, currency: 'INR', direction, ts,
    merchant, rawMerchant: merchant, category, categorySource: 'manual',
    ref: '', method, bankKey: '', accountLast4: '',
    dedupeKey: `manual|${uuid()}`, createdAt: Date.now(), notes,
  };
  await db.put('transactions', txn);
  emit({ type: 'transaction', txn });
  return txn;
}

/** User override of a category — never re-touched by rules afterward. */
export async function recategorize(txnId, category) {
  const txn = await db.get('transactions', txnId);
  if (!txn) return;
  txn.category = category;
  txn.categorySource = 'manual';
  await db.put('transactions', txn);
  emit({ type: 'recategorize', txn });
}

export async function deleteTxn(txnId) {
  await db.del('transactions', txnId);
  emit({ type: 'delete', id: txnId });
}

// ── live ingestion bridge ─────────────────────────────────────────────────────
// Poll the local bridge (tools/serve.js) for messages POSTed by the email/SMS
// adapters. If the page is served by a plain static host (no /ingest route),
// the first failure disables polling silently — the PWA still works standalone.
let pollTimer = null;
export function startLivePoll(intervalMs = 4000) {
  if (pollTimer) return;
  const tick = async () => {
    let res;
    try {
      res = await fetch('/ingest/pending', { headers: { 'cache-control': 'no-store' } });
    } catch { return stopLivePoll(); } // no bridge -> stop quietly
    if (!res.ok) return stopLivePoll();
    const { messages } = await res.json().catch(() => ({ messages: [] }));
    let n = 0;
    for (const m of messages || []) {
      const r = await ingestRaw(m);
      if (r === 'parsed') n++;
    }
    if (n) emit({ type: 'batch', count: n });
  };
  pollTimer = setInterval(tick, intervalMs);
  tick();
}
export function stopLivePoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
