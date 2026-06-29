// Money is stored as INTEGER minor units (paise) everywhere. Floats corrupt
// currency math (0.1 + 0.2 !== 0.3), so we never store rupees-as-float.
// never-lazy: this is a money path.

// Indian bank amounts come in four shapes that must all parse:
//   "Rs.499.00", "Rs 499", "INR 1,299.00", bare "Rs2499.0", "₹1,23,456.78"
// The comma grouping is 2-2-3 from the right (lakh), NOT thousands — so we
// strip ALL commas before parsing rather than assuming Western groups.
const AMOUNT_RE = /(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;

/** Parse the first currency amount in a string to integer paise, or null. */
export function parseAmount(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(AMOUNT_RE);
  if (!m) return null;
  return toMinor(m[1]);
}

/** "1,23,456.78" -> 12345678 (paise). Returns null on garbage. */
export function toMinor(numStr) {
  if (typeof numStr === 'number') return Math.round(numStr * 100);
  if (typeof numStr !== 'string') return null;
  const cleaned = numStr.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  // Round on the minor unit to dodge float drift (e.g. 2499.0 * 100).
  return Math.round(parseFloat(cleaned) * 100);
}

const FMT_CACHE = new Map();
function fmt(currency) {
  let f = FMT_CACHE.get(currency);
  if (!f) {
    // en-IN gives the ₹ glyph and lakh grouping for free (Intl is stdlib, rung 3).
    f = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    });
    FMT_CACHE.set(currency, f);
  }
  return f;
}

/** 12345678 -> "₹1,23,456.78". Uses a true minus for negatives. */
export function formatMoney(minor, currency = 'INR') {
  if (!Number.isFinite(minor)) return '—';
  const s = fmt(currency).format(Math.abs(minor) / 100);
  return minor < 0 ? '−' + s : s;
}

/** Split for KPI display: { sym:"₹", whole:"1,23,456", frac:".78", sign:"" }. */
export function splitMoney(minor, currency = 'INR') {
  const parts = fmt(currency).formatToParts(Math.abs(minor) / 100);
  let sym = '', whole = '', frac = '';
  for (const p of parts) {
    if (p.type === 'currency') sym = p.value;
    else if (p.type === 'decimal' || p.type === 'fraction') frac += p.value;
    else if (p.type === 'integer' || p.type === 'group') whole += p.value;
  }
  return { sym, whole, frac, sign: minor < 0 ? '−' : '' };
}
