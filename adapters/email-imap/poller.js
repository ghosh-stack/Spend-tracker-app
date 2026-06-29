#!/usr/bin/env node
// Email → SpendLens ingestion adapter.
//
// Connects to your mailbox over IMAP+TLS (read-only), pulls recent messages
// from the configured bank senders, and POSTs each to the running app's local
// /ingest endpoint. The app parses + dedupes them, so re-polling the same mail
// is a harmless no-op (intake contentHash rejects duplicates).
//
// Credentials come ONLY from environment variables (see ../../.env.example).
// Nothing is hardcoded, nothing is stored, nothing leaves your machine except
// the IMAP connection to YOUR mail server and the POST to 127.0.0.1.
//
// Run:  node poller.js     (after `npm install` in this folder + filling .env)
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { readFileSync } from 'node:fs';

// Load .env from the repo root if present (no dotenv dependency — 6 lines).
try {
  for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env file — rely on real environment variables */ }

const {
  IMAP_HOST, IMAP_PORT = '993', IMAP_USER, IMAP_APP_PASSWORD,
  IMAP_ALLOWED_SENDERS = '', IMAP_SINCE_DAYS = '30', IMAP_POLL_SECONDS = '120',
  INGEST_URL = 'http://127.0.0.1:8787/ingest', INGEST_TOKEN = '',
} = process.env;

if (!IMAP_HOST || !IMAP_USER || !IMAP_APP_PASSWORD) {
  console.error('Missing IMAP_HOST / IMAP_USER / IMAP_APP_PASSWORD. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const allowed = IMAP_ALLOWED_SENDERS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const fromAllowed = (addr) => !allowed.length || allowed.some((a) => addr.toLowerCase().includes(a));

async function pollOnce() {
  const client = new ImapFlow({
    host: IMAP_HOST, port: +IMAP_PORT, secure: true,
    auth: { user: IMAP_USER, pass: IMAP_APP_PASSWORD },
    logger: false,
  });
  await client.connect();
  let posted = 0;
  const lock = await client.getMailboxLock('INBOX');
  try {
    const since = new Date(Date.now() - (+IMAP_SINCE_DAYS) * 86400000);
    for await (const msg of client.fetch({ since }, { source: true, envelope: true })) {
      const from = (msg.envelope?.from?.[0]?.address) || '';
      if (!fromAllowed(from)) continue;
      const parsed = await simpleParser(msg.source);
      const text = (parsed.text || parsed.html || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const ok = await post({
        source: 'email-imap',
        sender: from,
        text,
        receivedAt: (parsed.date || new Date()).toISOString(),
        meta: { subject: parsed.subject || '' },
      });
      if (ok) posted++;
    }
  } finally {
    lock.release();
    await client.logout();
  }
  return posted;
}

async function post(payload) {
  try {
    const res = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(INGEST_TOKEN ? { authorization: `Bearer ${INGEST_TOKEN}` } : {}) },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (e) {
    console.error('Could not reach the app ingest endpoint at', INGEST_URL, '— is `node tools/serve.js` running?');
    return false;
  }
}

async function loop() {
  console.log(`SpendLens email poller → ${INGEST_URL}`);
  console.log(`Watching ${IMAP_USER} for ${allowed.length || 'ALL'} sender(s), last ${IMAP_SINCE_DAYS} days, every ${IMAP_POLL_SECONDS}s.`);
  for (;;) {
    try {
      const n = await pollOnce();
      if (n) console.log(`[${new Date().toLocaleTimeString()}] forwarded ${n} message(s)`);
    } catch (e) {
      console.error('poll error:', e.message);
    }
    await new Promise((r) => setTimeout(r, (+IMAP_POLL_SECONDS) * 1000));
  }
}

loop();
