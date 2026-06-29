// Loaded ONLY inside the Capacitor Android wrapper (app.js guards on
// window.Capacitor.isNativePlatform()). The plain browser PWA never imports it,
// so the web build stays dependency-free. Captured messages arrive via the
// 'spendlens-sms' window event that app.js already handles.
const Cap = window.Capacitor;
const Plugin = Cap.registerPlugin('SpendLensCapture');
const Prefs = Cap.Plugins && Cap.Plugins.Preferences;

const pref = async (key, dflt = '') => { try { return (await Prefs.get({ key })).value ?? dflt; } catch { return dflt; } };
const setPref = async (key, value) => { try { await Prefs.set({ key, value: String(value) }); } catch {} };

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

// Expose for the in-app capture-status screen.
window.SpendLensNative = {
  plugin: Plugin,
  status: () => Plugin.getStatus(),
  openNotificationAccess: () => Plugin.openNotificationAccessSettings(),
  reonboard: async () => { await setPref('onboarded', ''); return onboard(); },
};

onboard();
drain();
