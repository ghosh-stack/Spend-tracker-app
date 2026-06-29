# Style guide — "Ledger"

The running app is the living mockup; this documents the system behind it. The
single source of truth in code is the token block at the top of
[`app/css/styles.css`](../app/css/styles.css).

**Concept:** an ink-navy ground with one jade accent. Neutrals carry a cool-navy
bias so the background reads as *chosen*, not default grey. One accent signals
money / action / live, deliberately avoiding the neon-lime and purple-gradient
fintech clichés. Semantic colors (positive/negative/warn/info) are a separate
ramp, never decorative.

## Color tokens

| Role | Dark (default) | Light |
|---|---|---|
| `--bg` | `#0b1014` | `#f4f6f8` |
| `--surface` / `--surface2` / `--surface3` | `#131a21` / `#1a232c` / `#222d38` | `#fff` / `#f0f3f6` / `#e7edf1` |
| `--border` / `--border-strong` | `#28333d` / `#36444f` | `#dde4ea` / `#c6d1d9` |
| `--text` / `--text-dim` / `--text-mute` | `#eef3f6` / `#9fb0bd` / `#6c7f8c` | `#0e1620` / `#51626f` / `#6f808d` |
| `--accent` / `--accent-press` | `#34d6a0` / `#25b487` | `#11a374` / `#0c8861` |
| `--positive` / `--negative` / `--warn` / `--info` | `#4ad6a0` / `#ff6b6b` / `#f5b54a` / `#5ea2ff` | `#0f9c6e` / `#d4393f` / `#b9760a` / `#2f6fe0` |

**Categorical chart palette** (hue-spaced so adjacent donut slices read apart):
`#34d6a0 #5ea2ff #b388ff #ffb454 #ff7eb3 #4fd1c5 #f5e16c #8a96a3`. Each expense
**category owns one hex** (in `rules.js`) that drives its donut slice, legend
dot, feed pill, and icon tile — one identity token, app-wide.

**Contrast:** text-on-bg >16:1, dim >7:1 (both AAA); mute ~4.6:1 (AA, non-essential
labels only). Accent is reserved for fills/large figures — never small accent text on dark.

## Typography

The design calls for Space Grotesk / Inter / JetBrains Mono (all OFL). This
build ships a **system stack** instead — to stay fully offline with zero font
CDNs/binaries — keeping the same discipline:

- **Sans** (`--font-sans`): `system-ui, -apple-system, "Segoe UI", Roboto, …` — UI text & headings (tracking `-0.02em`).
- **Mono** (`--font-mono`): `ui-monospace, "Cascadia Code", "SF Mono", Consolas, …` — **every monetary value**, deltas, axis labels, dates, with `font-variant-numeric: tabular-nums` so columns align to the pixel. Negatives use a true minus (`−`); the currency symbol is dimmed.
- **Scale** (1.25 minor third): hero `3rem` · KPI `2rem` · titles `1.3rem` · body `0.94–1rem` · meta `0.8rem`.

## Spacing, radius, motion

- **Space:** 4 / 8 / 12 / 16 / 24 / 32 / 48 px.
- **Radii:** sm 8 · md 12 · lg 16 · xl 22 · pill 999.
- **Easing:** `cubic-bezier(.22,.61,.36,1)`. All motion is wrapped in
  `@media (prefers-reduced-motion: reduce)`, which kills every animation/transition.
- **Focus:** every interactive element shows a 2px-offset accent ring on `:focus-visible`.

## Components

| Component | Notes | Borrowed from |
|---|---|---|
| **Top app bar** | sticky, blurred; title + context line ("June 2026 · N accounts"); gains a border on scroll | Monarch — the context subline |
| **Sidebar → bottom nav** | 236px labeled rail on desktop; on phones, a blurred bottom nav with a notched center FAB | Emma (rail) · Cred (FAB) |
| **KPI cards ×4** | number-first; value split into dimmed symbol / whole / fraction; delta semantics flip by metric | Copilot Money |
| **Category donut** | native SVG (`stroke-dasharray`, `pathLength=100`); hover dims siblings | Mint (color identity) |
| **Spend-over-time** | native SVG rounded bars over a faint grid; most-recent bar emphasized | Walnut · Copilot |
| **Live feed** | category tile + merchant + meta pills + signed mono amount; new rows slide in | Emma · Cred |
| **Filters toolbar** | segmented date range (`aria-pressed`) + category/account selects + Reset | YNAB · Monarch |
| **Empty / loading** | dashed well with one CTA / shimmer skeletons matching real row geometry (zero layout shift) | YNAB · Copilot |

## Responsive

Three breakpoints, priority order preserved through every collapse
(summary → shape → detail):

- **≥1080px** — full rail, 4 KPIs across, side-by-side charts.
- **760–1080px** — charts stack; KPIs reflow to 2×2 (<920px).
- **<760px** — rail hidden, blurred bottom nav + center FAB; KPIs 1-up
  (1-col <520px); touch targets ≥44px.
