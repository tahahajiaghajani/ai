# Siraf design system in `src/ui`

The foundation of the «سیراف» redesign. The specs live in the brand package (`components.md`, `antd-theme.md`, `preview.html`); this file says what is wired into the app and the rules for restyling a screen.

## Files

| File | What it is |
|---|---|
| `siraf/tokens.css` | The source of truth (`--sf-*`): fonts (`/fonts/siraf/`), brand scales, type, spacing, radii, density, motion, light and dark themes, preference overrides, print, and base primitives. **Do not edit by hand.** Change it in the brand package, run `check-tokens.mjs` and `antd-palette.mjs`, then copy it here again (fix the font URLs to `/fonts/siraf/`). |
| `siraf/siraf-palette.ts` | Generated from `tokens.css`: the hex/rgba palette that antd reads. Do not edit. |
| `siraf/siraf-theme.ts` | `sirafTheme(mode)` and `sirafConfig(mode)`: the antd 6 theme and `ConfigProvider` props (verbatim from the brand package). |
| `siraf/siraf-antd.css` | What antd tokens cannot express (focus ring, 3:1 field edge, money columns, totals rule, selected row bar, sheet timing, and more). `@layer components`. |
| `siraf/motion.css` | Reusable motion classes (below). |
| `siraf/brand.css` | The Dusk brand surface for login, onboarding and About: `.sf-brand`, `.sf-brand-in`, `.sf-tagline`, `.sf-horizon`, `.sf-en`, `.sf-story`, `.sf-bfoot`. |
| `../styles.css` | The layer order, Tailwind, the imports above, the `@theme inline` bridge, and the legacy aliases. |
| `../lib/theme.tsx` | `ThemeProvider` and `useTheme()`. |
| `../lib/fa.ts` | Persian figures and dates: `fa`, `grams`, `signed`, `accounting`, `balance`, `docNo`, `pct`, `compact`, `splitDecimals`, `parseAmount`, `jDate`/`jLong`/`jTime`…, and search (`normalizeFa`, `matchesFa`). The app's existing `@shared/format` keeps working; prefer `fa.ts` on restyled screens. |
| `../lib/motion.ts` | `useReducedMotion`, `prefersReducedMotion`, `cssDuration`, `stagger(i)`, `useCountUp`. |
| `../components/brand.tsx` | `<SirafMark/>`, `<Wordmark/>`, `<Logo/>` and `<SirafTile/>`. |
| `../static/fonts/siraf/` | Vazirmatn, Arad, Geist and Geist Mono (variable), the `print/` static set, and the OFL licences. These files are the only font source. Vazirmatn and Arad are preloaded in `index.html`. |

## Theme

- `useTheme()` returns `{ pref, mode, setPref, dark, toggle }`.
  - `pref` is `"system" | "light" | "dark"`, stored in `localStorage["siraf.theme"]`. The old key `taraz.theme` is moved over once, both in the pre-paint script in `index.html` and in the provider.
  - `mode` is the theme in effect. `<html data-theme>` and `<meta name="theme-color">` follow it.
- antd runs inside `<StyleProvider layer>`, so its CSS sits in the `antd` layer. `siraf-antd.css` and Tailwind utilities beat it without `!important`.
- Toasts appear bottom-left, at most 3 at a time. `message` shows one at a time. Use `notification` for confirmations.
- Global antd defaults from `sirafConfig`:
  - Drawers are floating sheets with no scrim (`mask: false`).
  - Modals are centred.
  - Tags are filled pills.
  - Tooltips have no arrow.

## Tailwind (bridge)

All of these follow the theme, so never add `dark:` variants.

| Kind | Utilities |
|---|---|
| Surfaces | `bg-canvas`, `bg-surface`, `bg-raised`, `bg-sunken`, `bg-well` |
| Text | `text-ink`, `text-ink-2`, `text-ink-3`, `text-ink-4` (disabled only) |
| Lines | `border-line`, `border-line-2`, `border-line-3`, `border-control-strong` |
| Accent | `bg-accent`, `hover:bg-accent-hover`, `text-accent-text`, `bg-accent-tint`, `bg-accent-tint-2`, `bg-accent-bar` |
| Semantic | `text-in`, `bg-in-tint`, `text-danger`, `bg-danger-tint`, `text-warning`, `bg-warning-fill`, `bg-warning-tint`, `bg-neutral-tint`, `text-holiday` |
| Modules | `text-gold-text`, `bg-gold`, `bg-gold-tint`, `border-gold-line` (inside «طلا» only); `text-sea-text`, `bg-sea-tint` (inside «صرافی» only) |
| Fonts | `font-sans` (Vazirmatn), `font-display` (Arad, 16 px or more, never numbers), `font-latin` (Geist), `font-mono` (Geist Mono) |
| Shape | `rounded-xs`, `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-xl`; `shadow-e1`, `shadow-e2`, `shadow-e3`, `shadow-e4`; `ease-out`, `ease-in-out` |

