// Runnable check for the money + parser path: `npm test` (node --test).
// Samples are the real-bank-format templates the parser is built against.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMinor, parseAmount } from '../app/js/money.js';
import { parseMessage, parseDate, inferDirection, categorize } from '../app/js/parser.js';
import { PARSE_RULES, CATEGORIZE_RULES } from '../app/js/rules.js';

const rules = {
  parseRules: [...PARSE_RULES].sort((a, b) => a.priority - b.priority),
  categorizeRules: CATEGORIZE_RULES,
};
const parse = (body, sender = '') =>
  parseMessage({ source: 'test', sender, body, receivedAt: Date.UTC(2026, 5, 28) }, rules);

test('money: Indian lakh comma grouping -> integer paise', () => {
  assert.equal(toMinor('1,23,456.78'), 12345678); // 2-2-3 grouping, not thousands
  assert.equal(toMinor('499.00'), 49900);
  assert.equal(toMinor('2499.0'), 249900);
  assert.equal(toMinor('5000'), 500000);
  assert.equal(parseAmount('Avl Bal INR 1,52,300.00'), 15230000);
  assert.equal(toMinor('12.345'), null); // 3 decimals is not currency
});

test('parseDate: every Indian format, day-first', () => {
  const d = (s) => new Date(parseDate(s, 0));
  assert.equal(d('28-06-26').getFullYear(), 2026);
  assert.equal(d('28-06-26').getMonth(), 5);   // June (0-indexed)
  assert.equal(d('28-06-26').getDate(), 28);
  assert.equal(d('28Jun26').getMonth(), 5);
  assert.equal(d('28-Jun-2026').getDate(), 28);
  assert.equal(d('28/06/26').getMonth(), 5);
  assert.equal(d('2026-06-28:14:32:08').getHours(), 14); // ISO-ish, time not misread
  assert.equal(d('28 Jun 2026, 2:32 pm').getHours(), 14); // 12h -> 24h
  assert.equal(d('28-06-26 18:45:12').getHours(), 18);
  assert.equal(parseDate('not a date', 999), 999);        // junk -> fallback
});

test('direction: anchors on the first verb (SBI IMPS names both)', () => {
  assert.equal(inferDirection('your a/c is debited for rs.100 and a/c xxx credited'), 'debit');
  assert.equal(inferDirection('a/c credited by rs.100 trf from someone'), 'credit');
});

test('HDFC UPI debit -> amount, merchant, category, account', () => {
  const { status, txn } = parse('Sent Rs.499.00 From HDFC Bank A/C x1234 To SWIGGY On 28-06-26 Ref 451234567890 Not You? Call 18002586161');
  assert.equal(status, 'parsed');
  assert.equal(txn.amount, 49900);
  assert.equal(txn.direction, 'debit');
  assert.equal(txn.merchant, 'SWIGGY');
  assert.equal(txn.category, 'food');
  assert.equal(txn.accountLast4, '1234');
  assert.equal(txn.method, 'upi');
  assert.equal(txn.ref, '451234567890');
});

test('SBI UPI debit: bare "Rs2499.0" amount with no space/decimals', () => {
  const { txn } = parse('Rs2499.0 debited@SBI UPI frm A/cX1234 on 28Jun26 RefNo 618234567890. If not u? call 1800111109. -SBI');
  assert.equal(txn.amount, 249900);
  assert.equal(txn.direction, 'debit');
  assert.equal(txn.accountLast4, '1234');
});

test('ICICI card debit -> shopping', () => {
  const { txn } = parse('INR 1,299.00 spent on ICICI Bank Card XX1234 on 28-Jun-26 at FLIPKART. Avl Lmt: INR 1,45,000.00.');
  assert.equal(txn.amount, 129900);
  assert.equal(txn.merchant, 'FLIPKART');
  assert.equal(txn.category, 'shopping');
  assert.equal(txn.method, 'card');
});

test('SBI account credit: lakh-grouped amount + income merchant', () => {
  const { txn } = parse('Your A/C XXXXX981234 Credited INR 45,000.00 on 28/06/26 -Deposit by transfer from ACME PAYROLL. Avl Bal INR 1,23,456.78-SBI');
  assert.equal(txn.amount, 4500000);
  assert.equal(txn.direction, 'credit');
  assert.equal(txn.merchant, 'ACME PAYROLL');
});

test('Axis UPI debit: embedded ref + merchant after UPI/P2M', () => {
  const { txn } = parse('Debit INR 850.00 A/c no. XX1234 28-06-26 18:45:12 UPI/P2M/618234567894/SWIGGY Not you? SMS BLOCKUPI Cust ID to 919951860002');
  assert.equal(txn.amount, 85000);
  assert.equal(txn.merchant, 'SWIGGY');
  assert.equal(txn.category, 'food');
  assert.equal(txn.ref, '618234567894');
});

