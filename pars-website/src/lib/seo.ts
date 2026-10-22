import "server-only";
import type { Metadata, MetadataRoute, Viewport } from "next";
import { env } from "@/lib/env";
import { latinDigits } from "@/lib/digits";
import { copy, href, type Lang } from "@/lib/i18n";
import type { SiteContent } from "@/lib/settings-types";

export const siteViewport: Viewport = {
  themeColor: "#07061a",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export function siteMetadata(lang: Lang): Metadata {
  const c = copy(lang);
  return {
    metadataBase: new URL(env.siteUrl),
    title: { default: c.meta.title, template: `%s | ${c.meta.short}` },
    description: c.meta.description,
    applicationName: c.meta.short,
    openGraph: {
      type: "website",
      locale: lang === "fa" ? "fa_IR" : "en_US",
      siteName: c.meta.short,
      title: c.meta.title,
      description: c.meta.description,
      images: [{ url: "/og.png", width: 1200, height: 630, alt: c.meta.short }],
    },
    twitter: { card: "summary_large_image", title: c.meta.title, description: c.meta.description, images: ["/og.png"] },
    manifest: href(lang, "/manifest.webmanifest"),
  };
}

/** Web app manifest per language: /manifest.webmanifest (app/manifest.ts) and /en/manifest.webmanifest (a route). */
export function webManifest(lang: Lang): MetadataRoute.Manifest {
  return {
    name: lang === "fa" ? "مدیریت پروژه پارس — Pars Project Management" : "Pars Project Management",
    short_name: "Pars",
    description: copy(lang).footer.tagline,
    start_url: href(lang, "/"),
    ...(lang === "en" ? { scope: "/en" } : {}),
    display: "standalone",
    background_color: "#07061a",
    theme_color: "#07061a",
    lang,
    dir: lang === "fa" ? "rtl" : "ltr",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}

/** Canonical + hreflang for a page that exists in both languages. */
export function pageAlternates(lang: Lang, path: string): Metadata["alternates"] {
  return {
    canonical: href(lang, path),
    languages: { fa: href("fa", path), en: href("en", path), "x-default": href("fa", path) },
  };
}

/**
 * Metadata for an inner page. A page's openGraph replaces the root one (Next merges metadata shallowly),
 * so locale, site name and image are repeated here, and the Twitter card gets the page's own title too.
 * `article` pages (blog posts) are written per language, so they have a canonical but no language pair.
 */
export function pageMetadata(
  lang: Lang,
  o: { path: string; title: string; description: string; image?: string; article?: { publishedTime?: string; modifiedTime?: string; tags?: string[] } },
): Metadata {
  const c = copy(lang);
  const url = href(lang, o.path);
  const images = o.image ? [{ url: o.image }] : [{ url: "/og.png", width: 1200, height: 630, alt: c.meta.short }];
  const base = { url, locale: lang === "fa" ? "fa_IR" : "en_US", siteName: c.meta.short, title: o.title, description: o.description, images };
  return {
    title: o.title,
    description: o.description,
    alternates: o.article ? { canonical: url } : pageAlternates(lang, o.path),
    openGraph: o.article ? { ...base, type: "article", ...o.article } : { ...base, type: "website" },
    twitter: { card: "summary_large_image", title: o.title, description: o.description, images: [o.image ?? "/og.png"] },
  };
}

export function organizationJsonLd(lang: Lang, site: SiteContent): string {
  const c = copy(lang);
  const url = env.siteUrl;
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${url}/#org`,
        name: "Pars Project Management",
        alternateName: ["مدیریت پروژه پارس", "شرکت مدیریت پروژه پارس", "موسسه مدیریت پروژه پارس", "Pars Project Management Institute", "Pars PMI"],
        url,
        foundingDate: "2010",
        logo: `${url}/brand/pars-logo.svg`,
        description: c.meta.description,
        email: site.contact.email,
        telephone: site.contact.phones[0] ? `+98-${latinDigits(site.contact.phones[0]).replace(/^0/, "")}` : undefined,
        address: { "@type": "PostalAddress", streetAddress: lang === "fa" ? site.contact.addressFa : site.contact.addressEn, addressLocality: "Tehran", addressCountry: "IR" },
        knowsAbout: ["Enterprise Project Management", "EPM", "EPPM", "Project Portfolio Management", "PMBOK", "Microsoft Project Server", "Oracle Primavera P6", "Contract management", "Performance evaluation", "AI agents", "Retrieval-Augmented Generation", "Predictive analytics", "Agile", "Scrum", "PMO"],
        sameAs: Object.values(site.social).filter(Boolean),
      },
      ...(site.ceo.nameEn || site.ceo.nameFa
        ? [
            {
              "@type": "Person",
              "@id": `${url}/#ceo`,
              name: (lang === "fa" ? site.ceo.nameFa : site.ceo.nameEn) || site.ceo.nameFa || site.ceo.nameEn,
              alternateName: [site.ceo.nameFa, site.ceo.nameEn].filter(Boolean),
              jobTitle: lang === "fa" ? site.ceo.titleFa : site.ceo.titleEn,
              description: (lang === "fa" ? site.ceo.bioFa : site.ceo.bioEn) || undefined,
              worksFor: { "@id": `${url}/#org` },
            },
          ]
        : []),
      {
        "@type": "WebSite",
        "@id": `${url}/#website`,
        url: `${url}${href(lang, "/")}`,
        name: c.meta.short,
        inLanguage: lang === "fa" ? "fa-IR" : "en",
        publisher: { "@id": `${url}/#org` },
      },
    ],
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
