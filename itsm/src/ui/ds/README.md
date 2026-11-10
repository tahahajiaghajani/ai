# Design system «ds» in `src/ui` — v2.0 «کاریز»

The visual foundation of «کاریز» / Kariz: tokens, the Ant Design 6 theme, motion, icons, illustrations and the brand
surface. **Read [`docs/DESIGN_SYSTEM.md`](../../../docs/DESIGN_SYSTEM.md) before restyling a screen**; the brand book
(name, logo rules, colour meaning, voice and tone) is [`docs/BRAND_FA.md`](../../../docs/BRAND_FA.md). The living style
guide is in the app: Settings → «راهنمای طراحی» (`settings/style-guide`). Token names stay brand-neutral (`--ds-*`,
`ds-*` classes, `fonts/ds/`).

## Files

| File | What it is |
|---|---|
| `ds/tokens.css` | The source of truth (`--ds-*`): fonts, brand scales (firuzeh, lajvard, zaferan) and gradients, type, spacing, radii, density, motion, role aliases, light and dark themes (two identical dark blocks), preference overrides, print and base primitives (§8, `@layer base`). |
| `ds/ds-palette.ts` | GENERATED from `tokens.css` (`npm run tokens`): the hex/rgba palette antd reads. Never edit by hand. |
| `ds/ds-theme.ts` | `dsTheme(mode)` and `dsConfig(mode)`: the antd 6 theme and `ConfigProvider` props. |
| `ds/ds-antd.css` | What antd tokens cannot express (focus ring, 3:1 field edge, number columns, totals rule, selected row bar, sheet timing, press). `@layer components`. |
| `ds/motion.css` | Motion classes (below), optimistic-update states, the celebration layer. |
| `ds/brand.css` | The brand surface of login, onboarding and About: `.ds-brand`, `.ds-brand-in`, `.ds-tagline`, `.ds-horizon`, `.ds-en`, `.ds-story`, `.ds-bfoot` (the kariz night). |
| `ds/icons.tsx` | `Icon`, `DirIcon` + `DIRECTIONAL` (logical directional icons), `NuqtaSpark`. |
| `ds/illustrations.tsx` | `Illustration` + `ILLUSTRATIONS` (empty, search, done, offline, locked, error, welcome). |
| `ds/celebrate.ts` | `celebrate(el)` for milestones. |
| `../index.html` | The inline `@layer` order statement (must stay first in `<head>`), the pre-paint theme, the boot mark. |
| `../styles.css` | Tailwind, the imports above and the `@theme inline` bridge. |
| `@shared/brand` | The logo drawing, brand colours and SVG builders (also used by `scripts/brand-assets.mts`). |
| `@shared/color` | Colour maths: parse, composite, WCAG contrast, OKLCH, colour-blind ΔE. |
| `../lib/theme.tsx`, `../lib/motion.ts`, `../lib/fa.ts` | `ThemeProvider`/`useTheme()`; `useReducedMotion`, `cssDuration`, `stagger`, `useCountUp`; Persian figures and dates. |
| `../components/brand.tsx` | `<BrandMark/>`, `<Wordmark/>`, `<Logo/>`, `<BrandTile/>`. |
| `../static/fonts/ds/` | Arad (text and titles, unmodified, Reserved Font Name «Arad»), DS Num (every digit: a digit-only subset of Vazirmatn), Geist and Geist Mono, the `print/` static set and the OFL licences. The only font source; Arad and DS Num are preloaded. |

## Theme

- `useTheme()` returns `{ pref, mode, setPref, dark, toggle }`; `pref` is stored in `localStorage["itsm.theme"]` (the
  pre-paint script in `index.html` reads the same key). `<html data-theme>` and `<meta name="theme-color">` follow
  `mode`; in the Windows app the preload reports it to the main process.
- antd runs inside `<StyleProvider layer>`; `ds-antd.css` and Tailwind utilities beat it without `!important`.
- Toasts bottom-left, at most 3; `message` one at a time; drawers are floating sheets without a scrim; modals centred;
  tags filled pills; tooltips without arrows.

## Tailwind bridge

All follow the theme, so never add `dark:` variants.

