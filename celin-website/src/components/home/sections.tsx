import Link from "next/link";
import type { CSSProperties } from "react";
import type { Collection, Product } from "@/lib/catalog-types";
import { num, type Lang } from "@/lib/format";
import { href, t } from "@/lib/i18n";
import { mediaUrl, type Media } from "@/lib/media";
import { Arch } from "@/components/fx/arch";
import { ArchLines } from "@/components/fx/arch-lines";
import { Grain } from "@/components/fx/grain";
import { Marquee } from "@/components/fx/marquee";
import { Reel } from "@/components/fx/reel";
import { SplitWords } from "@/components/fx/split-words";
import { Icon } from "@/components/ui/icons";
import { Picture } from "@/components/ui/picture";
import { ProBar } from "@/components/pro/pro-bar";
import { ProductCard } from "@/components/shop/product-card";

const diamond = (className = "size-2 text-gold") => (
  <svg viewBox="0 0 10 10" className={className} aria-hidden>
    <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
  </svg>
);

/** Section heading: a small label with a diamond, a large Naskh title (words rise), an optional link. */
export function SectionHead({ eyebrow, title, link, tone = "dark", align = "start", className = "" }: { eyebrow: string; title: string; link?: { href: string; label: string }; tone?: "dark" | "light"; align?: "start" | "center"; className?: string }) {
  return (
    <div className={`flex flex-wrap items-end gap-x-10 gap-y-6 ${align === "center" ? "flex-col items-center text-center" : "justify-between"} ${className}`}>
      <div className={align === "center" ? "max-w-3xl" : "max-w-2xl"}>
        <p className={`label flex items-center gap-2.5 ${align === "center" ? "justify-center" : ""} ${tone === "light" ? "text-gold-on-dark!" : "text-gold-text!"}`}>
          {diamond(`size-1.5 ${tone === "light" ? "text-gold-glow" : "text-gold"}`)}
          {eyebrow}
        </p>
        <SplitWords text={title} className={`display mt-3 text-[2.125rem] leading-[1.4]! font-bold sm:text-5xl ${tone === "light" ? "text-on-night" : "text-ink"}`} />
      </div>
      {link && (
        <Link href={link.href} className={`group inline-flex items-center gap-2 text-sm ${tone === "light" ? "text-on-night" : "text-ink"}`}>
          <span className={`border-b pb-1 transition-colors ${tone === "light" ? "border-on-night/40 group-hover:border-gold-on-dark" : "border-ink/30 group-hover:border-gold"}`}>{link.label}</span>
          <Icon name="arrow" className="size-4 transition-transform duration-500 group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1" />
        </Link>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ribbon

export function Ribbon({ items }: { items: string[] }) {
  return (
    <section aria-hidden className="relative overflow-clip border-y border-gold/25 bg-mesh-bone py-6 sm:py-8">
      <Marquee items={items} seconds={46} itemClassName="display text-3xl font-semibold text-metal sm:text-5xl" />
    </section>
  );
}

// ------------------------------------------------------------------ statement

/** One large sentence on three lines with two small arch pictures set between the words. */
export function Statement({ lang, lines, a, b }: { lang: Lang; lines: [string, string, string]; a: Media; b: Media }) {
  const inline = (m: Media, delay: number) => (
    <div className="mx-[0.18em] inline-block w-[0.78em] translate-y-[0.1em] align-baseline">
      <Arch media={m} lang={lang} sizes="120px" ratio="78/105" unveil delay={delay} alt="" />
    </div>
  );
  return (
    <section className="relative isolate overflow-clip bg-mesh-porcelain py-24 sm:py-36">
      <ArchLines count={4} className="pointer-events-none absolute inset-x-0 -bottom-8 mx-auto h-[115%] w-[min(1100px,140vw)] opacity-70" />
      <div className="container-lux relative text-center">
        <div className="display text-[clamp(2.1rem,5.6vw,5rem)] leading-[1.4] font-bold text-ink">
          <div>
            <SplitWords as="span" text={lines[0]} />
            {inline(a, 300)}
          </div>
          <SplitWords as="div" text={lines[1]} delay={250} wordClassName="text-metal metal-live" />
          <div>
            {inline(b, 600)}
            <SplitWords as="span" text={lines[2]} delay={450} />
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ the arcade of collections

export function Arcade({ lang, collections, copy }: { lang: Lang; collections: Collection[]; copy: { eyebrow: string; title: string; all: string; discover: string } }) {
  return (
    <section data-tone="light" className="relative isolate bg-mesh-cocoa text-on-night">
      <Grain />
      <Reel
        className="py-20 sm:py-28 lg:flex lg:min-h-[100svh] lg:flex-col lg:justify-center lg:py-16"
        header={
          <div className="container-lux">
            <SectionHead eyebrow={copy.eyebrow} title={copy.title} tone="light" link={{ href: href(lang, "/collections"), label: copy.all }} />
          </div>
        }
        trackClassName="mt-12 gap-[max(1.25rem,3vw)] px-[var(--gutter)] pb-4 lg:mt-14"
      >
        {collections.map((c, i) => (
          <Link
            key={c.slug}
            href={href(lang, `/collections/${c.slug}`)}
            className="group w-[68vw] shrink-0 snap-start sm:w-[42vw] lg:w-[clamp(260px,23vw,360px)]"
            data-cursor="view"
            data-cursor-label={copy.discover}
          >
            <div className="relative px-3 pt-3">
              <Arch media={c.media} lang={lang} sizes="(min-width: 1024px) 23vw, (min-width: 640px) 42vw, 68vw" ring="champagne" sparkle={8} frameClassName="fx-sheen" className="[--ring-gap:10px]" />
              <span className="pointer-events-none absolute inset-x-3 bottom-0 top-3 rounded-t-full bg-gradient-to-t from-night/70 via-transparent to-transparent opacity-80 transition-opacity duration-700 group-hover:opacity-40" aria-hidden />
              <span className="absolute bottom-5 left-1/2 -translate-x-1/2 font-label text-xs tracking-[0.3em] text-on-night/80 ltr">{String(i + 1).padStart(2, "0")}</span>
            </div>
            <div className="mt-6 text-center">
              <h3 className="display text-3xl font-bold text-on-night transition-colors duration-500 group-hover:text-gold-glow">{t(c, "name", lang)}</h3>
              <p className="mx-auto mt-2 max-w-[16rem] text-sm leading-7 text-on-night-muted">{t(c, "tagline", lang)}</p>
            </div>
          </Link>
        ))}
      </Reel>
    </section>
  );
}

// ------------------------------------------------------------------ featured pieces (with the Pro bar above them)

export function Featured({ lang, products, collectionNames, copy }: { lang: Lang; products: Product[]; collectionNames: Record<string, string>; copy: { eyebrow: string; title: string; all: string } }) {
  return (
    <section className="relative isolate bg-mesh-porcelain py-20 sm:py-28">
      <div className="container-lux">
        <SectionHead eyebrow={copy.eyebrow} title={copy.title} link={{ href: href(lang, "/shop"), label: copy.all }} />
        <ProBar lang={lang} className="mt-10" />
        <div className="mt-8 grid grid-cols-2 gap-x-3 gap-y-10 sm:gap-x-6 lg:grid-cols-4 lg:gap-x-8">
          {products.map((p, i) => (
            <div key={p.id} className={i % 2 === 1 ? "lg:translate-y-16" : ""} data-reveal style={{ "--d": i % 4 } as CSSProperties}>
              <ProductCard product={p} lang={lang} collectionName={p.collection ? collectionNames[p.collection] : undefined} variant="arch" sizes="(min-width: 1024px) 23vw, 46vw" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ craft: four cards that stack as you read

export interface CraftStep {
  title: string;
  body: string;
  media: Media;
}

export function Craft({ lang, steps, copy }: { lang: Lang; steps: CraftStep[]; copy: { eyebrow: string; title: string; body: string; link: string } }) {
  return (
    <section className="relative isolate bg-mesh-bone py-20 sm:py-28">
      <div className="container-lux grid gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-[calc(var(--header-h)+3rem)]">
            <SectionHead eyebrow={copy.eyebrow} title={copy.title} />
            <p className="mt-6 max-w-sm text-lg leading-9 text-muted">{copy.body}</p>
            <Link href={href(lang, "/craft")} className="btn btn-ink mt-9">
              {copy.link}
            </Link>
          </div>
        </div>
        <ol className="space-y-6 lg:col-span-8 lg:col-start-5">
          {steps.map((s, i) => (
            <li key={i} className="sticky" style={{ top: `calc(var(--header-h) + 1.5rem + ${i * 1.75}rem)` }}>
              <article className="relative grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-center gap-5 overflow-hidden border border-gold/20 bg-porcelain p-4 shadow-[0_30px_60px_-40px_rgb(26_19_16/0.45)] sm:gap-10 sm:p-8">
                <span aria-hidden className="absolute inset-0 bg-[radial-gradient(60%_80%_at_100%_0%,rgb(230_208_171/0.35),transparent_70%)]" />
                <Arch media={s.media} lang={lang} sizes="(min-width: 1024px) 24vw, 38vw" ring="copper" parallax={5} className="relative [--ring-gap:7px]" />
                <div className="relative">
                  <span className="display block text-5xl font-bold text-metal sm:text-7xl">{num(String(i + 1).padStart(2, "0"), lang)}</span>
                  <h3 className="display mt-2 text-2xl font-bold text-ink sm:mt-4 sm:text-4xl">{s.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-muted sm:mt-4 sm:text-lg sm:leading-9">{s.body}</p>
                </div>
              </article>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ the house

export function House({ lang, d }: { lang: Lang; d: { eyebrow: string; title: string; body: string; cta: string; href: string; media: Media; mobile: Media | null; signature: string; signatureLabel: string } }) {
  return (
    <section className="relative isolate overflow-clip py-20 sm:py-32" style={{ background: "radial-gradient(60% 70% at 85% 30%, rgb(239 220 205 / 0.9), transparent 70%), radial-gradient(50% 60% at 0% 100%, rgb(230 208 171 / 0.5), transparent 70%), var(--color-porcelain)" }}>
      <div className="container-lux grid items-center gap-14 lg:grid-cols-12 lg:gap-10">
        <div className="relative mx-auto w-[min(80vw,460px)] lg:order-2 lg:col-span-5 lg:col-start-8 lg:w-full" data-cursor="view">
          <ArchLines count={3} className="pointer-events-none absolute inset-x-[-22%] bottom-0 top-[-10%] h-[110%] w-[144%]" />
          <Link href={href(lang, d.href)} aria-label={d.cta} className="block">
            <Arch media={d.media} mobile={d.mobile} lang={lang} sizes="(min-width: 1024px) 34vw, 80vw" ring="copper" keystone unveil parallax={8} sparkle={10} />
          </Link>
        </div>
        <div className="lg:col-span-6">
          <p className="label flex items-center gap-2.5 text-gold-text!">
            {diamond("size-1.5 text-gold")}
            {d.eyebrow}
          </p>
          <SplitWords text={d.title} className="display mt-4 text-[2.5rem] leading-[1.35]! font-bold text-ink sm:text-6xl" />
          <p className="mt-7 max-w-xl text-lg leading-10 text-ink-2" data-reveal>
            {d.body}
          </p>
          <p className="display mt-10 text-4xl font-bold text-metal metal-live sm:text-5xl" aria-label={d.signatureLabel} data-reveal style={{ "--d": 2 } as CSSProperties}>
            <span aria-hidden>{d.signature}</span>
          </p>
          <Link href={href(lang, d.href)} className="btn btn-line mt-10 text-ink" data-reveal style={{ "--d": 3 } as CSSProperties}>
            {d.cta}
          </Link>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ twenty years

export interface AnniversaryData {
  eyebrow: string;
  number: string;
  title: string;
  subtitle: string;
  body: string;
  body2: string;
  closing: string;
  cta: string;
  href: string;
  media: Media;
}

/**
 * «۲۰ سال درخشش»: a huge numeral filled with a photograph that drifts inside the glyph as the page scrolls
 * (the Persian zero is drawn as the brand's rhombus, as in Naskh calligraphy), beside the launch letter.
 */
export function Anniversary({ lang, d }: { lang: Lang; d: AnniversaryData }) {
  const fill: CSSProperties = { backgroundImage: `url("${mediaUrl(d.media, 960)}")`, backgroundSize: "cover", backgroundPosition: `${d.media.fx}% ${d.media.fy}%` };
  const digits = num(d.number, lang);
  // Persian zeros become the copper rhombus; other digits are photo-filled glyphs
  const parts = lang === "fa" ? digits.split(/(۰)/).filter(Boolean) : [digits];
  return (
    <section className="relative isolate overflow-clip py-20 sm:py-32" style={{ background: "radial-gradient(55% 60% at 15% 40%, rgb(230 208 171 / 0.75), transparent 70%), radial-gradient(45% 55% at 95% 90%, rgb(60 202 190 / 0.08), transparent 70%), var(--mesh-bone)" }}>
      <div className="container-lux grid items-center gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="relative flex justify-center lg:col-span-6" aria-label={`${digits} ${lang === "fa" ? "سال" : "years"}`} role="img">
          <ArchLines count={4} className="pointer-events-none absolute inset-x-[-10%] bottom-[-6%] top-[-8%] h-[114%] w-[120%]" />
          <span className="ltr relative flex items-center" aria-hidden>
            {parts.map((p, i) =>
              p === "۰" ? (
                <svg key={i} viewBox="0 0 10 14" className="mx-[0.02em] h-[clamp(4.5rem,9vw,8rem)] w-auto self-end mb-[12%]">
                  <defs>
                    <linearGradient id="ann-rh" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#6e3f1f" />
                      <stop offset="0.45" stopColor="#d9a273" />
                      <stop offset="0.6" stopColor="#f6d9b4" />
                      <stop offset="1" stopColor="#8a5230" />
                    </linearGradient>
                  </defs>
                  <path d="M5 0 10 7 5 14 0 7Z" fill="url(#ann-rh)" />
                </svg>
              ) : (
                <span
                  key={i}
                  className="fx-pan display block bg-clip-text text-[clamp(13rem,30vw,28rem)] leading-[1.05]! font-bold text-transparent [-webkit-text-stroke:1px_rgb(156_94_52/0.45)]"
                  style={fill}
                >
                  {p}
                </span>
              ),
            )}
          </span>
        </div>
        <div className="lg:col-span-6">
          <p className="label flex items-center gap-2.5 text-gold-text!">
            {diamond("size-1.5 text-gold")}
            <span className="ltr">{d.eyebrow}</span>
          </p>
          <SplitWords text={d.title} className="display mt-4 text-[2.5rem] leading-[1.35]! font-bold text-ink sm:text-6xl" />
          <p className="display mt-3 text-2xl font-semibold text-metal sm:text-3xl" data-reveal>
            {d.subtitle}
          </p>
          <div className="mt-8 max-w-xl space-y-5 text-lg leading-10 text-ink-2">
            <p data-reveal style={{ "--d": 1 } as CSSProperties}>{d.body}</p>
            <p data-reveal style={{ "--d": 2 } as CSSProperties}>{d.body2}</p>
          </div>
          <p className="mt-8 max-w-xl border-s-2 border-gold/60 ps-5 text-xl leading-10 font-semibold text-ink" data-reveal style={{ "--d": 3 } as CSSProperties}>
            {d.closing}
          </p>
          <Link href={href(lang, d.href)} className="btn btn-ink mt-10" data-reveal style={{ "--d": 4 } as CSSProperties}>
            {d.cta}
          </Link>
        </div>
      </div>
    </section>
  );
}

export { diamond };
