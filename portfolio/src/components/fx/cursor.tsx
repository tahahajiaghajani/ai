"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";

/**
 * A difference-blended cursor: a dot that follows exactly and a ring that trails. Over links the ring grows; over
 * `data-cursor="label"` elements it becomes a disc carrying `data-cursor-label`. Fine pointers only. It sits above the
 * menu, the chat dialog and the skip link (the system cursor is hidden under them too), below the intro.
 */
export function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState("");
  const labelRef = useRef("");

  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const d = dot.current!;
    const r = ring.current!;
    document.documentElement.classList.add("has-cursor");
    gsap.set([d, r], { xPercent: -50, yPercent: -50, opacity: 0 });
    const dx = gsap.quickTo(d, "x", { duration: 0.08, ease: "power3" });
    const dy = gsap.quickTo(d, "y", { duration: 0.08, ease: "power3" });
    const rx = gsap.quickTo(r, "x", { duration: 0.5, ease: "power3" });
    const ry = gsap.quickTo(r, "y", { duration: 0.5, ease: "power3" });
    let shown = false;
    let mode = "";

    const move = (e: PointerEvent) => {
      if (!shown) {
        shown = true;
        gsap.to([d, r], { opacity: 1, duration: 0.3 });
      }
      dx(e.clientX);
      dy(e.clientY);
      rx(e.clientX);
      ry(e.clientY);
    };
    const over = (e: PointerEvent) => {
      const t = e.target as Element | null;
      const labelled = t?.closest<HTMLElement>("[data-cursor-label]");
      const link = t?.closest("a, button, [role='button'], input, textarea, select, label, [data-cursor]");
      const next = labelled ? "label" : link ? (link.matches("input, textarea, select") ? "text" : "link") : "";
      const text = labelled?.dataset.cursorLabel ?? "";
      if (next === mode && text === labelRef.current) return;
      mode = next;
      labelRef.current = text;
      setLabel(text);
      gsap.to(r, {
        width: next === "label" ? 96 : next === "link" ? 56 : next === "text" ? 4 : 34,
        height: next === "label" ? 96 : next === "link" ? 56 : next === "text" ? 28 : 34,
        borderRadius: next === "text" ? 2 : 999,
        backgroundColor: next === "label" ? "rgba(255,255,255,1)" : "rgba(255,255,255,0)",
        duration: 0.45,
        ease: "expo.out",
      });
      gsap.to(d, { scale: next ? 0 : 1, duration: 0.3 });
    };
    const leave = () => {
      shown = false;
      gsap.to([d, r], { opacity: 0, duration: 0.3 });
    };
    const down = () => gsap.to(r, { scale: 0.82, duration: 0.2 });
    const up = () => gsap.to(r, { scale: 1, duration: 0.35, ease: "back.out(3)" });

    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerover", over, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    return () => {
      document.documentElement.classList.remove("has-cursor");
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerover", over);
      document.documentElement.removeEventListener("pointerleave", leave);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[95] hidden mix-blend-difference [@media(hover:hover)_and_(pointer:fine)]:block">
      <div ref={ring} className="fixed start-0 top-0 grid size-[34px] place-items-center rounded-full border border-white text-black" style={{ left: 0, right: "auto" }}>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em]">{label}</span>
      </div>
      <div ref={dot} className="fixed top-0 size-[6px] rounded-full bg-white" style={{ left: 0, right: "auto" }} />
    </div>
  );
}
