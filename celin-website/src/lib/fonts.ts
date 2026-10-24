import { Bodoni_Moda, Jost, Vazirmatn } from "next/font/google";
import localFont from "next/font/local";

/**
 * Self-hosted by next/font (no request to Google or anyone else from the visitor's browser — important in Iran):
 * - Nazli 400 / 700 (Sharif FarsiWeb, GPL-2+; src/fonts/README.md) — the Persian voice of the whole public site:
 *   the free twin of Nazanin, the face of the «گالری اعتماد» line of the logo. Headings 700, running text 400.
 *   Our web cut is scaled ×1.12 in the em and has tight, centred vertical metrics; it holds no Latin letters or
 *   digits, so Latin text falls through to Jost / Bodoni Moda. `unicode-range` = the subset's own coverage. Its
 *   middle dot «·» is redrawn as a short bar (the original is the shape of the Persian zero «۰»; src/fonts/README.md),
 *   so separators in names and eyebrows never read as a zero.
 * - Vazirmatn (variable) — only the admin panel and dense numeric tables (tabular figures).
 * - Bodoni Moda (optical sizes) — Latin display, a Didone like the CELIN wordmark.
 * - Jost — Latin labels, UI and English running text, close to the logo's tracked "Handmade Jewelry" line.
 * No metric-adjusted fallbacks: a local-Arial fallback has Arabic glyphs and would catch Persian letters and digits
 * before the Persian face does (the Persian system fallbacks sit at the end of the stacks in globals.css).
 */
export const nazli = localFont({
  src: [
    { path: "../fonts/nazli.woff2", weight: "400", style: "normal" },
    { path: "../fonts/nazlib.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-fa",
  display: "swap",
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0020-002F, U+003A-0040, U+005B-0060, U+007B-007E, U+00A0, U+00AB, U+00B7, U+00BB, U+00D7, U+0600-06FF, U+200C-2010, U+2022, U+2026, U+FB50-FDFF, U+FE70-FEFF",
    },
  ],
});

export const vazirmatn = Vazirmatn({ subsets: ["arabic"], variable: "--font-fa-ui", display: "swap", adjustFontFallback: false, preload: false });

export const bodoni = Bodoni_Moda({ subsets: ["latin"], axes: ["opsz"], variable: "--font-latin-display", display: "swap", adjustFontFallback: false });
export const jost = Jost({ subsets: ["latin"], variable: "--font-latin-ui", display: "swap", adjustFontFallback: false });

export const FONT_VARS = `${nazli.variable} ${vazirmatn.variable} ${bodoni.variable} ${jost.variable}`;
