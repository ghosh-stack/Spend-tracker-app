# Usage

## First run

Open the app and click **Load demo data** (in the sidebar, or the empty-state
button). It ingests 36 sample bank notifications so you can see the dashboard
populated. Click **Erase all** any time to clear everything and start with your
own data.

## The dashboard

- **Filters** — segmented date range (Week / Month / Quarter / Year / All) plus
  category and account dropdowns. *Reset* appears when a filter is active.
- **KPI cards** — Spent, Income, Top category, Net flow. Deltas compare to the
  previous equivalent period (spend ▲ is red, income ▲ is green).
- **Category donut** — composition of the period; hover a slice to isolate it.
  A category's color is the same everywhere (slice, legend, pill, icon tile).
- **Spending over time** — daily/weekly/monthly bars; the most recent bar is
  highlighted. Hover any bar for its total.
- **Activity feed** — every transaction with its category, account, method and
  time. New ones slide in live. Income shows green with a `+`.
- **Views** (sidebar / bottom nav): **Dashboard**, **Transactions** (full list),
  **Needs review** (messages that didn't parse).

## Getting transactions in

1. **Paste a bank alert** — *Paste alert* button → paste the exact SMS/email
   text → *Parse*. Parsed locally; nothing is sent anywhere.
2. **Add manually** — *+ Add expense* for cash or corrections (amount, type,
   merchant, category, date).
3. **Import a file** — *Import file* accepts a previous SpendLens **JSON export**
   (restores everything) or a **CSV / .txt** with one bank message per line.
4. **Email (automatic)** — run the [IMAP poller](../adapters/email-imap/README.md).
5. **Android SMS (automatic)** — set up the [SMS forwarder](../adapters/android-sms/README.md).

When the Node bridge (`node tools/serve.js`) is running and reachable, the top
bar shows a green **Live** pill and the app pulls forwarded messages every few
seconds. Otherwise it shows **Offline** and works fully in manual/import mode.

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

## Your data

- **Export** (sidebar) downloads a full **JSON** backup *and* a **CSV** of
  transactions.
- **Erase all** deletes the entire local database (irreversible — there is no
  cloud copy).
- Theme toggle (◐) switches dark/light and is remembered.
