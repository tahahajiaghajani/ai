import type { Metadata, Viewport } from "next";
import { Inter, Sora, Vazirmatn } from "next/font/google";
import { Document } from "@/components/site/document";
import { siteMetadata, siteViewport } from "@/lib/seo";
import "../../globals.css";

// both root layouts share one CSS chunk, so preloading here would also preload on Persian pages
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap", preload: false });
const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap", preload: false });
const vazir = Vazirmatn({ subsets: ["arabic"], variable: "--font-vazir", display: "swap", preload: false });

export const metadata: Metadata = siteMetadata("en");
export const viewport: Viewport = siteViewport;

export default function EnRoot({ children }: { children: React.ReactNode }) {
  return (
    <Document lang="en" fonts={`${inter.variable} ${sora.variable} ${vazir.variable}`}>
      {children}
    </Document>
  );
}
