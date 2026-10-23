# Exhibition brochure — tri-fold

The Pars Project Management exhibition brochure: a Persian (RTL) roll-fold on A4 landscape, built as one HTML page with generated vector art and printed to PDF with Chromium. Nothing here is part of the website build; this folder has its own `package.json`.

## Concept

The brochure reads like a conversation with the site's AI assistant: each panel opens with a visitor's question and answers it, and the back hands the conversation over to the site («نوبت سؤال شماست») through the QR code. The logo's two streams — violet for organisational experience, magenta for intelligence — leave the QR on the back, wrap around the spine and meet at one point on the cover: the tagline drawn.

## Layout

A4 landscape, 297 × 210 mm trim, 3 mm bleed (pages are 303 × 216 mm). Persian opens to the right, so the fold-in flap is the right-hand panel on the outside and the left-hand panel on the inside.

| Page | Left | Middle | Right |
|---|---|---|---|
| 1 · outside | front cover (100 mm) | back, QR · «۰۵» (100 mm) | fold-in flap, clients · «۰۲» (97 mm) |
| 2 · inside | fold-in flap, services and path · «۰۴» (97 mm) | AI agents · «۰۳» (100 mm) | cover inner, who we are · «۰۱» (100 mm) |

Folds on the outside are 100 and 200 mm from the left trim; on the inside 97 and 197 mm. Page 2 is printed on the back of page 1 turned over its vertical axis (the cover backs «۰۱»).

## Build

```bash
cd pars-website/marketing/brochure
npm install
CHROME_PATH=/path/to/chrome npm run brochure     # or a Chromium installed for Playwright
npm run build -- https://parspmi.ir              # another address (QR and printed URL)
```

`out/` gets the print PDF (`pars-brochure-print.pdf`), a proof with crop and fold marks (`pars-brochure-print-marks.pdf`), 300-dpi spreads and panels, and a 3D mockup. The render fails if any panel overflows or the QR stops decoding at print or phone-like resolutions.

## Files

- `brochure.html` — layout and every word of copy; edit text here. Facts must match the website's content (`src/content/fa.ts`) and the brand book.
- `art.js` — the ribbons, diagram connectors and cover notes, measured from the laid-out page in millimetres; also turns the gradient words into SVG text (CSS `background-clip: text` leaves hairline boxes in some PDF viewers).
- `build.mjs` — copies the logo and client logos from `public/` and draws the QR code (error correction H, 4-module quiet zone, the Pars mark in the middle).
- `render.mjs` — PDF, PNGs, mockup and checks.
