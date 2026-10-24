"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const SELECTOR = "[data-reveal]:not([data-in]), [data-fx]:not([data-in])";

/**
 * ArchLines (.fx-draw) use a non-scaling stroke, whose dash the browser measures in screen pixels: --fx-s (screen px
 * per viewBox unit, preserveAspectRatio "meet") lets one dash span the whole arch at the size it is drawn
 * (globals.css). Measured when the drawing starts.
 */
function measureDraw(el: Element) {
  if (!(el instanceof SVGSVGElement) || !el.classList.contains("fx-draw")) return;
  const vb = el.viewBox.baseVal;
  if (!vb || !vb.width || !vb.height) return;
  const s = Math.min(el.clientWidth / vb.width, el.clientHeight / vb.height);
  if (s > 0) el.style.setProperty("--fx-s", s.toFixed(3));
}

/**
 * Adds data-in to [data-reveal] / [data-fx] elements as they enter the viewport (once); data-fx="now"
 * plays on the next frame (heroes). Also watches for elements rendered later. Content is visible without JS.
 * The slow metal sheens (.metal-live) run only while on screen: data-live is set while they intersect.
 */
export function RevealObserver() {
  const path = usePathname();
  useEffect(() => {
    // the app has taken over: the boot script's failsafe keeps html.js (see boot-script.tsx)
    document.documentElement.classList.add("fx-ready");
    const show = (el: Element) => {
      measureDraw(el);
      el.setAttribute("data-in", "");
    };
    if (!("IntersectionObserver" in window)) {
      document.querySelectorAll(SELECTOR).forEach(show);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            show(en.target);
            io.unobserve(en.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    const live = new IntersectionObserver((entries) => {
      for (const en of entries) en.target.toggleAttribute("data-live", en.isIntersecting);
    });
    const watch = (root: ParentNode) => {
      root.querySelectorAll(".metal-live").forEach((el) => live.observe(el));
      if (root instanceof Element && root.matches(".metal-live")) live.observe(root);
      root.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
        if (el.dataset.fx === "now") {
          // heroes already play from the first paint (CSS): measure now, mark them in on the next frames
          measureDraw(el);
          requestAnimationFrame(() => requestAnimationFrame(() => show(el)));
        } else io.observe(el);
      });
    };
    watch(document);
    const mo = new MutationObserver((records) => {
      for (const r of records) r.addedNodes.forEach((n) => n instanceof HTMLElement && (n.matches(SELECTOR) ? watch(n.parentElement ?? document) : watch(n)));
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      live.disconnect();
      mo.disconnect();
    };
  }, [path]);
  return null;
}
