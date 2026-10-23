import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getCatalog } from "@/lib/catalog";
import { getSlots, slotText } from "@/lib/slots";
import { num, type Lang } from "@/lib/format";
import { href, t } from "@/lib/i18n";
import { commonCopy } from "@/content/copy/common";
import { Picture } from "@/components/ui/picture";
import { ProBar } from "@/components/pro/pro-bar";
import { ProductCard } from "@/components/shop/product-card";
import { Breadcrumbs } from "@/components/shop/breadcrumbs";
import { CategoryChips, ShopGrid } from "@/components/shop/shop-grid";

/** «همه‌ی جواهرات» and the category pages: static, filters in the URL, prices only through the Pro layer. */
export async function ShopPage({ lang, category }: { lang: Lang; category?: string }) {
  const c = commonCopy(lang);
  const [catalog, slots] = await Promise.all([getCatalog(), getSlots()]);
  const cat = category ? catalog.categories.find((k) => k.slug === category) : null;
  if (category && !cat) notFound();
  const products = cat ? catalog.products.filter((p) => p.category === cat.slug) : catalog.products;
  const collections = catalog.collections.map((k) => ({ slug: k.slug, name: t(k, "name", lang) }));
  const chips = catalog.categories.map((k) => ({ slug: k.slug, name: t(k, "name", lang) }));
  const ed = slots["shop.editorial"];
  const edHref = slotText(ed, "href", lang) || "/collections";
  const editorial = ed ? (
    <Link href={href(lang, edHref)} className="group relative block h-full min-h-full bg-night text-on-night">
      <Picture media={ed.media} mobile={ed.mobile} lang={lang} className="h-full min-h-[22rem]" sizes="(min-width: 1024px) 66vw, 100vw" imgClassName="transition-transform duration-[1200ms] ease-[var(--ease-lux)] group-hover:scale-[1.02]" />
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-night/70 to-transparent px-6 pt-20 pb-6 sm:px-8">
        <span className="display block text-2xl sm:text-3xl">{slotText(ed, "title", lang)}</span>
        <span className="mt-2 inline-block border-b border-on-night/50 pb-0.5 text-sm">{slotText(ed, "cta", lang)}</span>
      </span>
    </Link>
  ) : null;
  const title = cat ? t(cat, "name", lang) : c.nav.all;
  const intro = cat ? t(cat, "description", lang) : lang === "fa" ? "نگین‌های تراش اتمی، آبکاری رودیوم، نشانده و پرداخت‌شده با دست." : "Atomic-cut stones and rhodium plating, hand-set and hand-finished.";
  const colName = new Map(collections.map((k) => [k.slug, k.name]));
  const staticGrid = (
    <ul className="grid grid-cols-2 gap-px border-y border-line bg-line lg:grid-cols-3 xl:grid-cols-4">
      {products.slice(0, 24).map((p, i) => (
        <li key={p.id}>
          <ProductCard product={p} lang={lang} collectionName={p.collection ? colName.get(p.collection) : undefined} priority={i < 4} />
        </li>
      ))}
    </ul>
  );
  return (
    <main>
      <header className="container-lux pt-8 pb-6 sm:pt-12">
        <Breadcrumbs lang={lang} items={[{ label: c.nav.home, path: "/" }, ...(cat ? [{ label: c.nav.jewellery, path: "/shop" }, { label: title }] : [{ label: c.nav.jewellery }])]} />
        <div className="mt-6 flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
          <h1 className="display text-4xl sm:text-5xl">{title}</h1>
          <p className="max-w-md text-sm leading-7 text-muted">{intro}</p>
        </div>
      </header>
      <ProBar lang={lang} className="container-lux !px-[var(--gutter)]" />
      <Suspense
        fallback={
          <>
            <div className="container-lux flex items-center justify-between py-4 text-sm text-muted">
              <span />
              <span className="tabular-nums">{lang === "fa" ? `${num(products.length, lang)} اثر` : `${products.length} pieces`}</span>
            </div>
            {staticGrid}
          </>
        }
      >
        <ShopGrid lang={lang} products={products} collections={collections} editorial={editorial} categoryChips={<CategoryChips lang={lang} items={chips} current={cat?.slug ?? null} />} />
      </Suspense>
    </main>
  );
}
