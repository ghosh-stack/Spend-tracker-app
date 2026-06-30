# Usage

## First run

Open the app. On a brand-new install you get a focused setup panel — pick
**Load demo data** (ingests 44 sample bank notifications so you can see the
dashboard populated), **Paste a bank alert**, **Add manually**, or (in the
Android app) **Scan past SMS**. Click **Erase all** any time to clear everything
and start with your own data.

## The dashboard

- **Filters** — segmented date range (Week / Month / Quarter / Year / All) plus
  category and account dropdowns. *Reset* appears when a filter is active. On
  phones the filter row scrolls sideways on its own.
- **KPI hero + strip** — a large **Spent** figure, then Income, Top category and
  Net flow. Deltas compare to the previous equivalent period (spend ▲ is red,
  income ▲ is green).
- **Money flow (Sankey)** — the hero chart: income → spent/saved → categories,
  with a compact spent / saved / savings-rate header above it. Tap a category
  ribbon or node to filter the feed to it.
- **Breakdown** — a **treemap** of categories by default; toggle to a **donut**.
  A category's color is the same everywhere (tile, slice, ribbon, legend, pill).
- **Spending calendar** — a heatmap of daily spend this month (darker = more;
  today is ringed). Hover/tap a day for its total.
- **Spending pace** — your cumulative month-to-date spend against last month's
  pace and a projected month-end (on the Month range; other ranges show bars).
- **Activity feed** — every transaction with its category, account, method and
  time. New ones slide in live. Income shows green with a `+`. **Swipe** a row:
  right to recategorize, left to delete (with **Undo**).
- **Views** (sidebar / bottom nav): **Dashboard**, **Transactions** (full list),
  **Recurring**, **Insights**, **Needs review** (messages that didn't parse). On
  phones, Insights / Needs review / Capture status / Export live in the **More** sheet.

## Getting transactions in

1. **Paste a bank alert** — *Paste alert* button → paste the exact SMS/email
   text → *Parse*. Parsed locally; nothing is sent anywhere.
2. **Add manually** — *+ Add expense* for cash or corrections (amount, type,
   merchant, category, date).
3. **Import a file** — *Import file* accepts a previous SpendLens **JSON export**
   (restores everything) or a **CSV / .txt** with one bank message per line.
4. **Android app (automatic)** — the [native APK](../android-native/README.md)
   captures incoming bank **SMS** and **email/bank-app push** on-device, with no
   bridge or login. Check **More → Capture status** to grant/diagnose permissions,
   and use **Scan past SMS** there to backfill bank texts already on the phone
   (last 12 months, newest 2000 messages; on-device, only money texts are read).
5. **Email (automatic, desktop)** — optionally run the
   [IMAP poller](../adapters/email-imap/README.md) for full email bodies.

The top-bar status pill reflects how data is arriving:

- **Android app** — *Capture on* (a permission is granted), *Capture blocked*
  (Android is blocking a sideloaded permission — fix it in Capture status), or
  *Check capture*.
- **Web/PWA** — *Live* when the optional Node bridge (`node tools/serve.js`) is
  reachable and pulling forwarded messages, otherwise *Manual* (paste/import). The
  bridge is never required — manual paste and import always work.

## Editing a transaction

Hover any feed row → ✎ to open **Edit**:
- **Re-categorize** — and it *learns*: the merchant's other transactions
  (past & future) get the same category automatically. Manual choices are never
  overwritten by rules.
- **Note** — add free text (searchable).
- **Exclude from spending totals** — for reimbursable/non-personal spends; the
  transaction stays visible but drops out of every total and chart.

Messages that don't match a bank format land in **Needs review** — add them by
hand, or teach the parser a new format (below).

## Recurring, Insights & budgets

- **Recurring** (nav) auto-detects subscriptions, SIPs, rent and EMIs once there
  are a few months of history. It shows your **monthly commitment total**, an
  **upcoming-30-days** list, and each series with its cadence and next charge.
- **Insights** (nav / More) shows this month vs last, **projected month-end**
  spend, savings rate, biggest spend, and top merchants.
- **Budgets** live in Insights: type a monthly amount on any category to track a
  progress bar (turns red when over). With alerts on, you're notified at 80% and 100%.

## Search & cross-channel

- In **Transactions**, the search box filters by merchant, amount or note.
- A spend that arrives as **both an SMS and an email** is merged into one row,
  tagged 🔗 `email+sms`. A same-amount pair we're unsure about is flagged
  *possible dup* rather than merged — you decide.

## App lock & alerts (More → Privacy & alerts)

- **App lock** — set a PIN (biometric too, in the Android app). The app locks on
  every return to background and never shows data before you unlock. It's an
  access gate, not encryption; recovery is via your Export backup.
- **Alerts** — turn on local notifications for large transactions (set the
  threshold) and budget limits.

## Adding a bank or merchant rule

Rules are plain data in [`app/js/rules.js`](../app/js/rules.js):

```js
// A new parse rule (named groups the engine reads: amount, merchant, datetime, acct, ref)
{ id: 'mybank-upi-debit', bankKey: 'mybank', priority: 10, direction: 'debit', method: 'upi',
  pattern: `Paid ${'${A}'} to (?<merchant>.+?) from MyBank a/c X(?<acct>\\d{3,4}) ref (?<ref>\\d+)` }

// A new merchant → category rule (first match wins; put specific before general)
{ match: 'mymerchant', categoryId: 'shopping' }
```

Use **Needs review** to copy the exact text you need to match, write the rule,
reload, and re-paste (or re-import). Per-user rules can also be stored in the
`rules` IndexedDB store and are merged over the built-ins automatically.

## Export a PDF report

**More → Export PDF report** → pick a period (presets or a custom date range) →
*Generate PDF*. SpendLens builds a polished report **on-device** (KPIs, money-flow
Sankey, by-category, top merchants, recurring, transactions) and opens the system
print dialog — choose **Save as PDF**. There's no PDF library and nothing leaves
the device. A reversed custom range (From after To) is rejected up front.

## Keeping the Android app updated

Sideloaded APKs don't auto-update. **More → Check for updates** asks the GitHub
Releases API for the latest version and, if newer, flips to a **Download** button
that opens the new APK — install it over the top and **your data is kept**. It's a
version-only lookup; no personal data is sent. See
[android-native/README.md](../android-native/README.md).

## Your data

- **Export** (sidebar / More) downloads a full **JSON** backup *and* a **CSV** of
  transactions.
- **Erase all** deletes the entire local database (irreversible — there is no
  cloud copy).
- Theme toggle (◐) switches dark/light and is remembered.
