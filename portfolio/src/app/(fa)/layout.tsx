import type { Metadata, Viewport } from "next";
import { Document } from "@/components/site/document";
import { interFa, mono, serif, vazirFa } from "@/lib/fonts";
import { siteMetadata, siteViewport } from "@/lib/seo";
import "../globals.css";

export const metadata: Metadata = siteMetadata("fa");
export const viewport: Viewport = siteViewport;

export default function FaRoot({ children }: { children: React.ReactNode }) {
  return (
    <Document lang="fa" fonts={`${vazirFa.variable} ${interFa.variable} ${serif.variable} ${mono.variable}`}>
      {children}
    </Document>
  );
}
