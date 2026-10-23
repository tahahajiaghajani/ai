import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalog, related } from "@/lib/catalog";
import { getSettings } from "@/lib/settings";
import { env } from "@/lib/env";
import { latinDigits, type Lang } from "@/lib/format";
import { href, t } from "@/lib/i18n";
import { mediaUrl } from "@/lib/media";
import { jsonLd } from "@/lib/seo";
import { commonCopy } from "@/content/copy/common";
import { productCopy } from "@/content/copy/product";
import { story } from "@/content/copy/story";
import { SectionHead } from "@/components/home/sections";
import { ProductClient } from "@/components/product/product-client";
import { ProBar } from "@/components/pro/pro-bar";
import { ProductCard } from "@/components/shop/product-card";
import { Breadcrumbs } from "@/components/shop/breadcrumbs";

const diamond = (className: string) => (
  <svg viewBox="0 0 10 10" className={className} aria-hidden>
    <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
  </svg>
);

function Accordion({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="group border-b border-gold/20" open={open}>
      <summary className="flex min-h-15 cursor-pointer list-none items-center justify-between gap-4 py-3 text-ink transition-colors hover:text-gold-deep [&::-webkit-details-marker]:hidden">
        <span className="display text-lg font-semibold">{title}</span>
        <span className="relative size-3 shrink-0 text-gold" aria-hidden>
          <span className="absolute inset-x-0 top-1/2 h-px bg-current" />
          <span className="absolute inset-y-0 start-1/2 w-px bg-current transition-transform duration-300 group-open:scale-y-0" />
        </span>
      </summary>
      <div className="pb-7 text-sm leading-8 text-ink-2">{children}</div>
    </details>
  );
}

export async function ProductPage({ lang, slug }: { lang: Lang; slug: string }) {
  const [catalog, settings] = await Promise.all([getCatalog(), getSettings()]);
  const product = catalog.products.find((p) => p.slug === slug);
  if (!product) notFound();
  const c = commonCopy(lang);
  const tr = productCopy[lang];
  const col = product.collection ? catalog.collections.find((k) => k.slug === product.collection) : null;
  const cat = product.category ? catalog.categories.find((k) => k.slug === product.category) : null;
  const colName = new Map(catalog.collections.map((k) => [k.slug, t(k, "name", lang)]));
  const same = related(catalog, product, 4);
  const description = t(product, "description", lang);
  const sameCollection = same.every((p) => p.collection === product.collection);
  const making = story[lang].chapters.find((ch) => ch.key === "craft");

  const details = (
    <div className="border-t border-gold/20">
      <Accordion title={tr.details} open>
        {description && <p className="mb-5 text-base leading-9">{description}</p>}
        {product.specs.length > 0 && (
          <dl className="divide-y divide-line border-y border-line font-ui">
            {product.specs.map((s, i) => (
              <div key={i} className="grid grid-cols-[7.5rem_1fr] gap-4 py-2.5">
                <dt className="text-muted">{t(s, "label", lang)}</dt>
                <dd className="text-ink">{t(s, "value", lang)}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-4 font-ui text-xs leading-6 text-muted">{tr.indicative}</p>
      </Accordion>
      {making && (
        <Accordion title={tr.making}>
          <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-2 font-ui text-sm text-ink">
            {tr.materials.map((m) => (
              <li key={m} className="flex items-center gap-2">
                {diamond("size-1.5 text-gold")}
                {m}
              </li>
            ))}
          </ul>
          <p>{making.text}</p>
          <Link href={href(lang, "/craft")} className="mt-3 inline-block font-ui text-gold-text underline-offset-8 hover:underline">
            {tr.makingLink}
          </Link>
        </Accordion>
      )}
      <Accordion title={tr.care}>
        <ul className="space-y-1.5">
          {tr.careText.map((l) => (
            <li key={l} className="flex items-start gap-3">
              {diamond("mt-3 size-1 shrink-0 text-gold")}
              {l}
            </li>
          ))}
        </ul>
        <p className="mt-3 font-ui text-xs leading-6 text-muted">{tr.careNote}</p>
        <Link href={href(lang, "/care")} className="mt-3 inline-block font-ui text-gold-text underline-offset-8 hover:underline">
          {c.nav.care}
        </Link>
      </Accordion>
      <Accordion title={tr.delivery}>
        <ul className="space-y-1.5">
          {tr.deliveryText.map((l) => (
            <li key={l} className="flex items-start gap-3">
              {diamond("mt-3 size-1 shrink-0 text-gold")}
              {l}
            </li>
          ))}
        </ul>
      </Accordion>
    </div>
  );

  // public structured data: no offers (no price, no availability) — prices are for Pro members only
  const ld = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: t(product, "name", lang),
    description,
    sku: product.sku,
    brand: { "@type": "Brand", name: "CELIN" },
    image: product.images.map((m) => (m.src.startsWith("http") ? mediaUrl(m, 1280) : `${env.siteUrl}${mediaUrl(m, 1280)}`)),
    url: `${env.siteUrl}${href(lang, `/product/${product.slug}`)}`,
    ...(col ? { isRelatedTo: { "@type": "Collection", name: t(col, "name", lang) } } : {}),
  };

  return (
    <main>
      <section className="relative isolate bg-mesh-porcelain pb-6 lg:pb-20">
        <div className="container-lux pt-5 pb-4 lg:pt-7 lg:pb-1">
          <Breadcrumbs
            lang={lang}
            items={[
              { label: c.nav.home, path: "/" },
              { label: c.nav.jewellery, path: "/shop" },
              ...(cat ? [{ label: t(cat, "name", lang), path: `/shop/${cat.slug}` }] : []),
              { label: t(product, "name", lang) },
            ]}
          />
        </div>
        <ProductClient
          lang={lang}
          product={product}
          collectionName={col ? t(col, "name", lang) : null}
          contact={{ whatsapp: latinDigits(settings.contact.whatsapp), phone: latinDigits(settings.contact.phone) }}
          details={details}
        />
      </section>
      {same.length > 0 && (
        <section className="relative isolate overflow-clip bg-porcelain py-20 sm:py-28">
          <span aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(55%_60%_at_88%_20%,var(--color-blush),transparent_70%),radial-gradient(50%_55%_at_5%_100%,var(--color-champagne-2),transparent_70%)]" />
          <span aria-hidden className="hairline absolute inset-x-0 top-0" />
          <div className="container-lux relative">
            <SectionHead
              eyebrow={col && sameCollection ? tr.collection(t(col, "name", lang)) : c.nav.jewellery}
              title={sameCollection ? tr.related : tr.more}
              link={col ? { href: href(lang, `/collections/${col.slug}`), label: tr.viewAll } : { href: href(lang, "/shop"), label: c.nav.all }}
            />
            <ProBar lang={lang} className="mt-10" />
            <ul className="mt-10 grid grid-cols-2 gap-x-3 gap-y-12 sm:gap-x-6 lg:grid-cols-4 lg:gap-x-8">
              {same.map((p, i) => (
                <li key={p.id} className={i % 2 === 1 ? "lg:translate-y-14" : ""} data-reveal style={{ "--d": i } as CSSProperties}>
                  <ProductCard product={p} lang={lang} collectionName={p.collection ? colName.get(p.collection) : undefined} variant="arch" sizes="(min-width: 1024px) 23vw, 46vw" />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
    </main>
  );
}
