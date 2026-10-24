"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { commonCopy } from "@/content/copy/common";
import { searchCopy } from "@/content/copy/search";
import { num, type Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { mediaUrl } from "@/lib/media";
import { searchItems, type SearchItem } from "@/lib/search";
import { Overlay, OverlayLink, useOverlayNav } from "@/components/ui/overlay";
import { Icon } from "@/components/ui/icons";

let indexPromise: Promise<SearchItem[]> | null = null;
/** The price-free index, fetched once per page view (shared by the overlay and the results page). */
export function loadSearchIndex(): Promise<SearchItem[]> {
  indexPromise ??= fetch("/api/search-index")
    .then((r) => (r.ok ? r.json() : { items: [] }))
    .then((j: { items: SearchItem[] }) => j.items ?? [])
    .catch(() => {
      indexPromise = null;
      return [];
    });
  return indexPromise;
}

export type SearchSuggestion = { label: string; path: string };

/** /search?q=… for a query (the results page). */
export const searchHref = (lang: Lang, q: string) => `${href(lang, "/search")}${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`;

/** A small picture in the brand's arch (search results and the empty-field arcade). */
function ArchThumb({ it, className }: { it: SearchItem; className: string }) {
  return (
    <span className={`arch arch-clip relative block shrink-0 overflow-hidden bg-tile ${className}`}>
      {it.media && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mediaUrl({ src: it.media.src, ext: it.media.ext, widths: it.media.widths }, 480)}
          alt=""
          className="size-full object-cover transition-transform duration-[1.2s] ease-[var(--ease-out-expo)] group-hover:scale-[1.06]"
          style={{ objectPosition: `${it.media.fx}% ${it.media.fy}%` }}
          loading="lazy"
        />
      )}
    </span>
  );
}

/**
 * The search field with its results, shared by the overlay and the /search page: the categories as a small
 * arcade and a few suggestions while the field is empty, then instant results over the price-free index.
 * Links leave an overlay through OverlayLink (plain links on the page). Enter: the overlay opens the results
 * page for the query; the page keeps the query in its URL.
 */
