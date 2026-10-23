"use client";

import { useRef } from "react";
import { gsap } from "@/components/fx/gsap";
import { useGsap } from "@/components/fx/use-gsap";

/**
 * A metal hairline that fills along its track as the reader moves through the section around it (vertical
 * by default). Without JS or with reduced motion it is simply drawn in full.
 */
export function ScrollLine({ tone = "copper", axis = "y", className = "", start = "top 70%", end = "bottom 70%" }: { tone?: "copper" | "champagne"; axis?: "x" | "y"; className?: string; start?: string; end?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useGsap(
    () => {
      const el = ref.current!;
      const host = el.parentElement?.parentElement ?? el;
      gsap.fromTo(el, { [axis === "y" ? "scaleY" : "scaleX"]: 0 }, { [axis === "y" ? "scaleY" : "scaleX"]: 1, ease: "none", scrollTrigger: { trigger: host, start, end, scrub: 0.5 } });
    },
    ref,
    [axis, start, end],
  );
  const metal = tone === "champagne" ? "bg-[image:var(--metal-champagne)]" : "bg-[image:var(--metal-copper)]";
  return (
    <span aria-hidden className={`pointer-events-none absolute ${axis === "y" ? "inset-y-0 w-px" : "inset-x-0 h-px"} ${className}`}>
      <span className={`absolute inset-0 ${tone === "champagne" ? "bg-on-night/12" : "bg-gold/15"}`} />
      <span ref={ref} className={`absolute inset-0 ${metal} ${axis === "y" ? "origin-top" : "ltr:origin-left rtl:origin-right"}`} />
    </span>
  );
}
