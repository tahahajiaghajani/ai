"use client";

import { useEffect, type RefObject } from "react";
import { finePointer, useMotionReduced } from "@/components/fx/motion";

/**
 * Pointer depth for a hero: every `[data-depth]` element inside `root` leans towards the pointer by its
 * data-depth (px at the screen edge; negative leans away). Mouse/trackpad only; nothing with reduced motion
 * (live: turning motion off puts the layers back at once).
 */
export function usePointerDepth(root: RefObject<HTMLElement | null>) {
  const reduced = useMotionReduced();
  useEffect(() => {
    const el = root.current;
    if (!el || !finePointer() || reduced) return;
    const layers = [...el.querySelectorAll<HTMLElement>("[data-depth]")];
    if (!layers.length) return;
    let raf = 0;
    const target = { x: 0, y: 0 };
    const cur = { x: 0, y: 0 };
    const loop = () => {
      cur.x += (target.x - cur.x) * 0.06;
      cur.y += (target.y - cur.y) * 0.06;
      for (const l of layers) {
        const k = Number(l.dataset.depth);
        l.style.translate = `${(cur.x * k).toFixed(2)}px ${(cur.y * k).toFixed(2)}px`;
      }
      raf = Math.abs(target.x - cur.x) + Math.abs(target.y - cur.y) > 0.01 ? requestAnimationFrame(loop) : 0;
    };
    const move = (e: PointerEvent) => {
      target.x = (e.clientX / window.innerWidth - 0.5) * 2;
      target.y = (e.clientY / window.innerHeight - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(loop);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(raf);
      for (const l of layers) l.style.translate = "";
    };
  }, [root, reduced]);
}
