import Link from "next/link";
import type { CSSProperties } from "react";
import { getCatalog } from "@/lib/catalog";
import { href, num, t, type Lang } from "@/lib/i18n";
import { collectionsCopy } from "@/content/copy/collections";
import { Arch } from "@/components/fx/arch";
import { ArchLines } from "@/components/fx/arch-lines";
import { Aura } from "@/components/fx/aura";
import { Grain } from "@/components/fx/grain";
import { Magnetic } from "@/components/fx/magnetic";
import { SplitWords } from "@/components/fx/split-words";
import { Icon } from "@/components/ui/icons";
import { Picture } from "@/components/ui/picture";
import { Eyebrow } from "@/components/house/bits";

/**
 * /collections — every visible collection as an arcade of arch tiles on one long night ground (the header
 * stays light over it): staggered columns, a champagne sill under each arch, and on hover the collection's
 * first piece fades in through the arch. Static; no prices.
 */
export async function CollectionsPage({ lang }: { lang: Lang }) {
  const catalog = await getCatalog();
  const c = collectionsCopy[lang];
  const collections = catalog.collections.filter((k) => k.visible !== false);
  const pieces = (slug: string) => catalog.products.filter((p) => p.collection === slug);

  return (
    <main>
      <section data-header="dark" data-tone="light" className="relative isolate -mt-[var(--header-h)] overflow-clip bg-mesh-cocoa text-on-night">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[115svh]">
          <Aura palette="cocoa" light={0.9} />
          <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent to-night-2" />
        </div>
        <Grain />
        <div className="container-lux relative pt-[calc(var(--header-h)+3.5rem)] pb-28 sm:pt-[calc(var(--header-h)+5rem)] sm:pb-36">
          <div className="relative mx-auto max-w-3xl text-center">
            <ArchLines count={4} tone="champagne" immediate className="pointer-events-none absolute inset-x-[-10%] -bottom-10 top-[-40%] mx-auto h-[150%] w-[120%] opacity-70" />
            <div className="relative">
              <Eyebrow tone="light" center>
                {c.index.eyebrow}
              </Eyebrow>
              <SplitWords as="h1" text={c.index.title} immediate delay={150} className="title-page mt-5" wordClassName="text-metal-light metal-live" />
              <p className="label mt-5 text-on-night-muted!" data-reveal style={{ "--d": 4 } as CSSProperties}>
                {c.index.count(num(collections.length, lang))}
              </p>
            </div>
          </div>

          <ul className="mt-20 grid grid-cols-2 gap-x-4 gap-y-14 sm:mt-24 sm:gap-x-8 sm:gap-y-20 lg:grid-cols-4 lg:gap-x-10">
            {collections.map((k, i) => {
              const list = pieces(k.slug);
              const hover = list[0]?.images[0];
              return (
                <li key={k.slug} className={i % 2 === 1 ? "translate-y-10 lg:translate-y-24" : ""}>
                  <Link href={href(lang, `/collections/${k.slug}`)} className="group block text-center" data-cursor="view" data-cursor-label={c.index.discover}>
                    <div className="relative px-2 pt-2 sm:px-3 sm:pt-3">
                      <Arch media={k.media} lang={lang} sizes="(min-width: 1024px) 22vw, 46vw" ring="champagne" unveil delay={(i % 4) * 120} sparkle={8} frameClassName="fx-sheen" className="[--ring-gap:8px] sm:[--ring-gap:10px]" priority={i < 2}>
                        {hover && (
                          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-700 ease-[var(--ease-lux)] [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100">
                            <Picture media={hover} lang={lang} alt="" sizes="(min-width: 1024px) 22vw, 1px" className="absolute! inset-0 h-full" imgClassName="scale-105 transition-transform duration-[1.4s] ease-[var(--ease-out-expo)] group-hover:scale-100" />
                          </div>
                        )}
                        <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-night/65 via-transparent to-transparent opacity-80 transition-opacity duration-700 group-hover:opacity-40" />
                        <span aria-hidden className="absolute bottom-4 left-1/2 -translate-x-1/2 font-label text-[11px] tracking-[0.3em] text-on-night/85 ltr">{String(i + 1).padStart(2, "0")}</span>
                      </Arch>
                    </div>
                    <span aria-hidden className="mx-auto block h-px w-[112%] -translate-x-[5.4%] bg-[image:var(--metal-champagne)] opacity-50 rtl:translate-x-[5.4%]" />
                    <h2 className="title-section mt-6 text-on-night transition-colors duration-500 group-hover:text-gold-glow">{t(k, "name", lang)}</h2>
                    <p className="mx-auto mt-2 max-w-[17rem] text-sm leading-7 text-on-night-muted">{t(k, "tagline", lang)}</p>
                    {list.length > 0 && <p className="label mt-3 text-gold-on-dark!">{c.pieces(num(list.length, lang))}</p>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="relative isolate overflow-clip bg-mesh-porcelain py-24 text-center sm:py-32">
        <ArchLines count={4} className="pointer-events-none absolute inset-x-0 -bottom-6 mx-auto h-[120%] w-[min(900px,140vw)] opacity-60" />
        <div className="container-lux relative">
          <SplitWords text={c.closing.title} className="title-page mx-auto max-w-2xl text-ink" />
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4" data-reveal>
            <Magnetic>
              <Link href={href(lang, "/shop")} className="btn btn-metal h-13 px-8">
                {c.closing.shop}
                <Icon name="arrow" className="size-4 rtl:-scale-x-100" />
              </Link>
            </Magnetic>
            <Link href={href(lang, "/craft")} className="btn btn-line h-13 text-ink">
              {c.closing.craft}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
