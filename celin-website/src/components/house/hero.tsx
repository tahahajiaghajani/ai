"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import type { Lang } from "@/lib/format";
import type { Media } from "@/lib/media";
import type { Video } from "@/lib/video";
import { Arch } from "@/components/fx/arch";
import { ArchLines } from "@/components/fx/arch-lines";
import { Aura, type AuraPalette } from "@/components/fx/aura";
import { Grain } from "@/components/fx/grain";
import { SplitWords } from "@/components/fx/split-words";
import { gsap } from "@/components/fx/gsap";
import { useGsap } from "@/components/fx/use-gsap";
import { usePointerDepth } from "@/components/fx/use-pointer-depth";
import { Eyebrow, NightCrumbs } from "@/components/house/bits";
import { SlotVideo } from "@/components/house/slot-video";

export interface HouseHeroData {
  eyebrow: string;
  title: string;
  subtitle?: string;
  media: Media | null | undefined;
  mobile?: Media | null;
  video?: Video | null;
}

/**
 * The opening band of a house page, under the transparent header: living silk light (Aura), one tall arch
 * that fills from the crown inside a draw-in arcade of hairlines, words that rise in living metal. The layers
 * lean with the pointer and part as the page scrolls. `flip` puts the arch on the reading side.
 */
export function HouseHero({
  lang,
  d,
  palette = "espresso",
  light = 1,
  flip = false,
  ratio = "3/4",
  size = "lg",
  sparkle = 12,
  crumbs,
  actions,
  children,
  latin = ["HANDMADE JEWELRY", "ETEMAD GALLERY"],
}: {
  lang: Lang;
  d: HouseHeroData;
  palette?: AuraPalette;
  light?: number;
  flip?: boolean;
  ratio?: string;
  /** "xl" for a one-word title (a collection name) */
  size?: "lg" | "xl";
  sparkle?: number;
  crumbs?: { label: string; path?: string }[];
  actions?: ReactNode;
  children?: ReactNode;
  latin?: [string, string];
}) {
  const root = useRef<HTMLElement>(null);
  const depth = useRef<HTMLDivElement>(null);
  usePointerDepth(depth);

  useGsap(
    () => {
      const st = { trigger: root.current, start: "top top", end: "bottom top", scrub: 0.6 };
      gsap.to("[data-hh='arch']", { yPercent: -7, scale: 1.035, ease: "none", scrollTrigger: st });
      gsap.to("[data-hh='lines']", { scale: 1.14, opacity: 0.25, ease: "none", scrollTrigger: st });
      gsap.to("[data-hh='copy']", { yPercent: -22, opacity: 0, ease: "none", scrollTrigger: { ...st, end: "75% top" } });
    },
    root,
    [lang],
  );

  const titleSize =
    size === "xl"
      ? "text-[clamp(3.4rem,15vw,5rem)] leading-[1.25]! sm:text-7xl lg:text-[clamp(5rem,8vw,8.5rem)]"
      : "text-[clamp(2.4rem,9vw,3.4rem)] leading-[1.32]! sm:text-6xl lg:text-[clamp(3.4rem,5vw,5.4rem)]";

  return (
    <section ref={root} data-header="dark" data-tone="light" className="relative isolate -mt-[var(--header-h)] overflow-clip bg-night text-on-night lg:min-h-[100svh]">
      <Aura palette={palette} light={light} />
      <Grain />
      <div ref={depth} className="container-lux relative grid gap-y-12 pt-[calc(var(--header-h)+2.5rem)] pb-16 lg:min-h-[100svh] lg:grid-cols-12 lg:items-center lg:gap-x-8 lg:pt-[var(--header-h)] lg:pb-0">
        {/* the words */}
        <div data-hh="copy" className={`relative lg:col-span-6 ${flip ? "lg:order-2 lg:col-start-7" : "lg:col-start-1"}`}>
          {crumbs && <NightCrumbs lang={lang} items={crumbs} className="mb-8" />}
          <Eyebrow tone="light" reveal style={{ "--d": 1 } as CSSProperties}>
            {d.eyebrow}
          </Eyebrow>
          <SplitWords as="h1" text={d.title} immediate delay={200} className={`display mt-5 font-bold ${titleSize}`} wordClassName="text-metal-light metal-live" />
          {d.subtitle && (
            <p className="mt-6 max-w-lg text-lg leading-9 text-on-night-muted lg:mt-8 lg:text-xl lg:leading-10" data-reveal style={{ "--d": 6 } as CSSProperties}>
              {d.subtitle}
            </p>
          )}
          {children}
          {actions && (
            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4 lg:mt-11" data-reveal style={{ "--d": 8 } as CSSProperties}>
              {actions}
            </div>
          )}
        </div>

        {/* the arch */}
        <div className={`relative mx-auto w-[min(72vw,360px)] lg:col-span-5 lg:w-full lg:max-w-[470px] lg:self-end lg:pb-[7vh] ${flip ? "lg:order-1 lg:col-start-1" : "lg:col-start-8"}`}>
          <div data-hh="lines" className="pointer-events-none absolute inset-x-[-34%] bottom-0 top-[-16%] origin-bottom" data-depth="-5">
            <ArchLines count={5} tone="champagne" immediate delay={120} className="size-full" />
          </div>
          <div data-hh="arch" className="relative origin-bottom" data-depth="9" data-cursor="view">
            <Arch
              media={d.media}
              mobile={d.mobile}
              lang={lang}
              sizes="(min-width: 1024px) 34vw, 72vw"
              ratio={ratio}
              priority
              ring="champagne"
              keystone
              unveil
              afterIntro
              delay={150}
              sparkle={d.video ? false : sparkle}
            >
              <SlotVideo video={d.video} />
            </Arch>
          </div>
          <span aria-hidden className="absolute inset-x-[-22%] -bottom-px block h-px bg-[image:var(--metal-champagne)] opacity-60" />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-5 hidden items-end justify-between px-[var(--gutter)] text-on-night-muted lg:flex">
        <span className="font-label text-[10px] tracking-[0.32em] ltr">{latin[0]}</span>
        <span className="fx-scroll-cue text-gold-on-dark" aria-hidden />
        <span className="font-label text-[10px] tracking-[0.32em] ltr">{latin[1]}</span>
      </div>
    </section>
  );
}
