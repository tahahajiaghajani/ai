import "server-only";
import type { Metadata, MetadataRoute, Viewport } from "next";
import { env } from "@/lib/env";
import { href, t, type Lang } from "@/lib/i18n";
import type { Category, Collection, Product } from "@/lib/catalog-types";
import { story } from "@/content/copy/story";

export const SITE = {
  fa: { name: "سلین", title: "سلین CELIN — فراتر از یک زیور", description: "سلین؛ فراتر از یک زیور، امضایی از ظرافت، کیفیت و اصالت. زیورآلات سبک جواهری با نگین‌های درخشان، مخراج‌کاری دقیق و آبکاری رودیوم و طلا، از سال ۱۳۸۵." },
  en: { name: "CELIN", title: "CELIN — More than an ornament", description: "CELIN: more than an ornament — a signature of finesse, quality and authenticity. Fine-jewelry-style pieces with brilliant stones, precise setting and rhodium and gold plating, since 2006." },
} as const;

export const siteViewport: Viewport = {
  themeColor: "#fbf8f2",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

/** Site-wide metadata; `description` is the admin's «توضیح سایت در گوگل» (Settings → SEO) when it is filled. */
export function siteMetadata(lang: Lang, description?: string): Metadata {
  const s = SITE[lang];
  const desc = description?.trim() || s.description;
  return {
    metadataBase: new URL(env.siteUrl),
    title: { default: s.title, template: `%s | ${s.name}` },
    description: desc,
    applicationName: s.name,
    openGraph: { type: "website", locale: lang === "fa" ? "fa_IR" : "en_US", siteName: s.name, title: s.title, description: desc, images: [{ url: "/og.png", width: 1200, height: 630, alt: s.name }] },
    twitter: { card: "summary_large_image", title: s.title, description: desc, images: ["/og.png"] },
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

/** Shortens text for a meta description at a word boundary (never mid-word), ending with «…». */
export function clip(text: string, max = 160): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.lastIndexOf(" ", max - 1);
  return `${s.slice(0, cut > max * 0.6 ? cut : max - 1).replace(/[\s،,;؛:—–-]+$/, "")}…`;
}

const sentences = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?؟])\s+/)
    .filter(Boolean);

/** Persian indefinite: «انگشتر» → «انگشتری», «گوشواره» → «گوشواره‌ای», «النگو» → «النگویی». */
const faIndefinite = (w: string) => (/[هی]$/.test(w) ? `${w}‌ای` : /[اوآ]$/.test(w) ? `${w}یی` : `${w}ی`);

/**
 * A product's meta description: real sentences, unique per product, about 120–160 characters and never a
 * price — the name with its category and collection, the cut / color / finish line, then the product's own
 * description while whole sentences fit, and the brand's motto (or its first half) when there is room.
 */
export function productDescription(
  p: Pick<Product, "name_fa" | "name_en" | "subtitle_fa" | "subtitle_en" | "description_fa" | "description_en">,
  lang: Lang,
  ctx: { category?: Pick<Category, "name_fa" | "name_en"> | null; collection?: Pick<Collection, "name_fa" | "name_en"> | null } = {},
  max = 160,
): string {
  const name = t(p, "name", lang);
  const cat = ctx.category ? t(ctx.category, "name", lang) : "";
  const col = ctx.collection ? t(ctx.collection, "name", lang) : "";
  const parts = t(p, "subtitle", lang)
    .split(/\s*[·،,]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
  let lead: string;
  if (lang === "fa") {
    // a compound category («دستبند و النگو») takes no indefinite ی: «دستبند و النگویی» would read "bracelet and a bangle"
    const what = cat && !cat.includes(" و ") ? faIndefinite(cat) : "اثری";
    const from = col ? `از مجموعه‌ی ${col} سلین` : "از سلین";
    lead = `${name}، ${what} ${from}${parts.length ? `؛ ${parts.join("، ")}` : ""}.`;
  } else {
    const material = parts.map((x, i) => (i === 0 ? x : x.replace(/\b(?!Firouzeh\b)[A-Z][a-z]+/g, (w) => w.toLowerCase())));
    const from = col ? `from the ${col} collection` : "";
    const what = cat ? `one of CELIN's ${cat.toLowerCase()}${from ? ` ${from}` : ""}` : `a CELIN piece${from ? ` ${from}` : ""}`;
    lead = `${name}, ${what}${material.length ? `. ${material.join(", ")}` : ""}.`;
  }
  let out = lead;
  for (const s of sentences(t(p, "description", lang))) {
    if (`${out} ${s}`.length > max) break;
    out = `${out} ${s}`;
  }
  // the brand's own line: the whole motto when it fits, else its first half
  const brand = [`${story[lang].motto}.`, lang === "fa" ? `سلین؛ ${story.fa.mottoShort}.` : `CELIN — ${story.en.mottoShort.toLowerCase()}.`].find((b) => `${out} ${b}`.length <= max);
  if (brand) out = `${out} ${brand}`;
  return clip(out, max);
}

/**
 * A collection's meta description: the tagline, then the story's whole sentences while they fit — never cut
 * mid-phrase (a clipped «… in gold…» reads as a material claim). Cut at a word boundary only when not even the
 * first sentence fits.
 */
export function collectionDescription(c: Pick<Collection, "tagline_fa" | "tagline_en" | "story_fa" | "story_en">, lang: Lang, max = 160): string {
  const tagline = t(c, "tagline", lang).replace(/\s+/g, " ").trim();
  const text = t(c, "story", lang);
  let out = "";
  for (const s of sentences(text)) {
    const next = out ? `${out} ${s}` : tagline ? `${tagline} — ${s}` : s;
    if (next.length > max) break;
    out = next;
  }
  return out || clip([tagline, text].filter(Boolean).join(" — "), max);
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
