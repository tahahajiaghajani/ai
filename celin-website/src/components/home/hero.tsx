"use client";

import Link from "next/link";
import { useRef, type CSSProperties } from "react";
import type { Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { mediaUrl, type Media } from "@/lib/media";
import type { Video } from "@/lib/video";
import { Arch } from "@/components/fx/arch";
import { ArchLines } from "@/components/fx/arch-lines";
import { Aura } from "@/components/fx/aura";
import { Grain } from "@/components/fx/grain";
import { Magnetic } from "@/components/fx/magnetic";
import { SplitWords } from "@/components/fx/split-words";
import { SlotVideo } from "@/components/fx/slot-video";
import { gsap } from "@/components/fx/gsap";
import { useGsap } from "@/components/fx/use-gsap";
import { usePointerDepth } from "@/components/fx/use-pointer-depth";
import { Icon } from "@/components/ui/icons";
import { latinMarks } from "@/content/copy/common";

export interface HeroData {
  eyebrow: string;
  title: string;
  subtitle: string;
  cta: string;
  href: string;
  all: string;
  a: { media: Media; mobile: Media | null; video?: Video | null };
  b: Media;
  c: Media;
}

/**
 * The opening: a triple arcade (a tall central arch between two lower ones, on one sill) over living
 * espresso-and-paraiba light. After the intro the arches fill from the crown down, the arcade lines draw,
 * the words rise; the layers lean with the pointer and part at different speeds as the page scrolls.
 */
export function HomeHero({ lang, d }: { lang: Lang; d: HeroData }) {
  const root = useRef<HTMLElement>(null);
  const depth = useRef<HTMLDivElement>(null);

  // pointer depth: each layer leans by its data-depth (live with the motion preference)
  usePointerDepth(depth);

  // scroll: the arcade parts — sides drift out, the centre rises slower, the words lift away
  useGsap(
    () => {
      const st = { trigger: root.current, start: "top top", end: "bottom top", scrub: 0.6 };
      gsap.to("[data-part='start']", { xPercent: lang === "fa" ? 18 : -18, yPercent: 8, opacity: 0.35, ease: "none", scrollTrigger: st });
      gsap.to("[data-part='end']", { xPercent: lang === "fa" ? -18 : 18, yPercent: 8, opacity: 0.35, ease: "none", scrollTrigger: st });
      gsap.to("[data-part='centre']", { yPercent: -6, scale: 1.04, ease: "none", scrollTrigger: st });
      gsap.to("[data-part='copy']", { yPercent: -28, opacity: 0, ease: "none", scrollTrigger: { ...st, end: "70% top" } });
      gsap.to("[data-part='lines']", { scale: 1.12, opacity: 0.3, ease: "none", scrollTrigger: st });
    },
    root,
    [lang],
  );

  return (
    <section ref={root} data-header="dark" data-tone="light" className="under-header relative isolate min-h-[calc(100svh-var(--announce-h,0px))] overflow-clip bg-night text-on-night">
      <Aura palette="espresso" />
      <Grain />
      {/* the silk light settles into plain night at the bottom edge, where the dawn of the next band begins */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[24vh] bg-gradient-to-b from-transparent to-night" />
      <div ref={depth} className="container-lux relative grid min-h-[calc(100svh-var(--announce-h,0px))] grid-rows-[auto_1fr] gap-y-6 pt-[calc(var(--header-h)+2rem)] pb-10 lg:grid-cols-12 lg:grid-rows-1 lg:items-center lg:gap-x-8 lg:pb-0">
        {/* the arcade */}
        <div className="relative order-1 mx-auto w-full max-w-[560px] lg:order-2 lg:col-span-7 lg:max-w-none lg:self-end lg:pb-[6.5vh]">
          <div className="relative flex items-end justify-center gap-[3.5%]">
            <div data-part="lines" className="pointer-events-none absolute inset-x-[-20%] bottom-0 top-[-16%] origin-bottom" data-depth="-4">
              <ArchLines count={5} tone="champagne" immediate delay={100} className="size-full" />
            </div>
            <div data-part="start" className="w-[27.5%]" data-depth="14">
              <Arch media={d.b} lang={lang} sizes="(min-width: 1024px) 17vw, 26vw" ring="champagne" unveil afterIntro delay={350} sparkle={6} className="[--ring-gap:8px]" />
            </div>
            <div data-part="centre" className="w-[45%] origin-bottom" data-depth="7" data-cursor="view">
              <Link href={href(lang, d.href)} aria-label={d.cta} className="block">
                <Arch media={d.a.media} mobile={d.a.mobile} lang={lang} sizes="(min-width: 1024px) 27vw, 45vw" ratio="3/4.3" priority ring="champagne" keystone unveil afterIntro delay={150} sparkle={14}>
                  {d.a.video && <SlotVideo video={d.a.video} poster={mediaUrl(d.a.media, 960)} position={`${d.a.media.fx}% ${d.a.media.fy}%`} />}
                </Arch>
              </Link>
            </div>
            <div data-part="end" className="w-[27.5%]" data-depth="14">
              <Arch media={d.c} lang={lang} sizes="(min-width: 1024px) 17vw, 26vw" ring="champagne" unveil afterIntro delay={500} sparkle={6} className="[--ring-gap:8px]" />
            </div>
          </div>
          {/* the sill */}
          <span aria-hidden className="mx-auto mt-0 block h-px w-[110%] -translate-x-[4.5%] bg-[image:var(--metal-champagne)] opacity-60 rtl:translate-x-[4.5%]" />
        </div>

        {/* the words */}
        <div data-part="copy" className="relative order-2 text-center lg:order-1 lg:col-span-5 lg:text-start">
          <p className="fx-in label flex items-center justify-center gap-3 text-gold-on-dark! lg:justify-start" style={{ "--in": 0 } as CSSProperties}>
            <svg viewBox="0 0 10 10" className="size-2 text-gold-glow" aria-hidden>
              <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
            </svg>
            {d.eyebrow}
          </p>
          <SplitWords
            as="h1"
            text={d.title}
            immediate
            delay={250}
            className="display mt-4 text-[clamp(2.75rem,11vw,4rem)] leading-[1.3]! font-bold sm:text-6xl lg:mt-6 lg:text-[clamp(4rem,6.4vw,7rem)]"
            wordClassName="text-metal-light metal-live"
          />
          <p className="mx-auto mt-5 max-w-md text-lg leading-9 text-on-night-muted lg:mx-0 lg:mt-7 lg:text-xl lg:leading-10 fx-in" style={{ "--in": 4 } as CSSProperties}>
            {d.subtitle}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-4 lg:mt-10 lg:justify-start fx-in" style={{ "--in": 5 } as CSSProperties}>
            <Magnetic>
              <Link href={href(lang, d.href)} className="btn btn-metal h-13 px-8 text-[0.9375rem]">
                {d.cta}
                <Icon name="arrow" className="size-4 rtl:-scale-x-100" />
              </Link>
            </Magnetic>
            <Link href={href(lang, "/shop")} className="group inline-flex items-center gap-2 text-sm text-on-night">
              <span className="border-b border-on-night/40 pb-1 transition-colors group-hover:border-gold-on-dark">{d.all}</span>
            </Link>
          </div>
        </div>
      </div>
      {/* scroll cue + signature */}
      <div className="pointer-events-none absolute inset-x-0 bottom-5 hidden items-end justify-between px-[var(--gutter)] text-on-night-muted lg:flex">
        <span className="font-label text-[10px] tracking-[0.32em] ltr">{latinMarks.since}</span>
        <span className="fx-scroll-cue text-gold-on-dark" aria-hidden />
        <span className="font-label text-[10px] tracking-[0.32em] ltr">{latinMarks.house}</span>
      </div>
    </section>
  );
}