## Classes

These come from `tokens.css` §8 and the files above.

| Group | Classes |
|---|---|
| Type | `.sf-t-display`, `.sf-t-page`, `.sf-t-section` (Arad, DSTY 3), `.sf-t-title`, `.sf-t-body`, `.sf-t-dense`, `.sf-t-label`, `.sf-t-caption`, `.sf-t-paragraph`, `.sf-t-hero`, `.sf-t-figure`, `.sf-display` |
| Numbers and bidi | `.sf-num` (tabular, nowrap), `.sf-ltr`, `.sf-latin`, `.sf-mono`, `.sf-end`, `.sf-dec`, `.sf-unit`, `.sf-excluded`, `.sf-sr` |
| Links and status | `.sf-link`, `.sf-nuqta` (`data-live`), `.sf-pulse`, `.sf-holiday` |
| antd hooks | `.sf-code` (code inputs), `rootClassName="sf-instant"` (a sheet opened from the keyboard), `rootClassName="sf-glass"` (a floating menu) |
| Motion | `.sf-enter` (opacity + 8 px rise; set `style={stagger(i)}` for a hand-built stagger), `.sf-stagger` (its first 6 children enter 30 ms apart), `.sf-fade`, `.sf-pop` (scale .96 → 1), `.sf-press` (scale .98 while pressed), `.sf-launch` + `.sf-nq` (the nuqtas set beside the alef: login, splash and the boot screen only) |
| Brand | `.sf-mark-color` (Dusk on paper, warm white on charcoal) |

Under `prefers-reduced-motion` or `data-motion="reduced"`, the motion classes keep only their opacity fade, and `.sf-launch` does not play.

## Components

- `<SirafMark size variant="color|mono|white" title launch/>` draws the mark alone.
  - Sizes 16, 24, 32 and 48 use the hand-pixelled cuts.
  - `color` is Dusk on paper and warm white in dark. `mono` is `currentColor`. `white` is for the Dusk gradient.
- `<Wordmark size tone="ink|white|current" latin/>` renders «سیراف» in Arad 760 with DSTY 3. With `latin`, it renders "Siraf" in Geist 600 at −0.025 em.
- `<Logo size tone="ink|white" compact latin launch/>` is the RTL lockup: the mark at the start, on a shared baseline, in the proportions of `lockup-fa.svg`.
  - `size` is the wordmark's font size.
  - `compact` shows the mark alone.
  - `layout.tsx`'s old `Logo({collapsed, light})` now renders it.
- `<SirafTile size/>` is the white mark on the app icon's gradient, for the business switcher and About.
- `useCountUp(target)` is **only for counts and percentages**. Never use it for money, weights or rates: they never count through amounts that did not exist (components.md §3.1). Use the rolling digits of the hero instead. Tables never animate numbers.
- Icons: use `lucide-react` (1.59.0) at `size={16} strokeWidth={1.4} absoluteStrokeWidth`, coloured `text-ink-3`, and `text-ink` when active. The icon names are in components.md §0.5. `@ant-design/icons` stays until each screen moves.
- Brand constants live in `@shared/constants`:
  - `APP_NAME` (سیراف) and `APP_NAME_EN` (Siraf);
  - `APP_TAGLINE` and `APP_TAGLINE_EN`;
  - `APP_LINES`;
  - `APP_DESCRIPTION`.

  Never hard-code the name. «تراز» stays only in its accounting senses: تراز آزمایشی، ترازنامه، تراز افتتاحیه، سند تراز است…

## Legacy aliases (remove when every screen is migrated)

`styles.css` keeps today's names working in the new palette. Each one is marked `LEGACY` there.

