import localFont from "next/font/local";
import { LATIN_VARS } from "@/fonts/latin";

/**
 * The same Nazli for the English pages, not preloaded: there it only sets the odd Persian word (the language
 * switch, a Persian name), so the browser fetches a weight only when a Persian glyph is actually on the page
 * instead of downloading both before the hero. (A module of its own: next/font preloads every face defined in a module the layout imports.)
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

/** English pages: the Latin faces preloaded, Nazli fetched only when a Persian glyph is on the page. */
export const FONT_VARS_EN = `${nazli.variable} ${LATIN_VARS}`;
