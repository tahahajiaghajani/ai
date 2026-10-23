"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { commonCopy } from "@/content/copy/common";
import { METALS, STONES, fromPrice, type Product } from "@/lib/catalog-types";
import { num, type Lang } from "@/lib/format";
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
const TONES = ["gold", "silver", "rose"] as const;
const EMPTY: ShopFilters = { metal: [], stone: [], collection: [], sort: "featured" };

const T = {
  fa: { filter: "فیلتر و مرتب‌سازی", filterShort: "فیلتر", sort: "مرتب‌سازی", featured: "پیشنهاد سلین", new: "تازه‌ترین", priceAsc: "قیمت: کم به زیاد", priceDesc: "قیمت: زیاد به کم", tone: "رنگ پوشش", stone: "رنگ نگین", collection: "مجموعه", clear: "پاک کردن", show: (n: string) => `نمایش ${n} اثر`, count: (n: string) => `${n} اثر`, more: "نمایش بیشتر", none: "اثری با این انتخاب‌ها پیدا نشد.", reset: "نمایش همه", all: "همه", quick: "رنگ پوشش" },
  en: { filter: "Filter & sort", filterShort: "Filter", sort: "Sort", featured: "Our selection", new: "Newest", priceAsc: "Price: low to high", priceDesc: "Price: high to low", tone: "Finish", stone: "Stone color", collection: "Collection", clear: "Clear", show: (n: string) => `Show ${n} pieces`, count: (n: string) => `${n} pieces`, more: "Show more", none: "No pieces match these choices.", reset: "Show all", all: "All", quick: "Finish" },
};

const GRID = "container-lux grid grid-cols-2 gap-x-3 gap-y-10 sm:gap-x-6 sm:gap-y-14 lg:grid-cols-3 lg:gap-x-8 xl:grid-cols-4";
const toneDot = (v: string) => `size-3 shrink-0 rounded-full ring-1 ring-ink/10 ${v === "gold" ? "bg-swatch-gold" : v === "silver" ? "bg-swatch-silver" : "bg-swatch-rose"}`;
const diamond = (className: string) => (
  <svg viewBox="0 0 10 10" className={className} aria-hidden>
    <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
  </svg>
);

/**
 * Keeps a sticky bar just under the site header, which slides away while reading down and returns on the
 * way up: the bar follows the header's lower edge (rAF while the page moves) and marks itself data-stuck.
 */
function useStickUnderHeader() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = ref.current;
    const header = document.querySelector("body header");
    if (!bar || !header) return;
    let raf = 0;
    let until = 0;
    const tick = () => {
      const top = Math.max(0, header.getBoundingClientRect().bottom);
      bar.style.top = `${top.toFixed(1)}px`;
      const stuck = window.scrollY > 0 && Math.abs(bar.getBoundingClientRect().top - top) < 1.5;
      if (stuck !== bar.hasAttribute("data-stuck")) bar.toggleAttribute("data-stuck", stuck);
      raf = performance.now() < until ? requestAnimationFrame(tick) : 0;
    };
    const kick = () => {
      until = performance.now() + 700;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    kick();
    window.addEventListener("scroll", kick, { passive: true });
    window.addEventListener("resize", kick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", kick);
      window.removeEventListener("resize", kick);
    };
  }, []);
  return ref;
}

function cardsOf({ lang, list, colName, editorial, withEditorial, reveal }: { lang: Lang; list: Product[]; colName: Map<string, string>; editorial?: ReactNode; withEditorial: boolean; reveal: boolean }) {
  const cards: ReactNode[] = [];
  list.forEach((p, i) => {
    cards.push(
      <li key={p.id} data-reveal={reveal && i >= 4 ? "" : undefined} style={{ "--d": i % 4 } as CSSProperties}>
        <ProductCard product={p} lang={lang} collectionName={p.collection ? colName.get(p.collection) : undefined} priority={i < 4} ground={false} />
      </li>,
    );
    if (i === 5 && editorial && withEditorial) {
      cards.push(
        <li key="editorial" className="col-span-2" data-reveal={reveal ? "" : undefined}>
          {editorial}
        </li>,
      );
    }
  });
  return cards;
}

/** The count at the start of the bar, in Naskh. */
function Count({ lang, n }: { lang: Lang; n: number }) {
  return <span className="display text-lg font-semibold whitespace-nowrap text-ink tabular-nums">{T[lang].count(num(n, lang))}</span>;
}

