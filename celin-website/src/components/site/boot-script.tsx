"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

/**
 * Runs before first paint: enables reveal effects, restores the visitor's motion preference, and marks every
 * page view except the first home-page view of a session «intro-seen» (no intro curtain).
 * Failsafe: «js» hides content until the app takes over (RevealObserver / this component mark «fx-ready»). If that
 * has not happened within 3 s — a script chunk failed, a very slow network — «js» is taken off again and «fx-late»
 * records it, so every html.js-gated hiding rule stops and the page reads as it does without JS (see late()).
 */
export const BOOT = `(function(){var d=document.documentElement;d.classList.add('js');setTimeout(function(){if(!d.classList.contains('fx-ready')){d.classList.remove('js');d.classList.add('fx-late')}},3000);try{if(localStorage.getItem('celin-motion')==='reduced')d.dataset.motion='reduced'}catch(e){}try{var s=sessionStorage,p=location.pathname.replace(/\\/$/,'');if(s.getItem('celin-intro')||(p!==''&&p!=='/en'))d.classList.add('intro-seen');s.setItem('celin-intro','1')}catch(e){d.classList.add('intro-seen')}})();`;

/** The first-paint entrances that «js» starts (globals.css: .fx-in, [data-fx="now"] words / curtains / pictures, drawn lines). */
const ENTRANCES = new Set(["fx-in", "fx-rise", "fx-unveil", "fx-settle", "fx-draw"]);

/**
 * Pinned bands found on a page the app reached after the failsafe stay static for this page view (data-static: no
 * sticky stage, no spacer that would lengthen the page under the visitor); "seen" marks one already on screen or
 * above it, whose scene then stays as the visitor saw it (sceneMode() in use-gsap.ts).
 */
function stillBands() {
  document.querySelectorAll<HTMLElement>(".fx-pin:not([data-static])").forEach((el) => {
    el.dataset.static = el.getBoundingClientRect().top < window.innerHeight ? "seen" : "";
  });
}

/**
 * Brings the effects back after the failsafe without hiding or replaying anything the visitor has seen: what is in
 * view or above it is marked in, «js» returns for what is still below the fold, and the first-paint entrances it
 * restarts jump straight to their end — all before the next paint.
 */
function resume(h: HTMLElement) {
  stillBands();
  document.querySelectorAll("[data-reveal]:not([data-in]), [data-fx]:not([data-in])").forEach((el) => {
    if (el.getBoundingClientRect().top < window.innerHeight) el.setAttribute("data-in", "");
  });
  h.classList.add("js");
  // getAnimations() applies the new class first, so it lists the entrances that have just started
  for (const a of document.getAnimations()) {
    if ("animationName" in a && ENTRANCES.has((a as CSSAnimation).animationName)) {
      try {
        a.finish();
      } catch {}
    }
  }
}

/**
 * The app arrived after the failsafe (a slow network): the visitor has been reading the still page for a while. The
 * bands are settled at once, before the scenes start; «js» comes back once the app's first renders are done (an
 * idle moment), so nothing they still change — a price slot's loading state, for one — flips on the way. Without
 * document.getAnimations() the page simply stays still.
 */
function late(h: HTMLElement) {
  stillBands();
  if (typeof document.getAnimations !== "function") return;
  const go = () => resume(h);
  if ("requestIdleCallback" in window) window.requestIdleCallback(go, { timeout: 1000 });
  else setTimeout(go, 400);
}

const never = () => () => {};

/**
 * The inline boot script. In server HTML it runs as the page is parsed. But some pages are rendered by React
 * in the browser (Next's recovery shell after notFound() on a dynamic route, for one): a <script> React
 * creates never runs (and React warns about it), so then the same code is added once as a real script
 * element, before paint. While hydrating, the server's script element is kept as it is.
 */
export function BootScript() {
  const fromServer = useSyncExternalStore(never, () => false, () => true);
  useLayoutEffect(() => {
    const h = document.documentElement;
    // the app is running: the boot failsafe must not take the effects away
    h.classList.add("fx-ready");
    if (h.classList.contains("js")) return;
    // the boot script ran, but the failsafe has fired: bring the effects back without replaying anything
    if (h.classList.contains("fx-late")) return late(h);
    const s = document.createElement("script");
    s.textContent = BOOT;
    document.head.appendChild(s);
  }, []);
  return fromServer ? <script dangerouslySetInnerHTML={{ __html: BOOT }} /> : null;
}
