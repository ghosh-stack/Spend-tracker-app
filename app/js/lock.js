// App lock: a PIN gate (PBKDF2-SHA256 via WebCrypto) over the UI, locking on
// background, with an attempt lockout. Optional biometric unlock when running in
// the Capacitor wrapper. Fully local — no server, the raw PIN is never stored.
// Honest boundary: this is an access gate, NOT at-rest encryption (see PRIVACY.md).
import * as db from './db.js';

const enc = new TextEncoder();
const ITER = 210000;
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin, salt, iters) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}
const constEq = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };

const getLock = () => db.getSetting('appLock', null);
export async function isEnabled() { const l = await getLock(); return !!(l && l.enabled); }

export async function setPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, ITER);
  await db.setSetting('appLock', { enabled: true, salt: b64(salt), hash: b64(hash), iterations: ITER, biometric: false, failed: 0, lockoutUntil: 0 });
}
export async function disable() { await db.setSetting('appLock', { enabled: false }); }

async function lockoutRemaining() { const l = await getLock(); return l && l.lockoutUntil ? Math.max(0, l.lockoutUntil - Date.now()) : 0; }

async function verify(pin) {
  const l = await getLock();
  if (!l || !l.enabled) return true;
  if (l.lockoutUntil && Date.now() < l.lockoutUntil) return false;
  const ok = constEq(await derive(pin, unb64(l.salt), l.iterations), unb64(l.hash));
  l.failed = ok ? 0 : (l.failed || 0) + 1;
  l.lockoutUntil = (!ok && l.failed >= 5) ? Date.now() + Math.min(15 * 60000, 30000 * 2 ** (l.failed - 5)) : (ok ? 0 : l.lockoutUntil);
  await db.setSetting('appLock', l);
  return ok;
}

let showing = false;
// Relock immediately on return to foreground when the lock is on.
export async function maybeRelock() { if (!showing && await isEnabled()) return gate(); }

// Show the lock overlay; resolves when the user unlocks. Financial data is only
// rendered after this resolves (app.js awaits it before the first render).
export function gate() {
  showing = true;
  return new Promise(async (resolve) => {
    const screen = document.getElementById('lockScreen');
    const input = document.getElementById('pinInput');
    const msg = document.getElementById('lockMsg');
    const btn = document.getElementById('unlockBtn');
    const bioBtn = document.getElementById('bioBtn');
    screen.hidden = false;
    input.value = ''; setTimeout(() => input.focus(), 50);

    const finish = () => { screen.hidden = true; showing = false; resolve(); };
    const attempt = async () => {
      const rem = await lockoutRemaining();
      if (rem > 0) { msg.textContent = `Too many attempts — wait ${Math.ceil(rem / 1000)}s.`; return; }
      if (await verify(input.value)) finish();
      else { const l = await getLock(); msg.textContent = `Wrong PIN${l.failed >= 3 ? ` · ${l.failed} tries` : ''}`; input.value = ''; input.focus(); }
    };
    btn.onclick = attempt;
    input.onkeydown = (e) => { if (e.key === 'Enter') attempt(); };

    const bio = window.Capacitor?.Plugins?.BiometricAuth;
    const l = await getLock();
    if (bio && l?.biometric) {
      bioBtn.hidden = false;
      const tryBio = async () => { try { await bio.authenticate({ reason: 'Unlock SpendLens' }); finish(); } catch {} };
      bioBtn.onclick = tryBio;
      tryBio();
    } else if (bioBtn) {
      bioBtn.hidden = true;
    }
  });
}
