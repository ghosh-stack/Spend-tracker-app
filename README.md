<h1 align="center">SpendLens</h1>

<p align="center"><em>Your bank's UPI & card alerts, turned into a live, categorized spending dashboard — entirely on your device.</em></p>

<p align="center">
  <img alt="local-first" src="https://img.shields.io/badge/data-100%25%20local-34d6a0?style=flat-square">
  <img alt="zero deps" src="https://img.shields.io/badge/PWA%20deps-0-34d6a0?style=flat-square">
  <img alt="platforms" src="https://img.shields.io/badge/runs%20on-Windows%20·%20macOS%20·%20Linux%20·%20Android-5ea2ff?style=flat-square">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-111111?style=flat-square">
</p>

SpendLens reads bank notifications (Indian UPI + credit/debit-card SMS and email),
extracts amount · merchant · date · account, auto-categorizes each transaction,
and shows it on a sleek real-time dashboard. It is a **local-first PWA**: one web
codebase that installs on every desktop OS and Android, stores everything in your
browser's IndexedDB, and **never sends your financial data anywhere**.

> Built the [ponytail](#design-philosophy) way: the browser already runs
> everywhere, so the "cross-platform app" is a PWA with zero runtime
> dependencies — not an Electron/Flutter stack. We cut the whole server tier
> (it's also the strongest privacy posture). What we never cut: money precision,
> input validation, and accessibility.

## What's honest about this build

A few requirements collide with platform reality; here's exactly how each is handled:

| Requirement | Reality | What SpendLens does |
|---|---|---|
| Auto-track **SMS** | No web API can read SMS; `RECEIVE_SMS` is Play-Store-restricted | The **native Android app** ([android-native/](android-native/)) reads incoming bank SMS on-device via a `BroadcastReceiver`. Sideloaded (Play won't allow the permission). |
| Auto-track **email** | A browser can't read your inbox | The native app's **notification listener** captures bank **email + bank-app push** on-device (Gmail/Outlook/PhonePe/…). Optional Node **IMAP poller** for full email bodies. |
| Same spend on **SMS *and* email** | Double-counting | **Cross-channel dedupe/merge** — collapses them into one transaction, keeping both source channels. |
| Android-first | — | **Installable PWA** today (Add to Home screen) + the **Capacitor APK** for hands-off auto-capture (built by CI). |
| Real bank streams | The provided inputs were placeholders (no live creds) | Runs now on a **44-message sample corpus**; real alerts flow in via the native app. |

Nothing is faked: the parser, categorizer, cross-channel dedupe, recurring
detection, storage, and dashboard are real and verified. The native APK is
complete source + a CI build (the sandbox can't compile/sign). The parts that
need *your* device permissions are clearly marked and wired to plug in.

## Quick start (60 seconds, no install)

You need either **Python 3** *or* **Node 18+** to serve the files (a service
worker needs `http://`, not `file://`).

```bash
# Option 1 — Python (just the app)
python -m http.server 8765 --directory app
# open http://127.0.0.1:8765  → click "Load demo data"

# Option 2 — Node (app + live ingestion bridge for the adapters)
node tools/serve.js
# open http://127.0.0.1:8787  → click "Load demo data"
```

Then **install it**: in Chrome/Edge click the address-bar *Install* icon
(desktop), or *Add to Home screen* on Android. It now runs offline in its own window.

## Features

- **Parser engine** — 25 real bank formats (HDFC, SBI, ICICI, Axis, Kotak, PNB,
  BoB, Yes, IDFC, Paytm, GPay, PhonePe, SBI Card) + a gated generic fallback for
  unknown banks. Handles ₹/Rs./INR, lakh comma grouping, the date-format zoo, and
  debit-vs-credit disambiguation. Rules are data — [add a bank](app/js/rules.js) by adding a row.
- **Cross-channel dedupe & merge** — the same spend arriving via SMS *and* email
  collapses into one transaction (exact reference, or amount+account+window), and
  the richer source fills the gaps.
- **Auto-learn categorization** — 14 categories, ~70 India-tuned merchant rules;
  recategorizing a merchant once sticks for all its past & future transactions.
- **Recurring detection** — auto-spots subscriptions / SIPs / rent / EMIs, predicts
  the next charge, and totals your monthly commitment.
- **Insights & budgets** — month-over-month, projected month-end, savings rate,
  top merchants, and per-category monthly budgets with progress bars.
- **Live dashboard** — KPI cards, SVG category donut, spend-over-time chart, live
  feed with search + per-txn notes and exclude-from-spend. Dark/light, responsive, WCAG-AA.
- **Native Android** — Capacitor app that auto-captures SMS + email/push on-device.
- **App lock + alerts** — PIN/biometric lock; local notifications for large spends
  and budget limits.
- **Privacy** — 100% local, no telemetry, one-click **export** (JSON+CSV) and
  **erase** (GDPR Art. 17 & 20). No hardcoded secrets; the PIN is never stored, only its hash.

## Project layout

```
app/                     The PWA — open this in a browser. Zero dependencies.
  index.html  manifest.webmanifest  sw.js
  css/styles.css         "Ledger" design system (dark + light)
  js/
    money.js   parser.js   rules.js          ← pure engine (tested)
    db.js      ingest.js   queries.js         ← storage · dedupe/merge · insights/recurring
    charts.js  ui.js       app.js             ← view + glue
    lock.js    notify.js   native-capture.js  ← app lock · alerts · Capacitor glue
  data/sample-notifications.json
android-native/          Capacitor Android app — on-device SMS + email/push capture
tools/serve.js / serve.py  Local dev server (Node / Python); serve.js also bridges adapters
adapters/                Optional email-IMAP poller + android-sms (no-code) forwarder
tests/parser.test.js     Runnable check:  node --test tests/
docs/                    ARCHITECTURE · SETUP · USAGE · STYLE_GUIDE · PRIVACY
.env.example             Adapter credential template (never commit .env)
.github/workflows/android-apk.yml   CI that builds the sideloadable APK
```

## Documentation

- [**ARCHITECTURE.md**](docs/ARCHITECTURE.md) — how it's built, the data model, the parser pipeline, design decisions.
- [**SETUP.md**](docs/SETUP.md) — run, install, and the optional desktop (Tauri) / Android (Capacitor) builds.
- [**USAGE.md**](docs/USAGE.md) — day-to-day use, ingestion options, adding bank rules.
- [**STYLE_GUIDE.md**](docs/STYLE_GUIDE.md) — the visual system (tokens, type, components).
- [**PRIVACY.md**](docs/PRIVACY.md) — the GDPR posture and exactly what data lives where.
- [**android-native/README.md**](android-native/README.md) — build & sideload the auto-capture Android app.

## Design philosophy

The orientation material for this project ([ponytail](https://github.com/DietrichGebert/ponytail))
is a build discipline: *write only what the task needs; prefer native platform
features and the standard library over dependencies; never over-engineer — but
never cut validation, security, or accessibility.* Every architecture decision
in [ARCHITECTURE.md](docs/ARCHITECTURE.md) names the rung that justified it.

## Tests

```bash
node --test tests/        # parser/money correctness on the real bank formats
```
(The same assertions were verified in-browser against the live modules.)

## License

[MIT](LICENSE).
