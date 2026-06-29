# SpendLens — native Android app

Wraps the PWA in [`../app`](../app) with [Capacitor](https://capacitorjs.com) and
adds **automatic, on-device capture** of bank alerts:

- **SMS** — a `BroadcastReceiver` (`RECEIVE_SMS`) catches incoming bank texts.
- **Email + bank-app push** — a `NotificationListenerService` reads notifications
  from an allow-list of mail/bank apps (Gmail, Outlook, HDFC, ICICI, PhonePe, …).

Both feed the **same** parser the web app uses, via the `spendlens-sms` window
event. The cross-channel dedupe means a spend seen on SMS *and* email collapses
into one transaction. Everything stays on the device — no server, no credentials.

## Why sideload-only (read this)

Google Play restricts `RECEIVE_SMS` to default SMS-handler apps, and scrutinises
notification-access for reading other apps' notifications. An expense tracker
qualifies for neither, so this is distributed as a **self-signed APK you
sideload** — not a Play Store app. That's the honest, correct model for a
single-user, local-first tracker. (The web app and manual paste/import need no
permissions and remain the universal fallback.)

## Build the APK

**Easiest — GitHub Actions (no local Android toolchain):** push a tag like
`v0.2.0` (or run the *Android APK* workflow manually). It builds a debug-signed
APK and attaches it to the release / as a run artifact. Download it to your phone
and open it (allow "install unknown apps"). See
[`.github/workflows/android-apk.yml`](../.github/workflows/android-apk.yml).

**Locally** (needs Node 18+, JDK 17, Android SDK):
```bash
cd android-native
npm install
npx cap add android          # generates the android/ project (first time only)
npm run sync                 # copies ../app + injects native capture, patches manifest
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk  → sideload to your phone
```
`npm run open` opens the project in Android Studio if you prefer to build there.

> This repo ships the **source + CI**, not a prebuilt signed APK — signing needs
> your own keystore on your own machine. A debug-signed APK installs fine for
> personal use; for a release-signed one, add a keystore as CI secrets (the
> workflow has an opt-in signed path).

## First run (on the phone)

A one-time wizard requests, with an explanation before each:
1. **SMS permission** (`RECEIVE_SMS`) — read incoming bank texts (not your history).
2. **Notification access** — opens system Settings; toggle SpendLens on so it can
   read mail/bank-app alerts. (Can't be granted programmatically.)
3. **Battery exemption** — keep capture running in the background.

Each step is skippable; manual paste/import always works. A capture-status screen
shows what's granted and when the last alert was captured.

## What's where

```
android-native/
  capacitor.config.json        appId app.spendlens, webDir ../app
  package.json                 @capacitor/* + scripts (init:android, sync, apk)
  scripts/apply-native.mjs     injects the native code + patches the manifest after cap sync
  native/
    MainActivity.java          registers the capture plugin
    capture/
      SpendLensCapturePlugin.java   permission + status methods, JS bridge
      SmsReceiver.java              incoming-SMS BroadcastReceiver
      SpendLensNotificationListener.java  email + bank-push capture
      CaptureBridge.java / CaptureQueue.java  deliver-or-buffer to the WebView
../app/js/native-capture.js    web glue (onboarding, queue drain) — loaded only in the wrapper
```

## Honest limitations

- Notification text can be **truncated/bundled**; alerts missing the amount land
  in *Needs review* rather than auto-logging. Full email bodies would need an
  opt-in Gmail/IMAP path (not built — keeps the zero-egress default).
- Notification access can be **revoked by the OS/OEM** after updates; the status
  screen + a nudge help you re-grant it.
- Aggressive OEM battery managers (Xiaomi/Oppo/Vivo) may kill the listener.
- Sideloaded APKs don't auto-update — reinstall a newer build manually.
- Sender IDs / package names are **spoofable**; the parser still requires a known
  bank format + plausible amount + account tail before recording.
