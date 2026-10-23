"use client";

import Lenis from "lenis";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { gsap, ScrollTrigger } from "@/components/fx/gsap";
import { finePointer, motionReduced, OVERLAY_EVENT } from "@/components/fx/motion";

/**
 * Smooth, weighted wheel scrolling (Lenis) driving GSAP's ScrollTrigger from one ticker. Mouse and
 * trackpad only: touch screens keep their native scrolling, and nothing changes with reduced motion.
 * Pauses while a dialog is open; dialogs and [data-lenis-prevent] areas scroll natively.
 */
export function SmoothScroll() {
  const lenis = useRef<Lenis | null>(null);
  const path = usePathname();

  useEffect(() => {
    if (motionReduced() || !finePointer()) return;
    const l = new Lenis({
      lerp: 0.085,
      wheelMultiplier: 0.95,
      anchors: { offset: -88 },
      stopInertiaOnNavigate: true,
      prevent: (node) => Boolean(node.closest?.("dialog, [data-lenis-prevent]")),
    });
    lenis.current = l;
    l.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => l.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    const onOverlay = (e: Event) => ((e as CustomEvent<{ open: boolean }>).detail.open ? l.stop() : l.start());
    window.addEventListener(OVERLAY_EVENT, onOverlay);
    return () => {
      window.removeEventListener(OVERLAY_EVENT, onOverlay);
      gsap.ticker.remove(tick);
      l.destroy();
      lenis.current = null;
    };
  }, []);

  // a new page: measure again once it has painted
  useEffect(() => {
    lenis.current?.resize();
    const id = requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => cancelAnimationFrame(id);
  }, [path]);

  return null;
}
