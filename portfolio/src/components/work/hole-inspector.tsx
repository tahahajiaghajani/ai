"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { num } from "@/lib/i18n";
import report from "@/content/data/turbine-report.json";

type Hole = { id: string; v: number; c: [number, number] };

const STAGES = [
  { fa: "هاف: جای هر سوراخ", en: "Hough: where each hole is" },
  { fa: "SAM: مرز دقیق", en: "SAM: the exact boundary" },
  { fa: "واریانس درون ماسک", en: "Variance inside each mask" },
  { fa: "گزارش JSON", en: "JSON report" },
];

// the three holes the analyzer flagged on the known_bad test sample (read from the workflow screenshots)
const BAD = new Set(["B3", "D5", "E2"]);

/**
 * The real 36-hole report of the thesis run, replayed stage by stage: Hough candidates → SAM masks → in-mask
 * variance → per-hole verdict. "Known bad" shows the test sample on which three holes were flagged.
 */
export function HoleInspector({ lang }: { lang: Lang }) {
  const holes = (report.holes as Hole[]).slice().sort((a, b) => a.id.localeCompare(b.id));
  const [stage, setStage] = useState(-1);
  const [bad, setBad] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const fa = lang === "fa";

  const box = useMemo(() => {
    const xs = holes.map((h) => h.c[0]);
    const ys = holes.map((h) => h.c[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }, [holes]);
  const P = (c: [number, number]) => ({
    x: 70 + ((c[0] - box.x0) / (box.x1 - box.x0 || 1)) * 360,
    y: 60 + ((c[1] - box.y0) / (box.y1 - box.y0 || 1)) * 480,
  });
  const vMin = Math.min(...holes.map((h) => h.v));
  const vMax = Math.max(...holes.map((h) => h.v));
  const mean = holes.reduce((s, h) => s + h.v, 0) / holes.length;

  // play the four stages once when the plate scrolls into view
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setStage(3);
      return;
    }
    let timers: ReturnType<typeof setTimeout>[] = [];
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        timers = [0, 1, 2, 3].map((s) => setTimeout(() => setStage(s), 400 + s * 1500));
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      timers.forEach(clearTimeout);
    };
  }, []);

  const failed = bad ? holes.filter((h) => BAD.has(h.id)) : [];
  const active = hover ? holes.find((h) => h.id === hover) : null;

  return (
    <div ref={root} className="grid gap-px overflow-hidden rounded-[6px] border border-line bg-line lg:grid-cols-[1.1fr_1fr]">
      <div className="relative bg-bg-2 p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label={fa ? "مرحله" : "Stage"} className="flex flex-wrap gap-1.5">
            {STAGES.map((s, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={stage === i}
                onClick={() => setStage(i)}
                className={`rounded-full border px-3 py-1.5 text-[0.72rem] transition-colors ${stage >= i ? "border-fg text-fg" : "border-line text-faint"} ${stage === i ? "bg-fg text-bg" : ""}`}
              >
                {num(lang, i + 1)}. {s[lang]}
              </button>
            ))}
          </div>
          <div className="flex overflow-hidden rounded-full border border-line font-mono text-[0.64rem] uppercase tracking-[0.12em]" dir="ltr">
            <button type="button" onClick={() => setBad(false)} className={`px-3 py-1.5 ${!bad ? "bg-fg text-bg" : "text-muted"}`} aria-pressed={!bad}>known_good</button>
            <button type="button" onClick={() => setBad(true)} className={`px-3 py-1.5 ${bad ? "bg-fg text-bg" : "text-muted"}`} aria-pressed={bad}>known_bad</button>
          </div>
        </div>
        <svg viewBox="0 0 500 600" className="mx-auto h-auto w-full max-w-[460px] text-fg" role="img" aria-label={fa ? "نقشه‌ی ۳۶ سوراخ خنک‌کاری" : "Map of the 36 cooling holes"} direction="ltr">
          <rect x={30} y={20} width={440} height={560} rx={14} fill="none" stroke="currentColor" strokeOpacity={0.18} />
          {holes.map((h) => {
            const p = P(h.c);
            const isBad = bad && BAD.has(h.id);
            return (
              <g key={h.id} onPointerEnter={() => setHover(h.id)} onPointerLeave={() => setHover(null)} className="cursor-crosshair">
                <circle cx={p.x} cy={p.y} r={16} fill="currentColor" opacity={stage >= 1 ? (isBad && stage >= 3 ? 0.08 : 0.88) : 0.12} className="transition-opacity duration-700" style={{ transitionDelay: `${(h.c[0] + h.c[1]) % 9 * 40}ms` }} />
                <circle cx={p.x} cy={p.y} r={22} fill="none" stroke="currentColor" strokeWidth={1.4} opacity={stage >= 0 ? 1 : 0} strokeDasharray={stage >= 0 ? "0" : "4 4"} className="transition-opacity duration-500" style={{ transitionDelay: `${(h.c[0] * 3 + h.c[1]) % 13 * 30}ms` }} />
                {stage >= 0 && stage < 1 ? (
                  <>
                    <line x1={p.x - 5} x2={p.x + 5} y1={p.y} y2={p.y} stroke="currentColor" />
                    <line x1={p.x} x2={p.x} y1={p.y - 5} y2={p.y + 5} stroke="currentColor" />
                  </>
                ) : null}
                {isBad && stage >= 3 ? (
                  <>
                    <circle cx={p.x} cy={p.y} r={29} fill="none" stroke="currentColor" strokeWidth={2.4} className="glyph-ping" />
                    <rect x={p.x - 26} y={p.y - 46} width={52} height={14} fill="currentColor" />
                    <text x={p.x} y={p.y - 36} textAnchor="middle" className="fill-[var(--bg)] font-mono text-[8.5px] font-semibold">FAILED</text>
                  </>
                ) : null}
                {stage >= 2 && !isBad ? (
                  <text x={p.x} y={p.y + 36} textAnchor="middle" className="fill-current font-mono text-[8px]" opacity={0.55}>{Math.round(h.v)}</text>
                ) : null}
                {hover === h.id ? <rect x={p.x - 27} y={p.y - 27} width={54} height={54} fill="none" stroke="currentColor" strokeWidth={1} /> : null}
              </g>
            );
          })}
          {["A", "B", "C", "D", "E", "F"].map((r, i) => (
            <text key={r} x={46} y={64 + i * 96} className="fill-current font-mono text-[10px]" opacity={0.45}>{r}</text>
          ))}
        </svg>
      </div>

      <div className="flex flex-col gap-6 bg-bg-2 p-4 md:p-6">
        <div>
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-faint">{fa ? "واریانس شدت پیکسل در هر ماسک" : "In-mask intensity variance, per hole"}</p>
          <svg viewBox="0 0 360 120" className="mt-3 h-auto w-full text-fg" direction="ltr" aria-hidden>
            <line x1={0} x2={360} y1={120 - ((mean - vMin + 20) / (vMax - vMin + 40)) * 110} y2={120 - ((mean - vMin + 20) / (vMax - vMin + 40)) * 110} stroke="currentColor" strokeDasharray="3 4" opacity={0.5} />
            {holes.map((h, i) => {
              const hgt = ((h.v - vMin + 20) / (vMax - vMin + 40)) * 110;
              return (
                <rect
                  key={h.id}
                  x={i * 10}
                  y={120 - (stage >= 2 ? hgt : 0)}
                  width={7}
                  height={stage >= 2 ? hgt : 0}
                  fill="currentColor"
                  opacity={hover === h.id ? 1 : bad && BAD.has(h.id) ? 0.2 : 0.7}
                  className="transition-all duration-700"
                  style={{ transitionDelay: `${i * 18}ms` }}
                />
              );
            })}
          </svg>
          <p className="mt-2 flex justify-between font-mono text-[0.62rem] text-faint" dir="ltr">
            <span>μ = {mean.toFixed(1)}</span>
            <span>σ = 15.8</span>
            <span>n = 36</span>
          </p>
        </div>
        <pre className="code min-h-[220px] flex-1 overflow-hidden rounded-[4px] border border-line bg-bg p-4 text-[0.72rem] leading-[1.7]" dir="ltr" aria-live="polite">
          <span className="t-p">{"{"}</span>
          {"\n  "}<span className="t-s">&quot;total_holes&quot;</span><span className="t-p">: </span><span className="t-n">36</span>,
          {"\n  "}<span className="t-s">&quot;failed_holes&quot;</span><span className="t-p">: </span><span className="t-n">{stage >= 3 ? failed.length : "…"}</span>,
          {"\n  "}<span className="t-s">&quot;clog_percentage&quot;</span><span className="t-p">: </span><span className="t-n">{stage >= 3 ? ((failed.length / 36) * 100).toFixed(1) : "…"}</span>,
          {"\n  "}<span className="t-s">&quot;holes&quot;</span><span className="t-p">: [</span>
          {(active ? [active] : holes.slice(0, 2)).map((h) => (
            <span key={h.id}>
              {"\n    { "}<span className="t-s">&quot;id&quot;</span>: <span className="t-s">&quot;{h.id}&quot;</span>, <span className="t-s">&quot;variance&quot;</span>: <span className="t-n">{stage >= 2 ? h.v : "…"}</span>,
              {"\n      "}<span className="t-s">&quot;status&quot;</span>: <span className="t-k">{stage >= 3 ? (bad && BAD.has(h.id) ? "\"FAILED\"" : "\"PASSED\"") : "…"}</span>, <span className="t-s">&quot;center&quot;</span>: [<span className="t-n">{h.c[0]}</span>, <span className="t-n">{h.c[1]}</span>] {"}"}
            </span>
          ))}
          {"\n    "}<span className="t-c">{"// …"}</span>
          {"\n  "}<span className="t-p">]</span>
          {"\n"}<span className="t-p">{"}"}</span>
        </pre>
        <p className="text-[0.8rem] leading-relaxed text-muted">
          {fa
            ? "داده‌ی واقعی اجرای پایان‌نامه روی ویدئوی نمونه‌ی سالم (۳۶ از ۳۶ سوراخ تشخیص داده شد). حالت known_bad نمونه‌ی آزمونی است که در آن سه سوراخ علامت خوردند. روی هر سوراخ بروید تا رکوردش را ببینید."
            : "Real data from the thesis run on the healthy sample video (36 of 36 holes found). known_bad is the test sample on which three holes were flagged. Hover a hole to read its record."}
        </p>
      </div>
    </div>
  );
}
