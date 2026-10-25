"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Lang } from "@/lib/i18n";
import { href, num } from "@/lib/i18n";
import type { Project } from "@/content/types";
import { ui } from "@/content/ui";
import { Media } from "@/components/work/media";

gsap.registerPlugin(ScrollTrigger);

export type RailItem = Pick<Project, "slug" | "title" | "kicker" | "oneLiner" | "year" | "cover" | "stack">;

/**
 * Selected work. Wide screens: the section pins and the scroll drives the cards sideways (toward the reading
 * direction), with a progress rule. Phones, reduced motion and no JS: a plain vertical list (the row classes carry
 * the same conditions as the pin: `motion-safe:lg:in-[.js]:`).
 */
export function WorkRail({ lang, items, intro }: { lang: Lang; items: RailItem[]; intro: React.ReactNode }) {
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const fa = lang === "fa";

  useEffect(() => {
    const el = section.current;
    const tr = track.current;
    if (!el || !tr) return;
    const mm = gsap.matchMedia();
    mm.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
      const distance = () => Math.max(0, tr.scrollWidth - window.innerWidth);
      const tween = gsap.to(tr, {
        x: () => (fa ? distance() : -distance()),
        ease: "none",
        scrollTrigger: {
          trigger: el,
          start: "top top",
          end: () => "+=" + distance(),
          pin: true,
          scrub: 0.6,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            if (bar.current) bar.current.style.transform = `scaleX(${self.progress})`;
          },
        },
      });
      // each card's picture drifts inside its frame while the track moves, from the card's entry to its exit
      // (the track moves the other way in rtl, so entry and exit use the opposite edges)
      const pics = gsap.utils.toArray<HTMLElement>("[data-rail-pic]", tr);
      const [from, to] = fa ? ["right left", "left right"] : ["left right", "right left"];
      pics.forEach((p) =>
        gsap.fromTo(p, { xPercent: fa ? -6 : 6 }, { xPercent: fa ? 6 : -6, ease: "none", scrollTrigger: { trigger: p, containerAnimation: tween, start: from, end: to, scrub: true } }),
      );
      return () => tween.scrollTrigger?.kill();
    });
    return () => mm.revert();
  }, [fa]);

  return (
    <section ref={section} id="work" className="relative overflow-hidden lg:flex lg:flex-col lg:justify-center motion-safe:lg:in-[.js]:h-[100svh]">
      <div className="mx-auto w-full max-w-[1800px] px-5 pt-24 md:px-10 lg:pt-24">{intro}</div>
      <div ref={track} className="mt-12 flex flex-col gap-16 px-5 pb-24 md:px-10 lg:mt-10 motion-safe:lg:in-[.js]:w-max motion-safe:lg:in-[.js]:flex-row motion-safe:lg:in-[.js]:gap-8 motion-safe:lg:in-[.js]:pb-0">
        {items.map((p, i) => (
          <Link
            key={p.slug}
            href={href(lang, `/work/${p.slug}`)}
            className="group relative block lg:w-[min(64vw,980px)]"
            data-cursor-label={ui.work.view[lang]}
          >
            <div className="relative aspect-[16/10] overflow-hidden rounded-[6px] border border-line bg-bg-2 lg:aspect-auto lg:h-[54svh]">
              <div data-rail-pic className="absolute -inset-x-[8%] inset-y-0 transition-transform duration-[1.2s] ease-[var(--ease-out-expo)] group-hover:scale-[1.04]">
                <Media m={p.cover} lang={lang} fill sizes="(min-width: 1024px) 64vw, 100vw" />
              </div>
              <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-80" />
              <span className="absolute start-5 top-5 rounded-full border border-white/30 bg-black/40 px-3 py-1 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-white backdrop-blur-md">
                {num(lang, String(i + 1).padStart(2, "0"))}{p.year ? ` — ${num(lang, p.year)}` : ""}
              </span>
            </div>
            <div className="mt-6 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
              <div>
                <p className="text-[0.8rem] text-muted">{p.kicker[lang]}</p>
                <h3 className={`mt-2 text-[clamp(1.8rem,3.2vw,3.2rem)] leading-[1.05] ${fa ? "font-bold leading-[1.35]" : "font-semibold tracking-[-0.035em]"}`}>{p.title[lang]}</h3>
                <p className="mt-3 max-w-[60ch] text-[0.95rem] leading-relaxed text-fg-2 lg:line-clamp-2">{p.oneLiner[lang]}</p>
              </div>
              <span aria-hidden className="hidden size-14 place-items-center rounded-full border border-line-strong text-xl transition-all duration-500 group-hover:bg-fg group-hover:text-bg lg:grid">
                {fa ? "←" : "→"}
              </span>
            </div>
          </Link>
        ))}
        <div className="hidden w-[20vw] shrink-0 motion-safe:lg:in-[.js]:block" aria-hidden />
      </div>
      <div className="mx-auto mt-10 hidden w-full max-w-[1800px] px-10 pb-10 motion-safe:lg:in-[.js]:block">
        <div className="h-px bg-line">
          <div ref={bar} className="h-px origin-[left] scale-x-0 bg-fg rtl:origin-[right]" />
        </div>
      </div>
    </section>
  );
}
