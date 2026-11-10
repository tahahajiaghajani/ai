# Kariz design system — engineers' guide

The visual foundation of «کاریز» / Kariz (web and Windows, one UI in `src/ui`). The brand book — story, name, logo
rules, colour meaning, voice and tone — is [`BRAND_FA.md`](BRAND_FA.md) (Persian). The living reference is in the app:
**Settings → راهنمای طراحی** (`settings/style-guide`, for members with `settings: full`); everything there is drawn by
the real tokens and components, in the theme in effect.

- [1. Principles](#1-principles)
- [2. Architecture](#2-architecture)
- [3. Tokens](#3-tokens)
- [4. Tooling and tests](#4-tooling-and-tests)
- [5. Components](#5-components)
- [6. Patterns](#6-patterns)
- [7. Building a page](#7-building-a-page)
- [8. Accessibility checklist](#8-accessibility-checklist)
- [9. Ant Design notes](#9-ant-design-notes)

## 1. Principles

1. **Tokens only.** Colours, type, spacing, radii, shadows and motion come from `--ds-*` custom properties (or the
   Tailwind bridge utilities that read them). No raw hex, no `dark:` variants: both themes come from the tokens.
2. **Quiet by default.** 90–95 % of a screen is neutral. One turquoise primary action per region; status is the
   exception (plain text-3 for the normal state, chips only for what needs attention).
3. **Colour is never the only signal.** States, priorities and SLA always carry a label (and a nuqta).
4. **Persian first.** RTL layout with logical properties (`margin-inline-start`, `inset-inline-end`…), Persian
   digits everywhere except Latin identifiers and code, Jalali dates.
5. **Motion explains, never decorates.** Transform and opacity only, short, ease-out, no loops (except the sync
   nuqta); everything degrades under reduced motion.
6. **AA everywhere.** Every text pair ≥ 4.5:1 and every meaningful graphic ≥ 3:1 in both themes — enforced by tests.

## 2. Architecture

| File | Role |
|---|---|
| `src/ui/index.html` | **The cascade-layer order**, declared inline before any stylesheet: `@layer properties, theme, base, antd, components, utilities;` (see below). Pre-paint theme script, boot mark. |
| `src/ui/styles.css` | Imports Tailwind and the design-system CSS; the `@theme inline` bridge (Tailwind utilities → tokens). |
| `src/ui/ds/tokens.css` | **Source of truth**: fonts (§1), brand scales and gradients (§2), scale tokens (§3), role aliases (§3b), light theme (§4), dark theme (§5, two identical blocks), preference overrides (§6), print (§7), base primitives (§8). |
| `src/ui/ds/ds-palette.ts` | **Generated** hex/rgba palette for antd (`npm run tokens`). Never edit by hand. |
| `src/ui/ds/ds-theme.ts` | `dsTheme(mode)` / `dsConfig(mode)`: the antd 6 `ConfigProvider` theme (algorithm, tokens, component tokens, semantic class hooks). |
| `src/ui/ds/ds-antd.css` | What antd tokens cannot express (focus rings, control edges, selected-row bar, sheet timing, press). |
| `src/ui/ds/motion.css` | Motion classes: `.ds-enter`, `.ds-fade`, `.ds-pop`, `.ds-stagger`, `.ds-press`, `.ds-launch`, `[data-pending]`, `.ds-flash`, celebration layer. |
| `src/ui/ds/brand.css` | The brand surface (login, onboarding, About): `.ds-brand`, `.ds-horizon`, `.ds-tagline`… |
| `src/ui/ds/icons.tsx` | `Icon`, `DirIcon` (logical directional icons), `DIRECTIONAL`, `NuqtaSpark`. |
| `src/ui/ds/illustrations.tsx` | `Illustration` and `ILLUSTRATIONS` (seven empty-state drawings). |
| `src/ui/ds/celebrate.ts` | `celebrate(el)` — the milestone animation. |
| `src/shared/brand.ts` | The logo drawing (mark, wordmarks, lockups, app icon) and brand colours — shared by `components/brand.tsx`, `scripts/brand-assets.mts` and the tests. |
| `src/shared/color.ts` | Colour maths (parse, composite, WCAG contrast, OKLCH, colour-blind ΔE). |
| `src/ui/components/*` | The kit: `layout.tsx` (PageHeader, Section), `blocks.tsx` (Card, Note), `display.tsx` (chips, status, empty, loading, figures), `brand.tsx`, `inputs.tsx`, `data.tsx`. |
| `src/ui/lib/theme.tsx`, `lib/motion.ts`, `lib/fa.ts` | Theme provider, motion hooks, Persian numbers and dates. |

**Cascade layers.** Browsers order `@layer`s by first appearance. Vite links a shared chunk's CSS (which opens
`@layer components`) before the entry CSS and the minifier drops the order statement in `styles.css`, so without the
inline declaration in `index.html` Tailwind's preflight (`base`) would beat every design-system rule and antd would
beat all of them. Keep the inline `<style>` the first thing in `<head>`; `tests/design-system.test.ts` checks it.
Custom properties are unlayered; component CSS goes in `@layer components`.

**Themes.** `<html data-theme="light|dark">` (set before paint from `localStorage["itsm.theme"]`, then by
`ThemeProvider`); without it the OS preference applies. Optional: `data-motion="reduced"`, `data-power="low"`
(Windows low-power: no glass, no grain, no motion), `data-density="compact"` on a page or panel.

**Minifier caveats.** Production CSS is minified by Lightning CSS: `:dir()` is rewritten as a `:lang()` list (which
follows `lang="fa"`, not the direction — use `[dir]` attribute selectors), and `rgb(r g b / a)` becomes `#rrggbbaa`
(computed token values may come back in that form; `parseColor` reads it).

## 3. Tokens

### Colour roles (both themes)

| Group | Tokens | Tailwind |
|---|---|---|
| Surfaces | `--ds-canvas`, `--ds-surface`, `--ds-raised`, `--ds-sunken`, `--ds-well` | `bg-canvas` … `bg-well` |
| Text | `--ds-text`, `--ds-text-2`, `--ds-text-3`, `--ds-text-4` (disabled only) | `text-ink` … `text-ink-4` |
| Lines | `--ds-line`, `--ds-line-2`, `--ds-line-3`, `--ds-control-strong` | `border-line` … `border-control-strong` |
| Interaction | `--ds-hover`, `--ds-hover-row`, `--ds-selected`, `--ds-pressed`, `--ds-scrim`, `--ds-selection`, `--ds-scrollbar` | — |
| Accent (turquoise) | `--ds-accent`, `-hover`, `-text`, `-line`, `-bar`, `-tint`, `-tint-2`, `-border`, `--ds-on-accent`, `--ds-focus-color`, `--ds-focus-ring` | `bg-accent`, `text-accent-text`, `bg-accent-tint(-2)`, `bg-accent-bar`, `text-on-accent`, `border-accent-border` |
| Semantic | `--ds-in` (success) / `-tint` / `-border`, `--ds-danger` / `-tint` / `-border` / `-solid`, `--ds-warning` / `-tint` / `-border` / `-fill`, `--ds-info` / `-tint` / `-border` / `-fill`, `--ds-neutral-tint`, `--ds-holiday`; aliases `--ds-success*` | `text-in`, `bg-in-tint`, `text-danger`, `text-warning`, `bg-warning-fill`, `text-info`, `bg-info-tint`, `text-success` |
| Second material (lapis) | `--ds-sea`, `--ds-sea-text`, `--ds-sea-tint`, `--ds-sea-line` (internal notes, viewers, callouts) | `text-sea-text`, `bg-sea-tint` |
| AI | `--ds-ai`, `--ds-ai-text`, `--ds-ai-tint`, `--ds-ai-border`, `--ds-grad-ai` | `text-ai`, `bg-ai-tint` |
| Record states | `--ds-state-{new,progress,hold,resolved,closed,cancelled}` (+ `-text`, `-tint`) | `text-state-new-text`, `bg-state-new-tint` … |
| Priorities | `--ds-p1` … `--ds-p5` (+ `-text`, `-tint`) | `text-p1-text`, `bg-p1-tint` … |
| SLA | `--ds-sla-{ok,risk,breach,paused,met}` (+ `-text`, `-tint`) | — |
| Named hues | `--ds-hue-{gray,red,orange,gold,green,teal,blue,indigo,purple,magenta}`, `--ds-on-hue` (option and portal colours, `COLOR_KEYS`) | `text-hue-*`, `bg-hue-*` |
| Logo | `--ds-brand-arch`, `--ds-brand-nuqta`, `--ds-brand-word`, `--ds-brand-nuqta-on-brand` | `text-brand-arch` |
| Charts | `--ds-chart-1` … `--ds-chart-8`, `--ds-chart-other`, `--ds-chart-grid/-axis/-crosshair/-compare`, `--ds-grad-chart-area`; `--ds-seq-1…9`; `--ds-div-1…9`; `--ds-status-{good,warning,serious,critical}` | `bg-chart-1` … |
| Illustrations | `--ds-illus-{ink,line,soft,water,light,alert}` | — |
| Brand constants | `--ds-firuzeh-50…950`, `--ds-lajvard-50…950`, `--ds-zaferan-50…950`, `--ds-ink`, `--ds-paper`, `--ds-charcoal`, `--ds-snow`, `--ds-grad-brand`, `--ds-grad-brand-tile` (brand surfaces only; UI uses the roles above) | — |

**Chart slots keep their hue family** (slot 2 saffron, 4 clay, 5 lapis, 6 pistachio, 7 walnut, 8 sky; slot 1 is now the
brand turquoise and slot 3 the old plum), so modules that use a slot by meaning are not recoloured. Named option
colours must use `--ds-hue-*`, never a chart slot.

**Legacy names** keep working as aliases: `--ds-dusk-*` (→ firuzeh), `--ds-grad-dusk(-tile)`, the `--ds-sea-*` set,
and names some modules used without a definition (`--ds-radius-2`, `--ds-surface-2`, `--ds-weight-bold`,
`--ds-font-num`, `--ds-grad-brand`).

### Type

Fonts: `--ds-font-sans` (DS Num digits + Arad UI + Geist), `--ds-font-display` (Arad at its own proportions),
`--ds-font-latin` (Geist), `--ds-font-mono` (Geist Mono). Weights: `--ds-weight-regular` 450, `-medium` 540,
`-strong` 600 (400/500/700 in print). Roles: `.ds-t-display`, `.ds-t-page`, `.ds-t-section`, `.ds-t-title`,
`.ds-t-body`, `.ds-t-dense`, `.ds-t-label`, `.ds-t-caption`, `.ds-t-paragraph`, `.ds-t-hero`, `.ds-t-figure`
(sizes in `--ds-type-*`). Never use the `font` shorthand (it resets `ss01`, `DSTY` and tabular figures).

Numbers and bidi: `.ds-num` (tabular, nowrap — never ellipsize a number), `.ds-id` (Latin identifiers, tabular Geist),
`.ds-mono` (code), `.ds-latin`, `.ds-ltr` (signed numbers, shortcuts), `.ds-dec`, `.ds-unit`, `.ds-end`. An element with
its own direction is a bare isolate with no margin; put spacing on an RTL wrapper.

### Space, shape, elevation, layers

Spacing `--ds-space-*` (4 px base), `--ds-gutter`, `--ds-card-padding`, `--ds-stack`. Radii `--ds-radius-xs…xl`,
`-pill`, `-icon`. Sizes `--ds-control-h(-sm/-lg)`, `--ds-topbar-h`, `--ds-sidebar-w`, `--ds-sheet-w*`,
`--ds-row-h(-compact)`. Elevation `--ds-ring`, `--ds-shadow-e1…e4` (ink-tinted in light; rings + highlights in dark),
glass `--ds-glass-*`. Layers `--ds-z-*` (sticky 10 … toast 1200).

### Motion

Durations `--ds-dur-instant` 0, `-fast` 100, `-base` 160, `-moderate` 200, `-slow` 300, `-crossfade` 150, `-sheet` 240,
`-sheet-exit` 180, `-hero` 500, `-flash` 1200, `-celebrate` 900, `-pulse` 2000 ms. Easings `--ds-ease-out` (entering),
`-out-quad` (hover, colour), `-in-out` (on-screen movement), `-sheet`. Amounts `--ds-enter-scale` .96,
`--ds-press-scale` .98, `--ds-enter-shift` 8px, `--ds-stagger` 30ms, `--ds-pending-opacity` .62. Under reduced motion
(OS, `data-motion="reduced"`, `data-power="low"`) durations shrink to ≤ 150 ms and every amount becomes the identity.

## 4. Tooling and tests

| Command | What it does |
|---|---|
| `npx tsx scripts/ds-tokens.ts` | Checks every token pair (542): text on every surface and tint (≥ 4.5), graphics (≥ 3), the chart palette (lightness band, chroma ≥ .10, adjacent CVD ΔE ≥ 8 and normal ΔE ≥ 15 with the Machado 2009 model, ≥ 3:1 on cards), the ramps, the two dark blocks and the brand mirror. |
| `npm run tokens` | The same, and regenerates `src/ui/ds/ds-palette.ts`. |
| `npm run check:tokens` | Fails when `ds-palette.ts` is stale. |
| `npm run brand` | Redraws every brand asset from `src/shared/brand.ts` (needs Playwright's Chromium; outputs are committed). |
| `tests/design-system.test.ts` | Runs the checks above, verifies every `var(--ds-*)` read without a fallback exists, the layer-order guard, the drawn name vs `APP_NAME`, the masters, and the formats of the icons and installer bitmaps. |
| `node scripts/ui-shots.mjs` | Screenshots of every page in light, dark and phone, with a console/error report. |

**Changing a colour:** edit `tokens.css` (the light block and **both** dark blocks), run `npm run tokens`, then
`npx vitest run tests/design-system.test.ts`. If a brand scale changes, update `BRAND_COLORS` in `src/shared/brand.ts`
and run `npm run brand`.

## 5. Components

| Component | Use |
|---|---|
| `PageHeader` (`components/layout`) | First element of every page: title, optional subtitle, at most one primary action. |
| `Card`, `Note` (`components/blocks`), `Section` (`layout`) | Content containers; `Note` is the quiet callout (never an amber surface). |
| `Chip` (`display`) | Status chip: tones `neutral`, `accent`, `in`, `warning`, `danger`, `info`, `ai`; `fig` for figures. |
| `StateChip`, `STATE_KIND` | A record state in its family (`new`, `progress`, `hold`, `resolved`, `closed`, `cancelled`); map engine categories with `STATE_KIND`. |
| `PriorityChip` | `p={1…5}` with an optional label; P1's nuqta draws attention once. |
| `StatusTag` | Legacy status maps (antd colour names) → chips; normal states stay plain text. |
| `EmptyState` | Icon tile in data views; `art` (an `IllustrationName`) for page-level and first-run states. |
| `Skeleton`, `Loader` | First load (after 200 ms) and waits over a second (three rhombic nuqtas). Never a spinner in content. |
| `BrandMark`, `Wordmark`, `Logo`, `BrandTile` (`components/brand`) | The logo, lockups and app tile; variants `color` / `mono` / `white` / `inverse`; `launch` animates. |
| `Icon`, `DirIcon`, `NuqtaSpark` (`ds/icons`) | Lucide at the system's size and stroke; logical directional icons; the AI spark. |
| `Illustration` (`ds/illustrations`) | `empty`, `search`, `done`, `offline`, `locked`, `error`, `welcome`. |
| `celebrate(el)` (`ds/celebrate`) | Milestones only. |
| Kit inputs (`components/inputs`): `NumberInput`, `DateInput` (Jalali), `RefSelect`; data: `ServerTable`, `EntityPage` | See their files. |

## 6. Patterns

- **Page anatomy:** `PageHeader` → filters row (`--ds-filters-gap` above the content it scopes) → content in cards or a
  table. Explanations live in «راهنما», not on the page.
- **Lists:** compact density (`size="small"`, 32 px rows); number columns `className="ds-num"`, start-aligned, sized to
  the widest value; the selected row has the neutral fill plus the 3 px accent bar at the start edge.
- **Records:** state chip in the header, SLA chips with tone by share used (`slaTone`: in → warning at 75 % → danger
  when breached; neutral when paused).
- **Status display:** the normal state is plain text-3; chips only for pending, failed/overdue, draft — and for
  record states/priorities where the column is the point.
- **Empty / loading / error:** illustration only for whole-page states; skeleton first, loader after a second;
  errors say what happened and what to do.
- **Optimistic updates:** apply at once (React 19 `useOptimistic`), mark the element `data-pending` until the server
  confirms, add `.ds-flash` once on success; on failure restore and show a toast.
- **Milestones:** `celebrate(buttonOrCard)` plus words (a toast or the page); never for routine saves.
- **AI surfaces:** lapis (`--ds-ai*`), the «AI» chip icon, `NuqtaSpark` for suggestions; proposals are drafts until a
  person applies them.
- **RTL icons:** use `DirIcon` for back/forward/next/prev/undo/redo/send/reply/external/login/logout; never mirror
  clocks, checks, search, media, charts or objects. Older screens that picked the visual icon directly stay as they are.
- **Charts:** fixed slot order, never cycled; > 8 series fold into «سایر»; direct labels or a table view; one axis;
  status colours (`--ds-status-*`) never reused as series.

## 7. Building a page

```tsx
import { Button } from "antd";
import { Plus } from "lucide-react";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { EmptyState, PriorityChip, StateChip, STATE_KIND } from "../../components/display";
import { Icon } from "../../ds/icons";

export default function Queue({ rows }: { rows: Row[] }) {
  return (
    <>
      <PageHeader title="رخدادها" actions={<Button type="primary" icon={<Icon icon={Plus} />}>رخداد تازه</Button>} />
      {rows.length ? (
        <Card flush>
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-5 py-2.5 border-b border-line">
              <span className="ds-id text-ink-3">{r.no}</span>
              <span className="flex-1 truncate">{r.title}</span>
              <StateChip state={STATE_KIND[r.category]}>{r.stateLabel}</StateChip>
              <PriorityChip p={r.priority} />
            </div>
          ))}
        </Card>
      ) : (
        <EmptyState art="done" title="همه‌چیز رسیدگی شده است" description="موارد تازه همین‌جا می‌آیند." />
      )}
    </>
  );
}
```

Then: check light and dark at 1440 × 900 and a phone at 375 px (`node scripts/ui-shots.mjs --paths <route>`), run
`npm run typecheck` and the design-system test.

## 8. Accessibility checklist

- Text ≥ 4.5:1, graphics and control edges ≥ 3:1 (use the roles; the test proves them).
- Focus visible on everything: the 2 px turquoise ring with a 2 px gap (`:focus-visible`); rows and cells draw it inside.
- Colour never alone: a word with every state, priority and chart series (legend or direct label).
- Persian text ≥ 12 px; values ≥ 13 px; never ellipsize a number.
- Every motion has a reduced-motion form; no loops; nothing blocks input.
- Icons are `aria-hidden` unless they are the only label (`Icon label="…"`); illustrations are decorative unless titled.
- Hit targets ≥ 32 px (24 px in dense toolbars with spacing).
- Forced colours (Windows high contrast): structure, focus and selection stay visible (tokens.css §6).

## 9. Ant Design notes

antd 6 renders inside `<StyleProvider layer>` (its CSS-in-JS sits in the `antd` layer) and `<ConfigProvider
{...dsConfig(mode)}>` with `direction="rtl"` and `fa_IR`. `dsTheme(mode)` maps the palette onto antd's seed and map
tokens (primary = accent, info = lapis, success = in, links = ink, checkbox/radio/switch = ink) and sets component tokens
(menu, buttons, inputs, select, date picker, tabs, table, tags, cards, drawer, modal, tooltip, notification…).
`dsConfig` adds what tokens cannot: floating side sheets without a scrim, centred compact dialogs, filled pill tags,
arrowless tooltips, glass notifications. Prefer antd v6 props (`Drawer size`, `destroyOnHidden`, `Alert title`,
`Tag variant`). Override antd in `ds-antd.css` (`@layer components`), never with `!important` unless antd sets inline
transition values (the sheet timing).
