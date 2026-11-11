"use client";

import Image from "next/image";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import type { Lang } from "@/lib/i18n";
import { num } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { ChevronIcon, CrossIcon } from "@/components/brand/icons";
import { prefersReducedMotion, useLenis } from "@/components/fx/motion";

export interface LightboxImage {
  src: string;
  w: number;
  h: number;
  alt: string;
  caption?: string;
}

const Ctx = createContext<(index: number, from: HTMLElement) => void>(() => {});

/**
 * A full-screen viewer for a post's pictures, in colour and whole (the page shows them cropped and grey until
 * hovered). Opens from any `LightboxTrigger`; pages with the arrow keys in the reading direction, by swiping, or with
 * its buttons; Escape or the close button hands focus back to the picture that opened it.
 */
export function LightboxProvider({ images, lang, children }: { images: LightboxImage[]; lang: Lang; children: React.ReactNode }) {
  const lenis = useLenis();
  const [index, setIndex] = useState<number | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  // pinch-zoomed in: drags pan the picture (the browser's), so they never page
  const [zoomed, setZoomed] = useState(false);
  const open = index !== null;
  const n = images.length;
  const fa = lang === "fa";

  const show = useCallback((i: number, from: HTMLElement) => {
    opener.current = from;
    setIndex(i);
  }, []);
  const close = useCallback(() => setIndex(null), []);
  const step = useCallback((d: number) => setIndex((i) => (i === null ? i : (i + d + n) % n)), [n]);

  // lock the page while open, animate the curtain, and keep keyboard focus inside the viewer
  useEffect(() => {
    const el = dialog.current;
    if (!open || !el) return;
    lenis?.stop();
    document.documentElement.style.overflow = "hidden";
    if (!prefersReducedMotion()) gsap.fromTo(el, { clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0% 0 0 0)", duration: 0.8, ease: "expo.inOut" });
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close();
      // the next picture lies in the reading direction: left in Persian, right in English
      if (e.key === "ArrowLeft") return step(fa ? 1 : -1);
      if (e.key === "ArrowRight") return step(fa ? -1 : 1);
      if (e.key !== "Tab") return;
      const items = el.querySelectorAll<HTMLElement>("button");
      const first = items[0];
      const last = items[items.length - 1];
      if (!el.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = "";
      lenis?.start();
      opener.current?.focus({ preventScroll: true });
    };
  }, [open, lenis, close, step, fa]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!open || !vv) return;
    const on = () => setZoomed(vv.scale > 1.01);
    on();
    vv.addEventListener("resize", on);
    return () => vv.removeEventListener("resize", on);
  }, [open]);

  // each new picture settles in softly
  useEffect(() => {
    if (index === null || !frame.current || prefersReducedMotion()) return;
    gsap.fromTo(frame.current, { opacity: 0, scale: 0.985 }, { opacity: 1, scale: 1, duration: 0.7, ease: "expo.out" });
  }, [index]);

  const cur = index === null ? null : images[index];
  const pad = (i: number) => num(lang, String(i).padStart(2, "0"));

  return (
    <Ctx.Provider value={show}>
      {children}
      {cur ? (
        <div
          ref={dialog}
          role="dialog"
          aria-modal="true"
          aria-label={ui.blog.photos[lang]}
          // pan-y: a sideways finger drag stays ours (with the default the browser takes it as a pan and cancels the
          // pointer, so a swipe never arrives); vertical drags and pinch-zoom remain the browser's. Zoomed in, every drag
          // is the browser's again, so the visitor can look across the picture
          className={`fixed inset-0 z-[85] flex flex-col bg-bg text-fg ${zoomed ? "touch-manipulation" : "touch-pan-y touch-pinch-zoom"}`}
          data-lenis-prevent
          onPointerDown={(e) => (swipe.current = e.isPrimary && !zoomed ? { x: e.clientX, y: e.clientY } : null)}
          onPointerCancel={() => (swipe.current = null)}
          onPointerUp={(e) => {
            const s = swipe.current;
            swipe.current = null;
            if (!s) return;
            const dx = e.clientX - s.x;
            if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(e.clientY - s.y)) return;
            // a swipe towards the reading start brings the next picture
            step((dx < 0) !== fa ? 1 : -1);
          }}
        >
          <div className="flex h-20 shrink-0 items-center justify-between px-5 md:px-10">
            {/* each new picture is announced whole: its place and what it shows */}
            <p className="font-mono text-[0.7rem] tracking-[0.2em] text-muted" aria-live="polite" aria-atomic="true">
              <span className="text-fg">{pad(index! + 1)}</span> / {pad(n)}
              <span className="sr-only">: {cur.alt}</span>
            </p>
            <button ref={closeBtn} type="button" onClick={close} className="grid size-11 place-items-center rounded-full border border-line-strong transition-colors hover:bg-fg hover:text-bg" aria-label={ui.blog.close[lang]}>
              <CrossIcon className="size-4" strokeWidth={1.3} />
            </button>
          </div>
          <div ref={frame} className="relative mx-5 min-h-0 flex-1 md:mx-24">
            <Image key={cur.src} src={cur.src} alt={cur.alt} fill sizes="100vw" quality={90} loading="eager" className="select-none object-contain" draggable={false} />
          </div>
          <div className="flex shrink-0 items-center justify-between gap-6 px-5 py-5 md:px-10 md:py-6">
            <p aria-hidden={cur.caption ? undefined : true} className={`min-w-0 text-fg-2 ${fa ? "text-[0.9rem]" : "text-[0.85rem]"}`}>{cur.caption ?? cur.alt}</p>
            {n > 1 ? (
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => step(-1)} className="grid size-11 place-items-center rounded-full border border-line-strong transition-colors hover:bg-fg hover:text-bg" aria-label={ui.blog.prev[lang]}>
                  {/* "previous" points back against the reading direction: right in Persian, left in English */}
                  <ChevronIcon className="size-4 rtl:-scale-x-100" />
                </button>
                <button type="button" onClick={() => step(1)} className="grid size-11 place-items-center rounded-full border border-line-strong transition-colors hover:bg-fg hover:text-bg" aria-label={ui.blog.next[lang]}>
                  <ChevronIcon className="size-4 ltr:-scale-x-100" />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </Ctx.Provider>
  );
}

/** A picture that opens the viewer at its place in the post; `label` names it for screen readers, `cue` is the cursor's word. */
export function LightboxTrigger({ index, label, cue, className = "", children }: { index: number; label: string; cue: string; className?: string; children: React.ReactNode }) {
  const show = useContext(Ctx);
  return (
    <button type="button" onClick={(e) => show(index, e.currentTarget)} aria-haspopup="dialog" aria-label={label} data-cursor-label={cue} className={`group block w-full cursor-zoom-in text-start ${className}`}>
      {children}
    </button>
  );
}
