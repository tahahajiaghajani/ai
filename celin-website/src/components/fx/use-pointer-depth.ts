"use client";

import { useEffect, type RefObject } from "react";
import { finePointer, useMotionReduced } from "@/components/fx/motion";

/**
 * Dispatched (bubbling) from inside the root when layers were added or their data-depth changed while the pointer
 * rests — the turning home arcade does it as its arches glide: the lean follows at once.
 */
export const DEPTH_EVENT = "celin:depth";

/**
 * Pointer depth for a hero: every `[data-depth]` element inside `root` leans towards the pointer by its
 * data-depth (px at the screen edge; negative leans away). Mouse/trackpad only; nothing with reduced motion
 * (live: turning motion off puts the layers back at once). The layers are looked up again whenever the lean
 * starts moving, so layers rendered later lean too.
 */
export function usePointerDepth(root: RefObject<HTMLElement | null>) {
  const reduced = useMotionReduced();
  useEffect(() => {
    const el = root.current;
    if (!el || !finePointer() || reduced) return;
    let layers: HTMLElement[] = [];
    const touched = new Set<HTMLElement>();
    let raf = 0;
    const target = { x: 0, y: 0 };
    const cur = { x: 0, y: 0 };
    const loop = () => {
      cur.x += (target.x - cur.x) * 0.06;
      cur.y += (target.y - cur.y) * 0.06;
      for (const l of layers) {
        const k = Number(l.dataset.depth);
        l.style.translate = `${(cur.x * k).toFixed(2)}px ${(cur.y * k).toFixed(2)}px`;
        touched.add(l);
      }
      raf = Math.abs(target.x - cur.x) + Math.abs(target.y - cur.y) > 0.01 ? requestAnimationFrame(loop) : 0;
    };
    const start = () => {
      if (raf) return;
      layers = [...el.querySelectorAll<HTMLElement>("[data-depth]")];
      raf = requestAnimationFrame(loop);
    };
    const move = (e: PointerEvent) => {
      target.x = (e.clientX / window.innerWidth - 0.5) * 2;
      target.y = (e.clientY / window.innerHeight - 0.5) * 2;
      start();
    };
    window.addEventListener("pointermove", move, { passive: true });
    el.addEventListener(DEPTH_EVENT, start);
    return () => {
      window.removeEventListener("pointermove", move);
      el.removeEventListener(DEPTH_EVENT, start);
      cancelAnimationFrame(raf);
      for (const l of touched) l.style.translate = "";
    };
  }, [root, reduced]);
}
