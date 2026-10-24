"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

/**
 * Runs before first paint: enables reveal effects, restores the visitor's motion preference, and marks every
 * page view except the first home-page view of a session «intro-seen» (no intro curtain).
 * Failsafe: «js» hides content until the app takes over (RevealObserver / this component mark «fx-ready»). If that
 * has not happened within 3 s — a script chunk failed, a very slow network — «js» is taken off again, so every
 * html.js-gated hiding rule stops and the page reads as it does without JS.
 */
const BOOT = `(function(){var d=document.documentElement;d.classList.add('js');setTimeout(function(){if(!d.classList.contains('fx-ready'))d.classList.remove('js')},3000);try{if(localStorage.getItem('celin-motion')==='reduced')d.dataset.motion='reduced'}catch(e){}try{var s=sessionStorage,p=location.pathname.replace(/\\/$/,'');if(s.getItem('celin-intro')||(p!==''&&p!=='/en'))d.classList.add('intro-seen');s.setItem('celin-intro','1')}catch(e){d.classList.add('intro-seen')}})();`;

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
    // the app is running: the boot failsafe must not take the effects away
    document.documentElement.classList.add("fx-ready");
    if (document.documentElement.classList.contains("js")) return;
    const s = document.createElement("script");
    s.textContent = BOOT;
    document.head.appendChild(s);
  }, []);
  return fromServer ? <script dangerouslySetInnerHTML={{ __html: BOOT }} /> : null;
}
