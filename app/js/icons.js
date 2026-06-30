// Inline-SVG icon set — single style (1.75px stroke, round caps, currentColor)
// so icons inherit nav/accent colour for free. No external assets (CSP/offline).
// Use: icon('dashboard', 18). Category glyphs stay as emoji in rules.js.
const P = {
  dashboard: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM13 13h7v7h-7zM4 13h7v7H4z"/>',
  txns: '<path d="M4 7h16M4 12h16M4 17h10"/><circle cx="20" cy="17" r="1.3" fill="currentColor" stroke="none"/>',
  recurring: '<path d="M4 9a8 8 0 0 1 14-3M20 5v4h-4"/><path d="M20 15a8 8 0 0 1-14 3M4 19v-4h4"/>',
  insights: '<path d="M4 20V4M4 20h16M8 16l3-4 3 2 4-6"/>',
  review: '<path d="M12 3l9 16H3zM12 9v4M12 17v.01"/>',
  flow: '<path d="M4 5c6 0 4 7 10 7s6-7 6-7M4 12c6 0 4 7 10 7"/>',
  home: '<path d="M4 11l8-7 8 7M6 9.5V20h12V9.5"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none"/>',
  paste: '<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 4.5h6V7H9z"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',
  import: '<path d="M12 3v10M8 9l4 4 4-4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  export: '<path d="M12 13V3M8 7l4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6zM10 20a2 2 0 0 0 4 0"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  pdf: '<path d="M12 3v11M8 10l4 4 4-4M5 19h14"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>',
};

export function icon(name, size) {
  const p = P[name];
  if (!p) return '';
  const s = size || 22;
  return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
}

// The ₹ "lens" brand mark: a gradient rounded chip with a stroked ₹ inside a
// concentric lens ring. Self-contained SVG (gradient id is unique per size call).
export function brandMark(size) {
  const s = size || 30;
  const id = 'bm' + s;
  return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 30 30" aria-hidden="true">'
    + '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">'
    + '<stop offset="0" stop-color="#7C6CFF"/><stop offset="1" stop-color="#3FD9A4"/></linearGradient></defs>'
    + '<rect width="30" height="30" rx="9" fill="url(#' + id + ')"/>'
    + '<circle cx="15" cy="15" r="8.4" fill="none" stroke="rgba(10,11,18,.30)" stroke-width="1.3"/>'
    + '<path d="M11.4 9.6h6.2M11.4 12.6h6.2M16.6 9.6c0 3.2-2 4.6-4.8 4.9 1.6 1.5 3.4 3.4 5 5.9" '
    + 'fill="none" stroke="#0A0B12" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
