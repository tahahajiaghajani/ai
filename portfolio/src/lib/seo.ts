import type { Metadata, Viewport } from "next";
import type { Lang } from "@/lib/i18n";
import { href } from "@/lib/i18n";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")).replace(/\/$/, "");

export const siteUrl = SITE;

const TITLE = {
  fa: "طاها آقاجانی — معمار سیستم‌های هوش مصنوعی سازمانی",
  en: "Taha Aghajani — Enterprise AI Systems Architect",
};

const DESCRIPTION = {
  fa: "پورتفولیوی طاها آقاجانی: سیستم‌های سازمانی هوش مصنوعی، RAG و مدل‌های زبانی، بینایی ماشین، ایجنت‌ها و ورکفلوها، مهندسی فول‌استک، طراحی و برندسازی.",
  en: "Portfolio of Taha Aghajani: enterprise AI systems, RAG and LLMs, computer vision, agents and workflows, full-stack engineering, design and branding.",
};

export function siteMetadata(lang: Lang): Metadata {
  return {
    metadataBase: new URL(SITE),
    title: { default: TITLE[lang], template: lang === "fa" ? "%s | طاها آقاجانی" : "%s | Taha Aghajani" },
    description: DESCRIPTION[lang],
    applicationName: lang === "fa" ? "طاها آقاجانی" : "Taha Aghajani",
    authors: [{ name: "Taha Aghajani" }],
    creator: "Taha Aghajani",
    openGraph: {
      type: "website",
      siteName: lang === "fa" ? "طاها آقاجانی" : "Taha Aghajani",
      locale: lang === "fa" ? "fa_IR" : "en_US",
      title: TITLE[lang],
      description: DESCRIPTION[lang],
      images: [{ url: `/og-${lang}.jpg`, width: 1200, height: 630, alt: TITLE[lang] }],
    },
    twitter: { card: "summary_large_image", title: TITLE[lang], description: DESCRIPTION[lang], images: [`/og-${lang}.jpg`] },
    alternates: pageAlternates(lang, "/"),
    icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }], apple: "/apple-icon.png" },
    formatDetection: { telephone: false },
  };
}

export const siteViewport: Viewport = {
  themeColor: "#050505",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** canonical + hreflang for a path that exists in both languages */
export function pageAlternates(lang: Lang, path: string): Metadata["alternates"] {
  return {
    canonical: href(lang, path),
    languages: { fa: href("fa", path), en: href("en", path), "x-default": href("fa", path) },
  };
}
