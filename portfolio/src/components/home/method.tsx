"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Lang } from "@/lib/i18n";
import { num } from "@/lib/i18n";
import { METHOD } from "@/content/profile";
import { ui } from "@/content/ui";

gsap.registerPlugin(ScrollTrigger);

/**
 * Five moves of forward-deployed work. On wide screens the section pins and the scroll walks the five steps:
 * a rule draws across, each step's number fills as it is reached. Phones, reduced motion and no JS get a plain list
 * with every step reached (the walk starts from step one only while the pin runs).
 */
export function Method({ lang }: { lang: Lang }) {
  const root = useRef<HTMLElement>(null);
  const [step, setStep] = useState(METHOD.length - 1);
  const fa = lang === "fa";

  // a layout effect, not useEffect: the pin wraps the section in GSAP's spacer, and its cleanup must put the section
  // back before React removes it on navigation (passive cleanups run after the removal, which then throws)
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
      setStep(0);
      el.style.setProperty("--p", "0");
      const st = ScrollTrigger.create({
        trigger: el,
        start: "top top",
        end: "+=" + window.innerHeight * 2.2,
        pin: true,
        scrub: true,
        onUpdate: (self) => {
          setStep(Math.min(METHOD.length - 1, Math.floor(self.progress * METHOD.length * 0.999)));
          el.style.setProperty("--p", String(self.progress));
        },
      });
      return () => {
        st.kill();
        setStep(METHOD.length - 1);
        el.style.setProperty("--p", "1");
      };
    });
    return () => mm.revert();
  }, []);

  return (
    <section ref={root} id="method" className="tone-invert relative overflow-hidden lg:h-[100svh]" style={{ ["--p" as string]: 1 }}>
      <div className="mx-auto flex h-full max-w-[1800px] flex-col justify-between gap-16 px-5 py-24 md:px-10 lg:py-16">
        <div className="grid grid-cols-12 gap-x-4">
          <p className="col-span-12 mb-6 flex items-center gap-3 font-mono text-[0.65rem] uppercase tracking-[0.22em] text-muted md:col-span-3">
            <span className="text-fg">{num(lang, "04")}</span>
            <span className="h-px w-6 bg-line-strong" />
            <span className={fa ? "font-fa text-[0.8rem] normal-case tracking-normal" : ""}>{ui.sections.method[lang]}</span>
          </p>
          <h2 className={`col-span-12 text-title md:col-span-9 ${fa ? "font-bold leading-[1.3]" : "font-semibold leading-[1.02] tracking-[-0.035em]"}`}>
            {fa ? (
              <>مهندسی استقرار پیشرو: <span className="font-light">کنار مسئله، تا روز بهره‌برداری.</span></>
            ) : (
              <>
                Forward-deployed: <span className="font-serif font-normal italic">beside the problem, until it runs in production.</span>
              </>
            )}
          </h2>
        </div>

        {/* the current step, huge and outlined, behind the content (wide screens) */}
        <div aria-hidden className="pointer-events-none absolute inset-0 hidden items-center justify-end overflow-hidden pe-10 lg:flex">
          <span key={step} className="latin text-outline animate-[fade-in_0.7s_ease-out] text-[34vh] font-semibold leading-none tracking-[-0.06em] opacity-60">
            {num(lang, `0${step + 1}`)}
          </span>
        </div>
        <div className="relative">
          <div className="absolute inset-x-0 top-[1.15rem] hidden h-px bg-line lg:block" />
          <div className="absolute start-0 top-[1.15rem] hidden h-px w-full origin-[left] scale-x-[var(--p)] bg-fg lg:block rtl:origin-[right]" />
          <ol className="grid gap-12 lg:grid-cols-5 lg:gap-6">
            {METHOD.map((m, i) => {
              const reached = i <= step;
              return (
                <li key={i} className="relative">
                  <span
                    className={`relative z-10 grid size-[2.3rem] place-items-center rounded-full border font-mono text-xs transition-colors duration-500 ${reached ? "border-fg bg-fg text-bg" : "border-line-strong bg-bg text-muted"}`}
                  >
                    {num(lang, `0${i + 1}`)}
                  </span>
                  <h3 className={`mt-6 text-[clamp(1.6rem,2.4vw,2.4rem)] leading-tight transition-opacity duration-500 lg:opacity-[var(--o)] ${fa ? "font-bold" : "font-semibold tracking-[-0.03em]"}`} style={{ ["--o" as string]: reached ? 1 : 0.35 }}>
                    {m.title[lang]}
                  </h3>
                  <p className="mt-3 max-w-[34ch] leading-relaxed text-fg-2 transition-opacity duration-500 lg:opacity-[var(--o)]" style={{ ["--o" as string]: reached ? 1 : 0.35 }}>
                    {m.body[lang]}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
