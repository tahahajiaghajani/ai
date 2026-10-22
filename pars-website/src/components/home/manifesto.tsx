import type { CSSProperties } from "react";
import type { Copy } from "@/content/fa";
import { LazyMark } from "@/components/brand/lazy-mark";
import { ScrollProgress } from "@/components/home/scroll-progress";

/**
 * "The intersection": the logo's ribbons converge while the manifesto lights up word by word.
 * Everything is driven by one CSS variable (--p) — no per-frame React work.
 */
export function Manifesto({ t }: { t: Copy }) {
  const words = t.manifesto.text.split(/\s+/);
  return (
    <section id="intersection" aria-label={t.manifesto.kicker}>
      <ScrollProgress className="relative h-[190vh] md:h-[230vh]">
        <div className="sticky top-0 flex min-h-[100svh] items-center overflow-hidden pb-10 pt-20 md:py-24">
          <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(40%_50%_at_var(--gx,30%)_50%,rgb(223_17_115/calc(var(--p,1)*0.16)),transparent_70%)]" />
          <div className="mx-auto grid w-full max-w-7xl items-center gap-7 px-5 sm:px-8 md:grid-cols-[0.85fr_1.15fr] md:gap-16">
            <div className="relative mx-auto w-[min(50vw,420px)] md:w-[min(78vw,420px)]" dir="ltr">
              <div className="mx-stage relative">
                <LazyMark animated idPrefix="mx" className="mx-mark relative z-10 h-auto w-full overflow-visible" />
                <span aria-hidden className="mx-glow absolute start-[47%] top-[50%] z-20 size-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgb(255_255_255/0.9),rgb(255_43_143/0.55)_30%,transparent_70%)] mix-blend-screen" />
              </div>
              <div className="mt-4 flex justify-between text-[11px] font-semibold md:mt-6 md:text-xs" dir="ltr">
                <span className="text-violet">{t.manifesto.left}</span>
                <span className="text-pink">{t.manifesto.right}</span>
              </div>
            </div>
            <div>
              <span className="kicker">
                <span className="h-px w-8 bg-violet/60" />
                {t.manifesto.kicker}
              </span>
              <p className="display mt-6 text-[clamp(1.12rem,2.7vw,2.35rem)] font-bold leading-[1.75] [html[lang=en]_&]:leading-[1.28]" style={{ "--n": words.length } as CSSProperties}>
                {words.map((w, i) => (
                  <span key={i} className="scrub-word" style={{ "--i": i } as CSSProperties}>
                    {w}{" "}
                  </span>
                ))}
              </p>
            </div>
          </div>
        </div>
      </ScrollProgress>
    </section>
  );
}
