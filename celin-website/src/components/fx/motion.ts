"use client";

import { useSyncExternalStore } from "react";

const REDUCE = "(prefers-reduced-motion: reduce)";

/** Motion is off for the OS «reduce motion» setting and for the site's own footer toggle. */
export function motionReduced(): boolean {
  if (typeof window === "undefined") return true;
  return document.documentElement.dataset.motion === "reduced" || window.matchMedia(REDUCE).matches;
}

/** Calls `cb` whenever the footer toggle (html[data-motion]) or the OS setting changes. */
export function onMotionChange(cb: () => void): () => void {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
  const mq = window.matchMedia(REDUCE);
  mq.addEventListener("change", cb);
  return () => {
    mo.disconnect();
    mq.removeEventListener("change", cb);
  };
}

/**
 * The live motion preference: re-renders when the footer toggle or the OS setting changes, so effects that list
 * it in their dependencies stop (cleanup) and start again without a reload. `true` on the server and while
 * hydrating: effects start only once the browser has said motion is allowed.
 */
export function useMotionReduced(): boolean {
  return useSyncExternalStore(onMotionChange, motionReduced, () => true);
}

/** A mouse or trackpad (no custom cursor, magnetism or smooth wheel on touch screens). */
export function finePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

/** Fired by <Overlay> so smooth scrolling pauses while a dialog is open. */
export const OVERLAY_EVENT = "celin:overlay";
export function overlayChanged(open: boolean) {
  window.dispatchEvent(new CustomEvent(OVERLAY_EVENT, { detail: { open } }));
}
