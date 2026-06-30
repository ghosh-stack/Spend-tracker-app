// Bootstrap: open the DB, restore theme, paint, detect the optional live
// ingestion bridge, register the service worker for offline/install.
import * as db from './db.js';
import * as ingest from './ingest.js';
import * as lock from './lock.js';
import * as notify from './notify.js';
import { initUI, wireGlobals, render, setLive, setUnparsedBadge } from './ui.js';

// Theme is a UI preference (not financial data) — fine to persist locally.
const savedTheme = localStorage.getItem('spendlens-theme');
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

async function refreshBadge() {
  const unparsed = await db.getAllByIndex('raw_messages', 'by_status', 'unparsed').catch(() => []);
  setUnparsedBadge(unparsed.length);
}

async function detectBridge() {
  try {
    const res = await fetch('/ingest/health', { cache: 'no-store' });
    if (res.ok) { setLive(true); ingest.startLivePoll(4000); return; }
  } catch { /* no bridge — PWA runs standalone */ }
  setLive(false);
}

async function main() {
  await db.openDB();
  if (await lock.isEnabled()) await lock.gate(); // block until unlocked — no data renders first
  initUI();
  wireGlobals();
  ingest.onChange(refreshBadge);
  ingest.onChange((evt) => { if (evt.type === 'transaction' && evt.txn) notify.onTransaction(evt.txn); });
  await render();
  await refreshBadge();
  detectBridge();

  // Re-lock immediately on return to the foreground when the lock is on.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) lock.maybeRelock(); });
  window.addEventListener('focus', () => lock.maybeRelock());

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // If the page was already controlled at load, a later controllerchange means
    // a freshly deployed SW just took over — reload once so the new shell (e.g.
    // updated categories) runs instead of the stale in-memory modules. Guarding
    // on an existing controller skips the first-install case (no reload loop).
    if (navigator.serviceWorker.controller) {
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        location.reload();
      });
    }
  }

  // Native-wrapper hook (Capacitor): the SMS receiver / notification listener
  // dispatch a 'spendlens-sms' window event; a forwarder can also call
  // window.SpendLens.ingest({...}) directly. The event detail carries its own
  // source ('android-sms' | 'android-notification'); default to SMS if absent.
  window.SpendLens = { ingest: (m) => ingest.ingestRaw(m), render };
  window.addEventListener('spendlens-sms', (e) => {
    try {
      const msg = JSON.parse(e.detail || '{}');
      ingest.ingestRaw({ source: 'android-sms', ...msg });
    } catch {}
  });

  // Inside the Capacitor wrapper, load the native capture glue (onboarding,
  // queue drain). Guarded so the plain browser PWA never references Capacitor.
  if (window.Capacitor?.isNativePlatform?.()) {
    import('./native-capture.js').catch(() => {});
  }
}

main();
