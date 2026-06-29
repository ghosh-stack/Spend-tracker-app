// Bootstrap: open the DB, restore theme, paint, detect the optional live
// ingestion bridge, register the service worker for offline/install.
import * as db from './db.js';
import * as ingest from './ingest.js';
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
  initUI();
  wireGlobals();
  ingest.onChange(refreshBadge);
  await render();
  await refreshBadge();
  detectBridge();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
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
