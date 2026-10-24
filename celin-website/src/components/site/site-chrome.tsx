import type { ReactNode } from "react";
import { getCatalog } from "@/lib/catalog";
import { getSettings } from "@/lib/settings";
import { getSlots, slotText } from "@/lib/slots";
import { t, type Lang } from "@/lib/i18n";
import { common } from "@/content/copy/common";
import { Announcement } from "@/components/site/announcement";
import { Footer, ServicesStrip } from "@/components/site/footer";
import { Header, type MenuData } from "@/components/site/header";
import { RevealObserver } from "@/components/site/reveal";
import { SearchOverlay } from "@/components/site/search-overlay";
import { searchSuggestions } from "@/components/site/search-suggestions";
import { ProSheet } from "@/components/pro/pro-sheet";
import { SmoothScroll } from "@/components/fx/smooth-scroll";
import { Cursor } from "@/components/fx/cursor";

/** Header, menus, Pro sheet, search and footer around every public page (static: no per-user data here). */
export async function SiteChrome({ lang, children }: { lang: Lang; children: ReactNode }) {
  const [catalog, settings, slots] = await Promise.all([getCatalog(), getSettings(), getSlots()]);
  const promo = slots["menu.promo"];
  const menu: MenuData = {
    categories: catalog.categories.map((c) => ({ slug: c.slug, name: t(c, "name", lang), media: c.media })),
    collections: catalog.collections.map((c) => ({ slug: c.slug, name: t(c, "name", lang), tagline: t(c, "tagline", lang) })),
    promo: promo ? { media: promo.media, title: slotText(promo, "title", lang), cta: slotText(promo, "cta", lang), href: slotText(promo, "href", lang) || "/shop" } : null,
  };
  const suggestions = searchSuggestions(catalog, lang);
  return (
    <>
      {/* the first Tab stop of every page */}
      <a href="#main" className="sr-only z-[60] bg-ink px-4 py-2 text-bone focus:not-sr-only focus:fixed focus:top-2 focus:start-2">
        {common[lang].skip}
      </a>
      <Announcement lang={lang} a={settings.announcement} />
      <Header lang={lang} menu={menu} />
      <div id="main" tabIndex={-1} className="outline-none">
        {children}
      </div>
      <ServicesStrip lang={lang} />
      <Footer lang={lang} contact={settings.contact} />
      <ProSheet lang={lang} />
      <SearchOverlay lang={lang} suggestions={suggestions} />
      <RevealObserver />
      <SmoothScroll />
      <Cursor label={lang === "fa" ? "مشاهده" : "View"} />
    </>
  );
}
