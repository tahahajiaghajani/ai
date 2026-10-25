"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * An endless band of words that speeds up and flips direction with the scroll's velocity.
 * Always laid out left-to-right (the band is decorative; the words are also in the page's own language).
 */
export function Marquee({ items, className = "", speed = 60, reverse = false }: { items: string[]; className?: string; speed?: number; reverse?: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // one copy's width, measured again whenever the band's size changes (resize, rotation, a late font swap)
    let half = el.scrollWidth / 2;
    const ro = new ResizeObserver(() => {
      half = el.scrollWidth / 2;
    });
    ro.observe(el);
    let x = 0;
    let dir = reverse ? 1 : -1;
    let boost = 0;
    // moves only while on screen: an off-screen band would still cost a style change every frame
    let onScreen = false;
    // the newest entry counts: several can arrive at once when the band leaves and comes back quickly
    const io = new IntersectionObserver((entries) => {
      onScreen = entries[entries.length - 1].isIntersecting;
    });
    io.observe(el);
    const tick = (_t: number, dt: number) => {
      if (!onScreen) return;
      x += ((dir * speed * (1 + boost)) / 1000) * dt;
      if (half > 0) {
        x %= half; // keeps x in (-half, 0], also when the copy has just shrunk
        if (x > 0) x -= half;
      }
      // whole device pixels on dense (phone) screens, where a fractional offset makes the text shimmer; on 1x screens
      // rounding would turn the steady 1 px a frame into stills and 2 px jumps
      const dpr = window.devicePixelRatio || 1;
      el.style.transform = `translate3d(${dpr >= 2 ? Math.round(x * dpr) / dpr : x}px,0,0)`;
      boost *= 0.92;
    };
    gsap.ticker.add(tick);
    const st = ScrollTrigger.create({
      trigger: el,
      start: "top bottom",
      end: "bottom top",
      onUpdate: (self) => {
        const v = self.getVelocity();
        boost = Math.min(6, Math.abs(v) / 300);
        dir = (v < 0 ? 1 : -1) * (reverse ? -1 : 1);
      },
    });
    return () => {
      gsap.ticker.remove(tick);
      ro.disconnect();
      io.disconnect();
      st.kill();
    };
  }, [speed, reverse]);
  const row = items.map((w, i) => (
    <span key={i} className="flex items-center gap-[0.5em] whitespace-nowrap px-[0.5em]">
      <span>{w}</span>
      <span aria-hidden className="inline-block size-[0.18em] rotate-45 bg-current opacity-60" />
    </span>
  ));
  return (
    <div className={`overflow-hidden ${className}`} dir="ltr" aria-hidden>
      <div ref={track} className="flex w-max will-change-transform">
        {row}
        {row}
      </div>
    </div>
  );
}
