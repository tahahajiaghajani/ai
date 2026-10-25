import { Instrument_Serif, Inter_Tight, JetBrains_Mono, Vazirmatn } from "next/font/google";

// both root layouts share one CSS chunk: each preloads only the faces its first screen needs
export const vazirFa = Vazirmatn({ subsets: ["arabic"], variable: "--font-fa", display: "swap", preload: true });
export const vazirEn = Vazirmatn({ subsets: ["arabic"], variable: "--font-fa", display: "swap", preload: false });
export const interFa = Inter_Tight({ subsets: ["latin"], variable: "--font-latin", display: "swap", preload: false, adjustFontFallback: false });
export const interEn = Inter_Tight({ subsets: ["latin"], variable: "--font-latin", display: "swap", preload: true });
export const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif-latin", display: "swap", preload: false });
export const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-latin", display: "swap", preload: false });
