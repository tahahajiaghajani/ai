"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { MARK_PATH, MARK_STROKE, MARK_VIEWBOX } from "@/components/brand/mark-paths";

/**
 * The mark drawn the way a pen would: the crossbar, then the dome and the base (the ط's bowl), then the
 * stem rises through both — it reads ط at about 80 % and t at about 86 %.
 */
export function MarkDraw({ className = "", duration = 1.6, delay = 0 }: { className?: string; duration?: number; delay?: number }) {
  const path = useRef<SVGPathElement>(null);
  useEffect(() => {
    const p = path.current;
    if (!p) return;
    const tween = gsap.fromTo(p, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration, delay, ease: "power2.inOut" });
    return () => {
      tween.kill();
    };
  }, [duration, delay]);
  return (
    <svg viewBox={MARK_VIEWBOX} className={className} aria-hidden>
      <path ref={path} d={MARK_PATH} fill="none" stroke="currentColor" strokeWidth={MARK_STROKE} strokeLinecap="butt" strokeLinejoin="miter" pathLength={1} strokeDasharray={1} strokeDashoffset={1} />
    </svg>
  );
}
