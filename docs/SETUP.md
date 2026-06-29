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

## 4. Optional: Android SMS auto-capture

Two routes, both honest about Google Play's SMS-permission policy. The no-code
automation-app route works today; the native Capacitor wrapper needs a self-signed,
sideloaded APK. See [adapters/android-sms/README.md](../adapters/android-sms/README.md).

## 5. Optional: native binaries

These wrap the **same** `app/` build — only add them if you want a signed
installer or on-device SMS capture.

### Desktop — Tauri
```bash
npm create tauri-app@latest          # choose "use existing frontend": point frontendDist at ../app
npm run tauri build                  # produces a platform installer
```
Needs the Rust toolchain + each OS's SDK (WebView2/MSVC on Windows, Xcode on
macOS, `webkit2gtk` on Linux). Tauri can run `adapters/email-imap/poller.js` as
a sidecar so users don't start it by hand. Cross-OS builds happen **on** each OS
(or a CI matrix).

### Android — Capacitor
```bash
npm i @capacitor/core @capacitor/cli
npx cap init SpendLens app.spendlens --web-dir ../app
npx cap add android
npx cap open android                 # build/sign in Android Studio
```
Needs Android Studio + SDK + JDK + Gradle. Add the SMS `BroadcastReceiver` from
the [android-sms adapter](../adapters/android-sms/README.md), sign with your own
keystore, and sideload.

> **Sandbox note:** this repo produces all source and configs but **not** signed
> binaries — code-signing (Authenticode, Apple notarization, an Android keystore)
> needs your own certificates on your own machines. The PWA path needs nothing signed.

## 6. Tests
```bash
node --test tests/
```
