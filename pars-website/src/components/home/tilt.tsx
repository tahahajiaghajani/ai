"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Subtle 3D tilt that follows the pointer (fine pointers only, off for reduced motion). */
export function Tilt({ className, children, max = 7 }: { className?: string; children: ReactNode; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let rx = 0;
    let ry = 0;
    const apply = () => {
      raf = 0;
      el.style.transform = `perspective(1100px) rotateX(${rx}deg) rotateY(${ry}deg)`;
    };
    const move = (e: PointerEvent) => {
      if (document.documentElement.dataset.motion === "reduced") return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      ry = x * max;
      rx = -y * max;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const leave = () => {
      rx = 0;
      ry = 0;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(raf);
    };
  }, [max]);
  return (
    <div ref={ref} className={className} style={{ transformStyle: "preserve-3d", transition: "transform .5s cubic-bezier(.16,1,.3,1)" }}>
      {children}
    </div>
  );
}
