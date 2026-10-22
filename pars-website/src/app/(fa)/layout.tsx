import type { Metadata, Viewport } from "next";
import { Sora, Vazirmatn } from "next/font/google";
import { Document } from "@/components/site/document";
import { siteMetadata, siteViewport } from "@/lib/seo";
import "../globals.css";

// only the Arabic-script subset is preloaded; Latin glyphs load on demand (unicode-range)
const vazir = Vazirmatn({ subsets: ["arabic"], variable: "--font-vazir", display: "swap" });
const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap", preload: false });

export const metadata: Metadata = siteMetadata("fa");
export const viewport: Viewport = siteViewport;

export default function FaRoot({ children }: { children: React.ReactNode }) {
  return (
    <Document lang="fa" fonts={`${vazir.variable} ${sora.variable}`}>
      {children}
    </Document>
  );
}
