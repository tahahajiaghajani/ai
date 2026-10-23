import Link from "next/link";
import type { CSSProperties } from "react";
import { getSettings } from "@/lib/settings";
import { getSlots, type ResolvedSlot } from "@/lib/slots";
import { href, type Lang } from "@/lib/i18n";
import { careCopy } from "@/content/copy/care";
import { Arch } from "@/components/fx/arch";
import { ArchLines } from "@/components/fx/arch-lines";
import { Grain } from "@/components/fx/grain";
import { SplitWords } from "@/components/fx/split-words";
import { Icon } from "@/components/ui/icons";
import { SectionHead } from "@/components/home/sections";
import { diamond, ordinal } from "@/components/house/bits";
import { storeChannels } from "@/components/house/contact-links";
import { HouseHero } from "@/components/house/hero";
import { ScrollLine } from "@/components/house/scroll-line";
import { slotReader } from "@/components/house/slot-reader";

/**
 * /care — «نگهداری و ضمانت»: cocoa hero; the four care habits as a row of arches (the product page's own
 * texts); packaging & delivery on espresso light beside the packaging picture; and the warranty, which for
 * now only invites the visitor to contact the store (owner-editable text in src/content/copy/care.ts).
 */
export async function CarePage({ lang }: { lang: Lang }) {
  const [slots, settings] = await Promise.all([getSlots(), getSettings()]);
  const s = (key: string) => slots[key] as ResolvedSlot;
  const txt = slotReader(slots, lang);
  const c = careCopy[lang];
  const ch = storeChannels(settings.contact, lang);

  return (
    <main>
      <HouseHero
        lang={lang}
        palette="cocoa"
        sparkle={12}
        d={{ eyebrow: txt("care.hero", "eyebrow"), title: txt("care.hero", "title"), subtitle: txt("care.hero", "subtitle"), media: s("care.hero").media, mobile: s("care.hero").mobile }}
        latin={["CARE", "WARRANTY"]}
      />

      {/* the habits, as an arcade */}
      <section className="relative isolate overflow-clip bg-mesh-porcelain py-20 sm:py-28">
        <div className="container-lux">
          <SectionHead eyebrow={c.rules.eyebrow} title={c.rules.title} align="center" />
          <ol className="-mx-[var(--gutter)] mt-14 flex snap-x snap-mandatory gap-4 overflow-x-auto px-[var(--gutter)] pt-3 pb-4 [scrollbar-width:none] sm:grid sm:grid-cols-2 sm:gap-6 sm:overflow-visible lg:grid-cols-4 [&::-webkit-scrollbar]:hidden">
            {c.rules.items.map((r, i) => (
              <li key={i} className="w-[72vw] max-w-[300px] shrink-0 snap-center sm:w-auto sm:max-w-none" data-reveal style={{ "--d": i } as CSSProperties}>
                <div className="frame-metal arch relative flex h-full min-h-[21rem] flex-col items-center bg-porcelain px-6 pt-16 pb-10 text-center [--frame:var(--metal-copper)] sm:min-h-[23rem]">
                  <span aria-hidden className="arch absolute inset-0 bg-[radial-gradient(80%_50%_at_50%_0%,rgb(230_208_171/0.5),transparent_75%)]" />
                  <svg aria-hidden viewBox="0 0 10 10" className="absolute left-1/2 top-0 size-2.5 -translate-x-1/2 -translate-y-1/2 text-gold-bright">
                    <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
                  </svg>
                  <span className="display relative text-6xl leading-[1.2]! font-bold text-metal">{ordinal(i + 1, lang)}</span>
                  <span aria-hidden className="relative mt-5 block h-px w-10 bg-gold/50" />
                  <p className="relative mt-6 text-base leading-8 text-ink-2 sm:text-lg sm:leading-9">{r}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mx-auto mt-12 flex max-w-2xl items-start justify-center gap-3 text-center text-base leading-8 text-muted sm:text-lg sm:leading-9" data-reveal>
            {diamond("mt-3 size-1.5 shrink-0 text-gold")}
            <span>{c.rules.note}</span>
          </p>
        </div>
      </section>

      {/* packaging & delivery */}
      <section data-tone="light" className="relative isolate overflow-clip bg-mesh-espresso py-20 text-on-night sm:py-28">
        <Grain />
        <div className="container-lux relative grid items-center gap-14 lg:grid-cols-12 lg:gap-10">
          <div className="relative mx-auto w-[min(66vw,340px)] lg:col-span-4 lg:col-start-2 lg:w-full lg:max-w-[380px]" data-cursor="view">
            <ArchLines count={4} tone="champagne" className="pointer-events-none absolute inset-x-[-24%] bottom-0 top-[-11%] h-[111%] w-[148%]" />
            <Arch media={s("care.packaging").media} mobile={s("care.packaging").mobile} lang={lang} sizes="(min-width: 1024px) 27vw, 66vw" ring="champagne" keystone unveil parallax={6} sparkle={10} />
          </div>
          <div className="lg:col-span-6 lg:col-start-7">
            <SectionHead eyebrow={c.delivery.eyebrow} title={c.delivery.title} tone="light" />
            <ol className="relative mt-10 space-y-8 ps-12">
              <span aria-hidden className="absolute start-[1.1rem] top-4 bottom-4 w-px">
                <ScrollLine tone="champagne" start="top 75%" end="bottom 55%" />
              </span>
              {c.delivery.steps.map((d, i) => (
                <li key={i} className="relative" data-reveal style={{ "--d": i } as CSSProperties}>
                  <span className="arch-full absolute -start-12 top-0 grid size-9 place-items-center border border-gold-on-dark/40 bg-night font-label text-xs text-gold-on-dark tabular-nums">{ordinal(i + 1, lang)}</span>
                  <p className="text-lg leading-9 text-on-night">{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* warranty — owner-editable placeholder (src/content/copy/care.ts) */}
      <section id="warranty" className="relative isolate scroll-mt-[var(--header-h)] overflow-clip bg-mesh-bone py-20 sm:py-28">
        <div className="container-lux">
          <div className="frame-metal relative mx-auto max-w-4xl overflow-hidden bg-porcelain/80 px-6 py-12 text-center [--frame:var(--metal-copper)] sm:px-14 sm:py-16">
            <ArchLines count={3} className="pointer-events-none absolute inset-x-0 -bottom-4 mx-auto h-[120%] w-[min(560px,120%)] opacity-50" />
            <div className="relative">
              <p className="label flex items-center justify-center gap-2.5 text-gold-text!">
                {diamond("size-1.5 text-gold")}
                {c.warranty.eyebrow}
              </p>
              <SplitWords text={c.warranty.title} className="display mt-4 text-[2rem] leading-[1.4]! font-bold text-ink sm:text-5xl" />
              <p className="mx-auto mt-6 max-w-2xl text-lg leading-10 text-ink-2" data-reveal>
                {c.warranty.body}
              </p>
              {c.warranty.points.length > 0 && (
                <ul className="mx-auto mt-8 max-w-xl space-y-3 text-start">
                  {c.warranty.points.map((p) => (
                    <li key={p} className="flex items-start gap-3 text-base leading-8 text-ink-2">
                      {diamond("mt-3 size-1.5 shrink-0 text-gold")}
                      {p}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-10 flex flex-wrap items-center justify-center gap-3" data-reveal style={{ "--d": 1 } as CSSProperties}>
                <Link href={href(lang, "/contact")} className="btn btn-ink h-12">
                  {c.warranty.contact}
                </Link>
                {ch.wa && (
                  <a href={ch.wa} target="_blank" rel="noreferrer" className="btn btn-line h-12 text-ink">
                    <Icon name="whatsapp" className="size-4" />
                    {c.warranty.whatsapp}
                  </a>
                )}
                {ch.tel && (
                  <a href={ch.tel} className="btn btn-line h-12 text-ink">
                    <Icon name="phone" className="size-4" />
                    {c.warranty.call}
                  </a>
                )}
              </div>
            </div>
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm">
            {[
              { path: "/craft", label: c.more.craft },
              { path: "/shop", label: c.more.shop },
            ].map((l) => (
              <Link key={l.path} href={href(lang, l.path)} className="group inline-flex items-center gap-2 text-ink">
                <span className="border-b border-ink/30 pb-1 transition-colors group-hover:border-gold">{l.label}</span>
                <Icon name="arrow" className="size-4 rtl:-scale-x-100" />
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
