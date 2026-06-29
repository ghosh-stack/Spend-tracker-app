# Privacy & GDPR

SpendLens is built so that compliance is the *default*, not a feature bolted on.
The strongest privacy guarantee comes from the architecture: **there is no
server**, so there is nowhere for your financial data to go.

## What data exists, and where

| Data | Where it lives | Leaves your device? |
|---|---|---|
| Transactions, accounts, rules, raw messages | **IndexedDB**, in your browser, on your device | **Never.** |
| Theme preference | `localStorage` (a UI flag, not financial data) | Never. |
| Bank credentials | Only if you use the email adapter: a gitignored `.env` / environment variables on your machine | Only to **your own** mail server, over IMAP+TLS. |
| Card numbers | Not stored. Accounts keep a display `last4` only. | N/A |

## No transmission, no telemetry

- The PWA makes **zero outbound network calls**. The service worker only serves
  the local cache; it contacts no third party.
- **No analytics, no crash reporting, no trackers, no ads.**
- The only network traffic in the entire system is optional and stays on your
  own infrastructure: (a) the email poller ↔ *your* mail server, and (b) the
  adapters → `127.0.0.1` (the local bridge).

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
