// Intake orchestration: raw message -> dedupe at intake -> parse -> resolve
// account -> dedupe at transaction -> store atomically -> notify the UI.
// The pure extraction lives in parser.js; this file is the side-effecting glue.
import * as db from './db.js';
import { parseMessage, normalizeRef, merchantConflict } from './parser.js';
import { PARSE_RULES, CATEGORIZE_RULES } from './rules.js';

// Same transaction can arrive via SMS and email hours apart; collapse within this window.
const CROSS_CHANNEL_WINDOW_MS = 3 * 60 * 60 * 1000;
const channelOf = (source) =>
  source === 'android-sms' || source === 'sms' ? 'sms'
  : source === 'email-imap' || source === 'email' ? 'email'
  : source === 'android-notification' ? 'push'
  : source === 'manual' ? 'manual'
  : source === 'import-csv' ? 'import'
  : (source || 'unknown');

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
  // Cap length: bank alerts are tiny, and an unbounded body is a needless DoS
  // surface for the regex engine.
  const body = String(msg.body ?? msg.text ?? '').slice(0, 4000);
  if (!body.trim()) return 'ignored';
  const source = msg.source || 'manual';
  const sender = msg.sender || '';
  // Adapters/sample may send an ISO string; everything downstream wants epoch ms.
  const receivedAt = typeof msg.receivedAt === 'string'
    ? (Date.parse(msg.receivedAt) || Date.now())
    : (msg.receivedAt || Date.now());
  const id = uuid();
  const hash = await contentHash(`${source}|${sender}|${body}`);

  // One base record; each branch only varies status + producedTxnId.
  const base = { id, source, sender, body, receivedAt, contentHash: hash };
  const rawRec = (status, producedTxnId = null) => ({ ...base, ingestedAt: Date.now(), status, producedTxnId });

  const intake = await db.addUnique('raw_messages', rawRec('pending'));
  if (!intake.ok) return 'duplicate'; // exact message already ingested

  const { status, txn } = parseMessage({ source, sender, body, receivedAt }, await rules());
  if (status !== 'parsed') {
    await db.put('raw_messages', rawRec('unparsed'));
    emit({ type: 'unparsed' });
    return 'unparsed';
  }

  txn.id = uuid();
  txn.accountId = await resolveAccount(txn.bankKey, txn.accountLast4, txn.method);
  txn.rawMessageId = id;
  txn.createdAt = Date.now();
  txn.notes = '';
  txn.source = source;
  txn.channel = channelOf(source);
  txn.sender = sender;
  // A generic-parsed txn with no ref AND no account has only a weak minute-bucket
  // key; fold in the content hash so two distinct unknown-bank spends in the same
  // minute don't collide and silently drop one.
  if (!txn.ref && !txn.accountLast4) txn.dedupeKey += '|' + hash.slice(0, 16);

  // Cross-channel match → merge or insert. Ingestion is serial (the poll awaits
  // each message; manual/paste is one at a time), so a read-decide-write with the
  // unique by_dedupeKey index as the final backstop is correct and avoids the
  // IndexedDB auto-commit pitfall of spanning reads+writes in one transaction.
  // Candidates = every txn at the same amount (amounts are sparse, so this is small).
  const cands = await db.getAllByIndex('transactions', 'by_amount', txn.amount);
  const existing = cands.find((c) => c.id !== txn.id && classifyMatch(c, txn) === 'merge')
    || cands.find((c) => (c.mergedKeys || []).includes(txn.dedupeKey)); // a 3rd copy of an already-merged txn

  if (existing) {
    const merged = mergeInto(existing, txn);
    await db.put('transactions', merged);
    await db.put('raw_messages', rawRec('parsed', existing.id));
    emit({ type: 'transaction', txn: merged, merged: true });
    return 'merged';
  }

  const soft = cands.find((c) => c.id !== txn.id && classifyMatch(c, txn) === 'soft');
  if (soft) txn.possibleDuplicateOf = soft.id; // likely dup, keep both + flag for review
  txn.channels = [txn.channel];
  txn.mergedKeys = [txn.dedupeKey];

  const added = await db.addUnique('transactions', txn); // unique by_dedupeKey is the exact-dup gate
  if (!added.ok) {
    await db.put('raw_messages', rawRec('duplicate'));
    return 'duplicate-txn';
  }
  await db.put('raw_messages', rawRec('parsed', txn.id));
  emit({ type: 'transaction', txn });
  return 'parsed';
}

// ── cross-channel dedupe/merge internals ──────────────────────────────────────
// 'merge' (same txn, fold together) | 'soft' (likely dup, keep both + flag) | null
function classifyMatch(existing, txn) {
  if (existing.amount !== txn.amount || existing.direction !== txn.direction) return null;
  // Tier 1: identical bank reference — same txn regardless of channel/time gap.
  if (txn.ref && existing.ref && normalizeRef(txn.ref) === normalizeRef(existing.ref)) return 'merge';
  // Same account (full id, OR same bank + last4 — never across banks that merely
  // share a last-4), within the time window.
  const sameTail = existing.accountId === txn.accountId
    || ((existing.bankKey || '') === (txn.bankKey || '') && !!existing.accountLast4 && existing.accountLast4 === txn.accountLast4);
  const inWindow = Math.abs(existing.ts - txn.ts) <= CROSS_CHANNEL_WINDOW_MS;
  if (!(sameTail && inWindow)) return null;
  if (merchantConflict(existing.merchant, txn.merchant)) return 'soft';
  // Cross-channel agreement is a confident merge; a same-channel, ref-less near
  // duplicate is only FLAGGED (could be two real same-amount spends) — never auto-merged.
  const crossChannel = (existing.channel || existing.source) !== (txn.channel || txn.source);
  return crossChannel ? 'merge' : 'soft';
}

