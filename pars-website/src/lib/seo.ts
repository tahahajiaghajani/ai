import "server-only";
import type { Metadata, Viewport } from "next";
import { env } from "@/lib/env";
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
    manifest: "/manifest.webmanifest",
  };
}

/** Canonical + hreflang for a page that exists in both languages. */
export function pageAlternates(lang: Lang, path: string): Metadata["alternates"] {
  return {
    canonical: href(lang, path),
    languages: { fa: href("fa", path), en: href("en", path), "x-default": href("fa", path) },
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
        alternateName: ["مدیریت پروژه پارس", "شرکت مدیریت پروژه پارس", "Pars PMI"],
        url,
        logo: `${url}/brand/pars-logo.svg`,
        description: c.meta.description,
        email: site.contact.email,
        telephone: site.contact.phones[0] ? `+98-${site.contact.phones[0].replace(/^0/, "")}` : undefined,
        address: { "@type": "PostalAddress", streetAddress: lang === "fa" ? site.contact.addressFa : site.contact.addressEn, addressLocality: "Tehran", addressCountry: "IR" },
        knowsAbout: ["Enterprise Project Management", "EPM", "EPPM", "Project Portfolio Management", "Microsoft Project Server", "Oracle Primavera P6", "AI agents", "Retrieval-Augmented Generation", "Predictive analytics", "Agile", "Scrum", "PMO"],
        sameAs: Object.values(site.social).filter(Boolean),
      },
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
