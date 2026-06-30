# Setup, build & deploy

The core app is static files — no build step, no bundler. You only need a way
to serve `app/` over `http://` (service workers and ES modules don't work from
`file://`).

## 1. Run it locally

### Option A — Python (app only)
```bash
python -m http.server 8765 --directory app
```
Open <http://127.0.0.1:8765>.

### Option B — Node bridge (app + live ingestion)
```bash
node tools/serve.js               # serves app/ AND the /ingest endpoint on :8787
PORT=9000 node tools/serve.js     # custom port
```
Open <http://127.0.0.1:8787>. Use this one if you'll run the email/SMS adapters.

> No Node or Python? Any static host works — `npx serve app`, VS Code Live
> Server, nginx, GitHub Pages, Netlify. Just serve the `app/` folder.

## 2. Install as an app (the "cross-platform" deliverable)

The PWA installs from the browser — no compiler, no store:

| Platform | How |
|---|---|
| **Windows / macOS / Linux** | Open the URL in **Chrome or Edge** → click the **Install** icon in the address bar (or ⋮ → *Install SpendLens*). It gets a window, a launcher/dock icon, and runs offline. |
| **Android** | Open in **Chrome** → ⋮ → **Add to Home screen** / **Install app**. Full-screen, offline, its own icon. |
| **iOS (bonus)** | Safari → Share → *Add to Home Screen*. (No SMS/email auto-capture on iOS; paste/import only.) |

For real always-on use, host `app/` on any static host over **HTTPS** (required
for install + service worker on non-localhost origins) and install from there.

## 3. Optional: email ingestion (desktop)

```bash
cp .env.example .env          # then fill IMAP_* values (app password, not your login)
node tools/serve.js           # keep the app tab open
cd adapters/email-imap && npm install && npm start
```
Details and provider notes: [adapters/email-imap/README.md](../adapters/email-imap/README.md).

## 4. Android app: auto-capture APK

The real Android deliverable is the Capacitor app in [`android-native/`](../android-native/),
which auto-captures bank **SMS** + **email/push** on-device. It's distributed as a
**self-signed, sideloaded APK** (Google Play restricts the `RECEIVE_SMS` /
notification-access permissions an expense tracker can't qualify for).

**[`android-native/README.md`](../android-native/README.md) is the source of
truth** for building, sideloading, first-run permissions, *Scan past SMS*
backfill, and the in-app updater. The fastest path needs **no local Android
toolchain**:

```bash
# Build via GitHub Actions: push a release tag (or run the "Android APK" workflow).
git tag v0.3.6 && git push origin v0.3.6
# → CI builds a debug-signed APK, stamps the version, and attaches it to the Release.
#   Download it to your phone and open it (allow "install unknown apps").
```

Build locally instead (needs Node 18+, JDK 17, Android SDK):

```bash
cd android-native
npm install
npx cap add android      # first time only — generates the android/ project
npm run sync             # copies ../app + injects native capture, patches the manifest
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk  → sideload to your phone
```

The legacy no-code [SMS forwarder](../adapters/android-sms/README.md) still works
for the web/PWA route, but the native APK is the recommended path.

## 5. Optional: desktop binary (Tauri)

Wraps the **same** `app/` build in the OS WebView — only add it if you want a
signed desktop installer.

```bash
npm create tauri-app@latest          # choose "use existing frontend": point frontendDist at ../app
npm run tauri build                  # produces a platform installer
```
Needs the Rust toolchain + each OS's SDK (WebView2/MSVC on Windows, Xcode on
macOS, `webkit2gtk` on Linux). Tauri can run `adapters/email-imap/poller.js` as
a sidecar so users don't start it by hand. Cross-OS builds happen **on** each OS
(or a CI matrix).

(The Android app is covered in §4 — it's built by the `android-native/` CI, not
hand-wired with `cap init`.)

> **Sandbox note:** this repo produces all source and configs but **not**
> release-signed binaries — release code-signing (Authenticode, Apple
> notarization, an Android *release* keystore) needs your own certificates on your
> own machines. The PWA path needs nothing signed, and the Android CI ships a
> **debug-signed** APK (a committed, non-secret debug keystore) that sideloads fine.

## 6. Tests
```bash
node --test tests/
```
