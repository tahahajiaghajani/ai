"use client";

import { useRef, type ReactNode } from "react";
import { gsap } from "@/components/fx/gsap";
import { useGsap } from "@/components/fx/use-gsap";

/**
 * A row that, on large screens with a mouse, is pinned while vertical scrolling moves it sideways (in the
 * reading direction: right-to-left in Persian). On touch screens, small screens and with reduced motion it
 * is a plain swipeable row with snap points. `progress` gets a 0–1 scale as --p (a copper line).
 */
export function Reel({ children, header, className = "", trackClassName = "" }: { children: ReactNode; header?: ReactNode; className?: string; trackClassName?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);

  useGsap(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(min-width: 1024px) and (hover: hover) and (pointer: fine)", () => {
        const host = root.current!;
        const el = track.current!;
        const rtl = getComputedStyle(el).direction === "rtl";
        host.dataset.pinned = "";
        const dist = () => Math.max(0, el.scrollWidth - el.clientWidth);
        gsap.to(el, {
          x: () => (rtl ? dist() : -dist()),
          ease: "none",
          scrollTrigger: {
            trigger: host,
            start: "top top",
            end: () => `+=${dist()}`,
            pin: true,
            scrub: 0.7,
            invalidateOnRefresh: true,
            anticipatePin: 1,
            onUpdate: (st) => bar.current?.style.setProperty("--p", st.progress.toFixed(3)),
          },
        });
        return () => {
          delete host.dataset.pinned;
        };
      });
      return () => mm.revert();
    },
    root,
    [],
  );

  return (
    <div ref={root} className={`group/reel relative overflow-x-clip ${className}`}>
      {header}
      <div
        ref={track}
        className={`flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] group-data-pinned/reel:snap-none group-data-pinned/reel:overflow-visible [&::-webkit-scrollbar]:hidden ${trackClassName}`}
      >
        {children}
      </div>
      <div className="container-lux mt-8 hidden group-data-pinned/reel:block" aria-hidden>
        <span className="block h-px bg-current/15">
          <span ref={bar} className="fx-progress block h-px bg-gold-bright" />
        </span>
      </div>
    </div>
  );
}
