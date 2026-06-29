# Email (IMAP) ingestion adapter

Forwards bank **email** alerts into SpendLens. This is the most reliable
automated path on desktop (bank emails are richer and less spoof-prone than
SMS, and desktops have no SMS radio at all).

## How it works

```
your mailbox  ──IMAP+TLS (read-only)──▶  poller.js  ──POST /ingest──▶  SpendLens (browser)
```

`poller.js` logs in to your mailbox, reads recent messages from the bank
senders you allow-list, and POSTs each one's text to the app's local ingest
endpoint (served by `node tools/serve.js`). The app parses, categorizes and
**dedupes** them — so the poller can run as often as you like and re-reading
the same email does nothing.

## Setup

1. **Run the app with the bridge server** (from the repo root):
   ```bash
   node tools/serve.js          # serves the PWA + the /ingest endpoint on :8787
   ```
   Open http://127.0.0.1:8787 and keep the tab open (it drains the queue).

2. **Configure credentials** — copy `.env.example` (repo root) to `.env` and fill in:
   ```ini
   IMAP_HOST=imap.gmail.com
   IMAP_PORT=993
   IMAP_USER=you@example.com
   IMAP_APP_PASSWORD=...          # an APP PASSWORD, never your login password
   IMAP_ALLOWED_SENDERS=alerts@hdfcbank.net,no-reply@icicibank.com
   INGEST_TOKEN=...               # optional; must match the server's token
   ```
   - **Gmail:** enable 2-Step Verification, then create an App Password at
     https://myaccount.google.com/apppasswords. (Plain-password IMAP is disabled.)
   - **Outlook / others:** use the provider's app-specific password.
   - Credentials are read **only** from `.env` / environment variables. Nothing
     is hardcoded; the real `.env` is gitignored and never leaves your machine.

3. **Install deps and run:**
   ```bash
   cd adapters/email-imap
   npm install
   npm start
   ```

## Honest limitations

- **Polling, not push.** It checks every `IMAP_POLL_SECONDS` (default 120s).
  Add IMAP IDLE later if you want instant. <!-- ponytail: poll interval vs freshness; upgrade = IMAP IDLE -->
- **Read-only.** It never deletes, moves or marks your mail.
- **Gmail/Outlook need an app password** (or OAuth, not implemented here) — that
  one-time setup friction is unavoidable and intentional; we don't ask for your
  primary password.
- Sender allow-listing is a convenience filter, **not** a trust check — email
  display names are spoofable. The app still requires the body to match a known
  bank format before recording anything.
