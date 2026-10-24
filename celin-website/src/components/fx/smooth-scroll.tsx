"use client";

import Lenis from "lenis";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";
import { forgetScroll, gsap, pauseScrollTrigger, ScrollTrigger, scrollTriggerOn } from "@/components/fx/gsap";
import { finePointer, OVERLAY_EVENT, useMotionReduced } from "@/components/fx/motion";

/**
 * Smooth, weighted wheel scrolling (Lenis) driving GSAP's ScrollTrigger from one ticker. Mouse and
 * trackpad only: touch screens keep their native scrolling, and nothing changes with reduced motion.
 * The preference is live: turning motion off (footer toggle, OS setting) destroys Lenis and stops
 * ScrollTrigger's frame loop at once; turning it on again starts them again. Pauses while a dialog is open;
 * dialogs and [data-lenis-prevent] areas scroll natively.
 */
export function SmoothScroll() {
  const lenis = useRef<Lenis | null>(null);
  const path = usePathname();
  const reduced = useMotionReduced();

  useEffect(() => {
    if (reduced) {
      // the scroll effects were reverted by their own contexts (useGsap); stop the loop that drove them
      pauseScrollTrigger();
      return;
    }
    if (!finePointer()) return;
    const l = new Lenis({
      lerp: 0.085,
      wheelMultiplier: 0.95,
      anchors: { offset: -88 },
      stopInertiaOnNavigate: true,
      prevent: (node) => Boolean(node.closest?.("dialog, [data-lenis-prevent]")),
    });
    lenis.current = l;
    // ScrollTrigger is registered by the first scroll effect on the page (useGsap); until then nothing listens
    const sync = () => scrollTriggerOn() && ScrollTrigger.update();
    l.on("scroll", sync);
    const tick = (time: number) => l.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    const onOverlay = (e: Event) => ((e as CustomEvent<{ open: boolean }>).detail.open ? l.stop() : l.start());
    window.addEventListener(OVERLAY_EVENT, onOverlay);
    const measure = requestAnimationFrame(() => scrollTriggerOn() && ScrollTrigger.refresh());
    return () => {
      cancelAnimationFrame(measure);
      window.removeEventListener(OVERLAY_EVENT, onOverlay);
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
      l.destroy();
      lenis.current = null;
      // native scrolling again: the remaining triggers measure against it
      if (scrollTriggerOn()) requestAnimationFrame(() => scrollTriggerOn() && ScrollTrigger.refresh());
    };
  }, [reduced]);

  // a new page: in the same commit as Next's scroll to its top, before any refresh — the old page's position is not
  // put back (forgetScroll); then measure again once it has painted
  useLayoutEffect(() => {
    forgetScroll();
  }, [path]);
  useEffect(() => {
    lenis.current?.resize();
    const id = requestAnimationFrame(() => scrollTriggerOn() && ScrollTrigger.refresh());
    return () => cancelAnimationFrame(id);
  }, [path]);

  return null;
}
