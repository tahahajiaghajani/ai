import type { MetadataRoute } from "next";
import { PROJECTS } from "@/content/projects";
import { siteUrl } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["/", ...PROJECTS.map((p) => `/work/${p.slug}`)];
  return pages.flatMap((path) => {
    const fa = `${siteUrl}${path === "/" ? "" : path}`;
    const en = `${siteUrl}/en${path === "/" ? "" : path}`;
    const alternates = { languages: { fa, en } };
    return [
      { url: fa || siteUrl, changeFrequency: "monthly" as const, priority: path === "/" ? 1 : 0.8, alternates },
      { url: en, changeFrequency: "monthly" as const, priority: path === "/" ? 0.9 : 0.7, alternates },
    ];
  });
}
