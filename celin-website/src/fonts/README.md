# Nazli — the Persian face of the CELIN site

`nazli.woff2` (400) and `nazlib.woff2` (700) are a web cut of **Nazli** and **Nazli Bold** by **Sharif FarsiWeb Inc.**
(© 2003–2004 Sharif FarsiWeb Inc.; Latin parts © 1999 (URW)++ Design & Development). Nazli is the free twin of the
classic Persian typeface Nazanin — the face of the «گالری اعتماد» line of the CELIN logo — and matches it glyph for glyph.

## License

**GNU General Public License, version 2 or (at your option) any later version (GPL-2+)** — the full text is in
[`LICENSE`](./LICENSE). This is the licence stated by Debian for these files (`Files: *`, `License: GPL-2+`) and by
the fonts themselves («You may freely change and/or redistribute this font under the GNU General Public License»).
It is not an OFL or proprietary licence; do not relabel it. Keep `LICENSE` and this file next to the fonts.

## Source

Debian package `fonts-farsiweb` **0.4.dfsg-14** (`/usr/share/fonts/truetype/farsiweb/nazli.ttf`, `nazlib.ttf`;
upstream: Sharif FarsiWeb Inc., https://persian-computing.org/archives/Sharif-FarsiWeb-Inc/Persian_fonts.html).

| file | sha256 of the original TTF |
|---|---|
| `nazli.ttf` | `c3babb334b0d1c4f2d342fb77db9d057e841abbfa0072ca16d2016b97c2911b0` |
| `nazlib.ttf` | `1b058b7a2ec0760e95e9a9b603eb4bec998bfa902fa8973f885d5aaccb2fde17` |

## Changes made (October 2026, for the CELIN website)

The version string (name ID 5) of each file carries the note «CELIN web cut 2026-10 …». Made with fontTools 4.67:

1. **Scaled ×1.12 inside the same 2048-unit em** (`scale_upem(font, 2294)`, then `unitsPerEm = 2048`): Nazli's
   letters are ~11% smaller on the em than the Latin faces (Jost, Bodoni Moda) beside them; this is CSS
   `size-adjust: 112%` baked into the file (Safari ignores the metric-override descriptors).
2. **Subset** (`pyftsubset`-equivalent `fontTools.subset`, all layout features and scripts kept, hinting dropped,
   all names kept): the space and ASCII punctuation, U+00A0 U+00AB U+00B7 U+00BB U+00D7, the whole Arabic block
   U+0600–06FF (letters, harakat, kashida ـ, Persian digits ۰–۹, ، ؛ ؟ ٪ ٫ ٬), U+200C–2010 (ZWNJ, ZWJ, LRM, RLM,
   hyphen), U+2022, U+2026 and the presentation forms U+FB50–FDFF, U+FE70–FEFF. The Latin letters and digits are
   removed so Latin text falls through to the Latin faces. The same list is the `unicode-range` in `src/lib/fonts.ts`.
3. **Vertical metrics replaced** (originally ascent 1960 / descent 1114 for 400 and 2126 / 1188 for 700, i.e. a
   1.5em-tall line box that sat the text low): one shared set for both weights — `hhea` = `OS/2` typo = win =
   ascent **1740** / descent **920**, line gap 0, `USE_TYPO_METRICS` on (OS/2 version 4). The box is centred on the
   letters, so buttons and lines centre Persian text exactly; diacritic-free lines do not touch at line-height ≥ 1.2.
4. Saved as WOFF2.

To rebuild: take the two TTFs from the Debian package and repeat steps 1–4 (scale 1.12, the code points above,
metrics 1740/920).
