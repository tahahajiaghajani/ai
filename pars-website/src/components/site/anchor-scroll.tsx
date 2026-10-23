"use client";

import { useEffect } from "react";

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Resolves once the page has stopped scrolling for a moment (a smooth scroll ended), or after `max` ms. */
async function settled(max = 2500): Promise<void> {
  let last = window.scrollY;
  let still = 0;
  for (let t = 0; t < max && still < 3; t += 50) {
    await sleep(50);
    still = window.scrollY === last ? still + 1 : 0;
    last = window.scrollY;
  }
}

/**
 * Same-page section links (#about, #services …) and arrivals from another page land exactly under the header.
 * The home sections use content-visibility: auto, so the browser measures a jump with their 900 px placeholders
 * and the target drifts as they render on the way. Before a jump every section is rendered (html[data-cv=all]),
 * the scroll waits for a closing overlay to release its scroll lock, and the position is checked again once the
 * scroll ends and after late layout. A same-page link without a hash (the «Home» link) scrolls to the top.
 */
export function AnchorScroll() {
  useEffect(() => {
    const root = document.documentElement;
    let run = 0;
    let touched = false;

    const smooth = () => root.dataset.motion !== "reduced" && matchMedia("(prefers-reduced-motion: no-preference)").matches;
    const path = (p: string) => p.replace(/\/+$/, "") || "/";
    const targetOf = (hash: string) => (hash.length > 1 ? document.getElementById(decodeURIComponent(hash.slice(1))) : null);

    /** How far `el` (or the top of the page) is from where a jump should leave it. */
    const drift = (el: HTMLElement | null) => {
      if (!el) return window.scrollY;
      const pad = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
      const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
      return el.getBoundingClientRect().top - pad - margin;
    };
    const jump = (el: HTMLElement | null, behavior: ScrollBehavior) => (el ? el.scrollIntoView({ behavior, block: "start" }) : window.scrollTo({ top: 0, behavior }));

    const go = async (el: HTMLElement | null, animate: boolean) => {
      const mine = ++run;
      root.dataset.cv = "all";
      // the mobile menu or the chat may still hold the page's scroll lock while it closes
      for (let i = 0; i < 40 && root.style.overflow === "hidden"; i++) await frame();
      await frame();
      await frame();
      if (mine !== run) return;
      jump(el, animate && smooth() ? "smooth" : "instant");
      await settled();
      for (const wait of [0, 500]) {
        if (wait) await sleep(wait);
        if (mine !== run) return;
        const d = drift(el);
        // the last sections may be too short to reach the top: then the end of the page is right
        const atEnd = window.scrollY + window.innerHeight >= root.scrollHeight - 2;
        if (Math.abs(d) > 2 && !(d > 0 && atEnd)) jump(el, "instant");
      }
    };

    // the visitor scrolling by hand cancels any pending correction
    const stop = () => {
      touched = true;
      run++;
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || path(url.pathname) !== path(location.pathname) || url.search !== location.search) return;
      // the skip link keeps the browser's own focus handling; unknown ids are left to the browser too
      if (url.hash === "#main") return;
      const el = targetOf(url.hash);
      if (url.hash.length > 1 && !el) return;
      e.preventDefault();
      const next = url.hash.length > 1 ? url.hash : url.pathname + url.search;
      if (next !== location.hash && next !== location.pathname + location.search + location.hash) {
        history.pushState(null, "", next);
        // pushState fires no hashchange: tell the language link, which keeps the hash
        window.dispatchEvent(new Event("pars:hash"));
      }
      void go(el, true);
    };

    // location.assign("/#contact") from the chat, typed hashes, back / forward between sections
    const onHash = () => {
      const el = targetOf(location.hash);
      if (el) void go(el, true);
    };

    document.addEventListener("click", onClick);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("keydown", stop);

    // arriving with a hash (a section link on another page): correct the browser's first jump, again after load
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const first = targetOf(location.hash);
    if (first && (!nav || nav.type === "navigate")) {
      void go(first, false);
      const again = () => {
        if (!touched) void go(first, false);
      };
      if (document.readyState === "complete") void document.fonts?.ready.then(again);
      else window.addEventListener("load", again, { once: true });
    }

    return () => {
      run++;
      document.removeEventListener("click", onClick);
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
  }, []);
  return null;
}