/** Static first paint (before the URL filters are read): the same bar and grid, unfiltered. */
export function ShopGridFallback({ lang, products, collections, editorial }: { lang: Lang; products: Product[]; collections: { slug: string; name: string }[]; editorial?: ReactNode }) {
  const tr = T[lang];
  const colName = new Map(collections.map((k) => [k.slug, k.name]));
  return (
    <div>
      <div className="glass sticky top-0 z-30 border-y border-gold/15">
        <div className="container-lux flex h-14 items-center justify-between gap-4">
          <Count lang={lang} n={products.length} />
          <span className="btn btn-line min-h-10 px-4 text-ink opacity-60" aria-hidden>
            <Icon name="filter" className="size-4" />
            <span className="hidden sm:inline">{tr.filter}</span>
            <span className="sm:hidden">{tr.filterShort}</span>
          </span>
        </div>
      </div>
      <ul className={`${GRID} pt-10 sm:pt-12`}>{cardsOf({ lang, list: products.slice(0, PAGE), colName, editorial, withEditorial: true, reveal: false })}</ul>
    </div>
  );
}

/**
 * The listing grid with filters kept in the URL (?metal=gold&stone=paraiba&collection=nour&sort=new).
 * Filtering runs in the browser over the static product list; price sorting only exists for Pro members.
 */
