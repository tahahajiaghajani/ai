import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/support/t/", "/en/support/t/"] }],
    sitemap: `${env.siteUrl}/sitemap.xml`,
  };
}
