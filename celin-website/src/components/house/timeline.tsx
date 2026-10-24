"use client";

import { useRef, type CSSProperties } from "react";
import { num, type Lang } from "@/lib/format";
import { ArchLines } from "@/components/fx/arch-lines";
import { Aura } from "@/components/fx/aura";
import { Grain } from "@/components/fx/grain";
import { NightFoot, NightHead } from "@/components/fx/melt";
import { gsap } from "@/components/fx/gsap";
import { useGsap } from "@/components/fx/use-gsap";
import { Eyebrow } from "@/components/house/bits";

export interface TimelineData {
  eyebrow: string;
  from: number;
  to: number;
  fromLabel: string;
  toLabel: string;
  years: string;
  count: number;
  closing: string;
}

/**
 * «۱۳۸۵ → ۱۴۰۵»: on the deep paraiba ground a copper thread runs from the year CELIN was born to the year its
 * website opened while the years count up to twenty (the stage stays in view on large screens with a mouse —
 * CSS sticky over --pin, globals.css .fx-pin — scrubbed as it passes elsewhere). Without motion it is the
 * finished line with the full count.
 */
export function Timeline({ lang, d }: { lang: Lang; d: TimelineData }) {
  const root = useRef<HTMLElement>(null);
  const count = useRef<HTMLSpanElement>(null);

  useGsap(
    () => {
      const mm = gsap.matchMedia();
      const build = (pin: boolean) => {
        const state = { p: 0 };
        const row = root.current!.querySelector<HTMLElement>("[data-tl='row']")!;
        const paint = () => {
          row.style.setProperty("--p", state.p.toFixed(4));
          if (count.current) count.current.textContent = num(Math.round(state.p * d.count), lang);
        };
        const tl = gsap.timeline({
          defaults: { ease: "none" },
          // pinned: the stage sticks (CSS) for --pin = 120vh; the timeline only scrubs over that distance
          scrollTrigger: pin ? { trigger: root.current, start: "top top", end: "+=120%", scrub: 0.8 } : { trigger: root.current, start: "top 75%", end: "bottom 70%", scrub: 0.8 },
        });
        tl.fromTo(state, { p: 0 }, { p: 1, duration: 1, onUpdate: paint, onStart: paint }, 0.1)
          .fromTo("[data-tl='lines']", { scale: 0.75, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.8 }, 0)
          .fromTo("[data-tl='to']", { opacity: 0.3 }, { opacity: 1, duration: 0.2 }, 0.9)
          .fromTo("[data-tl='closing']", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3 }, 0.85);
        paint();
        return () => {
          state.p = 1;
          paint();
        };
      };
      mm.add("(min-width: 1024px) and (hover: hover) and (pointer: fine)", () => build(true));
      mm.add("not all and (min-width: 1024px) and (hover: hover) and (pointer: fine)", () => build(false));
      return () => mm.revert();
    },
    root,
    [lang],
  );

  const year = "numeral inline-block whitespace-nowrap text-metal-light";
  return (
    <section ref={root} data-tone="light" className="fx-pin relative isolate bg-night-teal text-on-night" style={{ "--pin": "120vh" } as CSSProperties}>
      <div className="fx-pin-stage relative isolate overflow-clip">
        <Aura palette="paraiba" light={0.75} />
        <Grain />
        {/* the cocoa night above turns into the teal; the foot is plain teal night for the melt into the bone below */}
        <NightHead />
        <NightFoot tone="teal" />
        <div className="container-lux relative flex min-h-[100svh] flex-col items-center justify-center py-24 text-center">
          <Eyebrow tone="light" center>
            {d.eyebrow}
          </Eyebrow>
          <div className="relative mt-24 w-full max-w-5xl">
            <p className="relative mx-auto w-fit">
              <span className="sr-only">{`${num(d.count, lang)} ${d.years}`}</span>
              <span data-tl="lines" aria-hidden className="pointer-events-none absolute inset-x-[-150%] bottom-[-8%] top-[-75%] origin-bottom">
                <ArchLines count={6} tone="champagne" className="size-full" />
              </span>
              <span ref={count} aria-hidden className="title-mark relative block text-metal-light metal-live">
                {num(d.count, lang)}
              </span>
              <span aria-hidden className="title-card relative mt-1 block text-on-night">
                {d.years}
              </span>
            </p>
            {/* the thread from the first year to the twentieth */}
            <div data-tl="row" className="relative mt-14 grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-4 sm:gap-8 lg:mt-20" style={{ "--p": 1 } as CSSProperties}>
              <div className="text-center">
                <span className={year}>{num(d.from, lang)}</span>
                <span className="mx-auto mt-3 block max-w-[min(30vw,13rem)] text-sm leading-7 text-on-night-muted">{d.fromLabel}</span>
              </div>
              <div className="numeral relative mt-[0.55em] h-px">
                <span aria-hidden className="absolute inset-0 bg-on-night/15" />
                <span aria-hidden className="absolute inset-0 bg-[image:var(--metal-champagne)] ltr:origin-left rtl:origin-right" style={{ scale: "var(--p) 1" }} />
                <svg aria-hidden viewBox="0 0 10 10" className="absolute top-1/2 size-3 -translate-y-1/2 text-gold-glow ltr:-translate-x-1/2 rtl:translate-x-1/2" style={{ insetInlineStart: "calc(var(--p) * 100%)" }}>
                  <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
                </svg>
              </div>
              <div data-tl="to" className="text-center">
                <span className={year}>{num(d.to, lang)}</span>
                <span className="mx-auto mt-3 block max-w-[min(30vw,13rem)] text-sm leading-7 text-on-night-muted">{d.toLabel}</span>
              </div>
            </div>
            <p data-tl="closing" className="lede mx-auto mt-12 max-w-xl text-on-night-muted">
              {d.closing}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
