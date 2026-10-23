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

/** The element a #hash points at; a malformed escape (a cut-off shared link) is looked up as written, never thrown. */
function targetOf(hash: string): HTMLElement | null {
  if (hash.length < 2) return null;
  const raw = hash.slice(1);
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {}
  return document.getElementById(id) ?? (id !== raw ? document.getElementById(raw) : null);
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
    // the jump under way and where it started, so Back during a smooth jump can return there
    let flight: { mine: number; from: number } | null = null;
    // the pre-paint script in document.tsx notes a scroll that began before this code arrived
    let touched = root.dataset.moved === "1";

    const smooth = () => root.dataset.motion !== "reduced" && matchMedia("(prefers-reduced-motion: no-preference)").matches;
    const path = (p: string) => p.replace(/\/+$/, "") || "/";

    /** How far `el` (or the top of the page) is from where a jump should leave it. */
    const drift = (el: HTMLElement | null) => {
      if (!el) return window.scrollY;
      const pad = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
      const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
      return el.getBoundingClientRect().top - pad - margin;
    };
    const jump = (el: HTMLElement | null, behavior: ScrollBehavior) => (el ? el.scrollIntoView({ behavior, block: "start" }) : window.scrollTo({ top: 0, behavior }));

    /** `check`: the browser is already scrolling there (arrival with a hash), only correct what it misses. */
    const go = async (el: HTMLElement | null, animate: boolean, check = false) => {
      const mine = ++run;
      // a later jump, a hand scroll or a navigation elsewhere (the logo link, Back) ends this one
      const live = () => mine === run && targetOf(location.hash) === el;
      flight = { mine, from: window.scrollY };
      root.dataset.cv = "all";
      // the mobile menu or the chat may still hold the page's scroll lock while it closes
      for (let i = 0; i < 40 && root.style.overflow === "hidden"; i++) await frame();
      await frame();
      await frame();
      if (!live()) return;
      if (!check) jump(el, animate && smooth() ? "smooth" : "instant");
      await settled();
      if (flight?.mine === mine) flight = null;
      for (const wait of [0, 500]) {
        if (wait) await sleep(wait);
        if (!live()) return;
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

    /** Like the browser's own fragment jump: the next Tab and a screen reader continue from the target. */
    const focus = (el: HTMLElement) => {
      // a section skipped by content-visibility can't take focus: render the sections first
      root.dataset.cv = "all";
      if (!el.hasAttribute("tabindex")) {
        el.setAttribute("tabindex", "-1");
        el.dataset.jumped = "";
        el.addEventListener(
          "blur",
          () => {
            el.removeAttribute("tabindex");
            delete el.dataset.jumped;
          },
          { once: true },
        );
      }
      el.focus({ preventScroll: true });
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
      if (el) focus(el);
      void go(el, true);
    };

    // location.assign("/#contact") from the chat, typed hashes, back / forward between sections
    const onHash = () => {
      const el = targetOf(location.hash);
      if (el) return void go(el, true);
      const back = flight && flight.mine === run ? flight.from : null;
      flight = null;
      const mine = ++run;
      if (back === null) return;
      // Back to a page without a section while a smooth jump is still running: return to where the jump began.
      // The browser's smooth scroll keeps going after one scrollTo, so hold the spot until it has ended.
      void (async () => {
        for (let i = 0, still = 0; i < 90 && still < 4 && mine === run; i++) {
          if (Math.abs(window.scrollY - back) > 2) {
            window.scrollTo({ top: back, behavior: "instant" });
            still = 0;
          } else still++;
          await frame();
        }
      })();
    };

    document.addEventListener("click", onClick);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("keydown", stop);

    // arriving with a hash (a section link on another page): html:has(:target) makes the browser's own jump right;
    // check it once it ends and again after load, unless the visitor has started scrolling
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const first = targetOf(location.hash);
    const again = () => {
      if (!touched && first) void go(first, false, true);
    };
    if (first && !touched && (!nav || nav.type === "navigate")) {
      void go(first, false, true);
      if (document.readyState === "complete") void document.fonts?.ready.then(again);
      else window.addEventListener("load", again, { once: true });
    }

    return () => {
      // a 'load' or fonts.ready still pending must not revive this instance (StrictMode mounts effects twice)
      touched = true;
      run++;
      document.removeEventListener("click", onClick);
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("load", again);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
  }, []);
  return null;
}