export function SearchPanel({
  lang,
  mode,
  suggestions,
  items,
  categories: fixedCategories,
  q,
  onQ,
  onSubmit,
  inputRef,
}: {
  lang: Lang;
  mode: "overlay" | "page";
  suggestions: SearchSuggestion[];
  /** null while the index loads */
  items: SearchItem[] | null;
  /** categories known on the server (the page renders them before the index arrives, and without JS) */
  categories?: SearchItem[];
  q: string;
  onQ: (q: string) => void;
  onSubmit: (q: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const common = commonCopy(lang);
  const s = searchCopy[lang];
  const page = mode === "page";
  const limit = page ? 60 : 12;
  const all = useMemo(() => (items && q.trim() ? searchItems(items, q, 200) : []), [items, q]);
  const results = all.slice(0, limit);
  const categories = useMemo(() => fixedCategories ?? (items ?? []).filter((it) => it.kind === "category" && it.media), [fixedCategories, items]);
  const name = (it: SearchItem) => (lang === "en" ? it.name_en || it.name_fa : it.name_fa);
  const sub = (it: SearchItem) => (lang === "en" ? it.sub_en || it.sub_fa : it.sub_fa);
  const searching = Boolean(q.trim());
  const status = !searching || items === null ? "" : all.length ? s.count(num(all.length, lang)) : s.none(q.trim());

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(q);
  };

  return (
    <div className={page ? "container-lux max-w-5xl pt-10 pb-20 sm:pt-14 sm:pb-28" : "container-lux max-w-5xl py-7 sm:py-12"}>
      {page && (
        <h1 className="label mb-4 flex items-center gap-2.5 text-gold-text!">
          <span aria-hidden className="size-1 rotate-45 bg-current" />
          {s.title}
        </h1>
      )}
      <form action={href(lang, "/search")} method="get" role="search" className="relative flex items-center gap-4 pb-3" onSubmit={submit}>
        <Icon name="search" className="size-6 shrink-0 text-gold sm:size-7" />
        <input
          ref={inputRef}
          type="search"
          name="q"
          value={q}
          onChange={(e) => onQ(e.target.value)}
          placeholder={common.nav.searchPlaceholder}
          className="display h-14 min-w-0 flex-1 appearance-none bg-transparent text-2xl font-semibold text-ink outline-none placeholder:font-normal placeholder:text-faint sm:h-16 sm:text-4xl [&::-webkit-search-cancel-button]:hidden"
          autoComplete="off"
          enterKeyHint="search"
          aria-label={common.nav.search}
        />
        <span aria-hidden className="hairline absolute inset-x-0 bottom-0" />
      </form>
      {/* the count (or «nothing found») for screen readers; visible on the page */}
      <p aria-live="polite" className={page && searching && all.length > 0 ? "mt-4 font-ui text-xs text-muted" : "sr-only"}>
        {status}
      </p>
      {!searching ? (
        <div className={page ? "mt-8 space-y-9" : "mt-9 space-y-9"}>
          {page && <p className="font-ui text-sm text-muted">{s.browse}</p>}
          {categories.length > 0 && (
            <ul className="-mx-[var(--gutter)] flex animate-fade-in gap-4 overflow-x-auto px-[var(--gutter)] pt-1 [scrollbar-width:none] sm:gap-6 [&::-webkit-scrollbar]:hidden">
              {categories.map((it) => (
                <li key={it.slug} className="shrink-0">
                  <OverlayLink href={href(lang, it.path)} className="group flex w-[5.5rem] flex-col items-center text-center sm:w-28">
                    <ArchThumb it={it} className="aspect-[3/4] w-full" />
                    <span className="display mt-3 text-base leading-[1.5]! font-bold text-ink-2 transition-colors group-hover:text-gold-deep sm:text-lg">{name(it)}</span>
                  </OverlayLink>
                </li>
              ))}
            </ul>
          )}
          <ul className="flex flex-wrap gap-2">
            {suggestions.map((sg) => (
              <li key={sg.path}>
                <OverlayLink href={href(lang, sg.path)} className="inline-flex h-10 items-center rounded-full border border-line-strong bg-porcelain/70 px-4 font-ui text-sm text-ink-2 transition-colors hover:border-gold hover:text-ink">
                  {sg.label}
                </OverlayLink>
              </li>
            ))}
          </ul>
        </div>
      ) : items === null ? (
        <p className="mt-8 font-ui text-sm text-muted">{common.actions.loading}</p>
      ) : results.length === 0 ? (
        <p aria-hidden className="display mt-10 text-xl font-semibold text-ink-2">
          {s.none(q.trim())}
        </p>
      ) : (
        <>
          <ul className="mt-6 grid gap-x-10 sm:grid-cols-2">
            {results.map((it) => (
              <li key={`${it.kind}:${it.slug}`} className="border-b border-gold/15">
                <OverlayLink href={href(lang, it.path)} className="group flex items-center gap-4 py-3.5">
                  <ArchThumb it={it} className="h-[4.5rem] w-14" />
                  <span className="min-w-0 flex-1">
                    <span className="display block truncate text-lg leading-[1.6]! font-semibold text-ink transition-colors group-hover:text-gold-deep">{name(it)}</span>
                    <span className="block truncate text-xs leading-6 text-muted">{sub(it)}</span>
                  </span>
                  {it.sku ? <span className="hidden font-label text-xs text-muted sm:block ltr">{it.sku}</span> : s.kinds[it.kind] && <span className="label text-gold-text!">{s.kinds[it.kind]}</span>}
                </OverlayLink>
              </li>
            ))}
          </ul>
          {!page && all.length > results.length && (
            <p className="mt-7">
              <OverlayLink href={searchHref(lang, q)} className="btn-link">
                {s.all(num(all.length, lang))}
              </OverlayLink>
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Inside the overlay: Enter opens the results page for the query (the overlay's own way out). */
function OverlayPanel(props: Omit<Parameters<typeof SearchPanel>[0], "mode" | "onSubmit">) {
  const nav = useOverlayNav();
  return <SearchPanel {...props} mode="overlay" onSubmit={(q) => q.trim() && nav?.go(searchHref(props.lang, q))} />;
}

/** Search overlay under the header's search icon: instant results; Enter opens the full results page. */
export function SearchOverlay({ lang, suggestions }: { lang: Lang; suggestions: SearchSuggestion[] }) {
  const c = commonCopy(lang).nav;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const on = () => {
      setOpen(true);
      void loadSearchIndex().then(setItems);
      setTimeout(() => input.current?.focus(), 60);
    };
    window.addEventListener("celin:search", on);
    return () => window.removeEventListener("celin:search", on);
  }, []);

  return (
    <Overlay open={open} onClose={() => setOpen(false)} label={c.search} variant="top" closeLabel={c.close}>
      <div className="bg-mesh-porcelain">
        <OverlayPanel lang={lang} suggestions={suggestions} items={items} q={q} onQ={setQ} inputRef={input} />
      </div>
    </Overlay>
  );
}
