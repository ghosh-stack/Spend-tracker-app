# Style guide — "Aurora"

The running app is the living mockup; this documents the system behind it. The
single source of truth in code is the token block at the top of
[`app/css/styles.css`](../app/css/styles.css).

**Concept:** a cool **near-black** ground with an **electric-indigo** signature
accent. Neutrals carry a cool bias so the background reads as *chosen*, not
default grey. Indigo signals action / selection / focus; **jade is reserved for
money-in** (income, savings, the positive semantic) so green always means "good
for your balance" and never just "a button". Glassy, blurred surfaces and a
single brand gradient (indigo → jade) give it a modern-finance personality
without the neon-lime cliché. Light mode keeps the identity via a faint
**lavender-tinted** ground and an indigo hairline.

## Color tokens

| Role | Dark (default) | Light |
|---|---|---|
| `--bg` / `--bg-elev` | `#0B0C10` / `#0E1016` | `#F4F3FC` / `#FFFFFF` |
| `--surface` / `--surface2` / `--surface3` | `#14161C` / `#1B1E27` / `#242834` | `#FFFFFF` / `#F2F0FB` / `#E8E4F6` |
| `--border` / `--border-strong` / `--hairline` | `#262B36` / `#39414F` / `rgba(255,255,255,.06)` | `#E6E2F2` / `#CCC6E2` / `rgba(91,75,214,.08)` |
| `--text` / `--text-dim` / `--text-mute` | `#F2F5FA` / `#A4AEBE` / `#7E8898` | `#10131A` / `#4F5A6B` / `#6B7686` |
| `--accent` / `--accent-press` | `#7C6CFF` / `#6354F0` | `#5B4BD6` / `#4A3CC2` |
| `--accent-text` (accent used as text) | `#A9B2FF` | `#5B4BD6` |
| `--positive` / `--negative` / `--warn` / `--info` | `#3FD9A4` / `#FF6B74` / `#FFC24D` / `#5FA8FF` | `#0E9E74` / `#C8313A` / `#9A6700` / `#2F6FE0` |

**Gradients:** `--grad-brand` `linear-gradient(135deg, #7C6CFF → #3FD9A4)` (the ₹
brand mark) and `--grad-accent` (the primary button). Used sparingly — chrome and
one CTA, never as page decoration. The heatmap has its own 5-step ramp
(`--heat0…4`) per theme.

**Categorical chart palette:** each expense **category owns one hex** (in
[`rules.js`](../app/js/rules.js)) that drives its treemap tile, donut slice,
Sankey ribbon, legend dot, feed pill, and icon tile — one identity token,
app-wide. Income sources in the Sankey use jade shades.

**Contrast:** text-on-bg and dim pass AAA; mute is AA for non-essential labels.
`--accent-text` (a lighter indigo on dark, a darker indigo on light) is what's
used whenever the accent appears as *text*, so it always clears 4.5:1 — the raw
`--accent` is for fills only.

## Typography

The design calls for a geometric sans + a mono. This build ships a **system
stack** (zero font CDNs/binaries, fully offline) keeping the same discipline:

- **Sans** (`--font-sans`): `"Segoe UI Variable Display", system-ui, -apple-system, "Segoe UI", Roboto, …` — UI text & headings (tracking `-0.02em`).
- **Mono** (`--font-mono`): `ui-monospace, "Cascadia Code", "SF Mono", "Segoe UI Mono", Consolas, …` — **every monetary value**, deltas, axis labels, dates, with `font-variant-numeric: tabular-nums` so columns align to the pixel. Negatives use a true minus (`−`); the currency symbol and fraction are dimmed.
- **Scale:** hero spend `2.7rem` · KPI value `2rem` · titles `1.3rem` · body `0.94–1rem` · meta `0.75–0.8rem`.

## Spacing, radius, motion

- **Space:** 4 / 8 / 12 / 16 / 24 / 32 / 48 px (`--s1…s7`).
- **Radii:** sm 10 · md 14 · lg 18 · xl 24 · pill 999.
- **Elevation:** layered shadows + a top inner highlight (`--hi`) on cards; glass
  surfaces use `backdrop-filter: blur(14px)` with a `@supports` solid-colour fallback.
- **Easing:** `--ease cubic-bezier(.22,.61,.36,1)`, `--ease-spring cubic-bezier(.34,1.56,.64,1)`; durations 120 / 180 / 260 ms. All motion is wrapped in `@media (prefers-reduced-motion: reduce)`, which kills every animation/transition.
- **Focus:** every interactive element shows a 2px-offset accent ring on `:focus-visible`.

## Iconography

App chrome uses a single **inline-SVG icon set** ([`app/js/icons.js`](../app/js/icons.js)):
1.75px stroke, round caps, `currentColor` so icons inherit nav/accent colour for
free — nav, KPI cards, the More sheet, capture status, brand mark. **Emoji are
reserved for categories** (a warm, personal-finance layer in the feed, treemap and
Sankey), not for navigation or settings.

## Components

| Component | Notes |
|---|---|
| **Top app bar** | sticky, glass-blurred; title + context line ("July 2026 · N accounts · ₹X spent"); gains a hairline on scroll. A status pill reads *Live/Manual* (web) or *Capture on/blocked/Check* (APK). |
| **Sidebar → bottom nav** | 236px labelled rail on desktop; on phones a blurred bottom nav with a notched center **FAB** (owns "add") + a **More** sheet for secondary actions, grouped into sections. |
| **KPI hero + strip** | a large hero spend number, then a 3-up strip (Income, Top category, Net flow); value split into dimmed symbol / whole / fraction; delta pills flip colour by metric; sparklines. Horizontal-scroll strip on phones. |
| **Money-flow Sankey** | the hero visualization: income → spent/saved → categories, with a compact spent/saved/rate header above it. Tap a category ribbon/node to filter. |
| **Breakdown** | a squarified **treemap** by default, toggle to a **donut** (`aria-pressed`); category colour identity throughout. |
| **Spending calendar** | a month **heatmap** of daily spend (5-step ramp, today ringed). |
| **Spending pace** | cumulative month-to-date line vs a last-month baseline + projected month-end. |
| **Live feed** | category tile + merchant + meta pills + signed mono amount; new rows slide in; **swipe** a row (right = recategorize, left = delete with Undo). |
| **Filters toolbar** | segmented date range (radiogroup, arrow-key nav) + category/account selects + Reset; a horizontal-scroll rail on phones. |
| **Modals → bottom sheets** | dialogs become full-width bottom sheets under 760px. |
| **Empty / loading** | first run shows a focused setup panel (no empty chart scaffolding); shimmer skeletons match real row geometry. |

## Responsive

Priority order is preserved through every collapse (summary → shape → detail):

- **≥1080px** — full rail, charts side-by-side, KPI strip 3-up.
- **760–1080px** — charts stack.
- **<760px** — rail hidden, blurred bottom nav + center FAB; topbar declutters
  (no Add button, status pill collapses to a dot); filters become a horizontal
  scroll rail; the page is held inside the viewport (`min-width:0` containment +
  an `overflow-x` guard) so it never sideways-scrolls; touch targets ≥44px.
- **<520px** — KPI strip becomes a snap-scroll carousel.
