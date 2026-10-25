"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Lang } from "@/lib/i18n";
import { num } from "@/lib/i18n";

gsap.registerPlugin(ScrollTrigger);

/** Counts up from zero the first time it scrolls into view. Renders the final value without JS. */
export function Counter({ to, lang, duration = 2 }: { to: number; lang: Lang; duration?: number }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = el.current;
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const state = { v: 0 };
    node.textContent = num(lang, 0);
    const tw = gsap.to(state, {
      v: to,
      duration,
      ease: "power3.out",
      scrollTrigger: { trigger: node, start: "top 90%", once: true },
      onUpdate: () => {
        node.textContent = num(lang, Math.round(state.v));
      },
    });
    return () => {
      tw.scrollTrigger?.kill();
      tw.kill();
    };
  }, [to, lang, duration]);
  return (
    <span ref={el} className="tabular-nums">
      {num(lang, to)}
    </span>
  );
}
