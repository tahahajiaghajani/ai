"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * ScrollTrigger is registered only when something needs it (useGsap, smooth scrolling) and only while motion is
 * allowed: once registered it runs a requestAnimationFrame loop for good, so reduced-motion visitors and pages
 * without scroll effects never start it, and it is disabled again when the visitor turns motion off.
 */
let state: "off" | "on" | "paused" = "off";

export function ensureScrollTrigger() {
  if (typeof window === "undefined" || state === "on") return;
  if (state === "off") {
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ ignoreMobileResize: true });
  } else ScrollTrigger.enable();
  state = "on";
}

/** Motion turned off: stop ScrollTrigger's frame loop (its triggers are already reverted by their contexts). */
export function pauseScrollTrigger() {
  if (state !== "on") return;
  ScrollTrigger.disable();
  state = "paused";
}

export const scrollTriggerOn = () => state === "on";

export { gsap, ScrollTrigger };
