"use client";

import { useLenis } from "@/components/fx/motion";

export function BackToTop({ label }: { label: string }) {
  const lenis = useLenis();
  return (
    <button
      type="button"
      onClick={() => (lenis ? lenis.scrollTo(0, { duration: 2 }) : window.scrollTo({ top: 0, behavior: "smooth" }))}
      className="group flex items-center gap-2 text-fg"
    >
      <span className="link-draw">{label}</span>
      <span aria-hidden className="transition-transform duration-500 group-hover:-translate-y-1">↑</span>
    </button>
  );
}