| Kind | Utilities |
|---|---|
| Surfaces | `bg-canvas`, `bg-surface`, `bg-raised`, `bg-sunken`, `bg-well` |
| Text | `text-ink`, `text-ink-2`, `text-ink-3`, `text-ink-4` (disabled only) |
| Lines | `border-line`, `border-line-2`, `border-line-3`, `border-control-strong` |
| Accent (turquoise) | `bg-accent`, `hover:bg-accent-hover`, `text-accent-text`, `text-on-accent`, `bg-accent-tint`, `bg-accent-tint-2`, `bg-accent-bar`, `border-accent-border`, `bg-accent-line` |
| Semantic | `text-in`/`text-success`, `bg-in-tint`, `text-danger`, `bg-danger-tint`, `text-warning`, `bg-warning-fill`, `bg-warning-tint`, `text-info`, `bg-info-tint`, `bg-info-fill`, `bg-neutral-tint`, `text-holiday` |
| AI and sea | `text-ai`, `text-ai-text`, `bg-ai-tint`; `text-sea-text`, `bg-sea-tint`, `bg-sea` |
| States, priorities | `text-state-{new,progress,hold,resolved,closed,cancelled}(-text)`, `bg-state-*-tint`; `text-p1…p5(-text)`, `bg-p1…p5-tint` |
| Named hues, charts, logo | `bg-hue-*`/`text-hue-*`, `bg-chart-1…8`, `text-brand-arch`, `text-brand-nuqta` |
| Fonts | `font-sans`, `font-display`, `font-latin`, `font-mono`; weights `font-normal` 450, `font-medium` 540, `font-semibold` 600 |
| Shape, motion | `rounded-xs` … `rounded-xl`, `rounded-pill`; `shadow-e1` … `shadow-e4`; `ease-out`, `ease-in-out`, `ease-sheet` |

## Classes

| Group | Classes |
|---|---|
| Type | `.ds-t-display`, `.ds-t-page`, `.ds-t-section`, `.ds-t-title`, `.ds-t-body`, `.ds-t-dense`, `.ds-t-label`, `.ds-t-caption`, `.ds-t-paragraph`, `.ds-t-hero`, `.ds-t-figure`, `.ds-display` |
| Numbers and bidi | `.ds-num` (tabular, nowrap), `.ds-id` (Latin identifiers), `.ds-ltr`, `.ds-latin`, `.ds-mono`, `.ds-end`, `.ds-dec`, `.ds-unit`, `.ds-excluded`, `.ds-sr` |
| Links, status, icons | `.ds-link`, `.ds-nuqta` (`data-live`), `.ds-pulse`, `.ds-holiday`, `.ds-icon-dir` |
| Chips (kit) | `.ds-chip` with `data-tone`, `data-state`, `data-p` |
| antd hooks | `.ds-code`, `rootClassName="ds-instant"`, `rootClassName="ds-glass"` |
| Motion | `.ds-enter`, `.ds-stagger`, `.ds-fade`, `.ds-pop`, `.ds-press`, `.ds-launch` (+ `.ds-arch`, `.ds-nq`), `[data-pending]`, `.ds-flash` |
| Brand | `.ds-mark-color` |

Under `prefers-reduced-motion`, `data-motion="reduced"` or `data-power="low"`, motion keeps only its opacity fade and
`.ds-launch` does not play.

## Rules for restyling a screen

1. **Tokens only.** Bridge utilities or `var(--ds-*)`; never raw hex or `dark:` variants.
2. **The accent is rare.** Turquoise only for the primary action, focus, the selected-state indicator and the main
   chart series, at most once per region. Links are ink (`.ds-link`); checkbox, radio and switch are ink.
3. **Colour is never alone.** States, priorities and SLA always carry a word; use `StateChip`, `PriorityChip`, `Chip`.
4. **Numbers.** Digits are DS Num everywhere; `.ds-num` in columns; never ellipsize a number; signed numbers in `.ds-ltr`;
   Latin identifiers in `.ds-id`.
5. **Type.** Never the `font` shorthand. `.ds-t-*` classes or longhands; Persian text ≥ 12 px; weights from
   `--ds-weight-*`.
6. **Bidi and icons.** An element with its own direction is a bare isolate with no margin; directional icons through
   `DirIcon`; never `:dir()` in CSS (the minifier rewrites it as `:lang()`), use `[dir]`.
7. **Density.** Long lists compact (`size="small"`, 32 px rows); the home page comfortable.
8. **Status is the exception.** The normal state is plain `text-ink-3`; never warnings on an amber surface.
9. **Motion.** Transform and opacity only, never `transition: all`, no loops but the sync nuqta; `celebrate()` only for
   milestones.
10. **Check your work.** Light and dark at 1440 × 900 and a phone at 375 px (`node scripts/ui-shots.mjs`); keep
    `npm run typecheck` and `tests/design-system.test.ts` green.
