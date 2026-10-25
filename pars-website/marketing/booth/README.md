# Exhibition booth — pop-up, roll-ups, counters

Print files for the Pars Project Management exhibition booth, in Persian (RTL). Each artboard is one HTML page at its real size in centimetres, with generated vector art, printed to PDF by Chromium. Nothing here is part of the website build; this folder has its own `package.json`.

## Items

| Item | File size (cm) | Layout | Copies |
|---|---|---|---|
| Pop-up | 361 × 230 | return 35 · face 291 · return 35; face panel seams at 107.75, 180.5 and 253.25 (4 × 72.75) | 1 |
| Roll-up 1 — systems and AI | 95 × 210 | 85 × 200 trim + 5 cm bleed on all sides | 1 |
| Roll-up 2 — training, consulting, deployment | 95 × 210 | as roll-up 1 | 1 |
| Counter | 214 × 90 | side 72 · front 70 · side 72 | 2, the same file |
| Test strip | 60 × 45 | colours, threads, smallest text and a QR smaller than any on the booth | 1, printed first |

Every item comes in two styles and two modes:

- **minimal**: the logo, the slogan «جایی که مدیریت و هوش به هم می‌رسند.» and the address.
- **detailed**: services, the four steps of an agent, numbers, clients, a QR and contact details. The roll-ups carry the services.
- **dark**: a deep navy field. **light**: mist.

The pop-up and counter files have no extra bleed, because their sizes are the frame sizes. The art runs past every edge, so a version with bleed is a small change if a print shop asks for one.

## Concept

The logo's two silk streams, violet for organisational experience and magenta for intelligence, meet at one glowing point. This is the slogan drawn. On the pop-up they meet beside the headline. The two roll-ups mirror each other: roll-up 1 stands on the right and its streams flow in from the right edge, while roll-up 2 stands on the left and its streams flow in from the left. On the counters the streams wrap around both sides and meet under the front. Copy and facts match the website (`src/content/fa.ts`), the brand book and the brochure.

## Build

```bash
cd pars-website/marketing/booth
npm install
CHROME_PATH=/path/to/chrome npm run booth      # or a Chromium installed for Playwright
node render.mjs popup counter --jpg            # some items only; --jpg adds full-size JPEGs
node build.mjs https://parspmi.ir              # another address (QR and printed URL), then render again
npm run mockup                                 # booth mockups from the previews
```

`out/` gets:

- `print/pars-<item>-<style>-<mode>-<w>x<h>cm.pdf`: the print files at their exact size, with TrimBox and BleedBox set and fonts embedded.
- `proof/`: the same with guides (returns, panel seams, trim, safe areas, the roll-up foot).
- `preview/`: PNGs 2400 px on the long side, rasterized from the print PDFs.
- `jpg/`: full-size RGB JPEGs, with `--jpg`.
- `mockup/`: a 3/4 view of the whole booth for each style and mode.

The render fails if an asset fails to load, a block overflows, a gradient word wraps, or a QR stops decoding to the site address.

Print instructions for the print shop are in Persian in [`PRINT_FA.md`](PRINT_FA.md). The files are RGB, and the RIP converts them with the profile of the actual media.

## Files

- `src/booth.html`: fonts, colour tokens per mode and the component styles.
- `src/items.js`: sizes, all copy and the layout of every item, in centimetres. Edit text here.
- `src/art.js`: the background, glows, dot grid and silk ribbons, measured from the laid-out page. It shrinks `.fit` headlines to one line each, turns gradient words into SVG text (CSS `background-clip: text` leaves hairline boxes in some PDF viewers) and draws the `?guides` overlay.
- `src/icons.js`: the site's line icons.
- `src/mockup.html` and `mockup.mjs`: the booth mockups, built in CSS 3D at real proportions from the previews.
- `build.mjs`: copies the logo and client logos from `public/` and static font files from `@fontsource`, and draws the QR code (error correction Q, 4-module quiet zone, solid dark modules on white).
- `render.mjs`: the PDFs, previews, JPEGs and checks. `pdf-lib` crops each page to its exact size, because Chromium sizes PDF pages in 0.01 in steps, and gives every embedded font subset its own name.

Rules the layout keeps:

- Important pop-up content stays in the upper 140 cm, because counters may hide the lower part.
- Nothing sits on a counter fold, and nothing sits in the lowest 13 cm of a roll-up, which the foot hides.
- No booth text is set below 1.7 cm. The smallest is the counter's service details, which are read from close by. The test strip's labels are smaller, because they are read up close.
- Threads are 0.7–2.5 mm wide.
- The dot grid is drawn as real circles, not a PDF tiling pattern, which some RIPs rasterize coarsely.
