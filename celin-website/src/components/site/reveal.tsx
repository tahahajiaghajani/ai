"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const SELECTOR = "[data-reveal]:not([data-in]), [data-fx]:not([data-in])";

/**
 * Adds data-in to [data-reveal] / [data-fx] elements as they enter the viewport (once); data-fx="now"
 * plays on the next frame (heroes). Also watches for elements rendered later. Content is visible without JS.
 */
export function RevealObserver() {
  const path = usePathname();
  useEffect(() => {
    const show = (el: Element) => el.setAttribute("data-in", "");
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
    const watch = (root: ParentNode) => {
      root.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
        if (el.dataset.fx === "now") requestAnimationFrame(() => requestAnimationFrame(() => show(el)));
        else io.observe(el);
      });
    };
    watch(document);
    const mo = new MutationObserver((records) => {
      for (const r of records) r.addedNodes.forEach((n) => n instanceof HTMLElement && (n.matches(SELECTOR) ? watch(n.parentElement ?? document) : watch(n)));
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [path]);
  return null;
}