test('GPay: 12h time, ₹-less "Rs.499", masked ****1234', () => {
  const { txn } = parse('You paid Rs.499 to Swiggy. UPI transaction ID 618234600005, 28 Jun 2026, 2:32 pm. From HDFC Bank ****1234');
  assert.equal(txn.amount, 49900);
  assert.equal(txn.merchant, 'Swiggy');
  assert.equal(txn.accountLast4, '1234');
  assert.equal(new Date(txn.ts).getHours(), 14);
});

test('ICICI credit-card payment -> transfers (not double-counted as income)', () => {
  const { txn } = parse('Dear Customer, Payment of INR 12,500.00 has been received towards your ICICI Bank Credit Card XX1234 on 28-JUN-26 through UPI.');
  assert.equal(txn.direction, 'credit');
  assert.equal(txn.category, 'transfers');
});

test('generic fallback: matches an UNKNOWN bank when an account tail is present', () => {
  const { status, txn } = parse('Acct XX9999 debited Rs.250.00 at LOCALSHOP on 28-06-26');
  assert.equal(status, 'parsed');
  assert.equal(txn.amount, 25000);
  assert.equal(txn.direction, 'debit');
});

test('generic fallback: does NOT match marketing text (no account tail)', () => {
  const { status } = parse('Get Rs.500 cashback when you spend Rs.2000 at BigBasket this weekend!');
  assert.equal(status, 'unparsed'); // no masked account/card tail -> rejected
});

test('dedupe key is stable for the same transaction across channels', () => {
  const a = parse('Sent Rs.499.00 From HDFC Bank A/C x1234 To SWIGGY On 28-06-26 Ref 451234567890').txn;
  const b = parse('Sent Rs.499.00 From HDFC Bank A/C x1234 To SWIGGY On 28-06-26 Ref 451234567890').txn;
  assert.equal(a.dedupeKey, b.dedupeKey);
  assert.ok(a.dedupeKey.includes('451234567890'));
});

// ── regression tests for the review findings ────────────────────────────────

test('money: a 3-decimal amount is REJECTED, not truncated', () => {
  assert.equal(parseAmount('Rs.100.999'), null); // was silently read as 100.99
  assert.equal(parseAmount('Rs.100.99'), 10099);
});

test('parseDate: out-of-range month/day falls back instead of rolling over', () => {
  assert.equal(parseDate('13-13-26', 999), 999); // month 13 used to roll to next Jan
  assert.equal(parseDate('32-06-26', 999), 999); // day 32 used to roll to Jul 2
});

test('generic fallback: marketing that cites a card last-4 is REJECTED (no txn verb)', () => {
  assert.equal(parse('Use your Card xx1234 to spend Rs.2000 and get Rs.150 cashback! T&C apply').status, 'unparsed');
  assert.equal(parse('Pre-approved! Your Card xx8888 is eligible for a Rs.50,000 loan. Apply now').status, 'unparsed');
  assert.equal(parse('Your account xx4567 will be charged Rs.999 if you do not opt out. Reply STOP').status, 'unparsed');
});

test('SBI account-credit matches the real 5-X / 6-digit mask and keeps the merchant', () => {
  const { txn } = parse("Your A/C XXXXX987788 Credited INR 1,25,000.00 on 15/06/26 -Deposit by transfer from ACME CORP SALARY. Avl Bal INR 2,10,000.00-SBI");
  assert.equal(txn.amount, 12500000);
  assert.equal(txn.merchant, 'ACME CORP SALARY'); // was lost to the generic fallback before
  assert.equal(txn.category, 'income');
});

test('categorize: word boundaries stop short-key substring collisions', () => {
  const cat = (m, body = '') => categorize(m, body, CATEGORIZE_RULES).category;
  assert.notEqual(cat('TORRENT PHARMA'), 'housing'); // "torrent" must not hit "rent"
  assert.notEqual(cat('Motorola'), 'transport');     // "Motorola" must not hit "ola"
  assert.equal(cat('SWIGGY'), 'food');               // real merchant still matches
  assert.equal(cat('netflix@hdfcbank'), 'entertainment');
});

test('inferDirection: a strong debit verb beats an incidental "refund"/"cashback"', () => {
  assert.equal(inferDirection('Refund processed: Rs.500 debited from A/c x1234 to vendor'), 'debit');
  assert.equal(inferDirection('Rs.200 cashback offer; Rs.1000 spent on card xx1234'), 'debit');
});
