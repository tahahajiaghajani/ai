"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(ScrollTrigger, SplitText);

const LenisContext = createContext<Lenis | null>(null);

/** The page's smooth-scroll instance (null under reduced motion or before mount). */
export function useLenis(): Lenis | null {
  return useContext(LenisContext);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Declarative scroll motion for server-rendered markup:
 * - `data-fade` blocks rise and fade in as they enter (staggered in batches);
 * - `data-split` headings reveal line by line from a mask. Persian is split into words and lines only — splitting
 *   Persian into letters would break the joined script;
 * - `data-parallax="0.2"` drifts an element against the scroll;
 * - `data-scrub-words` paragraphs light up word by word while they cross the viewport.
 */
function bindScrollMotion(root: HTMLElement): () => void {
  const ctx = gsap.context(() => {
    const reduce = prefersReducedMotion();

    const fades = gsap.utils.toArray<HTMLElement>("[data-fade]", root);
    if (reduce) {
      gsap.set(fades, { opacity: 1, y: 0 });
    } else {
      ScrollTrigger.batch(fades, {
        start: "top 88%",
        once: true,
        onEnter: (els) =>
          gsap.to(els, { opacity: 1, y: 0, duration: 1.1, ease: "expo.out", stagger: 0.08, overwrite: true }),
      });
    }

    if (!reduce) {
      for (const el of gsap.utils.toArray<HTMLElement>("[data-split]", root)) {
        if (el.dataset.splitDone) continue;
        el.dataset.splitDone = "1";
        const fa = el.closest("[lang]")?.getAttribute("lang") === "fa" || document.documentElement.lang === "fa";
        const split = SplitText.create(el, { type: "lines", mask: "lines", linesClass: "split-line", aria: "auto", autoSplit: true,
          onSplit: (self) =>
            gsap.from(self.lines, {
              yPercent: 112,
              rotate: fa ? 0 : 2,
              duration: 1.25,
              ease: "expo.out",
              stagger: 0.09,
              scrollTrigger: { trigger: el, start: "top 90%", once: true },
            }),
        });
        void split;
      }

      for (const el of gsap.utils.toArray<HTMLElement>("[data-parallax]", root)) {
        const amount = Number(el.dataset.parallax) || 0.15;
        gsap.fromTo(
          el,
          { yPercent: -amount * 50 },
          { yPercent: amount * 50, ease: "none", scrollTrigger: { trigger: el.parentElement ?? el, start: "top bottom", end: "bottom top", scrub: true } },
        );
      }

      for (const el of gsap.utils.toArray<HTMLElement>("[data-scrub-words]", root)) {
        if (el.dataset.scrubDone) continue;
        el.dataset.scrubDone = "1";
        const split = SplitText.create(el, { type: "words", aria: "auto" });
        gsap.fromTo(
          split.words,
          { opacity: 0.16 },
          { opacity: 1, ease: "none", stagger: 0.05, scrollTrigger: { trigger: el, start: "top 80%", end: "bottom 45%", scrub: 0.6 } },
        );
      }
    }
  }, root);
  return () => ctx.revert();
}

export function MotionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [lenis, setLenis] = useState<Lenis | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // one smooth-scroll instance for the whole visit, driven by GSAP's ticker so ScrollTrigger stays in step
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const l = new Lenis({ lerp: 0.09, wheelMultiplier: 1, smoothWheel: true, anchors: { offset: -80 } });
    l.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => l.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    setLenis(l);
    return () => {
      gsap.ticker.remove(tick);
      l.destroy();
      setLenis(null);
    };
  }, []);

  // every page (and every client-side navigation) gets its own scroll motion
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    lenis?.scrollTo(0, { immediate: true });
    let unbind = () => {};
    // after fonts settle, so split lines match the final layout
    const go = () => {
      unbind = bindScrollMotion(root);
      ScrollTrigger.refresh();
    };
    const fonts = document.fonts?.ready ?? Promise.resolve();
    let alive = true;
    fonts.then(() => alive && go());
    return () => {
      alive = false;
      unbind();
    };
  }, [pathname, lenis]);

  return (
    <LenisContext.Provider value={lenis}>
      <div ref={rootRef}>{children}</div>
    </LenisContext.Provider>
  );
}
