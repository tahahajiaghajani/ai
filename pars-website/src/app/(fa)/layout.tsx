import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Sora } from "next/font/google";
import { Document } from "@/components/site/document";
import { siteMetadata, siteViewport } from "@/lib/seo";
import "../globals.css";

// IBM Plex Sans Arabic in three weights (light text, medium headings, semibold emphasis);
// only the Arabic-script subset is preloaded, Latin glyphs load on demand (unicode-range)
const fa = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], weight: ["300", "500", "600"], variable: "--font-fa", display: "swap" });
// no "Sora Fallback" face (local Arial): it would also catch the Persian digits meant for the Persian face
const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap", preload: false, adjustFontFallback: false });

export const metadata: Metadata = siteMetadata("fa");
export const viewport: Viewport = siteViewport;

export default function FaRoot({ children }: { children: React.ReactNode }) {
  return (
    <Document lang="fa" fonts={`${fa.variable} ${sora.variable}`}>
      {children}
    </Document>
  );
}
