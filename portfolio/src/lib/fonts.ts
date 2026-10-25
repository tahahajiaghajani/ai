import { Instrument_Serif, Inter_Tight, JetBrains_Mono, Vazirmatn } from "next/font/google";

// one instance per family: both root layouts share one CSS chunk, and a second instance with the same faces would
// declare them twice under another URL (the later one wins, so its preload is wasted). Inter Tight gets no Arial
// fallback face, which would otherwise catch Persian glyphs in Latin-first stacks before Vazirmatn.
export const vazir = Vazirmatn({ subsets: ["arabic"], variable: "--font-fa", display: "swap" });
export const inter = Inter_Tight({ subsets: ["latin"], variable: "--font-latin", display: "swap", adjustFontFallback: false });
export const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif-latin", display: "swap", preload: false });
export const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-latin", display: "swap", preload: false });
