"use client";

import { useLayoutEffect, useRef, type DependencyList, type RefObject } from "react";
import { gsap } from "@/components/fx/gsap";
import { motionReduced } from "@/components/fx/motion";

/**
 * Runs a GSAP setup scoped to `scope` (selectors resolve inside it) and reverts every tween and
 * ScrollTrigger it made on unmount or when `deps` change. Skipped entirely when motion is reduced.
 */
export function useGsap(setup: (ctx: gsap.Context) => void | (() => void), scope: RefObject<HTMLElement | null>, deps: DependencyList = []) {
  const fn = useRef(setup);
  fn.current = setup;
  useLayoutEffect(() => {
    if (!scope.current || motionReduced()) return;
    let cleanup: void | (() => void);
    const ctx = gsap.context((self) => {
      cleanup = fn.current(self);
    }, scope.current);
    return () => {
      if (typeof cleanup === "function") cleanup();
      ctx.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
