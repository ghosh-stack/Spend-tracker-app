// Loaded ONLY inside the Capacitor Android wrapper (app.js guards on
// window.Capacitor.isNativePlatform()). The plain browser PWA never imports it,
// so the web build stays dependency-free. Captured messages arrive via the
// 'spendlens-sms' window event that app.js already handles.
const Cap = window.Capacitor;
const Plugin = Cap.registerPlugin('SpendLensCapture');
const Prefs = (Cap.Plugins && Cap.Plugins.Preferences) || null;

// Prefer the native Preferences plugin; fall back to localStorage so the
// 'onboarded' flag (which gates the one-time permission requests) is
// deterministic even if the plugin proxy isn't populated in the WebView.
const pref = async (key, dflt = '') => {
  if (Prefs) { try { return (await Prefs.get({ key })).value ?? dflt; } catch {} }
  try { return localStorage.getItem('cap_' + key) ?? dflt; } catch { return dflt; }
};
const setPref = async (key, value) => {
  if (Prefs) { try { await Prefs.set({ key, value: String(value) }); return; } catch {} }
  try { localStorage.setItem('cap_' + key, String(value)); } catch {}
};

// First-run: explain-then-request each capability. Skippable — manual paste
// always works, so denying a permission never bricks the app.
async function onboard() {
  if (await pref('onboarded') === '1') return;
  try { await Plugin.requestSmsPermission(); } catch {}
  try {
    const s = await Plugin.isNotificationAccessGranted();
    if (!s.granted) await Plugin.openNotificationAccessSettings(); // email + bank-push; system screen
  } catch {}
  try { await Plugin.requestIgnoreBatteryOptimizations(); } catch {}
  await setPref('onboarded', '1');
}

// Flush messages buffered while backgrounded whenever we return to foreground.
const drain = () => Plugin.drainQueue().catch(() => {});
document.addEventListener('visibilitychange', () => { if (!document.hidden) drain(); });
window.addEventListener('focus', drain);

// Expose for the in-app capture-status screen and the updater.
window.SpendLensNative = {
  plugin: Plugin,
  status: () => Plugin.getStatus(),
  requestSms: () => Plugin.requestSmsPermission(),
  openNotificationAccess: () => Plugin.openNotificationAccessSettings(),
  openAppInfo: () => Plugin.openAppInfo().catch(() => {}),
  // GitHub release lookup via native HTTP (keeps the WebView CSP at connect-src
  // 'self'); returns { code, body } where body is the raw JSON string.
  checkUpdate: (repo) => Plugin.checkUpdate({ repo }),
  openExternal: (url) => { Plugin.openExternal({ url }).catch(() => {}); },
  // Print an HTML document to PDF via Android's PrintManager (see report.js).
  printContent: (html, jobName) => { Plugin.printContent({ html, jobName }).catch(() => {}); },
  reonboard: async () => { await setPref('onboarded', ''); return onboard(); },
};

onboard();
drain();
