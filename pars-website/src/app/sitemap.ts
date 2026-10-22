import type { MetadataRoute } from "next";
import { getBlog } from "@/lib/blog";
import { env } from "@/lib/env";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const u = env.siteUrl;
  // every language version lists the full set of alternates (itself and x-default included), as hreflang requires
  const pair = (fa: string, en: string, faPriority: number, enPriority: number): MetadataRoute.Sitemap => {
    const alternates = { languages: { fa: `${u}${fa}`, en: `${u}${en}`, "x-default": `${u}${fa}` } };
    return [
      { url: `${u}${fa}`, changeFrequency: "weekly", priority: faPriority, alternates },
      { url: `${u}${en}`, changeFrequency: "weekly", priority: enPriority, alternates },
    ];
  };
  // articles are written per language (no translated pairs), so each stands alone
  const posts: MetadataRoute.Sitemap = (await getBlog()).posts.map((p) => ({
    url: `${u}${p.lang === "en" ? "/en" : ""}/blog/${encodeURIComponent(p.slug)}`,
    lastModified: p.updated_at,
    changeFrequency: "monthly",
    priority: 0.6,
  }));
  return [...pair("/", "/en", 1, 0.9), ...pair("/records", "/en/records", 0.7, 0.6), ...pair("/blog", "/en/blog", 0.7, 0.6), ...posts, ...pair("/support", "/en/support", 0.6, 0.5)];
}
