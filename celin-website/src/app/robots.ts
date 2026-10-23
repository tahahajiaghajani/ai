import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

/** /robots.txt: the shop is open to crawlers; the admin panel, member accounts and the API are not. */
export const revalidate = 86400;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/account", "/en/account", "/api"] }],
    sitemap: `${env.siteUrl}/sitemap.xml`,
  };
}
