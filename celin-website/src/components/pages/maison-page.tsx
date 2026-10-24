import Link from "next/link";
import type { CSSProperties } from "react";
import { getSlots, type ResolvedSlot } from "@/lib/slots";
import { href, type Lang } from "@/lib/i18n";
import { num } from "@/lib/format";
import { story } from "@/content/copy/story";
import { maisonCopy } from "@/content/copy/maison";
import { Arch } from "@/components/fx/arch";
import { ArchLines } from "@/components/fx/arch-lines";
import { Grain } from "@/components/fx/grain";
import { Magnetic } from "@/components/fx/magnetic";
import { SplitWords } from "@/components/fx/split-words";
import { Icon } from "@/components/ui/icons";
import { Eyebrow, ordinal } from "@/components/house/bits";
import { HouseHero } from "@/components/house/hero";
import { ScrollLine } from "@/components/house/scroll-line";
import { slotReader } from "@/components/house/slot-reader";
import { Timeline } from "@/components/house/timeline";

/**
 * /maison — «داستان سلین»: the brand's own story (story.ts, verbatim) as an editorial sequence — the motto
 * over living espresso light, the year of birth, four chapters along a copper thread, «سلین؛ برای کسانی که…»,
 * twenty years from ۱۳۸۵ to ۱۴۰۵, the anniversary letter in an arch, and the closing line in living metal.
 */
