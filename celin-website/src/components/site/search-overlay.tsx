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

/** Search overlay: instant results over a small price-free index; Enter opens the full results page. */
export function SearchOverlay({ lang, suggestions }: { lang: Lang; suggestions: { label: string; path: string }[] }) {
  const c = commonCopy(lang).nav;
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
  const name = (it: SearchItem) => (lang === "en" ? it.name_en || it.name_fa : it.name_fa);
  const sub = (it: SearchItem) => (lang === "en" ? it.sub_en || it.sub_fa : it.sub_fa);

  return (
    <Overlay open={open} onClose={() => setOpen(false)} label={c.search} variant="top" closeLabel={c.close}>
      <div className="container-lux max-w-4xl py-6 sm:py-10">
        <form action={href(lang, "/search")} className="flex items-center gap-3 border-b border-ink pb-3" onSubmit={() => setOpen(false)}>
          <Icon name="search" className="size-6 shrink-0 text-ink-2" />
          <input
            ref={input}
            name="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={c.searchPlaceholder}
            className="h-12 min-w-0 flex-1 bg-transparent text-xl outline-none placeholder:text-faint sm:text-2xl"
            autoComplete="off"
            enterKeyHint="search"
            aria-label={c.search}
          />
        </form>
        {!q.trim() ? (
          <div className="mt-8">
            <ul className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <li key={s.path}>
                  <Link href={href(lang, s.path)} onClick={() => setOpen(false)} className="inline-block border border-line px-4 py-2 text-sm text-ink-2 hover:border-ink hover:text-ink">
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : items === null ? (
          <p className="mt-8 text-sm text-muted">{commonCopy(lang).actions.loading}</p>
        ) : results.length === 0 ? (
          <p className="mt-8 text-sm text-muted">{lang === "fa" ? `نتیجه‌ای برای «${q}» پیدا نشد.` : `No results for “${q}”.`}</p>
        ) : (
          <ul className="mt-6 divide-y divide-line">
            {results.map((it) => (
              <li key={`${it.kind}:${it.slug}`}>
                <Link href={href(lang, it.path)} onClick={() => setOpen(false)} className="flex items-center gap-4 py-3 hover:bg-bone/50">
                  <span className="relative block h-16 w-12 shrink-0 overflow-hidden bg-tile">
                    {it.media && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mediaUrl({ src: it.media.src, ext: it.media.ext, widths: it.media.widths }, 120)} alt="" className="size-full object-cover" style={{ objectPosition: `${it.media.fx}% ${it.media.fy}%` }} loading="lazy" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-ink">{name(it)}</span>
                    <span className="block truncate text-xs text-muted">{sub(it)}</span>
                  </span>
                  {it.sku && <span className="hidden font-label text-xs text-faint sm:block ltr">{it.sku}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Overlay>
  );
}
