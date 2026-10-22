import type { CSSProperties } from "react";
import type { Copy } from "@/content/fa";
import { num, type Lang } from "@/lib/i18n";
import { SectionHead } from "@/components/home/section-head";

export function Process({ lang, t }: { lang: Lang; t: Copy }) {
  const p = t.process;
  return (
    <section id="process" className="relative py-28 sm:py-36">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHead kicker={p.kicker} title={p.title} />
        <div data-reveal className="process relative mt-16">
          {/* wave connector, drawn when revealed */}
          <svg aria-hidden viewBox="0 0 1000 80" preserveAspectRatio="none" className="absolute inset-x-0 top-6 hidden h-20 w-full lg:block rtl:-scale-x-100">
            <defs>
              <linearGradient id="proc-g" x1="0" x2="1">
                <stop offset="0" stopColor="#8f86ff" />
                <stop offset=".5" stopColor="#c2479f" />
                <stop offset="1" stopColor="#ff2b8f" />
              </linearGradient>
            </defs>
            <path className="proc-path" d="M0 40 C 100 0, 150 80, 250 40 S 400 0, 500 40 S 650 80, 750 40 S 900 0, 1000 40" fill="none" stroke="url(#proc-g)" strokeWidth="2" pathLength={1} />
          </svg>
          <ol className="relative grid gap-8 lg:grid-cols-5 lg:gap-6">
            {p.steps.map((s, i) => (
              <li key={s.title} className="proc-step relative flex gap-5 lg:block" style={{ "--i": i } as CSSProperties}>
                <span className="relative z-10 grid size-14 shrink-0 place-items-center rounded-2xl border border-line-strong bg-ink-2 font-brand text-lg font-bold text-gradient shadow-[0_0_0_6px_var(--color-ink)] lg:mt-5">
                  {num(String(i + 1).padStart(2, "0"), lang)}
                </span>
                <div className="lg:mt-6">
                  <div className="font-brand text-xs text-faint">
                    <span className="ltr">{lang === "fa" ? s.en : ""}</span>
                  </div>
                  <h3 className="mt-1 text-lg font-bold">{s.title}</h3>
                  <p className="mt-2 text-[15px] leading-7 text-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
