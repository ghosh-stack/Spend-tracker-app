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

## Fixing categories

- Hover any feed row → 🏷 to **re-categorize**. Manual choices stick and are
  never overwritten by rules.
- Messages that don't match a bank format land in **Needs review** — add them by
  hand, or teach the parser a new format (below).

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
