"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/format";
import type { SearchItem } from "@/lib/search";
import { SearchPanel, loadSearchIndex, searchHref, type SearchSuggestion } from "@/components/site/search-overlay";

type Props = { lang: Lang; suggestions: SearchSuggestion[]; categories: SearchItem[] };

/** The static HTML of /search (and what a visitor without JS keeps): the empty field, a plain GET form. */
export function SearchPageShell(props: Props) {
  return <SearchPanel {...props} mode="page" items={null} q="" onQ={() => undefined} onSubmit={() => undefined} />;
}

/** /search in the browser: the query lives in the URL (?q=), results follow the field as it is typed. */
export function SearchPageView({ lang, suggestions, categories }: Props) {
  const sp = useSearchParams();
  const urlQ = sp.get("q") ?? "";
  const [q, setQ] = useState(urlQ);
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const written = useRef(urlQ.trim());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadSearchIndex().then(setItems);
    if (!urlQ) input.current?.focus({ preventScroll: true });
    return () => clearTimeout(timer.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // a new query from outside (the overlay's Enter while already here, Back/Forward)
  useEffect(() => {
    if (urlQ.trim() === written.current) return;
    written.current = urlQ.trim();
    setQ(urlQ);
  }, [urlQ]);

  const write = (v: string) => {
    clearTimeout(timer.current);
    if (v.trim() === written.current) return;
    written.current = v.trim();
    try {
      history.replaceState(null, "", searchHref(lang, v));
    } catch {
      // the URL is a convenience (sharing, Back); the results are already on screen
    }
  };

  return (
    <SearchPanel
      lang={lang}
      mode="page"
      suggestions={suggestions}
      categories={categories}
      items={items}
      q={q}
      inputRef={input}
      onQ={(v) => {
        setQ(v);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => write(v), 400);
      }}
      onSubmit={(v) => {
        write(v);
        input.current?.blur();
      }}
    />
  );
}
