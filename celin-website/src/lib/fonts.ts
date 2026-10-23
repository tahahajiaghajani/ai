import { Bodoni_Moda, Jost, Noto_Naskh_Arabic, Vazirmatn } from "next/font/google";

/**
 * Self-hosted by next/font (no request to Google from the visitor's browser — important in Iran):
 * - Noto Naskh Arabic (variable 400–700) — the Persian voice of the brand: a classical Naskh close to the
 *   «گالری اعتماد» line of the logo. Headings at 600–700, running text at 500.
 * - Vazirmatn (variable) — small Persian UI only: buttons, labels, forms, tables, prices (tabular figures).
 * - Bodoni Moda (optical sizes) — Latin display, a Didone like the CELIN wordmark.
 * - Jost — Latin labels, UI and English running text, close to the logo's tracked "Handmade Jewelry" line.
 * The Latin faces get no metric-adjusted fallback: a local-Arial fallback has Arabic glyphs and would catch
 * Persian letters and digits before the Persian faces do.
 */
export const naskh = Noto_Naskh_Arabic({ subsets: ["arabic"], variable: "--font-fa-naskh", display: "swap", adjustFontFallback: false, fallback: ["Vazirmatn", "Tahoma", "serif"] });

export const vazirmatn = Vazirmatn({ subsets: ["arabic"], variable: "--font-fa-ui", display: "swap", adjustFontFallback: false, fallback: ["Tahoma", "system-ui", "sans-serif"] });

export const bodoni = Bodoni_Moda({ subsets: ["latin"], axes: ["opsz"], variable: "--font-latin-display", display: "swap", adjustFontFallback: false });
export const jost = Jost({ subsets: ["latin"], variable: "--font-latin-ui", display: "swap", adjustFontFallback: false });

export const FONT_VARS = `${naskh.variable} ${vazirmatn.variable} ${bodoni.variable} ${jost.variable}`;
