// Bootstrap: open the DB, restore theme, paint, detect the optional live
// ingestion bridge, register the service worker for offline/install.
import * as db from './db.js';
import * as ingest from './ingest.js';
import * as lock from './lock.js';
import * as notify from './notify.js';
import { initUI, wireGlobals, render, setLive, setUnparsedBadge } from './ui.js';
import { APP_VERSION } from './version.js';

// Theme is a UI preference (not financial data) — fine to persist locally.
const savedTheme = localStorage.getItem('spendlens-theme');
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

async function refreshBadge() {
  const unparsed = await db.getAllByIndex('raw_messages', 'by_status', 'unparsed').catch(() => []);
  setUnparsedBadge(unparsed.length);
}

async function detectBridge() {
  // Native APK: the /ingest bridge is irrelevant (capture is native). Reflect the
  // real capture state so a working app never shows a misleading "Offline".
  if (window.Capacitor?.isNativePlatform?.()) return reflectCapture();
  try {
    const res = await fetch('/ingest/health', { cache: 'no-store' });
    if (res.ok) { setLive('live'); ingest.startLivePoll(4000); return; }
  } catch { /* no bridge — PWA runs standalone */ }
  setLive('manual');
}

// Map native capture permissions → the topbar pill. native-capture.js is imported
// asynchronously and sets window.SpendLensNative, so wait briefly for it on first run.
async function reflectCapture() {
  for (let i = 0; i < 25 && !window.SpendLensNative; i++) await new Promise((r) => setTimeout(r, 120));
  const n = window.SpendLensNative;
  if (!n) return setLive('check');
  try {
    const st = await n.status();
    if (st.sms === 'granted' || st.notificationAccess) setLive('capture');
    else if (st.sms === 'blocked') setLive('blocked');
    else setLive('check');
  } catch { setLive('check'); }
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

  // Re-lock immediately on return to the foreground when the lock is on; also
  // refresh the capture pill (the user may have just toggled a permission in Settings).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    lock.maybeRelock();
    if (window.SpendLensNative) reflectCapture();
  });
  window.addEventListener('focus', () => lock.maybeRelock());

  // Service worker: web (PWA) ONLY. Inside the Capacitor app the assets are already
  // bundled, and an active SW can shadow Capacitor's native bridge — leaving
  // window.Capacitor undefined, so SMS/notification capture silently never starts.
  // Capacitor serves from https://localhost, so treat localhost as native: keep the
  // SW out and unregister any that a previous build left behind (self-heals installs).
  const inCapacitor = location.hostname === 'localhost'
    || !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if ('serviceWorker' in navigator) {
    if (inCapacitor) {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    } else if (location.protocol.startsWith('http')) {
      // Version the SW URL so each release registers a fresh worker + cache (see sw.js).
      navigator.serviceWorker.register('sw.js?v=' + APP_VERSION).catch(() => {});
      // If already controlled at load, a later controllerchange means a freshly
      // deployed SW took over — reload once so the new shell runs (no loop: the
      // guard skips first install).
      if (navigator.serviceWorker.controller) {
        let reloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloading) return;
          reloading = true;
          location.reload();
        });
      }
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
    import('./native-capture.js').catch((e) => { try { window.__capErr = String((e && e.message) || e); } catch {} });
  }
}

main();
