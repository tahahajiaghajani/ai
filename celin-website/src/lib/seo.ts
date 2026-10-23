import "server-only";
import type { Metadata, MetadataRoute, Viewport } from "next";
import { env } from "@/lib/env";
import { href, type Lang } from "@/lib/i18n";

export const SITE = {
  fa: { name: "سلین", title: "سلین CELIN — فراتر از یک زیور", description: "سلین؛ فراتر از یک زیور، امضایی از ظرافت، کیفیت و اصالت. زیورآلات سبک جواهری با نگین‌های کیوبیک زیرکونیا، مخراج‌کاری دقیق و آبکاری رودیوم و طلا، از سال ۱۳۸۵." },
  en: { name: "CELIN", title: "CELIN — More than an ornament", description: "CELIN: more than an ornament — a signature of finesse, quality and authenticity. Fine-jewelry-style pieces with cubic zirconia stones, precise setting and rhodium and gold plating, since 2006." },
} as const;

export const siteViewport: Viewport = {
  themeColor: "#fbf8f2",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export function siteMetadata(lang: Lang): Metadata {
  const s = SITE[lang];
  return {
    metadataBase: new URL(env.siteUrl),
    title: { default: s.title, template: `%s | ${s.name}` },
    description: s.description,
    applicationName: s.name,
    openGraph: { type: "website", locale: lang === "fa" ? "fa_IR" : "en_US", siteName: s.name, title: s.title, description: s.description, images: [{ url: "/og.png", width: 1200, height: 630, alt: s.name }] },
    twitter: { card: "summary_large_image", title: s.title, description: s.description, images: ["/og.png"] },
    manifest: href(lang, "/manifest.webmanifest"),
    // static files in /public, made from the official mark (public/brand/celin-mark-reverse.svg) on the espresso ground
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "48x48" },
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
  };
}

/** Canonical + hreflang for a page that exists in both languages. */
export function pageAlternates(lang: Lang, path: string): Metadata["alternates"] {
  return { canonical: href(lang, path), languages: { fa: href("fa", path), en: href("en", path), "x-default": href("fa", path) } };
}

/** Metadata for an inner page (openGraph is repeated: Next merges metadata shallowly). */
export function pageMetadata(lang: Lang, o: { path: string; title: string; description: string; image?: string; noindex?: boolean }): Metadata {
  const s = SITE[lang];
  const url = href(lang, o.path);
  const images = o.image ? [{ url: o.image }] : [{ url: "/og.png", width: 1200, height: 630, alt: s.name }];
  return {
    title: o.title,
    description: o.description,
    alternates: pageAlternates(lang, o.path),
    openGraph: { url, locale: lang === "fa" ? "fa_IR" : "en_US", siteName: s.name, title: o.title, description: o.description, images, type: "website" },
    twitter: { card: "summary_large_image", title: o.title, description: o.description, images: [o.image ?? "/og.png"] },
    ...(o.noindex ? { robots: { index: false, follow: false } } : {}),
  };
}

export function webManifest(lang: Lang): MetadataRoute.Manifest {
  return {
    name: lang === "fa" ? "سلین — CELIN" : "CELIN",
    short_name: lang === "fa" ? "سلین" : "CELIN",
    description: SITE[lang].description,
    start_url: href(lang, "/"),
    ...(lang === "en" ? { scope: "/en" } : {}),
    display: "standalone",
    background_color: "#fbf8f2",
    theme_color: "#fbf8f2",
    lang,
    dir: lang === "fa" ? "rtl" : "ltr",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

/** JSON for a <script type="application/ld+json">, safe to inline. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
