"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import type { Lang } from "@/lib/i18n";
import { num } from "@/lib/i18n";
import { onIntroDone } from "@/components/fx/preloader";
import { VisionPortrait, type Detection } from "@/components/hero/vision-portrait";

// boxes in frame coordinates (the square photo shown in a 4:5 frame: x' = (x − 0.1) / 0.8)
const DETECTIONS: Detection[] = [
  { label: "person", score: "0.997", box: [0.02, 0.14, 0.9, 0.995], delay: 0 },
  { label: "taha_aghajani", score: "0.998", box: [0.32, 0.215, 0.62, 0.47], delay: 0.35 },
  { label: "wristwatch", score: "0.942", box: [0.35, 0.728, 0.455, 0.815], delay: 0.7 },
];

export interface HeroCopy {
  first: string;
  last: string;
  roles: string[];
  headline: string;
  available: string;
  scroll: string;
  alt: string;
}

export function Hero({ lang, copy }: { lang: Lang; copy: HeroCopy }) {
  const root = useRef<HTMLElement>(null);
  const [role, setRole] = useState(0);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = gsap.context(() => {
      if (reduce) return;
      gsap.set("[data-hero-line]", { yPercent: 115 });
      gsap.set("[data-hero-fade]", { opacity: 0, y: 18 });
      gsap.set("[data-hero-frame]", { clipPath: "inset(100% 0 0 0)" });
    }, el);
    const stop = onIntroDone(() => {
      if (reduce) return;
      ctx.add(() => {
        const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
        tl.to("[data-hero-frame]", { clipPath: "inset(0% 0 0 0)", duration: 1.6, ease: "expo.inOut" }, 0)
          .to("[data-hero-line]", { yPercent: 0, duration: 1.5, stagger: 0.12 }, 0.25)
          .to("[data-hero-fade]", { opacity: 1, y: 0, duration: 1.2, stagger: 0.08 }, 0.8);
        // the name drifts apart as the hero scrolls away
        gsap.to("[data-hero-drift='a']", { xPercent: lang === "fa" ? 8 : -8, ease: "none", scrollTrigger: { trigger: el, start: "top top", end: "bottom top", scrub: true } });
        gsap.to("[data-hero-drift='b']", { xPercent: lang === "fa" ? -10 : 10, ease: "none", scrollTrigger: { trigger: el, start: "top top", end: "bottom top", scrub: true } });
      });
    });
    return () => {
      stop();
      ctx.revert();
    };
  }, [lang]);

  // the rotating title
  useEffect(() => {
    const t = setInterval(() => setRole((r) => (r + 1) % copy.roles.length), 2800);
    return () => clearInterval(t);
  }, [copy.roles.length]);

  const fa = lang === "fa";
  return (
    <section ref={root} className="relative isolate min-h-[100svh] overflow-hidden pt-24 md:pt-28" aria-label={`${copy.first} ${copy.last}`}>
      <div aria-hidden className="grid-lines pointer-events-none absolute inset-0 -z-10 opacity-60" />

      <div className="mx-auto grid max-w-[1800px] grid-cols-12 gap-x-4 px-5 md:px-10">
        <div data-hero-fade className="col-span-12 flex items-center justify-between border-b border-line pb-4 font-mono text-[0.62rem] uppercase tracking-[0.22em] text-muted">
          <span>{num(lang, "001")} — Portfolio {num(lang, fa ? "۱۴۰۵" : "2026")}</span>
          <span className="hidden sm:inline" dir="ltr">35.69°N · 51.39°E — Tehran</span>
          <span className="flex items-center gap-2">
            <span className="size-1.5 animate-pulse-dot rounded-full bg-fg" />
            <span className={fa ? "font-fa normal-case tracking-normal" : ""}>{copy.available}</span>
          </span>
        </div>

        {/* the portrait: end side on desktop, under the name on phones */}
        <div className="relative col-span-12 mt-8 md:col-span-5 md:col-start-8 md:row-span-2 md:row-start-2 md:mt-12 lg:col-span-4 lg:col-start-9">
          <div data-hero-frame>
            <VisionPortrait src="/media/taha-portrait.jpg" alt={copy.alt} detections={DETECTIONS} />
          </div>
          <div data-hero-fade className="mt-3 flex justify-between font-mono text-[0.6rem] uppercase tracking-[0.2em] text-faint" dir="ltr">
            <span>fig. 01 — vision · hybrid</span>
            <span>{fa ? "hover · scan" : "hover to scan"}</span>
          </div>
        </div>

        <h1 className="relative z-10 col-span-12 mt-10 md:col-span-9 md:col-start-1 md:row-start-2 md:mt-16 md:self-start md:mix-blend-difference">
          <span className={`line-mask block ${fa ? "text-[clamp(4.2rem,15vw,15.5rem)] font-black leading-[1.05]" : "latin text-[clamp(4.5rem,17vw,18rem)] font-semibold leading-[0.84] tracking-[-0.055em]"}`} data-hero-drift="a">
            <span data-hero-line className="block">
              {copy.first}
            </span>
          </span>
          <span
            className={`line-mask block ${fa ? "text-[clamp(3.6rem,13vw,13.5rem)] font-extralight leading-[1.1]" : "font-serif text-[clamp(4.2rem,15.5vw,16.5rem)] italic leading-[0.9] tracking-[-0.03em]"}`}
            style={{ paddingBottom: "0.3em", marginBottom: "-0.3em" }}
            data-hero-drift="b"
          >
            <span data-hero-line className="block">
              {copy.last}
            </span>
          </span>
        </h1>

        <div className="col-span-12 mt-10 grid gap-8 pb-16 md:col-span-7 md:col-start-1 md:row-start-3 md:mt-14 md:grid-cols-7">
          <p data-hero-fade className="text-lead leading-[1.35] text-fg-2 md:col-span-5 text-balance">
            {copy.headline}
          </p>
          <div data-hero-fade className="md:col-span-7">
            <div className="flex items-center gap-4 border-t border-line pt-5">
              <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-faint">{fa ? "نقش" : "Role"}</span>
              <span className="relative h-7 flex-1 overflow-hidden">
                {copy.roles.map((r, i) => (
                  <span
                    key={r}
                    className="absolute inset-x-0 top-0 text-lg font-medium transition-all duration-700 ease-[var(--ease-out-expo)]"
                    style={{ transform: `translateY(${(i - role) * 110}%)`, opacity: i === role ? 1 : 0 }}
                    aria-hidden={i !== role}
                  >
                    {r}
                  </span>
                ))}
              </span>
              <span className="font-mono text-[0.62rem] text-faint">
                {num(lang, `0${role + 1}`)}/{num(lang, `0${copy.roles.length}`)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div data-hero-fade className="pointer-events-none absolute bottom-6 end-5 hidden items-center gap-3 font-mono text-[0.6rem] uppercase tracking-[0.25em] text-muted md:end-10 md:flex">
        <span className="relative block h-10 w-px overflow-hidden bg-line">
          <span className="absolute inset-x-0 top-0 h-1/2 animate-scan bg-fg" />
        </span>
        {copy.scroll}
      </div>
    </section>
  );
}