// Fold the new parse into the existing row; the richer source fills gaps. The
// dedupeKey is intentionally NOT recomputed — the existing row keeps its already-
// unique key so the put can't collide with another row (cross-channel matching
// uses classifyMatch, not the key); mergedKeys records the merged-in key.
function mergeInto(existing, txn) {
  const E = { ...existing };
  E.ts = Math.min(E.ts, txn.ts); // earliest is closest to the real swipe time
  const merchScore = (m) => (!m ? 0 : m.includes('@') ? 1 : 2 + m.length / 100); // human name beats VPA
  if (merchScore(txn.merchant) > merchScore(E.merchant)) { E.merchant = txn.merchant; E.rawMerchant = txn.rawMerchant; }
  if (!E.ref && txn.ref) E.ref = txn.ref;
  if (E.method === 'other' && txn.method !== 'other') E.method = txn.method;
  if (!E.bankKey && txn.bankKey) E.bankKey = txn.bankKey;
  if (E.categorySource !== 'manual' && txn.categorySource === 'rule' && E.categorySource !== 'rule') {
    E.category = txn.category; E.categorySource = 'rule';
  }
  E.channels = [...new Set([...(existing.channels || [existing.channel]), txn.channel])].sort();
  E.mergedKeys = [...new Set([...(existing.mergedKeys || [existing.dedupeKey]), txn.dedupeKey])];
  E.mergedAt = Date.now();
  return E;
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
    source: 'manual', channel: 'manual', sender: '', channels: ['manual'],
    dedupeKey: `manual|${uuid()}`, createdAt: Date.now(), notes,
  };
  await db.put('transactions', txn);
  emit({ type: 'transaction', txn });
  return txn;
}

/**
 * User override of a category. Also LEARNS: persists a user categorize rule for
 * this merchant and applies it to the merchant's other non-manual transactions,
 * so categorizing once sticks everywhere. Returns how many others were updated.
 */
export async function recategorize(txnId, category, { learn = true } = {}) {
  const txn = await db.get('transactions', txnId);
  if (!txn) return { applied: 0 };
  txn.category = category;
  txn.categorySource = 'manual';
  await db.put('transactions', txn);

  let applied = 0;
  const key = (txn.rawMerchant || '').trim().toLowerCase();
  if (learn && key.length >= 3) {
    await db.put('rules', {
      id: 'user-cat:' + key, kind: 'categorize', match: key, categoryId: category,
      bankKey: '*', priority: 1, enabled: true, builtin: false, createdAt: Date.now(),
    });
    _rules = null; // bust the merged-rules cache so the learned rule takes effect
    for (const t of await db.getAll('transactions')) {
      if (t.id !== txnId && t.categorySource !== 'manual' &&
          (t.rawMerchant || '').trim().toLowerCase() === key && t.category !== category) {
        t.category = category; t.categorySource = 'rule';
        await db.put('transactions', t);
        applied++;
      }
    }
  }
  emit({ type: 'recategorize', txn, applied });
  return { applied, merchant: txn.merchant };
}

export async function deleteTxn(txnId) {
  await db.del('transactions', txnId);
  emit({ type: 'delete', id: txnId });
}

/** Patch a transaction (notes, exclude-from-spend, possibleDuplicateOf clear). */
export async function updateTxn(txnId, patch) {
  const txn = await db.get('transactions', txnId);
  if (!txn) return;
  Object.assign(txn, patch);
  await db.put('transactions', txn);
  emit({ type: 'update', txn });
}

// ── live ingestion bridge ─────────────────────────────────────────────────────
// Poll the local bridge (tools/serve.js) for messages POSTed by the email/SMS
// adapters. If the page is served by a plain static host (no /ingest route),
// the first failure disables polling silently — the PWA still works standalone.
let pollTimer = null;
let polling = false;
export function startLivePoll(intervalMs = 4000) {
  if (polling) return;
  polling = true;
  // Self-rescheduling (not setInterval) so a slow batch never overlaps the next
  // tick. The whole body is guarded: a DB error mid-batch must not become an
  // unhandled rejection that silently re-fires every interval.
  const tick = async () => {
    try {
      const res = await fetch('/ingest/pending', { headers: { 'cache-control': 'no-store' } });
      if (!res.ok) return stopLivePoll();
      const { messages } = await res.json().catch(() => ({ messages: [] }));
      let n = 0;
      for (const m of messages || []) {
        try { const r = await ingestRaw(m); if (r === 'parsed' || r === 'merged') n++; }
        catch (e) { console.error('ingest error', e); } // skip the bad one, keep the batch
      }
      if (n) emit({ type: 'batch', count: n });
    } catch { return stopLivePoll(); } // no bridge / network gone -> stop quietly
    if (polling) pollTimer = setTimeout(tick, intervalMs);
  };
  tick();
}
export function stopLivePoll() {
  polling = false;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}
