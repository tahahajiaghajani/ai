// Code-split components without React's reveal throttle (docs/qa/PERFORMANCE_E2E_FA.md §2-6).
//
// React 19 holds back what a Suspense boundary reveals until 300 ms after the last fallback it showed: content that
// arrives sooner waits. A full page load passes nested lazy layers — the signed-in app (App → OrgArea), the module's
// page, its own sub-page (the portal's shell → home) — and each one added up to 300 ms: on the installed server the
// portal's last request started at 1,065 ms after the navigation, 578 ms with the throttle gone. `lazy` below loads a
// component's code the same way (on first render, once) but never suspends: until the code is there it shows the
// fallback of the `Suspense` around it (this module's, which also hands its fallback down), then a plain update renders
// the component. A failed load is thrown while rendering, to the nearest error boundary, as React.lazy does. The load's
// state is read with useSyncExternalStore: code that arrives between the render that showed the fallback and the
// moment the component listens (React subscribes in a passive effect, a task after the commit) is still seen — React
// compares the state again when it subscribes — instead of the fallback staying on screen.
// Use these two instead of React's `lazy` and `Suspense` in the UI (tests/perf-guards.test.ts checks).
import { Suspense as ReactSuspense, createContext, createElement, useContext, useSyncExternalStore, type ComponentProps, type ComponentType, type ReactNode, type SuspenseProps } from "react";

const Fallback = createContext<ReactNode>(null);

/** React's Suspense; the lazy components inside show its fallback while their code loads. */
export function Suspense({ fallback = null, children, ...rest }: SuspenseProps) {
  return createElement(ReactSuspense, { fallback, ...rest }, createElement(Fallback.Provider, { value: fallback }, children));
}

/** A component loaded on first use (or `preload()`), without suspending (see above). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazy<T extends ComponentType<any>>(load: () => Promise<{ default: T }>): T & { preload(): Promise<void> } {
  // what a render shows: nothing yet (the fallback), the component, or the failure — like React.lazy's, a load that
  // failed stays failed (until the page is loaded again)
  let state: { component: T } | { error: unknown } | null = null;
  let pending: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const settle = (next: NonNullable<typeof state>) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const preload = (): Promise<void> =>
    (pending ??= load().then(
      (m) => settle({ component: m.default }),
      (error: unknown) => settle({ error }),
    ));
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const snapshot = () => state;
  function Lazy(props: ComponentProps<T>) {
    const fallback = useContext(Fallback);
    const now = useSyncExternalStore(subscribe, snapshot, snapshot);
    if (!now) {
      // the code starts loading while rendering, as React.lazy does (once)
      void preload();
      return fallback;
    }
    if ("error" in now) throw now.error;
    return createElement(now.component, props);
  }
  return Object.assign(Lazy, { preload }) as unknown as T & { preload(): Promise<void> };
}
