// SpendLens local server (Node stdlib only — no dependencies).
//
// Two jobs in one tiny server:
//   1. Serve the PWA in /app as static files (so it installs as a PWA over http).
//   2. Buffer raw bank notifications POSTed by the ingestion adapters
//      (email poller, android-sms forwarder) so the PWA can pull them in live.
//
// The PWA also runs fully standalone from any static host; this server is only
// needed for the *automated* ingestion adapters. Bound to localhost.
//
// ponytail: in-memory queue, single consumer (the one open PWA tab drains it on
// poll). Survives nothing across restart. Add a file/SQLite spool only if you
// need durability or multiple consumers.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../app/', import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.INGEST_TOKEN || '';
const MAX_BODY = 64 * 1024; // a bank SMS/email alert is tiny; cap to refuse abuse.

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** @type {Array<{id:number, source:string, text:string, receivedAt:string, meta:object}>} */
const queue = [];
let seq = 0;

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(body);
};

// Constant-time token comparison (no early-out timing side channel).
const safeEq = (a, b) => {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};
const json = (res, status, obj) =>
  send(res, status, JSON.stringify(obj), { 'content-type': MIME['.json'] });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function authed(req) {
  if (!TOKEN) return true; // no token configured -> open (localhost only anyway)
  const h = req.headers['authorization'] || '';
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : '';
  return safeEq(bearer, TOKEN) || safeEq(req.headers['x-ingest-token'] || '', TOKEN);
}

async function handleIngest(req, res) {
  if (!authed(req)) return json(res, 401, { error: 'bad or missing ingest token' });
  let raw;
  try {
    raw = await readBody(req);
  } catch (e) {
    return json(res, e.status || 400, { error: e.message });
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(res, 400, { error: 'body must be JSON' });
  }
  // Accept one message or a batch. Validate at this trust boundary.
  const items = Array.isArray(payload) ? payload : [payload];
  const accepted = [];
  for (const m of items) {
    if (!m || typeof m.text !== 'string' || !m.text.trim()) continue; // skip junk
    const entry = {
      id: ++seq,
      source: typeof m.source === 'string' ? m.source.slice(0, 16) : 'unknown',
      text: m.text.slice(0, MAX_BODY),
      receivedAt: typeof m.receivedAt === 'string' ? m.receivedAt : new Date().toISOString(),
      meta: m.meta && typeof m.meta === 'object' ? m.meta : {},
    };
    queue.push(entry);
    accepted.push(entry.id);
  }
  return json(res, 200, { accepted: accepted.length, ids: accepted });
}

function drainPending(res) {
  const batch = queue.splice(0, queue.length); // drain-on-read, single consumer
  return json(res, 200, { messages: batch });
}

async function serveStatic(req, res, pathname) {
  // Resolve safely under ROOT (block path traversal at this trust boundary).
  const rel = decodeURIComponent(pathname.replace(/^\/+/, '')) || 'index.html';
  const target = normalize(join(ROOT, rel));
  if (!target.startsWith(normalize(ROOT))) return send(res, 403, 'forbidden');
  try {
    const data = await readFile(target);
    const type = MIME[extname(target).toLowerCase()] || 'application/octet-stream';
    return send(res, 200, data, { 'content-type': type });
  } catch {
    // SPA fallback: unknown non-asset paths return index.html.
    if (!extname(target)) {
      try {
        const idx = await readFile(join(ROOT, 'index.html'));
        return send(res, 200, idx, { 'content-type': MIME['.html'] });
      } catch {}
    }
    return send(res, 404, 'not found');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;
  if (req.method === 'POST' && pathname === '/ingest') return handleIngest(req, res);
  if (req.method === 'GET' && pathname === '/ingest/pending') return drainPending(res);
  if (req.method === 'GET' && pathname === '/ingest/health')
    return json(res, 200, { ok: true, pending: queue.length });
  if (req.method === 'GET') return serveStatic(req, res, pathname);
  send(res, 405, 'method not allowed');
});

// Localhost only — never expose bank data on the network.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`SpendLens running at http://127.0.0.1:${PORT}`);
  console.log(`  PWA:    http://127.0.0.1:${PORT}/`);
  console.log(`  Ingest: POST http://127.0.0.1:${PORT}/ingest  ${TOKEN ? '(token required)' : '(no token set)'}`);
});
