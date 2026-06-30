// Built-in rules as DATA. Adding a bank = add a PARSE_RULES entry; adding a
// merchant = add a CATEGORIZE_RULES entry. No engine change needed (the parser
// is generic). User-added/overridden rules live in IndexedDB and are merged on
// top of these at runtime, so this file stays the shipped baseline.
//
// Parse patterns use NAMED capture groups the parser reads directly:
//   (?<amount>) (?<merchant>) (?<datetime>) (?<acct>) (?<ref>)
// Sources & format notes: see docs/ARCHITECTURE.md. SMS sender IDs are
// spoofable, so senderPattern is only ever a weak hint, never proof.
import { CUR, NUM } from './money.js';

export const CATEGORIES = [
  { id: 'food', label: 'Food & Dining', icon: '🍽️', color: '#FF6B57', kind: 'expense' },
  { id: 'groceries', label: 'Groceries', icon: '🛒', color: '#4CAF7D', kind: 'expense' },
  { id: 'transport', label: 'Transport', icon: '🚗', color: '#3B9EFF', kind: 'expense' },
  { id: 'shopping', label: 'Shopping', icon: '🛍️', color: '#E879F9', kind: 'expense' },
  { id: 'bills', label: 'Bills & Utilities', icon: '💡', color: '#FFB02E', kind: 'expense' },
  { id: 'entertainment', label: 'Entertainment', icon: '🎬', color: '#A78BFA', kind: 'expense' },
  { id: 'health', label: 'Health', icon: '🩺', color: '#FF5C8A', kind: 'expense' },
  { id: 'travel', label: 'Travel', icon: '✈️', color: '#22C5C5', kind: 'expense' },
  { id: 'housing', label: 'Rent & Housing', icon: '🏠', color: '#C98A5E', kind: 'expense' },
  { id: 'investments', label: 'Investments', icon: '📈', color: '#34D399', kind: 'transfer' },
  { id: 'transfers', label: 'Transfers', icon: '🔁', color: '#94A3B8', kind: 'transfer' },
  { id: 'remittance', label: 'Remittance', icon: '💸', color: '#6366F1', kind: 'transfer' },
  { id: 'cash', label: 'Cash/ATM', icon: '🏧', color: '#6B7280', kind: 'expense' },
  { id: 'income', label: 'Income', icon: '💰', color: '#22C55E', kind: 'income' },
  { id: 'other', label: 'Other', icon: '📦', color: '#8B96A5', kind: 'expense' },
  { id: 'uncategorized', label: 'Uncategorized', icon: '❔', color: '#64748B', kind: 'expense' },
];

// Reusable amount fragment (built from the shared grammar in money.js).
const A = `${CUR}\\s*(?<amount>${NUM})`;

