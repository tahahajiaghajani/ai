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
import { ProductClient } from "@/components/product/product-client";
import { ProductCard } from "@/components/shop/product-card";
import { Breadcrumbs } from "@/components/shop/breadcrumbs";

function Accordion({ title, children, open }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="group border-b border-line" open={open}>
      <summary className="flex h-14 cursor-pointer list-none items-center justify-between text-sm text-ink [&::-webkit-details-marker]:hidden">
        {title}
        <span className="relative size-3" aria-hidden>
          <span className="absolute inset-x-0 top-1/2 h-px bg-ink" />
          <span className="absolute inset-y-0 start-1/2 w-px bg-ink transition-transform duration-300 group-open:scale-y-0" />
        </span>
      </summary>
      <div className="pb-6 text-sm leading-8 text-ink-2">{children}</div>
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

  const details = (
    <div className="border-t border-line">
      <Accordion title={tr.details} open>
        {description && <p className="mb-5">{description}</p>}
        {product.specs.length > 0 && (
          <dl className="divide-y divide-line border-y border-line">
            {product.specs.map((s, i) => (
              <div key={i} className="grid grid-cols-[8rem_1fr] gap-4 py-2.5">
                <dt className="text-muted">{t(s, "label", lang)}</dt>
                <dd className="text-ink">{t(s, "value", lang)}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-4 text-xs leading-6 text-muted">{tr.indicative}</p>
      </Accordion>
      <Accordion title={tr.care}>
        <ul className="space-y-1.5">
          {tr.careText.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-6 text-muted">{tr.careNote}</p>
        <Link href={href(lang, "/care")} className="mt-3 inline-block text-gold-text underline-offset-8 hover:underline">
          {c.nav.care}
        </Link>
      </Accordion>
      <Accordion title={tr.delivery}>
        <ul className="space-y-1.5">
          {tr.deliveryText.map((l) => (
            <li key={l}>{l}</li>
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
    <main className="pb-16">
      <div className="container-lux pt-6 pb-2 lg:pt-8">
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
      {same.length > 0 && (
        <section className="mt-16 border-t border-line pt-14 lg:mt-24">
          <div className="container-lux mb-8 flex items-end justify-between gap-6">
            <h2 className="display text-3xl">{same.every((p) => p.collection === product.collection) ? tr.related : tr.more}</h2>
            {col && (
              <Link href={href(lang, `/collections/${col.slug}`)} className="text-sm text-gold-text underline-offset-8 hover:underline">
                {tr.viewAll}
              </Link>
            )}
          </div>
          <ul className="grid grid-cols-2 gap-px border-y border-line bg-line lg:grid-cols-4">
            {same.map((p) => (
              <li key={p.id}>
                <ProductCard product={p} lang={lang} collectionName={p.collection ? colName.get(p.collection) : undefined} sizes="(min-width: 1024px) 25vw, 50vw" />
              </li>
            ))}
          </ul>
        </section>
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
    </main>
  );
}
