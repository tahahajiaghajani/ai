"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(ScrollTrigger, SplitText);

const LenisContext = createContext<Lenis | null>(null);

/** How far above a `#section` the page lands, so the fixed header does not cover its top. */
const ANCHOR_OFFSET = -80;

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
        const fa = el.closest("[lang]")?.getAttribute("lang") === "fa" || document.documentElement.lang === "fa";
        // SplitText starts a new line only where a word sits left of the one before, never the case in RTL; breaks don't
        // depend on direction, so RTL lines are measured laid out LTR (set as SplitText reads the text, restored once the
        // lines are wrapped, on every split and within one task: never painted). Each line stays one block of plain text,
        // so mixed Persian and Latin keep their order.
        const rtl = getComputedStyle(el).direction === "rtl";
        SplitText.create(el, { type: "lines", mask: "lines", linesClass: "split-line", aria: "none", autoSplit: true,
          prepareText: (text) => {
            if (rtl) el.style.direction = "ltr";
            return text;
          },
          onSplit: (self) => {
            el.style.direction = "";
            return gsap.from(self.lines, {
              yPercent: 112,
              rotate: fa ? 0 : 2,
              duration: 1.25,
              ease: "expo.out",
              stagger: 0.09,
              scrollTrigger: { trigger: el, start: "top 90%", once: true },
            });
          },
        });
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
        // the words only change opacity, so they stay in the accessibility tree ("auto" would hide them and move the
        // text into an aria-label, which a paragraph cannot carry)
        const split = SplitText.create(el, { type: "words", aria: "none" });
        gsap.fromTo(
          split.words,
          { opacity: 0.16 },
          { opacity: 1, ease: "none", stagger: 0.05, scrollTrigger: { trigger: el, start: "top 80%", end: "bottom 45%", scrub: 0.6 } },
        );
      }
    }
  }, root);
  // reverting restores every split element's markup, so the next bind (a new page, or Strict Mode's second run) splits afresh
  return () => ctx.revert();
}

/** The element the address's `#fragment` names, if any. */
function hashTarget(): HTMLElement | null {
  try {
    const id = decodeURIComponent(location.hash.slice(1));
    return id ? document.getElementById(id) : null;
  } catch {
    return null;
  }
}

/** Puts the page at the `#section` its address names (just below the fixed header), else at the top. */
function land(lenis: Lenis) {
  const target = hashTarget();
  // a glide still running from the last page (a click right after a wheel turn or a menu jump) would carry on to its
  // old target on the next frame, which on a shorter page is the very bottom: stopping and starting Lenis drops it
  if (!lenis.isStopped) {
    lenis.stop();
    lenis.start();
  }
  // a native jump, not lenis.scrollTo({ immediate }): that one makes Lenis ignore the next scroll event, which on Back
  // and Forward is the browser restoring the visitor's place, and the next wheel turn would glide from the top. It also
  // moves the page while an open overlay holds Lenis
  const y = target ? Math.max(0, target.getBoundingClientRect().top + window.scrollY + ANCHOR_OFFSET) : 0;
  window.scrollTo({ top: y, behavior: "instant" });
  lenis.resize(); // the new page's height, and the position just set
}

export function MotionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [lenis, setLenis] = useState<Lenis | null>(null);
  // the page effect reads the instance here, so its arrival does not bind the page a second time
  const lenisRef = useRef<Lenis | null>(null);
  const lastPath = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // one smooth-scroll instance for the whole visit, driven by GSAP's ticker so ScrollTrigger stays in step
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const l = new Lenis({ lerp: 0.09, wheelMultiplier: 1, smoothWheel: true, anchors: { offset: ANCHOR_OFFSET } });
    l.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => l.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    lenisRef.current = l;
    setLenis(l);
    return () => {
      gsap.ticker.remove(tick);
      l.destroy();
      lenisRef.current = null;
      setLenis(null);
    };
  }, []);

  // a client-side navigation starts the new page at the top, or at the #section its address names; the first page
  // keeps the place the browser gave it (its jump to a #section, or the position it restored). A layout effect, so it
  // runs before the new page is painted: no frame shows it where the last page was scrolled
  useLayoutEffect(() => {
    const navigated = lastPath.current !== null && lastPath.current !== pathname;
    lastPath.current = pathname;
    if (navigated && lenisRef.current) land(lenisRef.current);
  }, [pathname]);

  // every page (and every client-side navigation) gets its own scroll motion
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let unbind = () => {};
    // after fonts settle, so split lines match the final layout
    const go = () => {
      unbind = bindScrollMotion(root);
      ScrollTrigger.refresh();
      // pins and split lines have just moved the sections: land on the #section again
      if (hashTarget() && lenisRef.current) land(lenisRef.current);
    };
    const fonts = document.fonts?.ready ?? Promise.resolve();
    let alive = true;
    fonts.then(() => alive && go());
    return () => {
      alive = false;
      unbind();
    };
  }, [pathname]);

  return (
    <LenisContext.Provider value={lenis}>
      <div ref={rootRef}>{children}</div>
    </LenisContext.Provider>
  );
}
