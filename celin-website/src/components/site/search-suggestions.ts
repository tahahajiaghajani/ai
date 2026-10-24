import type { Catalog } from "@/lib/catalog-types";
import { t, type Lang } from "@/lib/i18n";
import { common } from "@/content/copy/common";

/** The suggestion chips under an empty search field (the overlay and the /search page). */
export function searchSuggestions(catalog: Catalog, lang: Lang): { label: string; path: string }[] {
  return [
    ...catalog.categories.slice(0, 5).map((k) => ({ label: t(k, "name", lang), path: `/shop/${k.slug}` })),
    ...catalog.collections.slice(0, 3).map((k) => ({ label: `${lang === "fa" ? "مجموعه‌ی " : ""}${t(k, "name", lang)}`, path: `/collections/${k.slug}` })),
    { label: common[lang].nav.care, path: "/care" },
  ];
}
