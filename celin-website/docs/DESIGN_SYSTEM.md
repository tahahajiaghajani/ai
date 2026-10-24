# CELIN — design system (for developers)

**Immersive, architectural luxury.** Rich layered colour (porcelain and bone grounds lit by champagne and blush, espresso and cocoa nights, the deep paraiba teal of the studio photos, the logo's copper as a living metal), the **round arch** of Spanish courtyards as the signature frame, a classical Persian voice in **Nazli** — the free twin of Nazanin, the very face of the «گالری اعتماد» line of the logo — and cinematic motion (smooth scroll, unveiling arches, rising words, live glints on the stones, flowing silk light). Persian first (RTL), English second. The brand's own story and lines are in `src/content/copy/story.ts` — use them, never invent claims (no "handmade/by hand" beyond the logo's "Handmade Jewelry" line).

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

Alternate light and dark bands down a page (e.g. espresso hero → bone → cocoa → porcelain → paraiba → …); let neighbouring bands melt into each other instead of meeting at a hard edge. Melts (utilities in `globals.css`, raw stops live there): `bg-dawn` (a band whose top row is plain night and whose light rises from below as one wide arch through cocoa, mocha, sand and bone — the home statement under the hero), `bg-dusk` (porcelain → night-2 over a short strip; `rotate-180` for night-2 → light), `bg-tide` (night-teal → porcelain). Give the dark side of a seam a plain edge (fade the Aura / mesh to the base colour there) so the two rows match exactly. Never a moving ribbon (marquee) between bands.

## Type

**Persian is Nazli everywhere on the public site.** The owner asked for the face of «گالری اعتماد» in the logo; that line is set in Nazanin Bold, and **Nazli** (Sharif FarsiWeb, **GPL-2+**, from Debian `fonts-farsiweb`) is its free twin, glyph for glyph. Our web cut (`src/fonts/`, loaded by `next/font/local` in `src/lib/fonts.ts`, variable `--font-fa`) has 400 and 700 only, holds no Latin letters or digits (Latin falls through to Jost / Bodoni Moda), is scaled ×1.12 in the em so it sits at the optical size of the Latin faces, and has tight centred vertical metrics (no 1.5em line gap), so text centres in buttons and diacritic-free lines never touch at line-height ≥ 1.2. On Persian pages (`html[lang=fa]`) Nazli leads the `sans` / `ui` / `display` stacks, so its space, punctuation and « » set the rhythm. Keep `src/fonts/LICENSE` and `README.md` with the files; never relabel the licence.

| Class / token | Font | Use |
|---|---|---|
| `display` | Bodoni Moda 400 (Latin) + **Nazli 700** (Persian) | home-page headings and display lines; Persian line-height ≥ 1.3 |
| `font-sans` (default body) | Jost (Latin) + **Nazli 400** | running text (body 16px / 1.95) |
| `font-ui` | Jost + **Nazli** | buttons, fields, labels, menus (buttons/inputs/labels get it automatically) |
| `font-dense` | Jost + **Vazirmatn** | dense numeric tables only (`table` gets it automatically): order lists, admin tables — tabular figures |
| `font-persian` | Nazli only | a Persian line that must not fall back to Latin metrics |
| `label` | Jost / Nazli | small eyebrows: Latin uppercase + tracking; Persian plain (never letter-spaced). Colour with `text-gold-text!` / `text-gold-on-dark!` |
| `font-label` + `ltr` | Jost | Latin codes, "PRO", SKUs, tracked Latin signatures |

**The quiet scale (every page except the home page).** The owner found the inner pages' type far too large; luxury is restraint. Inner pages use only these utilities (they carry family, weight, size and leading; no ad-hoc `text-4xl…8xl` or `clamp()` sizes there):

| Utility | Persian | Use |
|---|---|---|
| `title-page` | Nazli 700 · 30 → 42px · 1.45 | page hero titles (`HouseHero`, shop, collections, product, 404) |
| `title-section` | Nazli 700 · 22 → 30px · 1.55 | section titles (`SectionHead` default; pass `display` only on the home page) |
| `title-card` | Nazli 700 · 18 → 21px · 1.6 | card, tile and list titles |
| `title-quote` | Nazli 400 · 21 → 28px · 1.9 | one editorial sentence set large and light (the year of birth, the craft chapter, a collection's story) |
| `lede` | 17px · 2.05 (Latin 16 → 17px · 1.75) | the paragraph under a title |
| `numeral` | Nazli 700 · 34 → 50px · 1.15 | ordinals and years beside text («۰۱»، «۱۳۸۵»), usually `text-metal` |
| `title-mark` | Nazli 700 · 46 → 72px · 1.25 | one word or number as the mark of a band («۲۰»، «۴۰۴»، رودیوم · طلا، the footer line) |

The home page keeps its large display scale (hero, `SectionHead display`, the statement, «۲۰»).

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
| `.fx-parallax`, `.fx-drift`, `.fx-arrive` | CSS scroll-driven (compositor only): a picture drifting inside its frame / a layer drifting slower (`--drift` > 0) or faster (`--drift` < 0) than the page / a block rising softly out of the band above as it arrives. No JS; off with reduced motion; static where unsupported |
| `Sparkles` | glints detected on the bright facets of the parent's `<img>` (any uploaded photo) |
| `Aura palette="espresso|paraiba|cocoa|porcelain"` | WebGL silk light behind a band (CSS mesh fallback) |
| `Reel` | pinned horizontal row on desktop (reading direction), swipe row on touch |
| `Magnetic` | main CTA leans to the pointer |
| `Cursor` | copper glint; `data-cursor="view"` (+ `data-cursor-label`) opens a disc over pictures; `data-tone="light"` on dark bands |
| `Intro` | first home visit of a session: monogram + curtain (pure CSS) |
| `.fx-sheen` | light sweep across a picture on hover |
| `.fx-aperture` + `--open` | arch window that opens (GSAP scrubs `--open` 0→1) |

Rules: LCP picture eager (`priority`), no motion that blocks reading, ≤ 3 WebGL canvases per page, every effect must leave the content readable without JS.

## Layout and components

- `container-lux` (max 1440px, gutters 16/32/56px). Section rhythm `py-20 sm:py-28/32`. Every page hero may sit under the transparent header: give the band `data-header="dark"` and `-mt-[var(--header-h)]` (+ top padding) and the header turns light over it.
- `SectionHead` (`src/components/home/sections.tsx`): diamond eyebrow → Nazli title (rising words, `title-section`; `display` prop = the home page's large scale) → optional link.
- Home statement (`Statement`): under the hero, the night melts into porcelain (`bg-dawn`) while an asymmetric collage straddles the turn — a tall arch with ring and keystone (`home.statement`) and a smaller matted arch at another scale overlapping its lower corner (`home.statement.b`), at three drift speeds — beside the three lines (Nazli 700, the middle one in living metal) signed with the monogram. Phones: collage above, pictures stay large.
- «۲۰» (`Anniversary`): every digit in the polished copper of the rhombus zero (`--metal-rhombus`, stops `--rhombus-1…4`), never a photo inside the numeral.
- Buttons (`src/app/buttons.css`, components layer — utilities on the same element still win): `btn btn-metal` (main action, any ground: layered champagne–copper, engraved inner rule, the highlight travels on hover), `btn btn-ink` (espresso, inset champagne hairline, a light sweep), `btn btn-line` (light grounds: hairline with copper corner ticks that close into a frame on hover), `btn btn-line-light` (dark grounds, glass); sizes `btn-sm` 40px · default 48px · `btn-lg` 52px; text actions `btn-link` (rule rises to the word, arrow follows the reading direction; `btn-link-ink`, `btn-link-light`, `btn-link-plain` without arrow). States: `disabled` (a hairline outline), `aria-busy` + `<span class="btn-spinner">` (or `BusyLabel` in `account/ui.tsx`), pressed, a double focus ring (champagne inside `[data-tone="light"]` dark bands). English labels are tracked capitals; never letter-space Persian. Wrap the main CTA in `<Magnetic>`.
- Pro pieces (`src/app/pro.css`): `ProSeal` (small arch seal) and `ProHallmark` (round engraved seal; glows and turns inside `[data-pro-state="ok"]`) in `pro/seal.tsx`; `LuxFrame` (`ui/lux-frame.tsx`, double metal rule, corner rhombi, optional keystone); `ArchDoor` (`ui/arch-door.tsx`, an arch-shaped panel, `tone="night"` for the Pro salon); `CodeInput` (12 cells in three groups of four over one real input, `tone="night"`), `ProCodeCeremony`, `ProSteps` (request → approval → code → prices).
- Fields (`TextField` / `inputCls` in `src/components/account/ui.tsx`): label visible (`text-sm text-ink-2`), input 52px, 16px text (no zoom on iOS), `border-control`, a soft copper ring on focus, help `text-xs text-muted`, error `text-xs text-danger` with an icon; form-level notes `FormNote`.
- `Picture` for every image (accurate `sizes`, `priority` only for the LCP picture); `Overlay` for dialogs/sheets; `Icon`; Pro layer (`useMe`, `usePriceBook`, `PriceSlot`, `ProBar` — **the Pro bar stays above every product grid**), cart store, `ProductCard`, `ShopGrid`.
- The product card cover and the product page hero share `<ViewTransition name={`product-${id}`} share="morph" default="none">`.

## Copy

Persian first, warm and confident (the client's own voice in `story.ts`): «فراتر از یک زیور»، «امضایی از ظرافت، کیفیت و اصالت»، «با سلین همچون جواهر بدرخشید»، «۲۰ سال درخشش». Materials: نگین‌های درخشان با تراش اتمی، مخراج‌کاری دقیق، آبکاری رودیوم و طلا. **Never name the stone material** (the owner's rule: no «کیوبیک زیرکونیا» / «زیرکونیا» / cubic zirconia anywhere — copy, specs, metadata, search terms); say «نگین»، «نگین‌های درخشان»، colour and cut. **Never use the word «رواق»** (say «مجموعه‌های سلین»). Use «رودیوم» (never «رادیوم») and «مجموعه» (never «کالکشن»). No exclamation marks. «Pro» stays Latin. Locked price: «قیمت ویژه‌ی اعضای Pro». Copy files: `src/content/copy/*.ts` (`fa` / `en`, same shape).
