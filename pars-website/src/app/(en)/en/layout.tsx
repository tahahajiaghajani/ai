import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Inter, Sora } from "next/font/google";
import { Document } from "@/components/site/document";
import { siteMetadata, siteViewport } from "@/lib/seo";
import "../../globals.css";

// both root layouts share one CSS chunk, so preloading here would also preload on Persian pages
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap", preload: false });
const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap", preload: false });
const fa = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], weight: ["300", "500", "600"], variable: "--font-fa", display: "swap", preload: false });

export const metadata: Metadata = siteMetadata("en");
export const viewport: Viewport = siteViewport;

export default function EnRoot({ children }: { children: React.ReactNode }) {
  return (
    <Document lang="en" fonts={`${inter.variable} ${sora.variable} ${fa.variable}`}>
      {children}
    </Document>
  );
}