| Legacy | Now | Use instead |
|---|---|---|
| `--tz-bg`, `--tz-surface`, `--tz-surface-2` | canvas, surface, sunken | `--sf-canvas`, `--sf-surface`, `--sf-sunken` |
| `--tz-line`, `--tz-line-strong` | line, line-3 | `--sf-line`, `--sf-line-3` |
| `--tz-text`, `--tz-muted` | text, text-3 | `--sf-text`, `--sf-text-3` (or `--sf-text-2`) |
| `--tz-primary`, `--tz-primary-soft` | accent-text, accent-tint | `--sf-accent-text` / `--sf-accent`, `--sf-accent-tint` |
| `--tz-gold`, `--tz-gold-soft` | gold-text, gold-tint | `--sf-gold-text`, `--sf-gold-tint` |
| `--tz-success`, `--tz-danger`, `--tz-warning` | in, danger, warning | `--sf-in`, `--sf-danger`, `--sf-warning` |
| `--tz-shadow` | e1 | `--sf-shadow-e1` |
| `--tz-sidebar`, `--tz-sidebar-2`, `--tz-sidebar-text`, `--tz-sidebar-active` | warm charcoal | the canvas sidebar (components.md §1.2) |
| `bg-bg`, `bg-surface-2`, `border-line-strong` | | `bg-canvas`, `bg-sunken`, `border-line-3` |
| `text-muted` | | `text-ink-3` (labels, meta) or `text-ink-2` (secondary body) |
| `text-brand`, `bg-brand`, `border-brand`, `bg-brand-soft` | | `text-accent-text`, `bg-accent`, `border-accent-text`, `bg-accent-tint` (and keep Dusk rare: one per region) |
| `text-gold`, `bg-gold-soft` | | `text-gold-text`, `bg-gold-tint` |
| `text-ok`, `text-bad`, `text-warn` | | `text-in`, `text-danger`, `text-warning` |
| `.num`, `.ltr` | | `.sf-num`, `.sf-ltr` |
| `.tz-card`, `.tz-soft` | e1 card / sunken box | `bg-surface rounded-lg shadow-e1`, `bg-sunken rounded-lg` |
| `.tz-kbd` | Geist key cap | (keep as the kbd style or move it to a component) |
| `.tz-neg`, `.tz-pos` | danger, in | money out is ink, never red (components.md §0.4) |
| `.tz-table` + `.row-level-1`, `.row-level-2`, `.row-muted` | unfilled headers, sunken level rows, text-3 rows | antd `Table` with the theme; `size="small"` on ledgers and lists |
| `.tz-grid` | unfilled header, line-3 totals | the editable grid in components.md §4.10 |
| antd `Menu theme="dark"` tokens in `theme.tsx` (`legacyDarkMenu`) | warm ink menu on the legacy sidebar | the light menu on the canvas sidebar |

Hard-coded colours that the aliases cannot reach. Move them to `--sf-chart-*` or `--sf-*` when the screen is restyled:

- the Recharts fills in `modules/dashboard/Dashboard.tsx`, `modules/goods/SalesReports.tsx` and `modules/fx/Positions.tsx`;
- `modules/fx/shared.tsx` (the crypto violet);
- the print sheets in `modules/gold/Invoice.tsx`, `modules/gold/Labels.tsx` and `modules/treasury/PrintSlip.tsx`;
- `modules/fx/RatesBoard.tsx`.

## Rules for restyling a screen

1. **Use tokens only.** Use the bridge utilities or `var(--sf-*)`. Never use raw hex, `dark:` variants or new `--tz-*` / legacy utilities.
2. **Keep Dusk rare.** Use it only for the primary action, focus, the selected-state indicator and the main chart series, and at most once per region. Links are ink (`.sf-link`). Checkbox, radio and switch are ink.
3. **Write numbers to the rules.** Use Vazirmatn with `.sf-num` (tabular). Never use Arad for numbers. Never ellipsize money; give money columns 136 px or more (128 px compact). Render with `fa.ts`: document numbers with `docNo()`, ledgers with `balance()`. Put signed numbers in `.sf-ltr`.
4. **Type.** Never use the `font` shorthand, because it resets `ss01` (Persian digits), DSTY and tabular figures. Use the `.sf-t-*` classes or longhands. Persian text is at least 12 px; values are at least 13 px. Use weights 400, 500 and 600 (440 for the hero only).
5. **Bidi.** An element with its own direction is a bare isolate with no margin. Put spacing on an RTL wrapper (`.sf-end`).
6. **Density.** Ledgers and lists default to compact (`size="small"`, 32 px rows). The dashboard is comfortable.
7. **Status is the exception.** The normal state is plain `text-ink-3` text. Chips are only for pending, bounced or overdue, and draft. Never show warnings on an amber surface, because amber belongs to gold.
8. **Motion.** Animate only transform and opacity. Never use `transition: all`. Use no loops except the sync nuqta, and nothing on lists used dozens of times an hour.
9. **Gold and sea materials** appear only inside «طلا» and «صرافی».
10. **Remove legacy names.** When a screen no longer uses a legacy name, remove that usage. When nothing uses an alias any more, delete it from `styles.css` and from the table above.
11. **Check your work.** Check each rebuilt screen in light and dark at 1440 × 900. Run `scripts/check-preview.cjs <url>` from the brand package. Keep `npx tsc --noEmit -p tsconfig.json` green.
