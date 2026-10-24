import { Suspense } from "react";
import { getCatalog } from "@/lib/catalog";
import type { Lang } from "@/lib/format";
import { buildSearchIndex } from "@/lib/search-index";
import { searchCopy } from "@/content/copy/search";
import { searchSuggestions } from "@/components/site/search-suggestions";
import { SearchPageShell, SearchPageView } from "@/components/site/search-page-view";

/**
 * /search?q=… — the results page behind Enter in the search overlay: the same field and results on porcelain.
 * Static (the query is read in the browser, over the same price-free index as the overlay); without JS the
 * categories and suggestions stay as a way in.
 */
export async function SearchPage({ lang }: { lang: Lang }) {
  const [catalog, index] = await Promise.all([getCatalog(), buildSearchIndex().catch(() => [])]);
  const categories = index.filter((it) => it.kind === "category" && it.media);
  const suggestions = searchSuggestions(catalog, lang);
  return (
    <main className="relative isolate min-h-[70vh] bg-mesh-porcelain">
      <noscript>
        <p className="container-lux max-w-5xl pt-8 font-ui text-sm leading-7 text-muted">{searchCopy[lang].noScript}</p>
      </noscript>
      <Suspense fallback={<SearchPageShell lang={lang} suggestions={suggestions} categories={categories} />}>
        <SearchPageView lang={lang} suggestions={suggestions} categories={categories} />
      </Suspense>
    </main>
  );
}
