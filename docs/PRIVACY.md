# Privacy & GDPR

SpendLens is built so that compliance is the *default*, not a feature bolted on.
The strongest privacy guarantee comes from the architecture: **there is no
server**, so there is nowhere for your financial data to go.

## What data exists, and where

| Data | Where it lives | Leaves your device? |
|---|---|---|
| Transactions, accounts, rules, raw messages, budgets | **IndexedDB**, in your browser, on your device | **Never.** |
| App-lock PIN | Not stored. Only a **salted PBKDF2-SHA256 hash** in IndexedDB (`settings`). | **Never.** |
| Settings (alert prefs, budget-alert state) | IndexedDB (`settings`) | Never. |
| Theme preference | `localStorage` (a UI flag, not financial data) | Never. |
| Bank credentials | Only if you use the email-IMAP adapter: a gitignored `.env` / env vars on your machine | Only to **your own** mail server, over IMAP+TLS. |
| Android SMS / notification text | Captured by the native app, fed straight into on-device parsing | **Never** — no egress; the notification listener only reads an allow-list of mail/bank apps. |
| Card numbers | Not stored. Accounts keep a display `last4` only. | N/A |
| In-app update check | Nothing stored | **Only when you tap "Check for updates":** a version lookup to GitHub's release API. No personal or financial data is sent. |

## No transmission, no telemetry

- The PWA makes **zero outbound network calls**. The service worker only serves
  the local cache; it contacts no third party.
- **No analytics, no crash reporting, no trackers, no ads.**
- Outbound network traffic is limited to: (a) the optional email poller ↔ *your*
  mail server, and (b) the adapters → `127.0.0.1` (the local bridge) — both on
  your own infrastructure; plus (c) the in-app updater → GitHub's release API,
  **only when you tap "Check for updates"**, to compare your installed version
  against the latest release. It sends no personal or financial data — a standard
  version lookup (GitHub sees your IP, as with any web request). It runs as a
  native call, so the web layer's `connect-src 'self'` CSP stays untouched and the
  WebView itself still makes zero third-party calls.

## GDPR data-subject rights

Even though there's no third-party processing to govern, the rights are honored
in-app:

- **Access & portability (Art. 15 & 20)** — **Export** dumps every object store
  to a JSON file *and* a transactions CSV, via a normal browser download.
- **Erasure / "right to be forgotten" (Art. 17)** — **Erase all** calls
  `indexedDB.deleteDatabase()`, wiping everything including the immutable raw-message
  log. Per-record delete is also available in the feed. There is no backup we hold.
- **Rectification (Art. 16)** — re-categorize or delete any transaction; add/fix
  parser rules.
- **Data minimization** — only what's needed to show your spending is stored;
  full PANs and credentials are never persisted by the app.

## App lock, notifications, and the native app

- **App lock is an access gate, not at-rest encryption.** It hides the UI behind
  a PIN (PBKDF2 hash, constant-time check, escalating lockout after 5 wrong tries)
  and biometric on Android. IndexedDB itself isn't encrypted, so someone with
  OS/forensic access to the browser profile could still read it — the lock raises
  the bar against a found/borrowed unlocked phone, nothing more. The raw PIN is
  never stored or logged. Recovery is local-only: restore from an Export, or erase.
  Caveat: a short numeric PIN is weak against an attacker who can *extract* the
  hash (from the browser's IndexedDB or an Export file) and brute-force it offline,
  where the in-app lockout no longer applies — another reason it gates casual
  access only. Prefer a longer PIN; if you need true at-rest protection, that
  would require encrypting the stored data with a key derived from the PIN.
- **Notifications** are fired locally (browser Notifications / Android
  LocalNotifications) — no push server, no egress. They can show amounts on a lock
  screen; keep that in mind, or leave alerts off.
- **Native Android capture** stays on-device: the SMS receiver and the
  notification listener (restricted to an allow-list of *your* mail/bank apps)
  feed text straight into the local parser. Nothing is uploaded. Distribution is
  a self-signed sideloaded APK — see [android-native/README.md](../android-native/README.md).
- Erase-all wipes the `settings` store too, so erasing also clears the lock and
  all preferences — no orphaned lock can brick a fresh start.

## Credentials policy

- **No credentials or API keys are hardcoded** anywhere in the repository or the PWA.
- The optional email adapter reads IMAP credentials **only** from environment
  variables / a local `.env` you create from the committed `.env.example`. The
  real `.env` is gitignored, never committed, never stored in IndexedDB, and
  never sent anywhere except your mail server.
- Use a provider **app password**, not your primary password.

## Trust & security caveats

- SMS sender IDs and email display names are **spoofable**; SpendLens treats
  them as hints only and requires a recognized bank-message format plus a
  plausible amount and account tail before recording anything.
- Run the optional bridge/poller on a **trusted network**; it binds to localhost
  and is gated by an `INGEST_TOKEN` you set.
- Because data is local-only, **you are responsible for device backups**. Use
  Export before wiping a device or browser profile.
