"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { commonCopy } from "@/content/copy/common";
import type { Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { mediaUrl } from "@/lib/media";
import { searchItems, type SearchItem } from "@/lib/search";
import { Overlay } from "@/components/ui/overlay";
import { Icon } from "@/components/ui/icons";

let indexPromise: Promise<SearchItem[]> | null = null;
function loadIndex(): Promise<SearchItem[]> {
  indexPromise ??= fetch("/api/search-index")
    .then((r) => (r.ok ? r.json() : { items: [] }))
    .then((j: { items: SearchItem[] }) => j.items ?? [])
    .catch(() => {
      indexPromise = null;
      return [];
    });
  return indexPromise;
}

const KIND = {
  fa: { category: "دسته", collection: "مجموعه", page: "صفحه", product: "" },
  en: { category: "Category", collection: "Collection", page: "Page", product: "" },
};

/** A small picture in the brand's arch (search results and the empty-field arcade). */
function ArchThumb({ it, className }: { it: SearchItem; className: string }) {
  return (
    <span className={`arch relative block shrink-0 overflow-hidden bg-tile ${className}`}>
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

/** Search overlay: instant results over a small price-free index; Enter opens the full results page. */
export function SearchOverlay({ lang, suggestions }: { lang: Lang; suggestions: { label: string; path: string }[] }) {
  const common = commonCopy(lang);
  const c = common.nav;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const on = () => {
      setOpen(true);
      void loadIndex().then(setItems);
      setTimeout(() => input.current?.focus(), 60);
    };
    window.addEventListener("celin:search", on);
    return () => window.removeEventListener("celin:search", on);
  }, []);

  const results = useMemo(() => (items && q.trim() ? searchItems(items, q, 12) : []), [items, q]);
  const categories = useMemo(() => (items ?? []).filter((it) => it.kind === "category" && it.media), [items]);
  const name = (it: SearchItem) => (lang === "en" ? it.name_en || it.name_fa : it.name_fa);
  const sub = (it: SearchItem) => (lang === "en" ? it.sub_en || it.sub_fa : it.sub_fa);
  const close = () => setOpen(false);

  return (
    <Overlay open={open} onClose={close} label={c.search} variant="top" closeLabel={c.close}>
      <div className="bg-mesh-porcelain">
        <div className="container-lux max-w-5xl py-7 sm:py-12">
          <form action={href(lang, "/search")} className="relative flex items-center gap-4 pb-3" onSubmit={close}>
            <Icon name="search" className="size-6 shrink-0 text-gold sm:size-7" />
            <input
              ref={input}
              name="q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={c.searchPlaceholder}
              className="display h-14 min-w-0 flex-1 bg-transparent text-2xl font-semibold text-ink outline-none placeholder:font-normal placeholder:text-faint sm:h-16 sm:text-4xl"
              autoComplete="off"
              enterKeyHint="search"
              aria-label={c.search}
            />
            <span aria-hidden className="hairline absolute inset-x-0 bottom-0" />
          </form>
          {!q.trim() ? (
            <div className="mt-9 space-y-9">
              {categories.length > 0 && (
                <ul className="-mx-[var(--gutter)] flex animate-fade-in gap-4 overflow-x-auto px-[var(--gutter)] pt-1 [scrollbar-width:none] sm:gap-6 [&::-webkit-scrollbar]:hidden">
                  {categories.map((it) => (
                    <li key={it.slug} className="shrink-0">
                      <Link href={href(lang, it.path)} onClick={close} className="group flex w-[5.5rem] flex-col items-center text-center sm:w-28">
                        <ArchThumb it={it} className="aspect-[3/4] w-full" />
                        <span className="display mt-3 text-base leading-[1.5]! font-bold text-ink-2 transition-colors group-hover:text-gold-deep sm:text-lg">{name(it)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <ul className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <li key={s.path}>
                    <Link href={href(lang, s.path)} onClick={close} className="inline-flex h-10 items-center rounded-full border border-line-strong bg-porcelain/70 px-4 font-ui text-sm text-ink-2 transition-colors hover:border-gold hover:text-ink">
                      {s.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : items === null ? (
            <p className="mt-8 font-ui text-sm text-muted">{common.actions.loading}</p>
          ) : results.length === 0 ? (
            <p className="display mt-10 text-xl font-semibold text-ink-2">{lang === "fa" ? `نتیجه‌ای برای «${q}» پیدا نشد.` : `No results for “${q}”.`}</p>
          ) : (
            <ul className="mt-6 grid gap-x-10 sm:grid-cols-2">
              {results.map((it) => (
                <li key={`${it.kind}:${it.slug}`} className="border-b border-gold/15">
                  <Link href={href(lang, it.path)} onClick={close} className="group flex items-center gap-4 py-3.5">
                    <ArchThumb it={it} className="h-[4.5rem] w-14" />
                    <span className="min-w-0 flex-1">
                      <span className="display block truncate text-lg leading-[1.6]! font-semibold text-ink transition-colors group-hover:text-gold-deep">{name(it)}</span>
                      <span className="block truncate text-xs leading-6 text-muted">{sub(it)}</span>
                    </span>
                    {it.sku ? <span className="hidden font-label text-xs text-faint sm:block ltr">{it.sku}</span> : KIND[lang][it.kind] && <span className="label text-gold-text!">{KIND[lang][it.kind]}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Overlay>
  );
}
