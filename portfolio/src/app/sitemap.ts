import type { MetadataRoute } from "next";
import { PROJECTS } from "@/content/projects";
import { POSTS } from "@/content/blog";
import { siteUrl } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: { path: string; modified?: string; often?: "weekly" }[] = [
    { path: "/" },
    ...PROJECTS.map((p) => ({ path: `/work/${p.slug}` })),
    { path: "/blog", modified: POSTS[0]?.date, often: "weekly" as const },
    ...POSTS.map((p) => ({ path: `/blog/${p.slug}`, modified: p.date })),
  ];
  return pages.flatMap(({ path, modified, often }) => {
    const fa = `${siteUrl}${path === "/" ? "" : path}`;
    const en = `${siteUrl}/en${path === "/" ? "" : path}`;
    const alternates = { languages: { fa, en } };
    const common = { changeFrequency: often ?? ("monthly" as const), alternates, ...(modified ? { lastModified: new Date(modified) } : {}) };
    return [
      { url: fa || siteUrl, priority: path === "/" ? 1 : 0.8, ...common },
      { url: en, priority: path === "/" ? 0.9 : 0.7, ...common },
    ];
  });
}
