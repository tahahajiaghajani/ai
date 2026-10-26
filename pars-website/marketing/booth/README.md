# Exhibition booth — pop-up, roll-ups, counters

Print files for the Pars Project Management exhibition booth, in Persian (RTL). Each artboard is one HTML page at its real size in centimetres, with generated vector art, printed to PDF by Chromium. Nothing here is part of the website build; this folder has its own `package.json`.

## Items

| Item | File size (cm) | Layout | Copies |
|---|---|---|---|
| Pop-up | 291 × 230 | 35 · face 221 · 35; face panel seams at 108.67 and 182.33 (3 × 73.67) | 1 |
| Roll-up 1 — systems and AI | 95 × 210 | 85 × 200 trim + 5 cm bleed on all sides | 1 |
| Roll-up 2 — training, consulting, deployment | 95 × 210 | as roll-up 1 | 1 |
| Counter | 214 × 90 | side 72 · front 70 · side 72 | 2, the same file |
| Test strip | 60 × 45 | colours, threads, faint tints and small text | 1, printed first (optional) |

**The chosen set** for the booth is dark: the minimal pop-up, the minimal counter and the detailed roll-ups (`npm run final`). The pop-up has that one design. The detailed pop-up was laid out for an earlier 361 cm, four-panel frame and was retired with it. The roll-ups and counters can still be rendered in both styles, and every item in both modes:

- **minimal**: the logo with the Persian name «مدیریت پروژه پارس», the slogan «جایی که مدیریت و هوش به هم می‌رسند.» and the contact details. The roll-ups also list their services by name.
- **detailed**: services, numbers, the path of working together (roll-up 2) and the contact details. The roll-ups carry the services.
- **dark**: a deep navy field. **light**: mist.

The contact details are the site (parspmi.ir), the e-mail (info@parspmi.ir) and the two phone numbers (`COPY` and `REACH` in `items.js`). The boards carry no QR code. On the pop-up each of the three sits in one of the three face panels, so no seam crosses it.

The pop-up's 35 cm at each side wraps round the frame or is trimmed off, so it carries only art and the small marks. The pop-up and counter files have no further bleed, because their sizes are the frame sizes. The art runs past every edge, so a version with bleed is a small change if a print shop asks for one.

## Concept

The logo's two silk streams, violet for organisational experience and magenta for intelligence, meet at one glowing point. This is the slogan drawn.

- **Pop-up:** the streams meet beside the slogan. The joined stream runs down between the phones and the e-mail and sweeps to the right as a broad silk across the lower part, which the counters may hide.
- **Roll-ups:** roll-up 1 stands on the right of the booth and roll-up 2 on the left, and their art enters from the outer edge. On the minimal pair, roll-up 1's streams meet, while roll-up 2's two streams rise side by side with five glowing nodes. The detailed pair has a silk band down the outer edge.
- **Counters:** the streams wrap around both sides and meet under the front. Copy and facts match the website (`src/content/fa.ts`), the brand book and the brochure.

## Build

Requirements: Node 20 or later, poppler-utils (`pdftoppm`) and ImageMagick (`convert`). Chromium comes from `CHROME_PATH`, or from `npx playwright-core install chromium`.

```bash
cd pars-website/marketing/booth
npm install
CHROME_PATH=/path/to/chrome npm run final      # the chosen set (dark) with its JPEGs and the mockup
CHROME_PATH=/path/to/chrome npm run booth      # every item, style and mode, with JPEGs and mockups
node render.mjs popup counter                  # some items only; add --jpg for their full-size JPEGs, --final for the chosen set
node build.mjs https://example.ir && npm run booth   # another site address (the default is https://parspmi.ir)
```

A render without `--jpg` deletes the JPEG of every file it renders, so `out/jpg` never holds an older design or address.

`out/` gets:

- `print/pars-<item>-<style>-<mode>-<w>x<h>cm.pdf`: the print files at their exact size, with TrimBox and BleedBox set and fonts embedded.
- `proof/`: the same with guides (the pop-up's 35 cm sides, panel seams, counter folds, trim, safe areas, the top of the counters on the pop-up, the roll-up foot).
- `preview/`: PNGs 2400 px on the long side, rasterized from the print PDFs.
- `jpg/`: full-size RGB JPEGs, with `--jpg`.
- `mockup/`: a 3/4 view of the whole booth for each style and mode.

The render fails if:

- an asset fails to load, or a gradient word wraps;
- a block overflows or leaves the safe area;
- a number, contact item, step or hairline sits on a pop-up seam or a counter fold;
- an edge of the print differs from the art beside it (a blank sliver).

The safe areas are `window.SAFE` in `items.js`, and the proof draws the same areas in green:

- pop-up: the face from x 43 to 248 and y 10 to 140, the top of the counters;
- roll-up: x 10 to 85 and y 10 to 190, above the foot;
- counter: x 3 to 211 and y 4 to 82.

A print file gets its final name only after every check passes. The previous outputs of the file are removed first, so a failed render never leaves an old file under the new name.

Print instructions for the print shop are in Persian in [`PRINT_FA.md`](PRINT_FA.md). The files are RGB, and the RIP converts them with the profile of the actual media.

## Files

- `src/booth.html`: fonts, colour tokens per mode and the component styles.
- `src/items.js`: sizes, all copy and the layout of every item, in centimetres. Edit text here.
- `src/art.js`: the background, glows, dot grid and silk ribbons, measured from the laid-out page. It shrinks `.fit` headlines to one line each, turns gradient words into SVG text (CSS `background-clip: text` leaves hairline boxes in some PDF viewers) and draws the `?guides` overlay.
- `src/icons.js`: the site's line icons.
- `src/mockup.html` and `mockup.mjs`: the booth mockups, built in CSS 3D at real proportions from the previews.
- `build.mjs`: copies the logo from `public/` and static font files from `@fontsource`, and writes `out/site.js` with the site address the boards print.
- `render.mjs`: the PDFs, previews, JPEGs and checks. `pdf-lib` crops each page to its exact size, because Chromium sizes PDF pages in 0.01 in steps, and gives every embedded font subset its own name.

Rules the layout keeps:

- Pop-up content stays in the upper 140 cm, because counters may hide the lower part. Contact items and hairlines keep off the panel seams; only the slogan, the line under it and the art cross them.
- Nothing sits on a counter fold, and nothing sits in the lowest 13 cm of a roll-up, which the foot hides.
- No booth text is set below 1.7 cm. The smallest is the counter's service details, which are read from close by. The test strip's labels are smaller, because they are read up close.
- Threads are 0.7–2.6 mm wide. The test strip prints the finest and the widest at the boards' opacity.
- The dot grid is drawn as real circles, not a PDF tiling pattern, which some RIPs rasterize coarsely.