export const PARSE_RULES = [
  // ── HDFC ──────────────────────────────────────────────────────────────────
  { id: 'hdfc-upi-debit', bankKey: 'hdfc', priority: 10, channel: 'sms', direction: 'debit', method: 'upi',
    pattern: `Sent\\s+${A}\\s+From\\s+HDFC Bank A\\/C\\s+x*(?<acct>\\d{3,4})\\s+To\\s+(?<merchant>.+?)\\s+On\\s+(?<datetime>\\d{2}-\\d{2}-\\d{2,4})\\s+Ref\\s+(?<ref>\\d{9,16})` },
  { id: 'hdfc-upi-credit', bankKey: 'hdfc', priority: 10, channel: 'sms', direction: 'credit', method: 'upi',
    pattern: `Received\\s+${A}\\s+in your HDFC Bank A\\/C\\s+x*(?<acct>\\d{3,4})\\s+from\\s+(?<merchant>\\S+@\\S+)\\s+on\\s+(?<datetime>\\d{2}-\\d{2}-\\d{2,4})\\s+Ref\\s+(?<ref>\\d{9,16})` },
  { id: 'hdfc-card-debit', bankKey: 'hdfc', priority: 10, channel: 'sms', direction: 'debit', method: 'card',
    pattern: `Spent\\s+${A}\\s+On\\s+HDFC Bank Card\\s+x*(?<acct>\\d{3,4})\\s+At\\s+(?<merchant>.+?)\\s+On\\s+(?<datetime>[\\d:-]+)` },
  { id: 'hdfc-email-upi-debit', bankKey: 'hdfc', priority: 12, channel: 'email', direction: 'debit', method: 'upi',
    pattern: `${A}\\s+has been debited from your account\\s+\\**(?<acct>\\d{3,4})\\s+to VPA\\s+(?<merchant>\\S+@\\S+)\\s+on\\s+(?<datetime>\\d{2}-\\d{2}-\\d{4}\\s+\\d{2}:\\d{2}:\\d{2})\\.\\s*Your UPI transaction reference number is\\s+(?<ref>\\d{9,16})` },

  // ── SBI ───────────────────────────────────────────────────────────────────
  { id: 'sbi-upi-debit', bankKey: 'sbi', priority: 10, channel: 'sms', direction: 'debit', method: 'upi',
    pattern: `${A}\\s+debited.*?A\\/c\\s*X*(?<acct>\\d{3,4})\\s+on\\s+(?<datetime>\\d{1,2}[A-Za-z]{3}\\d{2,4})\\s+RefNo\\s+(?<ref>\\d{9,16})` },
  { id: 'sbi-upi-credit', bankKey: 'sbi', priority: 10, channel: 'sms', direction: 'credit', method: 'upi',
    pattern: `A\\/C\\s*X*(?<acct>\\d{3,4})\\s+credited by\\s+${A}\\s+on\\s+(?<datetime>\\d{1,2}[A-Za-z]{3}\\d{2,4})\\s+trf from\\s+(?<merchant>.+?)\\s+Ref No\\s+(?<ref>\\d{9,16})` },
  { id: 'sbi-acct-debit', bankKey: 'sbi', priority: 14, channel: 'sms', direction: 'debit', method: 'netbanking',
    pattern: `a\\/c no\\.?\\s*X*(?<acct>\\d{3,4})\\s+is debited for\\s+${A}\\s+on\\s+(?<datetime>\\d{2}-\\d{2}-\\d{2,4}).*?Ref no\\s+(?<ref>\\d{9,16})` },
  { id: 'sbi-acct-credit', bankKey: 'sbi', priority: 14, channel: 'sms', direction: 'credit', method: 'netbanking',
    // SBI masks this as XXXXX987788 (5 X's + 6 visible digits) — consume the
    // X's AND any leading digits, capturing only the last 4 for the account tail.
    pattern: `A\\/C\\s*[X\\d]*(?<acct>\\d{3,4})\\s+Credited\\s+${A}\\s+on\\s+(?<datetime>\\d{2}\\/\\d{2}\\/\\d{2,4}).*?from\\s+(?<merchant>.+?)\\.\\s*Avl Bal` },

  // ── ICICI ─────────────────────────────────────────────────────────────────
  { id: 'icici-card-debit', bankKey: 'icici', priority: 10, channel: 'sms', direction: 'debit', method: 'card',
    pattern: `${A}\\s+spent on ICICI Bank Card\\s+X*(?<acct>\\d{3,4})\\s+on\\s+(?<datetime>\\d{2}-[A-Za-z]{3}-\\d{2,4})\\s+at\\s+(?<merchant>.+?)\\.\\s*Avl Lmt` },
  { id: 'icici-upi-debit', bankKey: 'icici', priority: 10, channel: 'sms', direction: 'debit', method: 'upi',
    pattern: `Acct\\s*X*(?<acct>\\d{3,4})\\s+is debited with\\s+${A}\\s+on\\s+(?<datetime>\\d{2}-[A-Za-z]{3}-\\d{2,4})\\s+and credited to\\s+(?<merchant>\\S+@\\S+)\\s*\\(UPI Ref no\\s+(?<ref>\\d{9,16})\\)` },
  { id: 'icici-card-payment', bankKey: 'icici', priority: 10, channel: 'sms', direction: 'credit', method: 'card', setCategory: 'transfers',
    pattern: `Payment of\\s+${A}\\s+has been received towards your ICICI Bank Credit Card\\s+X*(?<acct>\\d{3,4})\\s+on\\s+(?<datetime>\\d{2}-[A-Za-z]{3}-\\d{2,4})` },

  // ── Axis ──────────────────────────────────────────────────────────────────
  { id: 'axis-upi-debit', bankKey: 'axis', priority: 10, channel: 'sms', direction: 'debit', method: 'upi',
    pattern: `Debit\\s+${A}\\s+A\\/c no\\.?\\s*X*(?<acct>\\d{3,4})\\s+(?<datetime>\\d{2}-\\d{2}-\\d{2,4}\\s+\\d{2}:\\d{2}:\\d{2})\\s+UPI\\/P2[MA]\\/(?<ref>\\d{9,16})\\/(?<merchant>.+?)(?:\\s+Not you|$)` },
  { id: 'axis-upi-credit', bankKey: 'axis', priority: 10, channel: 'sms', direction: 'credit', method: 'upi',
    pattern: `Credit\\s+${A}\\s+A\\/c no\\.?\\s*X*(?<acct>\\d{3,4})\\s+(?<datetime>\\d{2}-\\d{2}-\\d{2,4}\\s+\\d{2}:\\d{2}:\\d{2})\\s+UPI\\/P2[AM]\\/(?<ref>\\d{9,16})\\/(?<merchant>.+?)\\s+Info` },
  { id: 'axis-card-debit', bankKey: 'axis', priority: 10, channel: 'sms', direction: 'debit', method: 'card',
    pattern: `Spent Card no\\.?\\s*X*(?<acct>\\d{3,4})\\s+${A}\\s+(?<datetime>\\d{2}-\\d{2}-\\d{2,4}\\s+\\d{2}:\\d{2}:\\d{2})\\s+(?<merchant>.+?)\\s+Avl Lmt` },

  // ── Kotak ─────────────────────────────────────────────────────────────────
  { id: 'kotak-upi-debit', bankKey: 'kotak', priority: 10, channel: 'sms', direction: 'debit', method: 'upi',
    pattern: `Sent\\s+${A}\\s+from Kotak Bank AC\\s+X*(?<acct>\\d{3,4})\\s+to\\s+(?<merchant>\\S+@\\S+)\\s+on\\s+(?<datetime>\\d{2}-\\d{2}-\\d{2,4})\\.?\\s*UPI Ref\\s+(?<ref>\\d{9,16})` },
  { id: 'kotak-upi-credit', bankKey: 'kotak', priority: 10, channel: 'sms', direction: 'credit', method: 'upi',
    pattern: `Received\\s+${A}\\s+in your Kotak Bank AC\\s+X*(?<acct>\\d{3,4})\\s+from\\s+(?<merchant>\\S+@\\S+)\\s+on\\s+(?<datetime>\\d{2}-\\d{2}-\\d{2,4})\\.?\\s*UPI Ref\\s+(?<ref>\\d{9,16})` },

  // ── Other banks ─────────────────────────────────────────────────────────────
  { id: 'pnb-upi-debit', bankKey: 'pnb', priority: 10, channel: 'sms', direction: 'debit', method: 'upi',
    pattern: `${A}\\s+debited from A\\/c\\s*X*(?<acct>\\d{3,4})\\s+on\\s+(?<datetime>\\d{2}-\\d{2}-\\d{2,4})\\s+to VPA\\s+(?<merchant>\\S+@\\S+)\\s+UPI:?(?<ref>\\d{9,16})` },
  { id: 'bob-upi-credit', bankKey: 'bob', priority: 10, channel: 'sms', direction: 'credit', method: 'upi',
    pattern: `${A}\\s+Credited to A\\/c\\s*X*(?<acct>\\d{3,4})\\s+thru UPI\\/(?<ref>\\d{9,16})\\s+by\\s+(?<merchant>.+?)\\.\\s*Total Bal` },
  { id: 'yes-upi-debit', bankKey: 'yes', priority: 10, channel: 'sms', direction: 'debit', method: 'upi',
    pattern: `${A}\\s+debited from your YES BANK A\\/c no\\.?\\s*X*(?<acct>\\d{3,4})\\s+on\\s+(?<datetime>\\d{2}-[A-Za-z]{3}-\\d{2,4})\\s+towards UPI-(?<merchant>\\S+?)-(?<ref>\\d{9,16})` },
  { id: 'idfc-upi-debit', bankKey: 'idfc', priority: 10, channel: 'sms', direction: 'debit', method: 'upi',
    pattern: `A\\/c\\s*X*(?<acct>\\d{3,4})\\s+is debited by\\s+${A}\\s+on\\s+(?<datetime>\\d{2}-[A-Za-z]{3}-\\d{4}\\s+\\d{2}:\\d{2})\\s+&\\s+credited to\\s+(?<merchant>\\S+@\\S+)\\s*\\(UPI Ref\\s+(?<ref>\\d{9,16})\\)` },
  { id: 'paytm-upi-debit', bankKey: 'paytm', priority: 10, channel: 'sms', direction: 'debit', method: 'upi',
    pattern: `${A}\\s+sent to\\s+(?<merchant>\\S+@\\S+)\\s+from .*?a\\/c\\s*\\d{0,2}X*(?<acct>\\d{3,4})\\.\\s*UPI Ref:?\\s*(?<ref>\\d{9,16})` },
  { id: 'paytm-upi-credit', bankKey: 'paytm', priority: 10, channel: 'sms', direction: 'credit', method: 'upi',
    pattern: `${A}\\s+received from\\s+(?<merchant>.+?)\\s+in your .*?a\\/c\\s*\\d{0,2}X*(?<acct>\\d{3,4})\\.\\s*UPI Ref:?\\s*(?<ref>\\d{9,16})` },

  // ── UPI apps (drawn on a linked bank) ───────────────────────────────────────
  { id: 'gpay-upi-debit', bankKey: 'gpay', priority: 11, channel: 'sms', direction: 'debit', method: 'upi',
    pattern: `You paid\\s+${A}\\s+to\\s+(?<merchant>.+?)\\.\\s*UPI transaction ID\\s+(?<ref>\\d{9,16}),\\s*(?<datetime>\\d{1,2}\\s+[A-Za-z]{3}\\s+\\d{4},\\s*\\d{1,2}:\\d{2}\\s*[ap]m).*?\\*{2,}(?<acct>\\d{3,4})` },
  { id: 'phonepe-upi-credit', bankKey: 'phonepe', priority: 11, channel: 'sms', direction: 'credit', method: 'upi',
    pattern: `Payment of\\s+${A}\\s+received from\\s+(?<merchant>.+?)\\s+in your account\\s+X*(?<acct>\\d{3,4})\\.\\s*Txn ID\\s+(?<ref>[A-Z0-9]{12,30})` },

  // ── Credit-card email ───────────────────────────────────────────────────────
  { id: 'sbicard-email-debit', bankKey: 'sbicard', priority: 12, channel: 'email', direction: 'debit', method: 'card',
    pattern: `SBI Card ending\\s+(?<acct>\\d{3,4})\\s+for\\s+${A}\\s+at\\s+(?<merchant>.+?)\\s+on\\s+(?<datetime>\\d{2}\\/\\d{2}\\/\\d{2,4}\\s+\\d{2}:\\d{2}:\\d{2})\\.\\s*Your available credit limit` },

  // ── Generic fallback (any bank). Gated on THREE things co-occurring: a masked
  //    account/card tail, a transaction VERB, and a currency amount. The verb
  //    requirement is what rejects marketing that cites your card last-4
  //    ("Use Card xx1234 to spend... get cashback", "Card xx8888 eligible for a
  //    loan") — those have a tail + amount but no debited/spent/credited verb.
  //    The gap class [^\dxX*] (not [\s\w.]) removes the quantifier overlap that
  //    would otherwise allow catastrophic backtracking (ReDoS). Direction inferred.
  { id: 'generic-tail+amount', bankKey: '*', priority: 90, channel: 'any', direction: null, method: 'other',
    pattern: `^(?=.*\\b(?:a\\/?c|acct|account|card)\\b[^\\dxX*]{0,40}?[xX*]{1,6}\\d{3,4})(?=.*\\b(?:debited|credited|spent|sent|paid|withdrawn|received|debit|credit)\\b)(?=.*${CUR}\\s*[\\d,]+).*?${A}` },
];

