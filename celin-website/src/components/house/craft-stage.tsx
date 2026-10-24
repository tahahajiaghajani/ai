"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { num, type Lang } from "@/lib/format";
import type { Media } from "@/lib/media";
import { Arch } from "@/components/fx/arch";
import { ArchLines } from "@/components/fx/arch-lines";
import { Sparkles } from "@/components/fx/sparkles";
import { SplitWords } from "@/components/fx/split-words";
import { Picture } from "@/components/ui/picture";
import { diamond, ordinal } from "@/components/house/bits";

export interface CraftStep {
  title: string;
  body: string;
  tags: string[];
  media: Media;
  mobile?: Media | null;
}

/**
 * The four steps of the craft as a stage: on large screens one tall arch stays in view while the steps
 * scroll past it, and each step fills the arch with its own picture from the crown down (a column of
 * numerals marks the step). On phones every step carries its own arch. Without JS the first picture stays.
 */
export function CraftStage({ lang, steps, label }: { lang: Lang; steps: CraftStep[]; /** «مرحله‌ی» / "Step" */ label: string }) {
  const [active, setActive] = useState(0);
  const list = useRef<HTMLOListElement>(null);

  // the step crossing the middle of the screen is the active one (works with reduced motion too)
  useEffect(() => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>("[data-step]") ?? [])];
    if (!items.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
      },
      { rootMargin: "-48% 0px -48% 0px" },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="relative grid gap-y-6 lg:grid-cols-12 lg:gap-x-10">
      {/* the stage (large screens) */}
      <div className="hidden lg:col-span-5 lg:block">
        <div className="sticky top-[calc(var(--header-h)+6vh)] flex h-[calc(100svh-var(--header-h)-12vh)] items-center">
          <div className="relative mx-auto aspect-[3/4] h-full max-h-[640px] max-w-full">
            <ArchLines count={4} className="pointer-events-none absolute inset-x-[-22%] bottom-0 top-[-10%] h-[110%] w-[144%]" />
            <span aria-hidden className="arch-ring [--ring-gap:12px]" style={{ "--ring": "rgb(156 94 52 / 0.5)" } as CSSProperties} />
            <svg aria-hidden viewBox="0 0 10 10" className="absolute left-1/2 top-[-12px] z-[3] size-2.5 -translate-x-1/2 -translate-y-1/2 text-gold-bright">
              <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
            </svg>
            <div className="arch absolute inset-0 overflow-hidden bg-tile">
              {steps.map((s, i) => (
                <div
                  key={i}
                  aria-hidden={i !== active}
                  className="absolute inset-0 transition-[clip-path] duration-[1300ms] ease-[var(--ease-out-expo)]"
                  style={{ clipPath: i <= active ? "inset(0 0 0 0)" : "inset(0 0 100% 0)", zIndex: i }}
                >
                  <Picture
                    media={s.media}
                    lang={lang}
                    sizes="(min-width: 1024px) 36vw, 1px"
                    className="absolute inset-0"
                    imgClassName={`transition-transform duration-[1800ms] ease-[var(--ease-out-expo)] ${i <= active ? "scale-100" : "scale-[1.16]"}`}
                  />
                  {i === active && <Sparkles count={12} />}
                </div>
              ))}
            </div>
            <span aria-hidden className="absolute inset-x-[-16%] -bottom-px block h-px bg-[image:var(--metal-copper)] opacity-50" />
            {/* the step marks: on the inner side of the arch, in the gap towards the steps (never against the window edge) */}
            <ol aria-hidden className="absolute top-1/2 -translate-y-1/2 space-y-4 ltr:-right-16 rtl:-left-16">
              {steps.map((_, i) => (
                <li key={i} className={`font-label text-sm tabular-nums transition-colors duration-500 ${i === active ? "text-gold-text" : "text-faint"}`}>
                  <span className="flex items-center gap-2">
                    <span className={`block h-px transition-all duration-500 ${i === active ? "w-6 bg-gold" : "w-3 bg-line-strong"}`} />
                    {ordinal(i + 1, lang)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {/* the steps */}
      <ol ref={list} className="lg:col-span-6 lg:col-start-7">
        {steps.map((s, i) => (
          <li key={i} data-step={i} className="flex flex-col justify-center py-10 sm:py-14 lg:min-h-[86svh] lg:py-16">
            <div className="relative mx-auto mb-10 w-[min(74vw,380px)] lg:hidden">
              <ArchLines count={3} className="pointer-events-none absolute inset-x-[-18%] bottom-0 top-[-9%] h-[109%] w-[136%]" />
              <Arch media={s.media} mobile={s.mobile} lang={lang} sizes="74vw" ring="copper" keystone={i === 0} unveil parallax={5} sparkle={8} />
            </div>
            {/* the steps away from the middle dim only when the observer can move the light (never without JS) */}
            <div className={`transition-opacity duration-700 ${i === active ? "lg:opacity-100" : "lg:[html.js_&]:opacity-45"}`}>
              <span aria-hidden className="numeral block text-metal">
                {ordinal(i + 1, lang)}
              </span>
              <p className="label mt-2 text-gold-text!">{`${label} ${num(i + 1, lang)}`}</p>
              <SplitWords as="h3" text={s.title} className="title-section mt-3 text-ink" />
              <p className="lede mt-4 max-w-xl text-ink-2" data-reveal>
                {s.body}
              </p>
              {s.tags.length > 0 && (
                <ul className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2" data-reveal style={{ "--d": 1 } as CSSProperties}>
                  {s.tags.map((t, k) => (
                    <li key={t} className="flex items-center gap-4 text-sm text-gold-text">
                      {k > 0 && diamond("size-1.5 text-gold/70")}
                      {t}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
