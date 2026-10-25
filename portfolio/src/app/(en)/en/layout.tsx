import type { Metadata, Viewport } from "next";
import { Document } from "@/components/site/document";
import { inter, mono, serif, vazir } from "@/lib/fonts";
import { siteMetadata, siteViewport } from "@/lib/seo";
import "../../globals.css";

export const metadata: Metadata = siteMetadata("en");
export const viewport: Viewport = siteViewport;

export default function EnRoot({ children }: { children: React.ReactNode }) {
  return (
    <Document lang="en" fonts={`${inter.variable} ${vazir.variable} ${serif.variable} ${mono.variable}`}>
      {children}
    </Document>
  );
}
