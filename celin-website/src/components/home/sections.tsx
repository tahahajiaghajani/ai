import Link from "next/link";
import type { CSSProperties } from "react";
import type { Collection, Product } from "@/lib/catalog-types";
import { num, type Lang } from "@/lib/format";
import { href, t } from "@/lib/i18n";
import type { Media } from "@/lib/media";
import { Arch } from "@/components/fx/arch";
import { ArchLines } from "@/components/fx/arch-lines";
import { Grain } from "@/components/fx/grain";
import { Reel } from "@/components/fx/reel";
import { SplitWords } from "@/components/fx/split-words";
import { Icon } from "@/components/ui/icons";
import { ProBar } from "@/components/pro/pro-bar";
import { ProductCard } from "@/components/shop/product-card";

const diamond = (className = "size-2 text-gold") => (
  <svg viewBox="0 0 10 10" className={className} aria-hidden>
    <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
  </svg>
);

/**
 * Section heading: a small label with a diamond, a Nazli title (words rise), an optional link. Inner pages get
 * the quiet `title-section` scale; the home page passes `display` for its large showcase scale.
 */
export function SectionHead({ eyebrow, title, link, tone = "dark", align = "start", display = false, className = "" }: { eyebrow: string; title: string; link?: { href: string; label: string }; tone?: "dark" | "light"; align?: "start" | "center"; display?: boolean; className?: string }) {
  return (
    <div className={`flex flex-wrap gap-x-10 gap-y-6 ${align === "center" ? "flex-col items-center text-center" : "items-end justify-between"} ${className}`}>
      <div className={align === "center" ? "max-w-3xl" : "max-w-2xl"}>
        <p className={`label flex items-center gap-2.5 ${align === "center" ? "justify-center" : ""} ${tone === "light" ? "text-gold-on-dark!" : "text-gold-text!"}`}>
          {diamond(`size-1.5 ${tone === "light" ? "text-gold-glow" : "text-gold"}`)}
          {eyebrow}
        </p>
        <SplitWords text={title} className={`${display ? "display text-[2.125rem] leading-[1.4]! sm:text-5xl" : "title-section"} mt-3 ${tone === "light" ? "text-on-night" : "text-ink"}`} />
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

// ------------------------------------------------------------------ statement

/**
 * «برای کسانی که زیبایی را در جزئیات می‌بینند…» as an editorial spread, right under the hero: the hero's night
 * melts into porcelain through a tall dawn (bg-dawn) while an asymmetric collage straddles the turn — a tall arch
 * with a copper ring and keystone (home.statement), a smaller matted arch at another scale overlapping its lower
 * corner (home.statement.b) — and the three lines stand in the light beside it, the middle one in living metal,
 * signed with the monogram. Depth: the hairline arcade, the tall arch and the small one drift at three speeds and
 * the spread rises in as it arrives (CSS scroll timelines: no JS, still with reduced motion). Phones: the collage
 * above the words, the pictures stay large.
 */
export function Statement({ lang, lines, a, b, copy }: { lang: Lang; lines: [string, string, string]; a: Media; b: Media; copy: { eyebrow: string; seal: string } }) {
  return (
    <section className="relative isolate overflow-clip bg-dawn pt-[clamp(4.5rem,10vh,7rem)] pb-[clamp(10rem,24vh,13rem)] text-ink lg:pb-[clamp(14rem,32vh,18rem)]">
      {/* the hero's grain carries on over the dark part of the dawn */}
      <span aria-hidden className="grain -z-10 [mask-image:linear-gradient(to_bottom,black,transparent_45%)]" />
      <div className="container-lux relative grid gap-y-14 lg:grid-cols-12 lg:gap-x-10">
        {/* the collage (start side) */}
        <div className="fx-arrive relative lg:col-span-6 lg:col-start-1">
          <div className="relative me-[18%] sm:me-[30%] lg:me-[24%] xl:me-[28%]">
            <div aria-hidden className="fx-drift pointer-events-none absolute inset-x-[-26%] bottom-[-4%] top-[-14%] [--drift:56px]">
              <ArchLines count={5} tone="champagne" className="size-full opacity-80" />
            </div>
            <div className="fx-drift relative [--drift:22px]" data-cursor="view">
              <Arch media={a} lang={lang} alt="" sizes="(min-width: 1024px) 30vw, 72vw" ratio="3/4.25" ring="champagne" keystone unveil sparkle={12} className="[--ring-gap:12px]" />
            </div>
            {/* a vertical Latin line along the tall arch (large screens) */}
            <span aria-hidden className="absolute top-[38%] hidden font-label text-[10px] tracking-[0.36em] text-gold-text [writing-mode:vertical-rl] ltr xl:block ltr:-left-12 rtl:-right-12">
              ETEMAD GALLERY · SINCE 2006
            </span>
          </div>
          {/* the second arch: another scale, matted, overlapping the tall one lower down and nearer the words */}
          <div className="fx-drift absolute end-0 bottom-[-14%] w-[46%] [--drift:-46px] sm:w-[40%] lg:w-[42%]" data-reveal style={{ "--d": 3 } as CSSProperties}>
            <div className="arch bg-porcelain p-[5px] shadow-[0_44px_80px_-36px_rgb(26_19_16/0.55)] sm:p-2">
              <Arch media={b} lang={lang} alt="" sizes="(min-width: 1024px) 15vw, 46vw" ratio="3/4" sparkle={6} />
            </div>
            <span aria-hidden className="mt-3 block text-center font-label text-[10px] tracking-[0.32em] text-gold-text ltr">N° 02</span>
          </div>
          <span aria-hidden className="absolute start-[2%] bottom-[-7%] hidden font-label text-[10px] tracking-[0.32em] text-gold-text sm:block">
            <span className="ltr">N° 01</span>
          </span>
        </div>

        {/* the words, in the light */}
        <div className="fx-arrive relative mt-[12%] text-center sm:mt-[10%] lg:col-span-6 lg:col-start-7 lg:mt-0 lg:self-end lg:pb-[2%] lg:text-start">
          <p className="label flex items-center justify-center gap-2.5 text-gold-text! lg:justify-start">
            {diamond("size-1.5 text-gold")}
            {copy.eyebrow}
          </p>
          <h2 className="display mt-6 text-[clamp(2rem,1.4rem+1.6vw,2.6rem)] leading-[1.55]! text-ink [&:lang(en)]:leading-[1.22]!">
            <SplitWords as="span" text={lines[0]} className="block" />
            <SplitWords as="span" text={lines[1]} delay={200} className="block" wordClassName="text-metal metal-live" />
            <SplitWords as="span" text={lines[2]} delay={400} className="block" />
          </h2>
          <div className="mt-9 flex items-center justify-center gap-5 lg:justify-start" data-reveal style={{ "--d": 3 } as CSSProperties}>
            <span aria-hidden className="hairline w-20" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/celin-mark.svg" alt={copy.seal} className="h-11 w-auto" />
            <span aria-hidden className="hairline w-20 lg:hidden" />
          </div>
        </div>
      </div>
      {/* the light gives way to the cocoa of the collections below */}
      <span aria-hidden className="bg-dusk pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[clamp(8rem,20vh,12rem)]" />
    </section>
  );
}

// ------------------------------------------------------------------ the arcade of collections

export function Arcade({ lang, collections, copy, display = false }: { lang: Lang; collections: Collection[]; copy: { eyebrow: string; title: string; all: string; discover: string }; display?: boolean }) {
  return (
    <section data-tone="light" className="relative isolate bg-night-2 text-on-night">
      {/* plain night-2 at both edges, so the bands above and below melt into it; the lights fade in between */}
      <span aria-hidden className="absolute inset-0 -z-10 bg-mesh-cocoa [mask-image:linear-gradient(to_bottom,transparent,black_14rem,black_calc(100%-12rem),transparent)]" />
      <Grain />
      <Reel
        className="py-20 sm:py-28 lg:flex lg:min-h-[100svh] lg:flex-col lg:justify-center lg:py-16"
        header={
          <div className="container-lux">
            <SectionHead eyebrow={copy.eyebrow} title={copy.title} tone="light" display={display} link={{ href: href(lang, "/collections"), label: copy.all }} />
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
              <h3 className={`${display ? "display text-3xl" : "title-section"} text-on-night transition-colors duration-500 group-hover:text-gold-glow`}>{t(c, "name", lang)}</h3>
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
    <section className="relative isolate bg-mesh-porcelain pt-36 pb-20 sm:pt-44 sm:pb-28">
      <span aria-hidden className="bg-tide pointer-events-none absolute inset-x-0 top-0 -z-10 h-[clamp(7rem,18vh,11rem)]" />
      <div className="container-lux">
        <SectionHead eyebrow={copy.eyebrow} title={copy.title} display link={{ href: href(lang, "/shop"), label: copy.all }} />
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
            <SectionHead eyebrow={copy.eyebrow} title={copy.title} display />
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
}

/**
 * «۲۰ سال درخشش»: a huge numeral in plain polished copper — every digit in the same metal as the brand's rhombus
 * (the Persian zero, drawn as in Naskh calligraphy), crisp, no photograph — beside the launch letter.
 */
export function Anniversary({ lang, d }: { lang: Lang; d: AnniversaryData }) {
  const digits = num(d.number, lang);
  // Persian zeros become the copper rhombus; the other digits are glyphs in the same metal
  const parts = lang === "fa" ? digits.split(/(۰)/).filter(Boolean) : [digits];
  return (
    <section className="relative isolate overflow-clip py-28 sm:py-40" style={{ background: "radial-gradient(55% 60% at 15% 40%, rgb(230 208 171 / 0.75), transparent 70%), radial-gradient(45% 55% at 95% 90%, rgb(60 202 190 / 0.08), transparent 70%), var(--mesh-bone)" }}>
      {/* the cocoa night above melts into the bone, and the bone into the night of the paraiba band below */}
      <span aria-hidden className="bg-dusk pointer-events-none absolute inset-x-0 top-0 -z-10 h-[clamp(6rem,14vh,9rem)] rotate-180" />
      <span aria-hidden className="bg-dusk pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[clamp(6rem,14vh,9rem)]" />
      <div className="container-lux grid items-center gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="relative flex justify-center lg:col-span-6" aria-label={`${digits} ${lang === "fa" ? "سال" : "years"}`} role="img">
          <ArchLines count={4} className="pointer-events-none absolute inset-x-[-10%] bottom-[-6%] top-[-8%] h-[114%] w-[120%]" />
          <span className="ltr relative flex items-center" aria-hidden>
            {parts.map((p, i) =>
              p === "۰" ? (
                <svg key={i} viewBox="0 0 10 14" className="mx-[0.02em] mb-[12%] h-[clamp(4.5rem,9vw,8rem)] w-auto self-end">
                  <defs>
                    <linearGradient id="ann-rh" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" style={{ stopColor: "var(--rhombus-1)" }} />
                      <stop offset="0.45" style={{ stopColor: "var(--rhombus-2)" }} />
                      <stop offset="0.6" style={{ stopColor: "var(--rhombus-3)" }} />
                      <stop offset="1" style={{ stopColor: "var(--rhombus-4)" }} />
                    </linearGradient>
                  </defs>
                  <path d="M5 0 10 7 5 14 0 7Z" fill="url(#ann-rh)" />
                </svg>
              ) : (
                <span key={i} className="display block bg-[image:var(--metal-rhombus)] bg-clip-text text-[clamp(13rem,30vw,28rem)] leading-[1.05]! text-transparent [-webkit-text-fill-color:transparent]">
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
