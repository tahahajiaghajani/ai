"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { finePointer, motionReduced } from "@/components/fx/motion";

/**
 * A copper glint that trails the pointer; over pictures marked data-cursor="view" it opens into a disc with
 * a word («مشاهده»), over links and buttons into a soft ring. The system cursor stays (it is hidden only
 * over data-cursor="view" areas). Fine pointers only; nothing with reduced motion.
 */
export function Cursor({ label }: { label: string }) {
  const ring = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const path = usePathname();

  useEffect(() => {
    const r = ring.current;
    const d = dot.current;
    if (!r || !d || !finePointer() || motionReduced()) return;
    r.hidden = false;
    d.hidden = false;
    const pos = { x: -100, y: -100, rx: -100, ry: -100 };
    let raf = 0;
    let shown = false;
    const loop = () => {
      pos.rx += (pos.x - pos.rx) * 0.16;
      pos.ry += (pos.y - pos.ry) * 0.16;
      r.style.transform = `translate3d(${pos.rx}px, ${pos.ry}px, 0)`;
      d.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
      raf = Math.abs(pos.x - pos.rx) + Math.abs(pos.y - pos.ry) > 0.1 ? requestAnimationFrame(loop) : 0;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      pos.x = e.clientX;
      pos.y = e.clientY;
      if (!shown) {
        shown = true;
        pos.rx = pos.x;
        pos.ry = pos.y;
      }
      const t = e.target as Element | null;
      const zone = t?.closest?.("[data-cursor]") as HTMLElement | null;
      const field = t?.closest?.("input, textarea, select, [contenteditable]");
      const link = t?.closest?.("a, button, [role=button], label, summary");
      const mode = field ? "hidden" : zone?.dataset.cursor === "view" ? "view" : link ? "link" : "";
      if (r.dataset.mode !== mode) r.dataset.mode = mode;
      if (d.dataset.mode !== mode) d.dataset.mode = mode;
      if (text.current) text.current.textContent = zone?.dataset.cursorLabel || label;
      const tone = t?.closest?.("[data-tone]")?.getAttribute("data-tone") ?? "";
      if (r.dataset.tone !== tone) r.dataset.tone = tone;
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const leave = () => {
      r.dataset.mode = "hidden";
      d.dataset.mode = "hidden";
      shown = false;
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, [label]);

  // a new page: back to the plain glint
  useEffect(() => {
    if (ring.current) ring.current.dataset.mode = "";
  }, [path]);

  return (
    <>
      <div ref={ring} className="fx-cursor" hidden aria-hidden>
        <div className="fx-cursor-ring">
          <span ref={text}>{label}</span>
        </div>
      </div>
      <div ref={dot} className="fx-cursor-dot" hidden aria-hidden />
    </>
  );
}
