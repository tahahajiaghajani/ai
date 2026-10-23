import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { getCatalog } from "@/lib/catalog";
import type { Product } from "@/lib/catalog-types";
import { env } from "@/lib/env";
import { href, num, t, type Lang } from "@/lib/i18n";
import { jsonLd } from "@/lib/seo";
import { collectionsCopy } from "@/content/copy/collections";
import { commonCopy } from "@/content/copy/common";
import type { AuraPalette } from "@/components/fx/aura";
import { Arch } from "@/components/fx/arch";
import { ArchLines } from "@/components/fx/arch-lines";
import { Magnetic } from "@/components/fx/magnetic";
import { SplitWords } from "@/components/fx/split-words";
import { ProBar } from "@/components/pro/pro-bar";
import { ProductCard } from "@/components/shop/product-card";
import { Arcade, SectionHead } from "@/components/home/sections";
import { Eyebrow } from "@/components/house/bits";
import { HouseHero } from "@/components/house/hero";

/** The light of the hero follows the collection's stones: blue/green → paraiba, red → cocoa, otherwise espresso. */
function paletteOf(products: Product[]): AuraPalette {
  const n = (ss: string[]) => products.filter((p) => ss.includes(p.stone)).length;
  const cool = n(["blue", "green", "navy"]);
  const warm = n(["red"]);
  if (cool > warm && cool * 2 >= products.length) return "paraiba";
  if (warm > cool && warm * 2 >= products.length) return "cocoa";
  return "espresso";
}

/**
 * /collections/[slug] — the collection's arch over light in its own colour (name in living metal, tagline,
 * count), its story beside a worn picture, its pieces under the Pro bar, and the other collections as an
 * arcade. Static (catalogue only, never prices); an unknown slug is a 404.
 */
export async function CollectionPage({ lang, slug }: { lang: Lang; slug: string }) {
  const catalog = await getCatalog();
  const col = catalog.collections.find((k) => k.slug === slug && k.visible !== false);
  if (!col) notFound();
  const c = collectionsCopy[lang];
  const nav = commonCopy(lang).nav;
  const name = t(col, "name", lang);
  const tagline = t(col, "tagline", lang);
  const storyText = t(col, "story", lang);
  const products = catalog.products.filter((p) => p.collection === col.slug);
  const others = catalog.collections.filter((k) => k.slug !== col.slug && k.visible !== false && k.media);
  // the story's picture: a worn (second) photo of a piece, else a cover — never the hero's own picture
  const pictures = [...products.flatMap((p) => p.images.slice(1)), ...products.map((p) => p.images[0])].filter(Boolean);
  const worn = pictures.find((m) => m.src !== col.media?.src) ?? null;
  const arches = products.length <= 8;
  const url = `${env.siteUrl}${href(lang, `/collections/${col.slug}`)}`;

  return (
    <main>
      <HouseHero
        lang={lang}
        palette={paletteOf(products)}
        size="xl"
        sparkle={14}
        crumbs={[{ label: nav.home, path: "/" }, { label: nav.collections, path: "/collections" }, { label: name }]}
        d={{ eyebrow: c.collection, title: name, subtitle: tagline, media: col.media }}
        latin={["CELIN", (col.name_en || col.slug).toUpperCase()]}
        actions={
          <>
            {products.length > 0 && (
              <Magnetic>
                <a href="#pieces" className="btn btn-metal h-13 px-8">
                  {c.see}
                  <span className="font-label text-xs tabular-nums opacity-70">{num(products.length, lang)}</span>
                </a>
              </Magnetic>
            )}
            <Link href={href(lang, "/collections")} className="group inline-flex items-center gap-2 text-sm text-on-night">
              <span className="border-b border-on-night/40 pb-1 transition-colors group-hover:border-gold-on-dark">{nav.allCollections}</span>
            </Link>
          </>
        }
      />

      {storyText && (
        <section className="relative isolate overflow-clip bg-mesh-porcelain py-20 sm:py-32">
          <div className="container-lux grid items-center gap-14 lg:grid-cols-12 lg:gap-10">
            {worn && (
              <div className="relative mx-auto w-[min(64vw,320px)] lg:col-span-4 lg:col-start-2 lg:w-full lg:max-w-[360px]" data-cursor="view">
                <ArchLines count={3} className="pointer-events-none absolute inset-x-[-20%] bottom-0 top-[-10%] h-[110%] w-[140%]" />
                <Arch media={worn} lang={lang} sizes="(min-width: 1024px) 25vw, 64vw" ring="copper" keystone unveil parallax={7} sparkle={10} />
              </div>
            )}
            <div className={worn ? "lg:col-span-6 lg:col-start-7" : "mx-auto max-w-4xl text-center lg:col-span-12"}>
              <Eyebrow center={!worn}>{c.story}</Eyebrow>
              <SplitWords as="p" text={storyText} className="display mt-6 text-[clamp(1.45rem,2.6vw,2.3rem)] leading-[1.8]! font-semibold text-ink" />
            </div>
          </div>
        </section>
      )}

      <section id="pieces" className="relative isolate scroll-mt-[var(--header-h)] bg-mesh-bone py-20 sm:py-28">
        <div className="container-lux">
          <SectionHead eyebrow={c.piecesEyebrow} title={c.piecesTitle(name)} link={{ href: href(lang, "/shop"), label: nav.all }} />
          <ProBar lang={lang} className="mt-10" />
          {products.length === 0 ? (
            <p className="py-20 text-center text-lg text-muted">{c.empty}</p>
          ) : arches ? (
            <div className={`mt-10 grid grid-cols-2 gap-x-3 gap-y-12 sm:gap-x-6 lg:gap-x-8 lg:pb-16 ${products.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"} ${products.length < 3 ? "mx-auto max-w-3xl" : ""}`}>
              {products.map((p, i) => (
                <div key={p.id} className={i % 2 === 1 ? "lg:translate-y-16" : ""} data-reveal style={{ "--d": i % 4 } as CSSProperties}>
                  <ProductCard product={p} lang={lang} collectionName={name} variant="arch" sizes="(min-width: 1024px) 25vw, 46vw" />
                </div>
              ))}
            </div>
          ) : (
            <ul className="mt-8 grid grid-cols-2 gap-px border-y border-line bg-line lg:grid-cols-3 xl:grid-cols-4">
              {products.map((p) => (
                <li key={p.id}>
                  <ProductCard product={p} lang={lang} collectionName={name} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {others.length > 0 && <Arcade lang={lang} collections={others} copy={c.others} />}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name,
            description: tagline || storyText.slice(0, 160),
            url,
            inLanguage: lang,
            mainEntity: {
              "@type": "ItemList",
              numberOfItems: products.length,
              itemListElement: products.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: `${env.siteUrl}${href(lang, `/product/${p.slug}`)}`, name: t(p, "name", lang) })),
            },
          }),
        }}
      />
    </main>
  );
}
