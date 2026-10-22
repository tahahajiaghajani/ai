import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export default function sitemap(): MetadataRoute.Sitemap {
  const u = env.siteUrl;
  const page = (fa: string, en: string, priority: number): MetadataRoute.Sitemap[number] => ({
    url: `${u}${fa}`,
    changeFrequency: "weekly",
    priority,
    alternates: { languages: { fa: `${u}${fa}`, en: `${u}${en}` } },
  });
  return [page("/", "/en", 1), page("/support", "/en/support", 0.6), { url: `${u}/en`, priority: 0.9 }, { url: `${u}/en/support`, priority: 0.5 }];
}
