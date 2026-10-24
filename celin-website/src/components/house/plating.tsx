"use client";

import { useRef, type CSSProperties } from "react";
import type { Lang } from "@/lib/format";
import type { Media } from "@/lib/media";
import { Arch } from "@/components/fx/arch";
import { ArchLines } from "@/components/fx/arch-lines";
import { Aura } from "@/components/fx/aura";
import { Grain } from "@/components/fx/grain";
import { NightFoot, NightHead } from "@/components/fx/melt";
import { gsap } from "@/components/fx/gsap";
import { useGsap } from "@/components/fx/use-gsap";
import { Eyebrow } from "@/components/house/bits";

export interface PlatingData {
  eyebrow: string;
  title: string;
  body: string;
  rhodium: string;
  gold: string;
  rhodiumTone: string;
  goldTone: string;
  media: Media;
  mobile?: Media | null;
}

/**
 * «رودیوم» in silver light and «طلا» in champagne light on either side of one arch: as you scroll the two
 * words come in towards the picture (large screens). Without motion they simply stand beside it.
 */
export function Plating({ lang, d }: { lang: Lang; d: PlatingData }) {
  const root = useRef<HTMLElement>(null);
  useGsap(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(min-width: 1024px)", () => {
        const rtl = lang === "fa";
        const st = { trigger: root.current, start: "top 85%", end: "center 55%", scrub: 0.8 };
        gsap.fromTo("[data-pl='start']", { xPercent: rtl ? 45 : -45, opacity: 0.15 }, { xPercent: 0, opacity: 1, ease: "none", scrollTrigger: st });
        gsap.fromTo("[data-pl='end']", { xPercent: rtl ? -45 : 45, opacity: 0.15 }, { xPercent: 0, opacity: 1, ease: "none", scrollTrigger: st });
        gsap.fromTo("[data-pl='lines']", { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, ease: "none", scrollTrigger: st });
      });
      return () => mm.revert();
    },
    root,
    [lang],
  );

  const word = "title-mark block bg-[length:220%_100%] bg-clip-text text-transparent metal-live";
  return (
    <section ref={root} data-tone="light" className="relative isolate overflow-clip bg-night py-24 text-on-night sm:py-28 lg:py-32">
      <Aura palette="espresso" light={0.85} />
      <Grain />
      {/* plain night-2 at both edges, where the light bands above and below melt into it */}
      <NightHead />
      <NightFoot />
      <div className="container-lux relative text-center">
        <Eyebrow tone="light" center>
          {d.eyebrow}
        </Eyebrow>
        <h2 className="sr-only">{d.title}</h2>
        <div className="relative mt-10 grid grid-cols-2 items-center gap-x-4 gap-y-10 lg:mt-12 lg:grid-cols-[1fr_auto_1fr] lg:gap-x-8">
          <p data-pl="start" className="lg:text-end">
            <span className={word} style={{ backgroundImage: "var(--metal-silver)" }}>
              {d.rhodium}
            </span>
            <span className="mt-1 block text-sm text-on-night-muted">{d.rhodiumTone}</span>
          </p>
          <div className="relative col-span-2 row-start-2 mx-auto w-[min(70vw,360px)] lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:w-[clamp(280px,26vw,400px)]" data-cursor="view">
            <div data-pl="lines" className="pointer-events-none absolute inset-x-[-30%] bottom-0 top-[-14%]">
              <ArchLines count={5} tone="champagne" className="size-full" />
            </div>
            <Arch media={d.media} mobile={d.mobile} lang={lang} sizes="(min-width: 1024px) 26vw, 70vw" ring="champagne" keystone unveil parallax={6} sparkle={14} />
            <span aria-hidden className="absolute inset-x-[-18%] -bottom-px block h-px bg-[image:var(--metal-champagne)] opacity-60" />
          </div>
          <p data-pl="end" className="lg:col-start-3 lg:text-start">
            <span className={word} style={{ backgroundImage: "var(--metal-champagne)" }}>
              {d.gold}
            </span>
            <span className="mt-1 block text-sm text-on-night-muted">{d.goldTone}</span>
          </p>
        </div>
        {d.body && (
          <p className="lede mx-auto mt-12 max-w-xl text-on-night-muted" data-reveal style={{ "--d": 1 } as CSSProperties}>
            {d.body}
          </p>
        )}
      </div>
    </section>
  );
}
