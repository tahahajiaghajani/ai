import type { Metadata, Viewport } from "next";
import { Document } from "@/components/site/document";
import { FONT_VARS } from "@/lib/fonts";
import { siteMetadata, siteViewport } from "@/lib/seo";
import "../../globals.css";

export const metadata: Metadata = siteMetadata("en");
export const viewport: Viewport = siteViewport;

export default function EnRoot({ children }: { children: React.ReactNode }) {
  return (
    <Document lang="en" fonts={FONT_VARS}>
      {children}
    </Document>
  );
}
