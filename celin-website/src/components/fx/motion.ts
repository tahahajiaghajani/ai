"use client";

/** Motion is off for the OS «reduce motion» setting and for the site's own footer toggle. */
export function motionReduced(): boolean {
  if (typeof window === "undefined") return true;
  return document.documentElement.dataset.motion === "reduced" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
