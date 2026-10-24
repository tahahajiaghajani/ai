import { Suspense, type CSSProperties } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getCatalog } from "@/lib/catalog";
import { getSlots, slotText } from "@/lib/slots";
import { num, type Lang } from "@/lib/format";
import { href, t } from "@/lib/i18n";
import { commonCopy } from "@/content/copy/common";
import { shopCopy } from "@/content/copy/shop";
import { Arch } from "@/components/fx/arch";
import { Aura } from "@/components/fx/aura";
import { Grain } from "@/components/fx/grain";
import { Melt, NightFoot } from "@/components/fx/melt";
import { SplitWords } from "@/components/fx/split-words";
import { Icon } from "@/components/ui/icons";
import { ProBar } from "@/components/pro/pro-bar";
import { Breadcrumbs } from "@/components/shop/breadcrumbs";
import { CategoryArches, CategoryArchesView } from "@/components/shop/category-arches";
import { ShopGrid, ShopGridFallback } from "@/components/shop/shop-grid";

const diamond = (className: string) => (
  <svg viewBox="0 0 10 10" className={className} aria-hidden>
    <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
  </svg>
);

/**
 * «همه‌ی جواهرات» and the category pages: a dark hero under the transparent header with the categories as an
 * arcade, the Pro bar, then the grid with its filters in the URL. Static; prices only through the Pro layer.
 */
export async function ShopPage({ lang, category }: { lang: Lang; category?: string }) {
  const c = commonCopy(lang);
  const s = shopCopy[lang];
  const [catalog, slots] = await Promise.all([getCatalog(), getSlots()]);
  const cat = category ? catalog.categories.find((k) => k.slug === category) : null;
  if (category && !cat) notFound();
  const products = cat ? catalog.products.filter((p) => p.category === cat.slug) : catalog.products;
  const collections = catalog.collections.map((k) => ({ slug: k.slug, name: t(k, "name", lang) }));
  const title = cat ? t(cat, "name", lang) : c.nav.all;
  const intro = (cat && t(cat, "description", lang)) || s.intro;

  const arches = {
    lang,
    items: catalog.categories.map((k) => ({ slug: k.slug, name: t(k, "name", lang), media: k.media, count: s.pieces(num(catalog.products.filter((p) => p.category === k.slug).length, lang)) })),
    current: cat?.slug ?? null,
    label: s.categories,
    allLabel: s.all,
    total: s.pieces(num(catalog.products.length, lang)),
  };

  // the editorial tile between the rows: an arch window on living cocoa
  const ed = slots["shop.editorial"];
  const edHref = slotText(ed, "href", lang) || "/collections";
  const editorial = ed ? (
    <Link
      href={href(lang, edHref)}
      data-tone="light"
      data-cursor="view"
      data-cursor-label={slotText(ed, "cta", lang)}
      className="group relative isolate grid h-full grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-center gap-5 overflow-hidden bg-night-2 px-5 py-8 text-on-night sm:gap-10 sm:px-10 sm:py-10"
    >
      <span aria-hidden className="absolute inset-0 -z-10 bg-mesh-cocoa" />
      <Grain />
      {/* no scroll-triggered fx inside: the tile lives in the grid's Suspense boundary (the grid reveals it) */}
      <div className="relative [--ring-gap:9px]">
        <div aria-hidden className="pointer-events-none absolute inset-x-[-34%] bottom-0 top-[-16%]">
          <svg viewBox="0 0 200 260" preserveAspectRatio="xMidYMax meet" className="size-full" fill="none" stroke="currentColor">
            {[0, 1, 2].map((i) => {
              const w = 120 + i * 40;
              const r = w / 2;
              const top = 40 - i * 20;
              return <path key={i} d={`M ${100 - r} 260 L ${100 - r} ${top + r} A ${r} ${r} 0 0 1 ${100 + r} ${top + r} L ${100 + r} 260`} vectorEffect="non-scaling-stroke" strokeWidth={1} className="text-gold-on-dark" opacity={0.38 - i * 0.1} />;
            })}
          </svg>
        </div>
        <Arch media={ed.media} mobile={ed.mobile} lang={lang} sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 26vw, 40vw" ring="champagne" keystone sparkle={10} frameClassName="fx-sheen" />
        <span aria-hidden className="absolute inset-x-[-18%] -bottom-px block h-px bg-[image:var(--metal-champagne)] opacity-60" />
      </div>
      <div className="relative">
        <p className="label flex items-center gap-2.5 text-gold-on-dark!">
          {diamond("size-1.5 text-gold-glow")}
          {s.editorial}
        </p>
        <p className="title-section mt-3 text-metal-light">{slotText(ed, "title", lang)}</p>
        <span className="mt-6 inline-flex items-center gap-2 text-sm sm:mt-8">
          <span className="border-b border-on-night/40 pb-1 transition-colors group-hover:border-gold-on-dark">{slotText(ed, "cta", lang)}</span>
          <Icon name="arrow" className="size-4 transition-transform duration-500 group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1" />
        </span>
      </div>
    </Link>
  ) : null;

  return (
    <main>
      <section data-header="dark" data-tone="light" className="under-header relative isolate overflow-clip bg-night text-on-night">
        <Aura palette="espresso" light={0.85} />
        <Grain />
        <NightFoot />
        <div className="container-lux relative pt-[calc(var(--header-h)+1.75rem)] pb-10 sm:pt-[calc(var(--header-h)+2.5rem)] sm:pb-14">
          <Breadcrumbs lang={lang} tone="light" items={[{ label: c.nav.home, path: "/" }, ...(cat ? [{ label: c.nav.jewellery, path: "/shop" }, { label: title }] : [{ label: c.nav.jewellery }])]} />
          <div className="mt-7 grid gap-x-10 gap-y-4 sm:mt-10 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <p className="label flex items-center gap-2.5 text-gold-on-dark!">
                {diamond("size-1.5 text-gold-glow")}
                {s.eyebrow}
              </p>
              <SplitWords as="h1" text={title} immediate delay={100} className="title-page mt-3" wordClassName="text-metal-light metal-live" />
            </div>
            {/* above the fold: enters from the first paint (fx-in, pure CSS), never waiting for the app */}
            <p className="fx-in lede max-w-md text-on-night-muted lg:col-span-5 lg:col-start-8 lg:justify-self-end" style={{ "--in": 2 } as CSSProperties}>
              {intro}
            </p>
          </div>
          {/* the arcade enters as one row from the first paint (CSS only: nothing touches the suspended links before they hydrate) */}
          <div className="fx-in mt-9 sm:mt-12" style={{ "--in": 3 } as CSSProperties}>
            <Suspense fallback={<CategoryArchesView {...arches} />}>
              <CategoryArches {...arches} />
            </Suspense>
          </div>
        </div>
      </section>

      <div className="relative isolate bg-mesh-porcelain pb-20 sm:pb-28">
        {/* the hero's night melts into the porcelain of the grid */}
        <Melt at="top" />
        <div className="container-lux pt-[calc(var(--melt-h)*0.72)] pb-6">
          <ProBar lang={lang} />
        </div>
        <Suspense fallback={<ShopGridFallback lang={lang} products={products} collections={collections} editorial={editorial} />}>
          <ShopGrid lang={lang} products={products} collections={collections} editorial={editorial} />
        </Suspense>
      </div>
    </main>
  );
}
