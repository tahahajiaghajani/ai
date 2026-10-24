"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { finePointer, useMotionReduced } from "@/components/fx/motion";

/** Leans its child towards the pointer when it comes near (main calls to action; mouse only; still with reduced motion). */
export function Magnetic({ children, strength = 0.28, className = "" }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useMotionReduced();
  useEffect(() => {
    const el = ref.current;
    if (!el || !finePointer() || reduced) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2);
      const y = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate3d(${x * strength}px, ${y * strength}px, 0)`;
    };
    const leave = () => (el.style.transform = "");
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      leave();
    };
  }, [strength, reduced]);
  return (
    <span ref={ref} className={`inline-flex transition-transform duration-500 ease-[var(--ease-out-expo)] ${className}`}>
      {children}
    </span>
  );
}
