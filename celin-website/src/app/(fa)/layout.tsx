import type { Metadata, Viewport } from "next";
import { Document } from "@/components/site/document";
import { FONT_VARS } from "@/lib/fonts";
import { siteMetadata, siteViewport } from "@/lib/seo";
import { getSettings } from "@/lib/settings";
import "../globals.css";

/** The site description can be changed in Admin → Settings → SEO (saving there refreshes the pages). */
export async function generateMetadata(): Promise<Metadata> {
  return siteMetadata("fa", (await getSettings()).seo.description_fa);
}
export const viewport: Viewport = siteViewport;

export default function FaRoot({ children }: { children: React.ReactNode }) {
  return (
    <Document lang="fa" fonts={FONT_VARS}>
      {children}
    </Document>
  );
}
