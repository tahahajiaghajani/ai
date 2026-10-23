"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { commonCopy } from "@/content/copy/common";
import { METALS, STONES, fromPrice, type Product } from "@/lib/catalog-types";
import { num, type Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { Overlay } from "@/components/ui/overlay";
import { Icon } from "@/components/ui/icons";
import { usePriceBook } from "@/components/pro/session";
import { ProductCard } from "@/components/shop/product-card";

export type SortKey = "featured" | "new" | "price-asc" | "price-desc";

export interface ShopFilters {
  metal: string[];
  stone: string[];
  collection: string[];
  sort: SortKey;
}

export function readFilters(sp: URLSearchParams | null): ShopFilters {
  const list = (k: string) => (sp?.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const sort = sp?.get("sort");
  return {
    metal: list("metal").filter((m) => (METALS as string[]).includes(m)),
    stone: list("stone").filter((s) => (STONES as readonly string[]).includes(s)),
    collection: list("collection"),
    sort: sort === "new" || sort === "price-asc" || sort === "price-desc" ? sort : "featured",
  };
}

/** Plating filter: a two-tone piece also counts as gold and as silver; options carry their own swatch. */
function metalsOf(p: Product): string[] {
  const out = new Set<string>();
  if (p.metal) out.add(p.metal);
  if (p.metal === "two-tone") {
    out.add("gold");
    out.add("silver");
  }
  for (const v of p.variants) if (v.swatch === "gold" || v.swatch === "silver" || v.swatch === "rose") out.add(v.swatch);
  return [...out];
}

export function applyFilters(products: Product[], f: ShopFilters, prices?: Record<string, { price: number | null; stock: number; variants: Record<string, { price: number | null; stock: number }> }>): Product[] {
  let list = products.filter(
    (p) =>
      (!f.metal.length || metalsOf(p).some((m) => f.metal.includes(m))) &&
      (!f.stone.length || (p.stone && f.stone.includes(p.stone))) &&
      (!f.collection.length || (p.collection && f.collection.includes(p.collection))),
  );
  if (f.sort === "new") list = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
  if ((f.sort === "price-asc" || f.sort === "price-desc") && prices) {
    const val = (p: Product) => fromPrice(prices[p.id]) ?? Number.POSITIVE_INFINITY;
    list = [...list].sort((a, b) => (f.sort === "price-asc" ? val(a) - val(b) : val(b) - val(a)));
  }
  return list;
}

const PAGE = 24;

const T = {
  fa: { filter: "فیلتر و مرتب‌سازی", sort: "مرتب‌سازی", featured: "پیشنهاد سلین", new: "تازه‌ترین", priceAsc: "قیمت: کم به زیاد", priceDesc: "قیمت: زیاد به کم", tone: "رنگ پوشش", stone: "رنگ نگین", collection: "مجموعه", clear: "پاک کردن", show: (n: string) => `نمایش ${n} اثر`, count: (n: string) => `${n} اثر`, more: "نمایش بیشتر", none: "اثری با این انتخاب‌ها پیدا نشد.", reset: "نمایش همه", all: "همه" },
  en: { filter: "Filter & sort", sort: "Sort", featured: "Our selection", new: "Newest", priceAsc: "Price: low to high", priceDesc: "Price: high to low", tone: "Finish", stone: "Stone color", collection: "Collection", clear: "Clear", show: (n: string) => `Show ${n} pieces`, count: (n: string) => `${n} pieces`, more: "Show more", none: "No pieces match these choices.", reset: "Show all", all: "All" },
};

/**
 * The listing grid with filters kept in the URL (?metal=gold&stone=paraiba&collection=nour&sort=new).
 * Filtering runs in the browser over the static product list; price sorting only exists for Pro members.
 */
export function ShopGrid({
  lang,
  products,
  collections,
  editorial,
  categoryChips,
}: {
  lang: Lang;
  products: Product[];
  collections: { slug: string; name: string }[];
  editorial?: ReactNode;
  categoryChips?: ReactNode;
}) {
  const tr = T[lang];
  const c = commonCopy(lang);
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const book = usePriceBook();
  const f = readFilters(sp);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ShopFilters>(f);
  const [limit, setLimit] = useState(PAGE);

  const list = useMemo(() => applyFilters(products, f, book?.prices), [products, f.metal.join(), f.stone.join(), f.collection.join(), f.sort, book]); // eslint-disable-line react-hooks/exhaustive-deps
  const draftCount = useMemo(() => applyFilters(products, draft).length, [products, draft]);

  const push = (next: ShopFilters) => {
    const q = new URLSearchParams();
    if (next.metal.length) q.set("metal", next.metal.join(","));
    if (next.stone.length) q.set("stone", next.stone.join(","));
    if (next.collection.length) q.set("collection", next.collection.join(","));
    if (next.sort !== "featured") q.set("sort", next.sort);
    const s = q.toString();
    router.replace(s ? `${path}?${s}` : path, { scroll: false });
    setLimit(PAGE);
  };

  // facet options with counts over the other facets' current choice
  const facet = (key: "metal" | "stone" | "collection", values: { v: string; label: string }[]) =>
    values
      .map((o) => ({ ...o, n: applyFilters(products, { ...draft, [key]: [o.v], sort: "featured" }).length }))
      .filter((o) => o.n > 0 || draft[key].includes(o.v));

  const toggle = (key: "metal" | "stone" | "collection", v: string) => setDraft((d) => ({ ...d, [key]: d[key].includes(v) ? d[key].filter((x) => x !== v) : [...d[key], v] }));
  const chips = [
    ...f.metal.map((v) => ({ key: "metal" as const, v, label: c.tones[v as keyof typeof c.tones] ?? v })),
    ...f.stone.map((v) => ({ key: "stone" as const, v, label: c.stones[v as keyof typeof c.stones] ?? v })),
    ...f.collection.map((v) => ({ key: "collection" as const, v, label: collections.find((k) => k.slug === v)?.name ?? v })),
  ];

  const colName = useMemo(() => new Map(collections.map((k) => [k.slug, k.name])), [collections]);
  const shown = list.slice(0, limit);
  const cards: ReactNode[] = [];
  shown.forEach((p, i) => {
    cards.push(
      <li key={p.id}>
        <ProductCard product={p} lang={lang} collectionName={p.collection ? colName.get(p.collection) : undefined} priority={i < 4} />
      </li>,
    );
    if (i === 5 && editorial && !chips.length && f.sort === "featured") {
      cards.push(
        <li key="editorial" className="col-span-2">
          {editorial}
        </li>,
      );
    }
  });

  const sortOptions: { v: SortKey; label: string }[] = [
    { v: "featured", label: tr.featured },
    { v: "new", label: tr.new },
    ...(book ? [{ v: "price-asc" as const, label: tr.priceAsc }, { v: "price-desc" as const, label: tr.priceDesc }] : []),
  ];

  return (
    <div>
      <div className="container-lux flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="min-w-0 flex-1">{categoryChips}</div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted tabular-nums">{tr.count(num(list.length, lang))}</span>
          <button
            type="button"
            onClick={() => {
              setDraft(f);
              setOpen(true);
            }}
            className="flex h-10 items-center gap-2 border border-line-strong px-4 text-sm text-ink transition-colors hover:border-ink"
          >
            <Icon name="filter" className="size-4" />
            {tr.filter}
            {chips.length > 0 && <span className="grid size-5 place-items-center rounded-full bg-ink text-[11px] text-bone">{num(chips.length, lang)}</span>}
          </button>
        </div>
      </div>
      {chips.length > 0 && (
        <div className="container-lux flex flex-wrap items-center gap-2 pb-4">
          {chips.map((ch) => (
            <button
              key={`${ch.key}:${ch.v}`}
              type="button"
              onClick={() => push({ ...f, [ch.key]: f[ch.key].filter((x) => x !== ch.v) })}
              className="flex h-8 items-center gap-1.5 border border-line bg-white px-3 text-xs text-ink-2 hover:border-ink"
            >
              {ch.label}
              <Icon name="close" className="size-3.5" />
            </button>
          ))}
          <button type="button" onClick={() => push({ metal: [], stone: [], collection: [], sort: f.sort })} className="h-8 px-2 text-xs text-gold-text underline-offset-4 hover:underline">
            {tr.clear}
          </button>
        </div>
      )}

      {list.length === 0 ? (
        <div className="container-lux py-24 text-center">
          <p className="text-muted">{tr.none}</p>
          <button type="button" onClick={() => push({ metal: [], stone: [], collection: [], sort: "featured" })} className="mt-5 h-11 border border-ink px-6 text-sm">
            {tr.reset}
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-px border-y border-line bg-line lg:grid-cols-3 xl:grid-cols-4">{cards}</ul>
      )}
      {list.length > limit && (
        <div className="py-12 text-center">
          <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="h-12 border border-ink px-8 text-sm transition-colors hover:bg-ink hover:text-bone">
            {tr.more}
          </button>
        </div>
      )}

      <Overlay open={open} onClose={() => setOpen(false)} label={tr.filter} variant="end" closeLabel={c.nav.close}>
        <div className="flex min-h-full flex-col">
          <div className="flex-1 space-y-8 px-6 py-6">
            <fieldset>
              <legend className="mb-3 text-sm text-ink">{tr.sort}</legend>
              <div className="space-y-1">
                {sortOptions.map((o) => (
                  <label key={o.v} className="flex h-11 cursor-pointer items-center gap-3 text-sm text-ink-2">
                    <input type="radio" name="sort" checked={draft.sort === o.v} onChange={() => setDraft((d) => ({ ...d, sort: o.v }))} className="size-4 accent-[var(--color-ink)]" />
                    {o.label}
                  </label>
                ))}
              </div>
            </fieldset>
            {(
              [
                ["metal", tr.tone, facet("metal", (["gold", "silver", "rose"] as const).map((v) => ({ v, label: c.tones[v] })))],
                ["stone", tr.stone, facet("stone", STONES.map((v) => ({ v, label: c.stones[v] })))],
                ["collection", tr.collection, facet("collection", collections.map((k) => ({ v: k.slug, label: k.name })))],
              ] as const
            ).map(([key, label, options]) =>
              options.length ? (
                <fieldset key={key}>
                  <legend className="mb-3 text-sm text-ink">{label}</legend>
                  <div className="flex flex-wrap gap-2">
                    {options.map((o) => {
                      const on = draft[key].includes(o.v);
                      return (
                        <button
                          key={o.v}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggle(key, o.v)}
                          className={`flex h-10 items-center gap-2 border px-3.5 text-sm transition-colors ${on ? "border-ink bg-ink text-bone" : "border-line-strong text-ink-2 hover:border-ink"}`}
                        >
                          {key === "metal" && <span className={`size-3 rounded-full ${o.v === "gold" ? "bg-swatch-gold" : o.v === "silver" ? "bg-swatch-silver" : "bg-swatch-rose"}`} aria-hidden />}
                          {o.label}
                          <span className={`text-xs tabular-nums ${on ? "text-bone/70" : "text-faint"}`}>{num(o.n, lang)}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null,
            )}
          </div>
          <div className="sticky bottom-0 flex gap-3 border-t border-line bg-ground px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button type="button" onClick={() => setDraft({ metal: [], stone: [], collection: [], sort: "featured" })} className="h-12 px-4 text-sm text-ink-2 underline-offset-4 hover:underline">
              {tr.clear}
            </button>
            <button
              type="button"
              onClick={() => {
                push(draft);
                setOpen(false);
              }}
              className="h-12 flex-1 bg-ink text-sm text-bone hover:bg-ink-2"
            >
              {tr.show(num(draftCount, lang))}
            </button>
          </div>
        </div>
      </Overlay>
    </div>
  );
}

/** Category chips above the grid (in-page navigation; the current one is marked). */
export function CategoryChips({ lang, items, current }: { lang: Lang; items: { slug: string; name: string }[]; current: string | null }) {
  const tr = T[lang];
  const sp = useSearchParams();
  const qs = sp?.toString() ? `?${sp.toString()}` : "";
  return (
    <nav className="-mx-[var(--gutter)] overflow-x-auto px-[var(--gutter)] [scrollbar-width:none]" aria-label={commonCopy(lang).nav.jewellery}>
      <ul className="flex w-max gap-2">
        {[{ slug: "", name: tr.all }, ...items].map((k) => {
          const on = (current ?? "") === k.slug;
          return (
            <li key={k.slug || "all"}>
              <Link
                href={`${href(lang, k.slug ? `/shop/${k.slug}` : "/shop")}${qs}`}
                aria-current={on ? "page" : undefined}
                className={`inline-flex h-10 items-center border px-4 text-sm transition-colors ${on ? "border-ink text-ink" : "border-line text-ink-2 hover:border-ink"}`}
              >
                {k.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
