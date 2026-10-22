"use client";

import { useEffect, useRef, useState } from "react";
import { num } from "@/lib/digits";

/** Counts up the numeric part of a stat (e.g. "15+", "90%") when it scrolls into view. */
export function Counter({ value, lang }: { value: string; lang: "fa" | "en" }) {
  // only a single quantity animates ("15+", "90%"); values like "24/7" stay static
  const m = value.match(/^(\D*)(\d+)(\D*)$/);
  const target = m ? Number(m[2]) : 0;
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(target);
  useEffect(() => {
    const el = ref.current;
    if (!el || !m || target === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduced") return;
    setN(0);
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const k = Math.min(1, (now - start) / 1600);
        setN(Math.round(target * (1 - Math.pow(1 - k, 4))));
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const fmt = (x: number) => (lang === "fa" ? new Intl.NumberFormat("fa-IR", { useGrouping: false }).format(x) : String(x));
  const rest = (m?.[3] ?? "").replace("%", lang === "fa" ? "٪" : "%");
  // a lone Persian zero is just a dot — spell it out
  const text = lang === "fa" && value.trim() === "0" ? "صفر" : m ? `${m[1]}${fmt(n)}${rest}` : num(value, lang);
  return (
    <span ref={ref} className="tabular-nums" dir="ltr">
      {text}
    </span>
  );
}
