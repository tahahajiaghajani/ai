# CELIN — design system (for developers)

**Immersive, architectural luxury.** Rich layered colour (porcelain and bone grounds lit by champagne and blush, espresso and cocoa nights, the deep paraiba teal of the studio photos, the logo's copper as a living metal), the **round arch** of Spanish courtyards as the signature frame, a bold classical **Naskh** voice close to the «گالری اعتماد» line of the logo, and cinematic motion (smooth scroll, unveiling arches, rising words, live glints on the stones, flowing silk light). Persian first (RTL), English second. The brand's own story and lines are in `src/content/copy/story.ts` — use them, never invent claims (no "handmade/by hand" beyond the logo's "Handmade Jewelry" line).

## Tokens (`src/app/globals.css`, Tailwind v4 `@theme`) — never raw hex in components

| Role | Utilities / vars |
|---|---|
| Light grounds | `bg-ground` #FAF6EF, `bg-porcelain`, `bg-bone`, `bg-bone-2`, `bg-tile`, `bg-sand`, `bg-champagne(-2)`, `bg-blush` |
| Dark grounds | `bg-night` (espresso), `bg-night-2` (cocoa), `bg-night-3`, `bg-cocoa`, `bg-mocha`, `bg-night-teal`, `bg-paraiba(-2)`; text `text-on-night`, `text-on-night-muted`, lines `border-night-line` |
| Mesh grounds (layered light, use these instead of flat fills) | `bg-mesh-porcelain`, `bg-mesh-bone`, `bg-mesh-espresso`, `bg-mesh-paraiba`, `bg-mesh-cocoa` (vars `--mesh-*`) |
| Copper (logo) | `text-gold`, `text-gold-text` (small text), `text-gold-deep`, `text-gold-bright`, `text-gold-glow`, `text-gold-on-dark`, `bg-gold-soft`, `bg-gold-mist` |
| Living metal | `text-metal` (copper, light grounds), `text-metal-light` (champagne, dark grounds), add `metal-live` for the slow sheen; `bg-metal` filled copper; vars `--metal-copper`, `--metal-champagne`, `--metal-rose`, `--metal-silver`, `--metal-fill`. Large text only (≥ 24px). |
| Ink | `text-ink` (warm espresso), `text-ink-2`, `text-muted`, `text-faint` (decor only), `border-line`, `border-line-strong`, `border-control` (fields) |
| Accents | `paraiba-glow` (teal light), `pomegranate(-2)` (a drop of red, ruby photos) |
| States | `text-success/warning/danger` + `bg-*-soft` |
| Texture | `<Grain/>` (film grain over a band), `glass` / `glass-dark` (floating bars), `frame-metal` (1px gradient border), `hairline` / `hairline-light` |

Alternate light and dark bands down a page (e.g. espresso hero → bone → cocoa → porcelain → paraiba → …); let neighbouring bands melt into each other with a short gradient instead of a hard edge.

## Type

| Class | Font | Use |
|---|---|---|
| `display` | Bodoni Moda (Latin) + **Noto Naskh Arabic 600** (Persian) | all headings; add `font-bold` (700) for big display lines; Persian line-height ≥ 1.35 |
| `font-sans` (default body) | Jost (Latin) + Noto Naskh Arabic **500** | running text, `text-lg leading-9`/`leading-10` for editorial paragraphs |
| `font-ui` | Jost + **Vazirmatn** | buttons, fields, labels, tables, prices, admin and dense account screens (buttons/inputs/labels/tables get it automatically) |
| `label` | Jost / Vazirmatn | small eyebrows: Latin uppercase + tracking; Persian plain (never letter-spaced). Colour with `text-gold-text!` / `text-gold-on-dark!` |
| `font-label` + `ltr` | Jost | Latin codes, "PRO", SKUs, tracked Latin signatures |

Rules: Persian digits on fa pages (`num`, `formatPrice`, `formatDate`); Latin snippets in `ltr`; never letter-space Persian; kashida (ـ) only in a signature line, with an `aria-label` holding the plain text.

## The arch (signature)

- `arch` utility = semicircle top at any width (`border-radius: 100vmax 100vmax 0 0`); `arch-full` = pill.
- `<Arch media … />` (`src/components/fx/arch.tsx`) for editorial pictures: `ring="copper|champagne"` (hairline arch outside), `keystone` (copper rhombus at the crown), `unveil` (fills from the crown on scroll), `parallax={n}` (drifts inside the frame), `sparkle` (live glints), `ratio` (default 3/4).
- `<ArchLines count tone />` concentric hairline arches on one sill (depth / arcade decor; draws itself in).
- Use arches for editorial pictures, collection and category tiles, featured product rows (`ProductCard variant="arch"`), page heroes; keep the plain 4:5 tile for dense product grids if a grid gets heavy. One sill (a champagne/copper hairline) under a row of arches reads as architecture.

## Motion and effects (`src/components/fx/*`, all honour reduced motion and the footer toggle)

| Piece | What |
|---|---|
| `SmoothScroll` (in `SiteChrome`) | Lenis + GSAP ScrollTrigger on one ticker; mouse/trackpad only; pauses while an `<Overlay>` is open; dialogs and `[data-lenis-prevent]` scroll natively |
| `useGsap(fn, ref, deps)` | scoped GSAP context, reverted on unmount; skipped with reduced motion. Use `gsap.matchMedia()` for desktop-only pins |
| `SplitWords` | headings whose **words** rise from a mask (never letters); `immediate` for heroes (pure CSS, waits for the intro); `wordClassName` for metal text |
| `data-reveal` (+ `style={{"--d": i}}`) | fade + rise on scroll; `--reveal-base` adds a base delay |
| `data-fx` + `.fx-unveil` / `.fx-draw` | trigger attributes set by `RevealObserver` (`data-fx="now"` = play at first paint) |
| `.fx-parallax`, `.fx-drift`, `.fx-pan` | CSS scroll-driven (compositor only) parallax / drift / photo inside letters |
| `Sparkles` | glints detected on the bright facets of the parent's `<img>` (any uploaded photo) |
| `Aura palette="espresso|paraiba|cocoa|porcelain"` | WebGL silk light behind a band (CSS mesh fallback) |
| `Reel` | pinned horizontal row on desktop (reading direction), swipe row on touch |
| `Marquee` | endless ribbon (pauses on hover) |
| `Magnetic` | main CTA leans to the pointer |
| `Cursor` | copper glint; `data-cursor="view"` (+ `data-cursor-label`) opens a disc over pictures; `data-tone="light"` on dark bands |
| `Intro` | first home visit of a session: monogram + curtain (pure CSS) |
| `.fx-sheen` | light sweep across a picture on hover |
| `.fx-aperture` + `--open` | arch window that opens (GSAP scrubs `--open` 0→1) |

Rules: LCP picture eager (`priority`), no motion that blocks reading, ≤ 3 WebGL canvases per page, every effect must leave the content readable without JS.

## Layout and components

- `container-lux` (max 1440px, gutters 16/32/56px). Section rhythm `py-20 sm:py-28/32`. Every page hero may sit under the transparent header: give the band `data-header="dark"` and `-mt-[var(--header-h)]` (+ top padding) and the header turns light over it.
- `SectionHead` (`src/components/home/sections.tsx`): diamond eyebrow → big Naskh title (rising words) → optional link.
- Buttons (utilities): `btn btn-metal` (main action, any ground), `btn btn-ink`, `btn btn-line` (light grounds), `btn btn-line-light` (dark grounds); wrap the main CTA in `<Magnetic>`.
- Fields: label visible (`text-sm text-ink-2`), input `h-12 w-full border border-control bg-white px-4 outline-none focus:border-gold`, help `text-xs text-muted`, error `text-xs text-danger`.
- `Picture` for every image (accurate `sizes`, `priority` only for the LCP picture); `Overlay` for dialogs/sheets; `Icon`; Pro layer (`useMe`, `usePriceBook`, `PriceSlot`, `ProBar` — **the Pro bar stays above every product grid**), cart store, `ProductCard`, `ShopGrid`.
- The product card cover and the product page hero share `<ViewTransition name={`product-${id}`} share="morph" default="none">`.

## Copy

Persian first, warm and confident (the client's own voice in `story.ts`): «فراتر از یک زیور»، «امضایی از ظرافت، کیفیت و اصالت»، «با سلین همچون جواهر بدرخشید»، «۲۰ سال درخشش». Materials: نگین کیوبیک زیرکونیا (تراش اتمی)، مخراج‌کاری دقیق، آبکاری رودیوم و طلا. Use «رودیوم» (never «رادیوم») and «مجموعه» (never «کالکشن»). No exclamation marks. «Pro» stays Latin. Locked price: «قیمت ویژه‌ی اعضای Pro». Copy files: `src/content/copy/*.ts` (`fa` / `en`, same shape).
