"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import type { Lang } from "@/lib/i18n";
import { faDigits } from "@/lib/i18n";
import { MarkDraw } from "@/components/brand/mark-draw";

declare global {
  interface Window {
    __introDone?: boolean;
  }
}

/** Tells the page the intro has finished (the hero starts its own entrance on this). */
function finish() {
  window.__introDone = true;
  document.documentElement.classList.remove("js-loading");
  window.dispatchEvent(new Event("intro:done"));
}

/** Runs `cb` once the intro is over (immediately when it already is). */
export function onIntroDone(cb: () => void): () => void {
  if (window.__introDone) {
    cb();
    return () => {};
  }
  window.addEventListener("intro:done", cb, { once: true });
  return () => window.removeEventListener("intro:done", cb);
}

/**
 * The opening titles, once per visit: the mark draws itself while a counter runs to 100, the name settles, and the
 * curtain lifts. Skipped on later pages of the same visit and under reduced motion.
 */
export function Preloader({ lang }: { lang: Lang }) {
  const root = useRef<HTMLDivElement>(null);
  const counter = useRef<HTMLSpanElement>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem("intro") === "1";
      sessionStorage.setItem("intro", "1");
    } catch {}
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = root.current;
    if (seen || reduce || !el) {
      setGone(true);
      finish();
      return;
    }
    const state = { n: 0 };
    const tl = gsap.timeline({
      onComplete: () => {
        setGone(true);
      },
    });
    tl.set(el, { autoAlpha: 1 })
      .to(state, {
        n: 100,
        duration: 2.1,
        ease: "power2.inOut",
        onUpdate: () => {
          if (counter.current) {
            const v = String(Math.round(state.n)).padStart(3, "0");
            counter.current.textContent = lang === "fa" ? faDigits(v) : v;
          }
        },
      })
      .to(el.querySelectorAll("[data-pre-line]"), { scaleX: 1, duration: 2.1, ease: "power2.inOut" }, 0)
      .from(el.querySelectorAll("[data-pre-word]"), { yPercent: 110, duration: 1.2, ease: "expo.out", stagger: 0.08 }, 0.5)
      .to(el.querySelectorAll("[data-pre-fade]"), { autoAlpha: 0, duration: 0.4 }, 2.25)
      .to(el, { clipPath: "inset(0 0 100% 0)", duration: 1.1, ease: "expo.inOut", onStart: finish }, 2.35);
    return () => {
      tl.kill();
    };
  }, [lang]);

  if (gone) return null;
  return (
    <div
      ref={root}
      aria-hidden
      className="invisible fixed inset-0 z-[100] flex flex-col justify-between bg-[#050505] p-5 text-[#f3f3ef] md:p-10"
      style={{ clipPath: "inset(0 0 0% 0)" }}
    >
      <div data-pre-fade className="flex justify-between font-mono text-[0.65rem] uppercase tracking-[0.25em] text-white/50">
        <span>Taha Aghajani</span>
        <span>Portfolio · {lang === "fa" ? "۱۴۰۵" : "2026"}</span>
      </div>
      <div className="flex flex-col items-center gap-8">
        <MarkDraw className="size-28 md:size-36" duration={2} />
        <div data-pre-fade className="overflow-hidden">
          <p data-pre-word className="latin text-sm uppercase tracking-[0.5em] text-white/80">
            Taha Aghajani
          </p>
        </div>
      </div>
      <div data-pre-fade className="flex items-end justify-between gap-6">
        <div className="h-px flex-1 origin-left bg-white/15 rtl:origin-right">
          <div data-pre-line className="h-px origin-left scale-x-0 bg-white rtl:origin-right" />
        </div>
        <span ref={counter} className="font-mono text-5xl tabular-nums md:text-7xl">
          {lang === "fa" ? "۰۰۰" : "000"}
        </span>
      </div>
    </div>
  );
}
