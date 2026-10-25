"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import type { Lang } from "@/lib/i18n";
import { href, num } from "@/lib/i18n";
import type { Project } from "@/content/types";
import { Media } from "@/components/work/media";

export type IndexItem = Pick<Project, "slug" | "title" | "kicker" | "year" | "cover" | "tier">;

/**
 * Every case study as one ruled list. On a fine pointer the hovered row's cover floats beside the cursor
 * (eased with quickTo); touch screens and reduced motion get the plain list (no cover at all).
 */
export function WorkIndex({ lang, items }: { lang: Lang; items: IndexItem[] }) {
  const fa = lang === "fa";
  const list = useRef<HTMLDivElement>(null);
  const float = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  // set by the effect where the cover can follow the pointer; elsewhere it would sit stuck at the list's corner
  const [canFloat, setCanFloat] = useState(false);
  // covers mount on first hover only, so the list costs nothing until it is explored
  const [seen, setSeen] = useState<Set<number>>(() => new Set());
  const enter = (i: number) => {
    setActive(i);
    if (canFloat) setSeen((s) => (s.has(i) ? s : new Set(s).add(i)));
  };

  useEffect(() => {
    const el = list.current;
    const f = float.current;
    if (!el || !f) return;
    if (!window.matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)").matches) return;
    setCanFloat(true);
    const x = gsap.quickTo(f, "x", { duration: 0.55, ease: "power3.out" });
    const y = gsap.quickTo(f, "y", { duration: 0.55, ease: "power3.out" });
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      x(e.clientX - r.left);
      y(e.clientY - r.top);
    };
    el.addEventListener("pointermove", move);
    return () => el.removeEventListener("pointermove", move);
  }, []);

  return (
    <section className="mx-auto max-w-[1800px] px-5 pb-28 pt-16 md:px-10 md:pb-40 md:pt-24" aria-labelledby="work-index">
      <div className="mb-8 flex items-end justify-between gap-6 border-b border-line pb-4">
        <h3 id="work-index" className="eyebrow eyebrow-fa">{fa ? "فهرست کامل کارها" : "Complete index"}</h3>
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-faint">{num(lang, String(items.length).padStart(2, "0"))}</p>
      </div>
      <div ref={list} className="relative overflow-x-clip" onPointerLeave={() => setActive(null)}>
        <ol>
          {items.map((p, i) => (
            <li key={p.slug} onPointerEnter={() => enter(i)}>
              <Link
                href={href(lang, `/work/${p.slug}`)}
                className={`group grid grid-cols-12 items-baseline gap-x-4 border-b border-line py-5 transition-opacity duration-500 md:py-7 ${active !== null && active !== i ? "md:opacity-35" : ""}`}
              >
                <span className="col-span-2 font-mono text-xs text-faint md:col-span-1">{num(lang, String(i + 1).padStart(2, "0"))}</span>
                <span className={`col-span-10 text-[clamp(1.35rem,2.6vw,2.4rem)] leading-tight transition-transform duration-700 ease-[var(--ease-out-expo)] md:col-span-6 ${fa ? "font-bold group-hover:-translate-x-3" : "font-semibold tracking-[-0.03em] group-hover:translate-x-3"}`}>
                  {p.title[lang]}
                  {p.tier === "lab" ? <span className="ms-3 rounded-full border border-line px-2 py-0.5 align-middle font-mono text-[0.6rem] font-normal uppercase tracking-[0.16em] text-muted">{fa ? "آزمایشگاه" : "Lab"}</span> : null}
                </span>
                <span className="col-span-10 col-start-3 mt-2 text-sm text-muted md:col-span-4 md:col-start-auto md:mt-0">{p.kicker[lang]}</span>
                <span className="hidden text-end font-mono text-xs text-faint md:col-span-1 md:block">{num(lang, p.year)}</span>
              </Link>
            </li>
          ))}
        </ol>
        <div ref={float} className="pointer-events-none absolute left-0 top-0 z-10 hidden md:block" aria-hidden>
          <div className={`-translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[6px] border border-line bg-bg-2 shadow-2xl transition-[opacity,scale] duration-500 ease-[var(--ease-out-expo)] ${canFloat && active !== null ? "scale-100 opacity-100" : "scale-75 opacity-0"}`}>
            <div className="relative aspect-[16/10] w-[300px]">
              {items.map((p, i) => (
                seen.has(i) ? (
                  <div key={p.slug} className={`absolute inset-0 transition-opacity duration-300 ${active === i ? "opacity-100" : "opacity-0"}`}>
                    <Media m={p.cover} lang={lang} fill sizes="300px" />
                  </div>
                ) : null
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
