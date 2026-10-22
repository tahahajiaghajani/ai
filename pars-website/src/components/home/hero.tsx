import type { CSSProperties } from "react";
import type { Copy } from "@/content/fa";
import { HeroWaves } from "@/components/home/hero-waves";
import { HeroComposer } from "@/components/home/hero-composer";

const d = (n: number) => ({ "--d": n }) as CSSProperties;

export function Hero({ t }: { t: Copy }) {
  const h = t.hero;
  return (
    <section id="top" className="grain relative isolate flex min-h-[100svh] flex-col overflow-hidden">
      {/* CSS backdrop (also the fallback when WebGL is unavailable) */}
      <div aria-hidden className="absolute inset-0 -z-20 bg-[radial-gradient(70%_55%_at_50%_100%,rgb(223_17_115/0.22),transparent_70%),radial-gradient(50%_45%_at_15%_10%,rgb(143_134_255/0.16),transparent_70%),radial-gradient(45%_40%_at_90%_20%,rgb(194_71_159/0.12),transparent_70%)]" />
      <div aria-hidden className="absolute inset-0 -z-10">
        <HeroWaves dir={t.dir} />
      </div>
      <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-b from-transparent to-ink" />

      <div className="hero-in mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-5 pb-20 pt-[calc(var(--header-h)+2.5rem)] text-center sm:px-8">
        <span style={d(0)} className="inline-flex items-center gap-2.5 rounded-full border border-line-strong bg-ink-3/60 py-1.5 pe-4 ps-2 text-[13px] text-muted backdrop-blur-md">
          <span className="relative flex size-5 items-center justify-center rounded-full bg-success/15">
            <span className="size-2 rounded-full bg-success animate-pulse-dot" />
          </span>
          {h.eyebrow}
        </span>

        <h1 style={d(1)} className="display mt-7 text-[clamp(2.05rem,5.4vw,4.25rem)] text-balance">
          <span className="block">{h.titleA}</span>
          <span className="block">
            {h.titleB}
            <span className="text-gradient">{h.titleHi}</span>
            {h.titleC}
          </span>
        </h1>

        <p style={d(2)} className="justified-center mt-6 max-w-2xl text-pretty text-base leading-8 text-muted sm:text-lg sm:leading-9">
          {h.lead}
        </p>

        <div style={d(3)} className="mt-10 w-full max-w-3xl">
          <HeroComposer placeholders={h.placeholders} label={h.placeholder} send={h.send} hint={h.hint} />
        </div>

        <ul style={d(4)} className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-faint">
          {h.trust.map((x, i) => (
            <li key={x} className="flex items-center gap-6">
              {i > 0 && <span aria-hidden className="size-1 rounded-full bg-pink/60" />}
              <span>{x}</span>
            </li>
          ))}
        </ul>
      </div>

      <a href="#intersection" aria-label={h.scroll} className="absolute bottom-6 start-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-[11px] text-faint transition hover:text-fg rtl:translate-x-1/2 sm:flex">
        <span className="relative h-9 w-5 rounded-full border border-line-strong">
          <span className="absolute start-1/2 top-1.5 h-2 w-0.5 -translate-x-1/2 rounded-full bg-pink animate-[float_1.8s_ease-in-out_infinite] rtl:translate-x-1/2" />
        </span>
      </a>
    </section>
  );
}
