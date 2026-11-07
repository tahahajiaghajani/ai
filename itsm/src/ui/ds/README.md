# Design system «ds» in `src/ui`

The visual foundation of the app: tokens, the Ant Design 6 theme, motion and the brand surface. The product's brand is
chosen later; until then the mark is a neutral placeholder monogram (`components/brand.tsx`) and the names here stay
brand-neutral (`--ds-*` tokens, `ds-*` classes, `fonts/ds/`). Read this before restyling a screen.

## Files

| File | What it is |
|---|---|
| `ds/tokens.css` | The source of truth (`--ds-*`): fonts (`/fonts/ds/`), the Dusk scale, type, spacing, radii, density, motion, light and dark themes, preference overrides, print and base primitives (§8, `@layer base`). |
| `ds/ds-palette.ts` | The hex/rgba palette that antd reads, mirrored from `tokens.css` (antd parses hex/rgb only). Change both together. |
| `ds/ds-theme.ts` | `dsTheme(mode)` and `dsConfig(mode)`: the antd 6 theme and `ConfigProvider` props. |
| `ds/ds-antd.css` | What antd tokens cannot express (focus ring, 3:1 field edge, number columns, totals rule, selected row bar, sheet timing). `@layer components`. |
| `ds/motion.css` | Reusable motion classes (below). |
| `ds/brand.css` | The Dusk brand surface of login, onboarding and About: `.ds-brand`, `.ds-brand-in`, `.ds-tagline`, `.ds-horizon`, `.ds-en`, `.ds-story`, `.ds-bfoot`. |
| `../styles.css` | The layer order, Tailwind, the imports above and the `@theme inline` bridge. |
| `../lib/theme.tsx` | `ThemeProvider` and `useTheme()`. |
| `../lib/fa.ts` | Persian figures and dates: `fa`, `signed`, `docNo`, `pct`, `compact`, `parseAmount`, `jDate`/`jLong`/`jTime`…, and search (`normalizeFa`, `matchesFa`). |
| `../lib/motion.ts` | `useReducedMotion`, `prefersReducedMotion`, `cssDuration`, `stagger(i)`, `useCountUp`. |
| `../components/brand.tsx` | `<BrandMark/>`, `<Wordmark/>`, `<Logo/>` and `<BrandTile/>` (the placeholder monogram). |
| `../static/fonts/ds/` | Arad (text and titles, unmodified, Reserved Font Name «Arad»), DS Num (every digit: a digit-only subset of Vazirmatn, renamed), Geist and Geist Mono (variable), the `print/` static set, and the OFL licences (`OFL-*.txt`, listed in «راهنما»). These files are the only font source; Arad and DS Num are preloaded in `index.html`. |

## Theme

- `useTheme()` returns `{ pref, mode, setPref, dark, toggle }`.
  - `pref` is `"system" | "light" | "dark"`, stored in `localStorage["itsm.theme"]` (the pre-paint script in `index.html` reads the same key).
  - `mode` is the theme in effect. `<html data-theme>` and `<meta name="theme-color">` follow it; in the Windows app the preload reports it to the main process (title bar, window canvas).
- antd runs inside `<StyleProvider layer>`, so its CSS sits in the `antd` layer. `ds-antd.css` and Tailwind utilities beat it without `!important`.
- Toasts appear bottom-left, at most 3 at a time. `message` shows one at a time. Use `notification` for confirmations.
- Global antd defaults from `dsConfig`: drawers are floating sheets with no scrim, modals are centred, tags are filled pills, tooltips have no arrow.

## Tailwind (bridge)

All of these follow the theme, so never add `dark:` variants.