// First match wins — order matters. Specific/qualified keywords come BEFORE the
// brands they could be confused with (instamart before swiggy, jiomart/jiosaavn
// before jio, "credit card payment" before generic income/transfer words).
export const CATEGORIZE_RULES = [
  // quick-commerce groceries (must precede swiggy/zomato/jio brands)
  { match: 'instamart', categoryId: 'groceries' },
  { match: 'jiomart', categoryId: 'groceries' },
  { match: 'bigbasket', categoryId: 'groceries' },
  { match: 'blinkit', categoryId: 'groceries' },
  { match: 'zepto', categoryId: 'groceries' },
  { match: 'dmart', categoryId: 'groceries' },
  { match: 'd mart', categoryId: 'groceries' },
  { match: 'reliance fresh', categoryId: 'groceries' },
  { match: 'more retail', categoryId: 'groceries' },
  { match: 'spencer', categoryId: 'groceries' },
  // entertainment brands that share a prefix with telecom (precede 'jio'/'airtel')
  { match: 'jiosaavn', categoryId: 'entertainment' },
  { match: 'jiohotstar', categoryId: 'entertainment' },
  { match: 'hotstar', categoryId: 'entertainment' },
  { match: 'jiocinema', categoryId: 'entertainment' },
  { match: 'prime video', categoryId: 'entertainment' },
  { match: 'youtube premium', categoryId: 'entertainment' },
  { match: 'netflix', categoryId: 'entertainment' },
  { match: 'spotify', categoryId: 'entertainment' },
  { match: 'sony liv', categoryId: 'entertainment' },
  { match: 'zee5', categoryId: 'entertainment' },
  { match: 'bookmyshow', categoryId: 'entertainment' },
  { match: 'pvr', categoryId: 'entertainment' },
  { match: 'inox', categoryId: 'entertainment' },
  // food
  { match: 'swiggy', categoryId: 'food' },
  { match: 'zomato', categoryId: 'food' },
  { match: 'dominos', categoryId: 'food' },
  { match: 'mcdonald', categoryId: 'food' },
  { match: 'kfc', categoryId: 'food' },
  { match: 'pizza hut', categoryId: 'food' },
  { match: 'faasos', categoryId: 'food' },
  { match: 'behrouz', categoryId: 'food' },
  { match: 'third wave', categoryId: 'food' },
  { match: 'starbucks', categoryId: 'food' },
  { match: 'chaayos', categoryId: 'food' },
  { match: 'restaurant', categoryId: 'food' },
  { match: 'cafe', categoryId: 'food' },
  // transport
  { match: 'uber', categoryId: 'transport' },
  { match: 'ola', categoryId: 'transport' },
  { match: 'rapido', categoryId: 'transport' },
  { match: 'irctc', categoryId: 'transport' },
  { match: 'indianoil', categoryId: 'transport' },
  { match: 'iocl', categoryId: 'transport' },
  { match: 'bharat petroleum', categoryId: 'transport' },
  { match: 'hpcl', categoryId: 'transport' },
  { match: 'fastag', categoryId: 'transport' },
  { match: 'namma metro', categoryId: 'transport' },
  { match: 'dmrc', categoryId: 'transport' },
  { match: 'redbus', categoryId: 'transport' },
  { match: 'blusmart', categoryId: 'transport' },
  // shopping
  { match: 'amazon', categoryId: 'shopping' },
  { match: 'flipkart', categoryId: 'shopping' },
  { match: 'myntra', categoryId: 'shopping' },
  { match: 'ajio', categoryId: 'shopping' },
  { match: 'meesho', categoryId: 'shopping' },
  { match: 'nykaa', categoryId: 'shopping' },
  { match: 'tatacliq', categoryId: 'shopping' },
  { match: 'croma', categoryId: 'shopping' },
  { match: 'reliance digital', categoryId: 'shopping' },
  { match: 'decathlon', categoryId: 'shopping' },
  { match: 'ikea', categoryId: 'shopping' },
  // travel
  { match: 'makemytrip', categoryId: 'travel' },
  { match: 'goibibo', categoryId: 'travel' },
  { match: 'cleartrip', categoryId: 'travel' },
  { match: 'ixigo', categoryId: 'travel' },
  { match: 'yatra', categoryId: 'travel' },
  { match: 'indigo', categoryId: 'travel' },
  { match: 'air india', categoryId: 'travel' },
  { match: 'vistara', categoryId: 'travel' },
  { match: 'oyo', categoryId: 'travel' },
  { match: 'airbnb', categoryId: 'travel' },
  // health
  { match: 'apollo', categoryId: 'health' },
  { match: 'pharmeasy', categoryId: 'health' },
  { match: '1mg', categoryId: 'health' },
  { match: 'netmeds', categoryId: 'health' },
  { match: 'practo', categoryId: 'health' },
  { match: 'cult.fit', categoryId: 'health' },
  { match: 'cultfit', categoryId: 'health' },
  { match: 'pharmacy', categoryId: 'health' },
  { match: 'hospital', categoryId: 'health' },
  { match: 'diagnostic', categoryId: 'health' },
  // investments (precede generic income/transfer)
  { match: 'zerodha', categoryId: 'investments' },
  { match: 'groww', categoryId: 'investments' },
  { match: 'upstox', categoryId: 'investments' },
  { match: 'indmoney', categoryId: 'investments' },
  { match: 'kuvera', categoryId: 'investments' },
  { match: 'smallcase', categoryId: 'investments' },
  { match: 'mutual fund', categoryId: 'investments' },
  { match: 'sip', categoryId: 'investments' },
  { match: 'nps', categoryId: 'investments' },
  { match: 'ppf', categoryId: 'investments' },
  // housing
  { match: 'rent', categoryId: 'housing' },
  { match: 'nobroker', categoryId: 'housing' },
  { match: 'nestaway', categoryId: 'housing' },
  { match: 'maintenance', categoryId: 'housing' },
  { match: 'mygate', categoryId: 'housing' },
  { match: 'home loan', categoryId: 'housing' },
  // bills & utilities (telecom AFTER jio* entertainment brands above)
  { match: 'jio', categoryId: 'bills' },
  { match: 'airtel', categoryId: 'bills' },
  { match: 'vi recharge', categoryId: 'bills' },
  { match: 'bsnl', categoryId: 'bills' },
  { match: 'electricity', categoryId: 'bills' },
  { match: 'bescom', categoryId: 'bills' },
  { match: 'mseb', categoryId: 'bills' },
  { match: 'tata power', categoryId: 'bills' },
  { match: 'adani electricity', categoryId: 'bills' },
  { match: 'indane', categoryId: 'bills' },
  { match: 'bharat gas', categoryId: 'bills' },
  { match: 'broadband', categoryId: 'bills' },
  { match: 'act fibernet', categoryId: 'bills' },
  { match: 'lic', categoryId: 'bills' },
  { match: 'insurance', categoryId: 'bills' },
  { match: 'recharge', categoryId: 'bills' },
  // cash
  { match: 'atm', categoryId: 'cash' },
  { match: 'cash wdl', categoryId: 'cash' },
  { match: 'cash withdrawal', categoryId: 'cash' },
  { match: 'nfs/cash', categoryId: 'cash' },
  // remittance (money-transfer services — precede generic transfer words)
  { match: 'remittance', categoryId: 'remittance' },
  { match: 'remitly', categoryId: 'remittance' },
  { match: 'western union', categoryId: 'remittance' },
  { match: 'moneygram', categoryId: 'remittance' },
  { match: 'instarem', categoryId: 'remittance' },
  { match: 'xoom', categoryId: 'remittance' },
  { match: 'wise', categoryId: 'remittance' },
  { match: 'remit', categoryId: 'remittance' },
  // transfers (precede income 'credit' words)
  { match: 'credit card payment', categoryId: 'transfers' },
  { match: 'cred club', categoryId: 'transfers' },
  { match: 'upi/p2p', categoryId: 'transfers' },
  { match: 'imps/p2a', categoryId: 'transfers' },
  { match: 'neft dr', categoryId: 'transfers' },
  // income
  { match: 'salary', categoryId: 'income' },
  { match: 'neft credit', categoryId: 'income' },
  { match: 'imps credit', categoryId: 'income' },
  { match: 'interest credit', categoryId: 'income' },
  { match: 'dividend', categoryId: 'income' },
  { match: 'refund', categoryId: 'income' },
  { match: 'cashback', categoryId: 'income' },
];

/** Category lookup by id, with a safe fallback. */
const CAT_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));
export const categoryById = (id) => CAT_BY_ID.get(id) || CAT_BY_ID.get('uncategorized');