export async function MaisonPage({ lang }: { lang: Lang }) {
  const slots = await getSlots();
  const s = (key: string) => slots[key] as ResolvedSlot;
  const txt = slotReader(slots, lang);
  const st = story[lang];
  const c = maisonCopy[lang];

  return (
    <main>
      <HouseHero
        lang={lang}
        palette="espresso"
        d={{ eyebrow: txt("maison.hero", "eyebrow"), title: txt("maison.hero", "title"), subtitle: txt("maison.hero", "subtitle"), media: s("maison.hero").media, mobile: s("maison.hero").mobile, video: s("maison.hero").video }}
        latin={["SINCE 2006", "ETEMAD GALLERY"]}
        actions={
          <a href="#story" className="group inline-flex items-center gap-3 text-sm text-on-night">
            <span className="border-b border-on-night/40 pb-1 transition-colors group-hover:border-gold-on-dark">{c.scroll}</span>
            <Icon name="arrow" className="size-4 rotate-90" />
          </a>
        }
      />

      {/* the year of birth */}
      <section id="story" className="relative isolate scroll-mt-[var(--header-h)] overflow-clip bg-mesh-porcelain py-24 sm:py-36">
        <ArchLines count={4} className="pointer-events-none absolute inset-x-0 -bottom-8 mx-auto h-[112%] w-[min(900px,150vw)] opacity-50" />
        <div className="container-lux relative mx-auto max-w-3xl text-center">
          <Eyebrow center>{c.prologue.eyebrow}</Eyebrow>
          <p className="numeral mt-5 text-metal" data-reveal>
            {num(c.prologue.year, lang)}
          </p>
          <span aria-hidden className="hairline mx-auto mt-6 block w-16" />
          <SplitWords as="p" text={st.born} className="title-quote mt-7 text-ink" />
        </div>
      </section>

      {/* four chapters on one copper thread */}
      <section className="relative isolate overflow-clip py-20 sm:py-28" style={{ background: "radial-gradient(60% 40% at 100% 10%, rgb(230 208 171 / 0.45), transparent 70%), radial-gradient(55% 35% at 0% 60%, rgb(239 220 205 / 0.6), transparent 70%), radial-gradient(50% 30% at 100% 95%, rgb(200 136 90 / 0.14), transparent 70%), var(--color-bone)" }}>
        <div className="container-lux relative">
          <div className="text-center">
            <Eyebrow center>{c.chapters.eyebrow}</Eyebrow>
            <SplitWords text={c.chapters.title} className="title-section mt-3 text-ink" />
          </div>
          <div className="relative mt-14 sm:mt-20">
            <ScrollLine className="start-[7px] lg:start-1/2" />
            {st.chapters.map((ch, i) => {
              const even = i % 2 === 0;
              const slot = s(`maison.chapter.${i + 1}`);
              return (
                <article key={ch.key} className="relative grid items-center gap-10 py-12 ps-10 sm:py-16 lg:grid-cols-12 lg:gap-8 lg:ps-0 lg:py-14">
                  {/* the knot on the thread */}
                  <span aria-hidden className="absolute start-0 top-14 grid size-[15px] place-items-center lg:start-1/2 lg:top-1/2 lg:-translate-y-1/2 ltr:lg:-translate-x-1/2 rtl:lg:translate-x-1/2">
                    <span className="size-[15px] rotate-45 border border-gold/60 bg-bone" />
                    <span className="absolute size-[5px] rotate-45 bg-gold" />
                  </span>
                  <div className={`relative mx-auto w-[min(68vw,340px)] lg:col-span-4 lg:w-full lg:max-w-[360px] ${even ? "lg:col-start-2" : "lg:order-2 lg:col-start-8"}`} data-cursor="view">
                    <ArchLines count={3} className="pointer-events-none absolute inset-x-[-18%] bottom-0 top-[-9%] h-[109%] w-[136%] opacity-80" />
                    <Arch media={slot.media} mobile={slot.mobile} lang={lang} sizes="(min-width: 1024px) 28vw, 72vw" ring="copper" keystone={i === 0} unveil parallax={6} sparkle={8} />
                  </div>
                  <div className={`relative lg:col-span-4 ${even ? "lg:col-start-8" : "lg:order-1 lg:col-start-2"}`}>
                    <p className="flex items-center gap-4">
                      <span className="numeral text-metal">{ordinal(i + 1, lang)}</span>
                      <span aria-hidden className="hairline w-12" />
                      <span className="label text-gold-text!">{c.chapter(num(i + 1, lang))}</span>
                    </p>
                    <SplitWords as="h2" text={ch.title} className="title-section mt-4 text-ink" />
                    <p className="lede mt-4 max-w-xl text-ink-2" data-reveal style={{ "--d": 1 } as CSSProperties}>
                      {ch.text}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* «سلین؛ برای کسانی که…» */}
      <section data-tone="light" className="relative isolate overflow-clip bg-mesh-cocoa py-24 text-on-night sm:py-32">
        <Grain />
        <div className="container-lux relative grid items-center gap-14 lg:grid-cols-12 lg:gap-10">
          <div className="relative mx-auto w-[min(62vw,320px)] lg:col-span-4 lg:w-full lg:max-w-[360px]" data-cursor="view">
            <ArchLines count={4} tone="champagne" className="pointer-events-none absolute inset-x-[-26%] bottom-0 top-[-12%] h-[112%] w-[152%]" />
            <Arch media={s("maison.story").media} mobile={s("maison.story").mobile} lang={lang} sizes="(min-width: 1024px) 25vw, 62vw" ring="champagne" keystone unveil parallax={7} sparkle={10} />
          </div>
          <div className="text-center lg:col-span-7 lg:col-start-6 lg:text-start">
            <SplitWords text={st.forWhom} className="title-page max-w-2xl lg:max-w-none" wordClassName="text-metal-light" />
          </div>
        </div>
      </section>

      <Timeline
        lang={lang}
        d={{ eyebrow: c.timeline.eyebrow, from: c.timeline.from, to: c.timeline.to, fromLabel: c.timeline.fromLabel, toLabel: c.timeline.toLabel, years: c.timeline.years, count: c.timeline.count, closing: st.anniversary.closing }}
      />

      {/* the letter of the twentieth year, in an arch */}
      <section className="relative isolate overflow-clip bg-mesh-bone py-20 sm:py-32">
        <div className="container-lux">
          <article className="frame-metal arch relative mx-auto max-w-3xl bg-porcelain/80 px-6 pt-24 pb-14 shadow-[0_50px_90px_-60px_rgb(26_19_16/0.5)] [--frame:var(--metal-copper)] sm:px-14 sm:pt-32 sm:pb-20">
            <span aria-hidden className="arch absolute inset-0 bg-[radial-gradient(70%_45%_at_50%_0%,rgb(230_208_171/0.45),transparent_75%)]" />
            <svg aria-hidden viewBox="0 0 10 10" className="absolute left-1/2 top-0 size-3 -translate-x-1/2 -translate-y-1/2 text-gold-bright">
              <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
            </svg>
            <div className="relative">
              <Eyebrow center>{c.letter.eyebrow}</Eyebrow>
              <SplitWords text={st.anniversary.title} className="title-section mx-auto mt-5 max-w-xl text-center text-ink" />
              <div className="lede mt-9 space-y-5 text-ink-2">
                {st.anniversary.paragraphs.map((p, i) => (
                  <p key={i} data-reveal style={{ "--d": i } as CSSProperties}>
                    {p}
                  </p>
                ))}
              </div>
              <p className="lede mt-8 border-s border-gold/60 ps-5 font-bold text-ink" data-reveal>
                {st.anniversary.welcome}
              </p>
              <p className="title-page mt-11 py-1 text-center text-metal metal-live" aria-label={c.letter.signatureLabel} data-reveal>
                <span aria-hidden>{c.letter.signature}</span>
              </p>
            </div>
          </article>
        </div>
      </section>

      {/* the closing line */}
      <section className="relative isolate overflow-clip bg-mesh-porcelain py-24 text-center sm:py-32">
        <ArchLines count={5} className="pointer-events-none absolute inset-x-0 -bottom-6 mx-auto h-[118%] w-[min(1100px,150vw)] opacity-70" />
        <div className="container-lux relative">
          <SplitWords text={st.shine} className="title-page mx-auto max-w-3xl" wordClassName="text-metal metal-live" />
          <p className="lede mx-auto mt-5 max-w-xl text-muted" data-reveal>
            {st.motto}
          </p>
          <div className="mt-11 flex flex-wrap items-center justify-center gap-4" data-reveal style={{ "--d": 2 } as CSSProperties}>
            <Magnetic>
              <Link href={href(lang, "/collections")} className="btn btn-metal h-13 px-8">
                {c.closing.collections}
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
