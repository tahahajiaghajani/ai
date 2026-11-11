import type { Metadata } from "next";
import { ShopPage } from "@/components/pages/shop-page";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("en", { path: "/shop", title: "All jewelry", description: "CELIN rings, necklaces, earrings, bracelets and sets — brilliant stones with a diamond-like cut, precise setting, rhodium, gold and champagne-gold plating." });

export default function Page() {
  return <ShopPage lang="en" />;
}