export function ShopGrid({ lang, products, collections, editorial }: { lang: Lang; products: Product[]; collections: { slug: string; name: string }[]; editorial?: ReactNode }) {
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
  const bar = useStickUnderHeader();

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
  const facet = (key: "metal" | "stone" | "collection", values: { v: string; label: string }[], base: ShopFilters = draft) =>
    values
      .map((o) => ({ ...o, n: applyFilters(products, { ...base, [key]: [o.v], sort: "featured" }).length }))
      .filter((o) => o.n > 0 || base[key].includes(o.v));

  const toggle = (key: "metal" | "stone" | "collection", v: string) => setDraft((d) => ({ ...d, [key]: d[key].includes(v) ? d[key].filter((x) => x !== v) : [...d[key], v] }));
  const chips = [
    ...f.metal.map((v) => ({ key: "metal" as const, v, label: c.tones[v as keyof typeof c.tones] ?? v })),
    ...f.stone.map((v) => ({ key: "stone" as const, v, label: c.stones[v as keyof typeof c.stones] ?? v })),
    ...f.collection.map((v) => ({ key: "collection" as const, v, label: collections.find((k) => k.slug === v)?.name ?? v })),
  ];
  const quickTones = facet("metal", TONES.map((v) => ({ v, label: c.tones[v] })), f);

  const colName = useMemo(() => new Map(collections.map((k) => [k.slug, k.name])), [collections]);
  const cards = cardsOf({ lang, list: list.slice(0, limit), colName, editorial, withEditorial: !chips.length && f.sort === "featured", reveal: true });

  const sortOptions: { v: SortKey; label: string }[] = [
    { v: "featured", label: tr.featured },
    { v: "new", label: tr.new },
    ...(book ? [{ v: "price-asc" as const, label: tr.priceAsc }, { v: "price-desc" as const, label: tr.priceDesc }] : []),
  ];
  const pill = (on: boolean, large = false) => `flex items-center gap-2 rounded-full border px-3.5 font-ui transition-colors duration-300 ${large ? "h-10 text-sm" : "h-9 text-xs"} ${on ? "border-ink bg-ink text-bone" : "border-line-strong bg-porcelain/60 text-ink-2 hover:border-ink hover:text-ink"}`;

  return (
    <div>
      {/* the bar: count · quick finish chips · filter & sort */}
      <div ref={bar} className="group/bar glass sticky top-0 z-30 border-y border-gold/15 transition-shadow duration-500 data-stuck:shadow-[0_18px_36px_-28px_rgb(26_19_16/0.45)]">
        <div className="container-lux flex h-14 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-6">
            <Count lang={lang} n={list.length} />
            {quickTones.length > 1 && (
              <div className="hidden items-center gap-2 lg:flex" role="group" aria-label={tr.quick}>
                <span aria-hidden className="me-1 h-5 w-px bg-line-strong" />
                {quickTones.map((o) => {
                  const on = f.metal.includes(o.v);
                  return (
                    <button key={o.v} type="button" aria-pressed={on} onClick={() => push({ ...f, metal: on ? f.metal.filter((x) => x !== o.v) : [...f.metal, o.v] })} className={pill(on)}>
                      <span className={toneDot(o.v)} aria-hidden />
                      {o.label}
                      <span className={`tabular-nums ${on ? "text-bone/70" : "text-faint"}`}>{num(o.n, lang)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setDraft(f);
              setOpen(true);
            }}
            className="btn btn-line min-h-10 shrink-0 px-4 text-ink"
          >
            <Icon name="filter" className="size-4" />
            <span className="hidden sm:inline">{tr.filter}</span>
            <span className="sm:hidden">{tr.filterShort}</span>
            {chips.length > 0 && <span className="grid size-5 place-items-center rounded-full bg-metal text-[11px] text-ink">{num(chips.length, lang)}</span>}
          </button>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="container-lux flex flex-wrap items-center gap-2 pt-5">
          {chips.map((ch) => (
            <button key={`${ch.key}:${ch.v}`} type="button" onClick={() => push({ ...f, [ch.key]: f[ch.key].filter((x) => x !== ch.v) })} className={pill(false)} aria-label={`${ch.label} — ${tr.clear}`}>
              {ch.key === "metal" && <span className={toneDot(ch.v)} aria-hidden />}
              {ch.label}
              <Icon name="close" className="size-3.5" />
            </button>
          ))}
          <button type="button" onClick={() => push({ ...EMPTY, sort: f.sort })} className="h-9 px-2 font-ui text-xs text-gold-text underline-offset-4 hover:underline">
            {tr.clear}
          </button>
        </div>
      )}

      {list.length === 0 ? (
        <div className="container-lux py-24 text-center sm:py-32">
          {diamond("mx-auto size-2.5 text-gold")}
          <p className="display mt-5 text-2xl font-semibold text-ink sm:text-3xl">{tr.none}</p>
          <button type="button" onClick={() => push(EMPTY)} className="btn btn-line mt-8 text-ink">
            {tr.reset}
          </button>
        </div>
      ) : (
        <ul className={`${GRID} pt-10 sm:pt-12`}>{cards}</ul>
      )}
      {list.length > limit && (
        <div className="flex flex-col items-center gap-4 pt-16 text-center">
          <span className="font-ui text-xs text-muted tabular-nums">
            {num(Math.min(limit, list.length), lang)} / {num(list.length, lang)}
          </span>
          <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="btn btn-line px-10 text-ink">
            {tr.more}
          </button>
        </div>
      )}

      <Overlay open={open} onClose={() => setOpen(false)} label={tr.filter} variant="end" closeLabel={c.nav.close}>
        <div className="flex min-h-full flex-col bg-mesh-porcelain">
          <div className="flex-1 space-y-9 px-6 py-7">
            <fieldset>
              <legend className="label mb-3 flex items-center gap-2 text-gold-text!">
                {diamond("size-1.5 text-gold")}
                {tr.sort}
              </legend>
              <div className="divide-y divide-line border-y border-line">
                {sortOptions.map((o) => (
                  <label key={o.v} className="flex h-12 cursor-pointer items-center justify-between gap-3 text-sm text-ink-2 has-checked:text-ink">
                    {o.label}
                    <input type="radio" name="sort" checked={draft.sort === o.v} onChange={() => setDraft((d) => ({ ...d, sort: o.v }))} className="size-4 accent-[var(--color-gold)]" />
                  </label>
                ))}
              </div>
            </fieldset>
            {(
              [
                ["metal", tr.tone, facet("metal", TONES.map((v) => ({ v, label: c.tones[v] })))],
                ["stone", tr.stone, facet("stone", STONES.map((v) => ({ v, label: c.stones[v] })))],
                ["collection", tr.collection, facet("collection", collections.map((k) => ({ v: k.slug, label: k.name })))],
              ] as const
            ).map(([key, label, options]) =>
              options.length ? (
                <fieldset key={key}>
                  <legend className="label mb-3 flex items-center gap-2 text-gold-text!">
                    {diamond("size-1.5 text-gold")}
                    {label}
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {options.map((o) => {
                      const on = draft[key].includes(o.v);
                      return (
                        <button key={o.v} type="button" aria-pressed={on} onClick={() => toggle(key, o.v)} className={pill(on, true)}>
                          {key === "metal" && <span className={toneDot(o.v)} aria-hidden />}
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
          <div className="glass sticky bottom-0 flex items-center gap-3 border-t border-gold/20 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button type="button" onClick={() => setDraft(EMPTY)} className="h-12 px-3 font-ui text-sm text-ink-2 underline-offset-4 hover:underline">
              {tr.clear}
            </button>
            <button
              type="button"
              onClick={() => {
                push(draft);
                setOpen(false);
              }}
              className="btn btn-ink flex-1"
            >
              {tr.show(num(draftCount, lang))}
            </button>
          </div>
        </div>
      </Overlay>
    </div>
  );
}
