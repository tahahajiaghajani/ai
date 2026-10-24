import localFont from "next/font/local";
import { LATIN_VARS } from "@/fonts/latin";

/**
 * Nazli again, not preloaded: for the English pages, where it only sets the odd Persian word (the language switch, a
 * Persian name), and for the global 404 and error pages. next/font preloads every face defined in a module that a
 * root layout — or global-not-found / global-error, which Next counts for every route — imports, so these must not
 * import src/lib/fonts.ts (the preloaded instance of the Persian pages). The browser fetches a weight here only when
 * a Persian glyph is on the page.
 */
export const nazli = localFont({
  src: [
    { path: "./nazli.woff2", weight: "400", style: "normal" },
    { path: "./nazlib.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-fa",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0020-002F, U+003A-0040, U+005B-0060, U+007B-007E, U+00A0, U+00AB, U+00B7, U+00BB, U+00D7, U+0600-06FF, U+200C-2010, U+2022, U+2026, U+FB50-FDFF, U+FE70-FEFF",
    },
  ],
});

/** English pages and the global 404 / error pages: the Latin faces preloaded, Nazli fetched on demand. */
export const FONT_VARS_LAZY = `${nazli.variable} ${LATIN_VARS}`;
