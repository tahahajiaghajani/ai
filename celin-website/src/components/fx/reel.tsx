"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { gsap, ScrollTrigger } from "@/components/fx/gsap";
import { sceneMode, useGsap } from "@/components/fx/use-gsap";

const PINNED = "(min-width: 1024px) and (hover: hover) and (pointer: fine)";

/**
 * How far the pinned row moves: from the first card at the row's opening gutter to the last card at the same gutter
 * at the other end. Measured on the cards, not with scrollWidth, which leaves out the closing padding of a row that
 * is not a scroll container (overflow-visible while pinned); the row's shift moves every rect alike. `row` and `last`
 * are the row's and its last card's rects, `pad` the row's inline-end padding, `width` its clientWidth.
 */
export function reelOverflow(row: { left: number; right: number }, last: { left: number; right: number }, pad: number, width: number, rtl: boolean): number {
  const length = (rtl ? row.right - last.left : last.right - row.left) + pad;
  return Math.max(0, length - width);
}

function overflowOf(el: HTMLElement): number {
  const last = el.lastElementChild;
  if (!last) return 0;
  const cs = getComputedStyle(el);
  return reelOverflow(el.getBoundingClientRect(), last.getBoundingClientRect(), parseFloat(cs.paddingInlineEnd) || 0, el.clientWidth, cs.direction === "rtl");
}

/**
 * A row that, on large screens with a mouse, stays in view while vertical scrolling moves it sideways (in the
 * reading direction: right-to-left in Persian). The stage sticks with CSS (.fx-pin, globals.css) over --pin, the
 * row's overflow; ScrollTrigger only scrubs the row. On touch screens, small screens and with reduced motion it is
 * a plain swipeable row with snap points. `progress` gets a 0–1 scale as --p (a copper line). Keyboard focus on a
 * card scrolls the page to the point where that card is in view.
 */
export function Reel({ children, header, className = "", trackClassName = "" }: { children: ReactNode; header?: ReactNode; className?: string; trackClassName?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const trigger = useRef<ScrollTrigger | null>(null);

  useGsap(
    () => {
      const mm = gsap.matchMedia();
      mm.add(PINNED, () => {
        const host = root.current!;
        const el = track.current!;
        // a band left static by the boot failsafe (no sticky stage) stays a plain swipeable row
        if (sceneMode(host) !== "pin") return;
        const rtl = getComputedStyle(el).direction === "rtl";
        host.dataset.pinned = "";
        const dist = () => overflowOf(el);
        // the sticky distance is the row's overflow (measured before every refresh)
        const setPin = () => host.style.setProperty("--pin", `${dist()}px`);
        setPin();
        ScrollTrigger.addEventListener("refreshInit", setPin);
        const tween = gsap.to(el, {
          x: () => (rtl ? dist() : -dist()),
          ease: "none",
          scrollTrigger: {
            trigger: host,
            start: "top top",
            end: () => `+=${dist()}`,
            scrub: 0.7,
            invalidateOnRefresh: true,
            onUpdate: (st) => bar.current?.style.setProperty("--p", st.progress.toFixed(3)),
          },
        });
        trigger.current = tween.scrollTrigger ?? null;
        return () => {
          ScrollTrigger.removeEventListener("refreshInit", setPin);
          trigger.current = null;
          host.style.removeProperty("--pin");
          delete host.dataset.pinned;
        };
      });
      return () => mm.revert();
    },
    root,
    [],
  );

  // keyboard focus on a card off to the side: scroll to the point of the scene where that card is in view
  useEffect(() => {
    const host = root.current;
    const el = track.current;
    if (!host || !el) return;
    const onFocus = (e: FocusEvent) => {
      const st = trigger.current;
      if (!st || host.dataset.pinned === undefined) return;
      const card = [...el.children].find((c) => c.contains(e.target as Node)) as HTMLElement | undefined;
      if (!card) return;
      const dist = Math.max(1, overflowOf(el));
      const rtl = getComputedStyle(el).direction === "rtl";
      // the card's distance from the row's reading-direction start (the row's shift moves both rects alike)
      const r = el.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const offset = rtl ? r.right - c.right : c.left - r.left;
      // the shift that brings the card to the middle of the row
      const p = Math.min(1, Math.max(0, (offset - (el.clientWidth - c.width) / 2) / dist));
      // straight there (the scrub follows): focus must not wait for a smooth scroll
      window.scrollTo({ top: st.start + p * (st.end - st.start), behavior: "instant" });
    };
    el.addEventListener("focusin", onFocus);
    return () => el.removeEventListener("focusin", onFocus);
  }, []);

  return (
    <div ref={root} className="fx-pin group/reel relative">
      <div className={`fx-pin-stage overflow-x-clip ${className}`}>
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
    </div>
  );
}
