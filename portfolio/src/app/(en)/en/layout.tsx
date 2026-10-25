import type { Metadata, Viewport } from "next";
import { Document } from "@/components/site/document";
import { interEn, mono, serif, vazirEn } from "@/lib/fonts";
import { siteMetadata, siteViewport } from "@/lib/seo";
import "../../globals.css";

export const metadata: Metadata = siteMetadata("en");
export const viewport: Viewport = siteViewport;

export default function EnRoot({ children }: { children: React.ReactNode }) {
  return (
    <Document lang="en" fonts={`${interEn.variable} ${vazirEn.variable} ${serif.variable} ${mono.variable}`}>
      {children}
    </Document>
  );
}