| Kind | Utilities |
|---|---|
| Surfaces | `bg-canvas`, `bg-surface`, `bg-raised`, `bg-sunken`, `bg-well` |
| Text | `text-ink`, `text-ink-2`, `text-ink-3`, `text-ink-4` (disabled only) |
| Lines | `border-line`, `border-line-2`, `border-line-3`, `border-control-strong` |
| Accent | `bg-accent`, `hover:bg-accent-hover`, `text-accent-text`, `bg-accent-tint`, `bg-accent-tint-2`, `bg-accent-bar` |
| Semantic | `text-in`, `bg-in-tint`, `text-danger`, `bg-danger-tint`, `text-warning`, `bg-warning-fill`, `bg-warning-tint`, `bg-neutral-tint`, `text-holiday` |
| Second material | `text-sea-text`, `bg-sea-tint` (a module's own accent, sparingly) |
| Fonts | `font-sans` (Arad UI + DS Num digits + Geist Latin), `font-display` (Arad at its own proportions, titles), `font-latin` (Geist), `font-mono` (Geist Mono). Weights `font-normal` 450, `font-medium` 540, `font-semibold` 600 (400/500/700 in print) |
| Shape | `rounded-xs` … `rounded-xl`; `shadow-e1` … `shadow-e4`; `ease-out`, `ease-in-out` |

## Classes

From `tokens.css` §8 and the files above.

| Group | Classes |
|---|---|
| Type | `.ds-t-display`, `.ds-t-page`, `.ds-t-section` (Arad, DSTY 3), `.ds-t-title`, `.ds-t-body`, `.ds-t-dense`, `.ds-t-label`, `.ds-t-caption`, `.ds-t-paragraph`, `.ds-t-hero`, `.ds-t-figure`, `.ds-display` |
| Numbers and bidi | `.ds-num` (tabular, nowrap), `.ds-ltr`, `.ds-latin`, `.ds-mono`, `.ds-end`, `.ds-dec`, `.ds-unit`, `.ds-excluded`, `.ds-sr` |
| Links and status | `.ds-link`, `.ds-nuqta` (`data-live`), `.ds-pulse`, `.ds-holiday` |
| antd hooks | `.ds-code` (code inputs), `rootClassName="ds-instant"` (a sheet opened from the keyboard), `rootClassName="ds-glass"` (a floating menu) |
| Motion | `.ds-enter` (opacity + 8 px rise; `style={stagger(i)}` for a hand-built stagger), `.ds-stagger` (its first 6 children enter 30 ms apart), `.ds-fade`, `.ds-pop` (scale .96 → 1), `.ds-press` (scale .98 while pressed), `.ds-launch` + `.ds-nq` (the mark's parts set in one after another: login and the boot screen only) |
| Brand | `.ds-mark-color` (the accent on paper, warm white on charcoal) |

Under `prefers-reduced-motion` or `data-motion="reduced"`, the motion classes keep only their opacity fade, and `.ds-launch` does not play.

## Components

- `<BrandMark size variant="color|mono|white" title launch/>` draws the placeholder monogram alone. Sizes 16, 32 and 64 use the pixel cut.
- `<Wordmark size tone="ink|white|current" latin/>` writes `APP_NAME` (or `APP_NAME_EN` with `latin`): a Latin name in Geist 600 at −0.025 em, a Persian one in Arad with DSTY 3.
- `<Logo size tone="ink|white" compact latin launch/>` is the lockup: the mark at the start, the name beside it. `compact` shows the mark alone.
- `<BrandTile size/>` is the white mark on the app icon's gradient (organisation switcher, About, the home page).
- The same monogram is rasterised into every icon by `desktop/scripts/make-icons.cjs` (favicons, PWA icons, the Windows icon, tray and installer art). Change both together.
- `useCountUp(target)` is **only for counts and percentages**; tables never animate numbers.
- Icons: `lucide-react` (1.59.0) at `size={16} strokeWidth={1.4} absoluteStrokeWidth`, coloured `text-ink-3`, `text-ink` when active.
- The product's name comes only from `@shared/constants`: `APP_NAME`, `APP_NAME_EN`, `APP_TAGLINE`, `APP_TAGLINE_EN`, `APP_DESCRIPTION`. Never hard-code it (`index.html` and `manifest.webmanifest` are filled from them by `vite.config.ts`).

## Rules for restyling a screen

1. **Use tokens only.** The bridge utilities or `var(--ds-*)`; never raw hex or `dark:` variants.
2. **Keep Dusk rare.** Only for the primary action, focus, the selected-state indicator and the main chart series, at most once per region. Links are ink (`.ds-link`). Checkbox, radio and switch are ink.
3. **Numbers.** Digits are drawn by DS Num in every stack; use `.ds-num` (tabular) in columns. Arad never draws a number. Never ellipsize a number. Put signed numbers in `.ds-ltr`.
4. **Type.** Never use the `font` shorthand (it resets `ss01`, DSTY and tabular figures). Use the `.ds-t-*` classes or longhands. Persian text is at least 12 px. Use the weight tokens `--ds-weight-regular` (450), `--ds-weight-medium` (540) and `--ds-weight-strong` (600).
5. **Bidi.** An element with its own direction is a bare isolate with no margin. Put spacing on an RTL wrapper (`.ds-end`).
6. **Density.** Long lists default to compact (`size="small"`, 32 px rows). The home page is comfortable.
7. **Status is the exception.** The normal state is plain `text-ink-3` text. Chips are for pending, failed or overdue, and draft. Never show warnings on an amber surface.
8. **Motion.** Animate only transform and opacity. Never `transition: all`. No loops except the sync nuqta.
9. **Check your work.** Light and dark at 1440 × 900 and a phone at 375 px (`node scripts/ui-shots.mjs`); keep `npm run typecheck` green.
