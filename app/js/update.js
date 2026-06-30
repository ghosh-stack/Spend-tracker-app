// In-app updater for the sideloaded APK. Sideloaded Android apps can't silently
// self-update (OS security), so this checks GitHub Releases for a newer version
// and, if found, opens the new APK so the user can reinstall over the top (their
// IndexedDB data survives an install-over).
//
// Privacy: the version lookup runs through the NATIVE plugin (SpendLensNative.
// checkUpdate), NOT a WebView fetch — so the page's strict CSP (connect-src
// 'self') stays intact and the web layer still makes zero third-party calls. The
// only egress is this explicit, user-initiated GitHub release lookup.
import { APP_VERSION, REPO } from './version.js';

export const currentVersion = APP_VERSION;

// Compare dotted numeric versions; true if a is strictly newer than b. A
// pre-release suffix (1.2.0-beta) is ignored for the gate — compares as 1.2.0.
export function isNewer(a, b) {
  const parse = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const x = parse(a), y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const dx = x[i] || 0, dy = y[i] || 0;
    if (dx !== dy) return dx > dy;
  }
  return false;
}

// Returns { code, data? }. Uses the native HTTP path inside the APK; falls back
// to a direct fetch in a plain browser (CSP-blocked in production, but keeps the
// module usable for local testing when a native mock is injected).
async function fetchLatestRelease() {
  const native = window.SpendLensNative && window.SpendLensNative.checkUpdate;
  if (native) {
    const r = await native(REPO); // { code, body }
    if (r.code !== 200 || !r.body) return { code: r.code };
    return { code: 200, data: JSON.parse(r.body) };
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store',
  });
  if (!res.ok) return { code: res.status };
  return { code: 200, data: await res.json() };
}

// Never throws. Status: 'available' | 'current' | 'none' | 'offline' | 'error'.
export async function checkForUpdate() {
  let r;
  try { r = await fetchLatestRelease(); }
  catch { return { status: 'offline' }; }
  if (r.code === 404) return { status: 'none' };       // no releases yet, or private repo
  if (r.code !== 200 || !r.data) return { status: 'error', code: r.code };
  const latest = String(r.data.tag_name || '').replace(/^v/, '');
  if (!latest) return { status: 'none' };
  const apk = (r.data.assets || []).find((a) => /\.apk$/i.test(a.name || ''));
  const downloadUrl = (apk && apk.browser_download_url) || r.data.html_url;
  return {
    status: isNewer(latest, APP_VERSION) ? 'available' : 'current',
    latest, current: APP_VERSION, downloadUrl, htmlUrl: r.data.html_url,
  };
}

// Open a URL (the APK asset or the release page) in the system browser/installer.
// The native intent handles .apk downloads reliably; browsers fall back to a tab.
export function openDownload(url) {
  if (!url) return;
  const ext = window.SpendLensNative && window.SpendLensNative.openExternal;
  if (ext) ext(url);
  else window.open(url, '_blank', 'noopener');
}
