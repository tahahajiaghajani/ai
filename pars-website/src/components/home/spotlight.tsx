"use client";

import type { ReactNode } from "react";

/** Feeds the pointer position to the hovered .spotlight card (one listener per group). */
export function SpotlightGroup({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={className}
      onPointerMove={(e) => {
        const card = (e.target as HTMLElement).closest<HTMLElement>(".spotlight");
        if (!card) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty("--x", `${e.clientX - r.left}px`);
        card.style.setProperty("--y", `${e.clientY - r.top}px`);
      }}
    >
      {children}
    </div>
  );
}
