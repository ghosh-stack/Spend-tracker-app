# Architecture

SpendLens is a **local-first Progressive Web App**: one web codebase (vanilla
ES modules, HTML, CSS, IndexedDB) that installs and runs on Windows, macOS,
Linux and Android, with no backend and no build step.

## The stack, rung by rung

The [ponytail](https://github.com/DietrichGebert/ponytail) ladder ("native
platform → stdlib → minimal dep") drove every choice:

| Decision | Rung | Why |
|---|---|---|
| **No backend at all** — no server, auth, or cloud DB | 1 (YAGNI) | A single-user tracker doesn't need a server tier. Deleting it is the biggest cut *and* the strongest privacy posture. |
| **One PWA for all 4 platforms** | 4 (native) | The browser already runs everywhere; manifest + service worker make it installable. No Electron/Flutter. |
| **IndexedDB directly** — no SQLite/Dexie/ORM | 3 (stdlib) | It's the platform's standard structured store. |
| **Dedupe via a UNIQUE index**, not a scan loop | 4 (native) | The DB engine rejects duplicates for free. |
| **`crypto.subtle` for hashing, `crypto.randomUUID` for ids** | 4 (native) | Web Crypto, no hashing library. |
| **Parser/categorizer rules are data rows**, not code | 1 + 2 | Adding a bank is adding a row; one engine serves both parse and categorize. |
| **Money as integer paise; raw messages kept immutable** | never-lazy | Floats corrupt currency math; the verbatim log lets a rule fix re-derive data. |
| **`Intl.NumberFormat('en-IN')`, `<input type=date>`, native SVG charts** | 4 (native) | No chart/format libraries. |
| **Email poller may use `imapflow` + `mailparser`** | 5 (justified dep) | Hand-rolling an IMAP/TLS+MIME client is *more* code and bug surface — the one place a dependency is "the minimum that works". |
| **Tauri / Capacitor wrappers** | 5 (optional) | Only for signed binaries / Android SMS; the core never depends on them. |

The PWA in `app/` has **zero runtime dependencies**. The only Node in the whole
system is the optional email adapter and the dev/bridge server (stdlib only).

## Data flow

```
┌─ ingestion ───────────────┐     ┌─ engine (pure) ─┐     ┌─ storage ──────┐     ┌─ view ─────┐
│ paste / import            │     │ normalize       │     │ raw_messages   │     │ KPI cards  │
│ email-imap  ─┐            │     │ match rule      │ ──▶ │ transactions   │ ──▶ │ money-flow │
│ android-sms ─┴▶ /ingest ──┼──▶  │ extract fields  │     │ accounts       │     │ live feed  │
│ (bridge queue)            │     │ categorize      │     │ rules          │     │ (pub/sub)  │
└───────────────────────────┘     │ dedupe key      │     └────────────────┘     └────────────┘
                                   └─────────────────┘
```

`parser.js` is a **pure function** (`parseMessage(msg, rules) → {status, txn}`)
with no DB or DOM coupling — that's why it runs under `node --test`. `ingest.js`
is the side-effecting glue (hashing, account resolution, atomic store, pub/sub).
The view (`ui.js`) subscribes to ingest events and repaints, so new
transactions appear live.

## IndexedDB schema (`app/js/db.js`)

| Store | Key | Indexes | Purpose |
|---|---|---|---|
| `transactions` | `id` (uuid) | `by_ts`, `by_account`, `by_category`, **`by_dedupeKey` (unique)**, `by_account_ts` | The derived spend records. Amounts are integer paise. |
| `accounts` | `id` (`bankKey:last4`) | `by_bankKey` | Display only — never stores a full card number, just `last4`. |
| `rules` | `id` | `by_kind_priority`, `by_bankKey` | **User-added** parse/categorize rules, merged over the built-ins from `rules.js`. |
| `raw_messages` | `id` (uuid) | **`by_contentHash` (unique)**, `by_status`, `by_source_receivedAt` | Immutable audit log of every ingested message. Never mutated except its `status`. |

## Parser pipeline (`app/js/parser.js`, `app/js/ingest.js`)

1. **Intake** — compute `SHA-256(source|sender|body)`; `add` to `raw_messages`.
   The unique `by_contentHash` index rejects an exact re-send → idempotent for free.
2. **Normalize** — `NFKC`, collapse whitespace, uppercase sender.
3. **Match** — try `parse` rules in priority order (specific banks first, gated
   generic last). Rules carry a regex with **named capture groups**. No match →
   stored `status='unparsed'` and surfaced in *Needs review*.
4. **Extract** — read `match.groups`; coerce amount → integer paise (strip lakh
   commas, never float); direction from the rule or the first directional verb;
   timestamp from the message's own date (day-first) else `receivedAt`; account
   tail → last 4 digits.
5. **Categorize** — `categorize` rules in order (first hit wins), else `uncategorized`.
   A user override sets `categorySource='manual'` and is never re-touched.
6. **Dedupe** — `dedupeKey = account|amount|direction|ref` (or a 1-minute bucket
   when no ref). The unique `by_dedupeKey` index is the gate, so the *same* spend
   arriving via both SMS and email collapses to one transaction.
7. **Store** — write the transaction, flip the source message to `parsed`, notify
   the dashboard.

Two dedupe levels exist on purpose: **content hash** stops the identical message
twice; **dedupe key** stops the same *transaction* across different channels.

## Ingestion adapters (`adapters/`)

| Adapter | Platform | Permission / creds | Honest limit |
|---|---|---|---|
| **manual paste / add** | all | none | per-message effort; the only path a plain browser PWA can do |
| **import (CSV/JSON)** | all | none (user picks file) | column layout varies per bank |
| **email-imap** (`poller.js`) | desktop / any Node box | IMAP app-password or OAuth, from **env only** | polls (not push); needs a running process |
| **android-sms** | Android only | `RECEIVE_SMS` (Play-restricted) | needs sideload or an automation app; no desktop/PWA equivalent |

All adapters POST the same JSON to `/ingest`, so the app has one ingest path.
The bridge (`tools/serve.js`) buffers POSTs on a localhost-only, token-gated
queue that the open app drains.

## Packaging

- **Core (all platforms, no binaries):** the PWA. Install from Chrome/Edge
  ("Install") on desktop, "Add to Home screen" on Android. Offline via the
  service worker.
- **Optional desktop binary:** [Tauri](https://tauri.app) wraps the same web
  build in the OS WebView (and can run the email poller as a sidecar).
- **Optional Android SMS capture:** [Capacitor](https://capacitorjs.com) wraps
  the web build and exposes an SMS `BroadcastReceiver`.

See [SETUP.md](SETUP.md) for build commands. Signed/distributable binaries
require your own code-signing certs and are out of scope for this source drop.

## Security notes

- SMS sender IDs and email display-names are **spoofable** — treated as hints,
  never proof. A message must match a known format *and* carry a plausible
  amount + account tail before it's recorded (the generic fallback is gated on a
  masked account/card tail to reject marketing texts).
- No secrets in the repo or the PWA. Adapter credentials live only in a gitignored
  `.env` / environment, never in IndexedDB, never transmitted off-device.

## v2 additions

- **DB v3** — added object stores `budgets` and `settings`, and `by_amount` /
  `by_channels` indexes on `transactions`. The `onupgradeneeded` handler is
  idempotent: it creates missing stores *and* adds missing indexes to existing
  stores, so a phone on v1 upgrades cleanly without data loss.
- **Cross-channel dedupe & merge** (`ingest.js`) — a freshly parsed transaction is
  matched against same-amount candidates: Tier 1 = identical bank reference (any
  time gap); Tier 2 = amount+account-tail+direction within ±3h on a *different*
  channel with agreeing merchant. A match merges (keeping `sources[]`/`channels[]`,
  letting the richer source fill gaps, recomputing the dedupe key); a same-amount
  conflicting pair is stored but flagged `possibleDuplicateOf`. The unique
  `by_dedupeKey` index remains the exact-duplicate backstop. Ingestion is serial,
  so this is a read-decide-write (no fragile multi-store transaction).
- **Recurring & insights** (`queries.js`) — `detectRecurring()` and `insights()`
  are pure, derived on demand (no stored table to invalidate). Recurring groups by
  a canonicalized merchant + account, gates on cadence band + low gap dispersion +
  amount stability + category prior, and scores a confidence.
- **App lock** (`lock.js`) — PBKDF2-SHA256 PIN gate (WebCrypto), constant-time
  compare, escalating lockout; gates render before any data paints and re-locks on
  background. Biometric is feature-detected (Capacitor only).
- **Notifications** (`notify.js`) — one facade over the web Notifications API and
  Capacitor LocalNotifications; large-transaction and budget triggers, no push server.
- **Native Android** ([android-native/](../android-native/)) — Capacitor wrapper
  with an SMS `BroadcastReceiver` and a `NotificationListenerService` (email +
  bank-app push) that forward into the WebView via the `spendlens-sms` event.
  Captured text is injected as a JSON *string literal* (`JSONObject.quote`), never
  as code. Built by CI; sideload-only by Play policy.

## v0.3 additions ("Aurora")

- **Visualization suite** (`charts.js`) — the dashboard centers on a money-flow
  **Sankey** (income → spent/saved → categories), with a category **treemap**
  (toggle donut), a daily **calendar heatmap**, and a cumulative **spending-pace**
  line. All are pure functions returning SVG strings (no chart library); category
  colour is one identity token from `rules.js`.
- **PDF report** (`report.js`) — builds a standalone print-optimized HTML document
  on-device and prints it to PDF: Android `PrintManager` in the APK, a hidden
  iframe + `window.print()` in the browser. No PDF library.
- **Inline-SVG icon set** (`icons.js`) — all app chrome; emoji stay for categories.
- **Scan past SMS** — `SpendLensCapturePlugin.scanSms()` reads existing inbox texts
  (`READ_SMS`, last 12 months / newest 2000), returns the bank-shaped ones (plus
  `scanned`/`matched`/`truncated` metadata) for the same on-device parser.
- **In-app updater** (`update.js` + `version.js`) — version-only GitHub-Releases
  lookup (native HTTP so the WebView keeps `connect-src 'self'`); `APP_VERSION` is
  CI-stamped from the release tag. The service worker's cache name is derived from
  `APP_VERSION` (registered as `sw.js?v=<version>`) so each release self-invalidates.
