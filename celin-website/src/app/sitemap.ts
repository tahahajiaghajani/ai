import type { MetadataRoute } from "next";
import { getCatalog } from "@/lib/catalog";
import { env } from "@/lib/env";
import { href, LANGS } from "@/lib/i18n";
import { mediaUrl } from "@/lib/media";

/**
 * /sitemap.xml: every public page in both languages (Persian at /, English at /en) with hreflang alternates,
 * and the product photos as image entries. Built from the public catalogue (published items only, never a
 * price); refreshed hourly.
 */
export const revalidate = 3600;

const PAGES: { path: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/shop", priority: 0.9, changeFrequency: "daily" },
  { path: "/collections", priority: 0.8, changeFrequency: "weekly" },
  { path: "/maison", priority: 0.6, changeFrequency: "monthly" },
  { path: "/craft", priority: 0.6, changeFrequency: "monthly" },
  { path: "/care", priority: 0.5, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.5, changeFrequency: "monthly" },
  { path: "/pro", priority: 0.6, changeFrequency: "monthly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.siteUrl;
  const abs = (p: string) => (/^https?:\/\//.test(p) ? p : `${base}${p}`);
  const both = (path: string, extra: Omit<MetadataRoute.Sitemap[number], "url" | "alternates">): MetadataRoute.Sitemap =>
    LANGS.map((lang) => ({
      url: abs(href(lang, path)),
      alternates: { languages: { fa: abs(href("fa", path)), en: abs(href("en", path)), "x-default": abs(href("fa", path)) } },
      ...extra,
    }));

  const { categories, collections, products } = await getCatalog();
  return [
    ...PAGES.flatMap((p) => both(p.path, { changeFrequency: p.changeFrequency, priority: p.priority })),
    ...categories.filter((c) => c.visible !== false).flatMap((c) => both(`/shop/${c.slug}`, { changeFrequency: "weekly", priority: 0.8 })),
    ...collections.filter((c) => c.visible !== false).flatMap((c) => both(`/collections/${c.slug}`, { changeFrequency: "weekly", priority: 0.7, ...(c.media ? { images: [abs(mediaUrl(c.media, 1280))] } : {}) })),
    ...products.flatMap((p) => both(`/product/${p.slug}`, { changeFrequency: "weekly", priority: 0.7, ...(p.images.length ? { images: p.images.slice(0, 4).map((m) => abs(mediaUrl(m, 1280))) } : {}) })),
  ];
}
