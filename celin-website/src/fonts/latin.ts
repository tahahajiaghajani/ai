import { Bodoni_Moda, Jost, Vazirmatn } from "next/font/google";

/**
 * The Latin faces and Vazirmatn, shared by both languages (src/lib/fonts.ts has the full notes). A module of their own
 * so the English layout can use them without importing the preloaded Persian Nazli instance.
 */
export const vazirmatn = Vazirmatn({ subsets: ["arabic"], variable: "--font-fa-ui", display: "swap", adjustFontFallback: false, preload: false });

export const bodoni = Bodoni_Moda({ subsets: ["latin"], axes: ["opsz"], variable: "--font-latin-display", display: "swap", adjustFontFallback: false });
export const jost = Jost({ subsets: ["latin"], variable: "--font-latin-ui", display: "swap", adjustFontFallback: false });

export const LATIN_VARS = `${vazirmatn.variable} ${bodoni.variable} ${jost.variable}`;
