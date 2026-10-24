"use client";

import { useLayoutEffect, useRef, type DependencyList, type RefObject } from "react";
import { ensureScrollTrigger, gsap } from "@/components/fx/gsap";
import { useMotionReduced } from "@/components/fx/motion";

/**
 * Runs a GSAP setup scoped to `scope` (selectors resolve inside it) and reverts every tween and
 * ScrollTrigger it made on unmount or when `deps` change. Skipped entirely when motion is reduced — and the
 * preference is live: turning motion off (footer toggle, OS setting) reverts the setup at once (pins, scrubs),
 * turning it on again runs it again.
 */
export function useGsap(setup: (ctx: gsap.Context) => void | (() => void), scope: RefObject<HTMLElement | null>, deps: DependencyList = []) {
  const fn = useRef(setup);
  fn.current = setup;
  const reduced = useMotionReduced();
  useLayoutEffect(() => {
    if (!scope.current || reduced) return;
    ensureScrollTrigger();
    let cleanup: void | (() => void);
    const ctx = gsap.context((self) => {
      cleanup = fn.current(self);
    }, scope.current);
    return () => {
      if (typeof cleanup === "function") cleanup();
      ctx.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reduced]);
}

/**
 * How the scene of a pinned band (.fx-pin) plays: "pin" — its stage sticks (large screens with a mouse, «js» and
 * motion; globals.css) and the scene scrubs over the pin; "pass" — it plays as the band passes, like on a touch
 * screen (also a band the boot failsafe left static); "still" — the app arrived after the failsafe and the visitor
 * has already seen the band as it is (data-static="seen", boot-script.tsx), so it stays that way.
 */
export function sceneMode(band: HTMLElement | null): "pin" | "pass" | "still" {
  if (!band || band.dataset.static === "seen") return "still";
  const stage = band.querySelector(":scope > .fx-pin-stage");
  return stage && getComputedStyle(stage).position === "sticky" ? "pin" : "pass";
}
