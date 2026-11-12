// Code-split components without React's reveal throttle (docs/qa/PERFORMANCE_E2E_FA.md §2-6).
//
// React 19 holds back what a Suspense boundary reveals until 300 ms after the last fallback it showed: content that
// arrives sooner waits. A full page load passes nested lazy layers — the signed-in app (App → OrgArea), the module's
// page, its own sub-page (the portal's shell → home) — and each one added up to 300 ms: on the installed server the
// portal's last request started at 1,065 ms after the navigation, 578 ms with the throttle gone. `lazy` below loads a
// component's code the same way (on first render, once) but never suspends: until the code is there it shows the
// fallback of the `Suspense` around it (this module's, which also hands its fallback down), then a plain update renders
// the component. A failed load is thrown while rendering, to the nearest error boundary, as React.lazy does.
// Use these two instead of React's `lazy` and `Suspense` in the UI (tests/perf-guards.test.ts checks).
import { Suspense as ReactSuspense, createContext, createElement, useContext, useEffect, useState, type ComponentProps, type ComponentType, type ReactNode, type SuspenseProps } from "react";

const Fallback = createContext<ReactNode>(null);

/** React's Suspense; the lazy components inside show its fallback while their code loads. */
export function Suspense({ fallback = null, children, ...rest }: SuspenseProps) {
  return createElement(ReactSuspense, { fallback, ...rest }, createElement(Fallback.Provider, { value: fallback }, children));
}

/** A component loaded on first use (or `preload()`), without suspending (see above). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazy<T extends ComponentType<any>>(load: () => Promise<{ default: T }>): T & { preload(): Promise<void> } {
  let loaded: T | null = null;
  // like React.lazy, a load that failed stays failed (until the page is loaded again)
  let failed: { error: unknown } | null = null;
  let pending: Promise<void> | null = null;
  const preload = (): Promise<void> =>
    (pending ??= load().then(
      (m) => {
        loaded = m.default;
      },
      (error: unknown) => {
        failed = { error };
      },
    ));
  function Lazy(props: ComponentProps<T>) {
    const fallback = useContext(Fallback);
    const [, rerender] = useState(0);
    // the code starts loading while rendering, as React.lazy does (idempotent)
    if (!loaded && !failed) void preload();
    useEffect(() => {
      if (loaded || failed) return;
      let live = true;
      void preload().then(() => {
        if (live) rerender((n) => n + 1);
      });
      return () => {
        live = false;
      };
    }, []);
    if (loaded) return createElement(loaded, props);
    if (failed) throw failed.error;
    return fallback;
  }
  return Object.assign(Lazy, { preload }) as unknown as T & { preload(): Promise<void> };
}
