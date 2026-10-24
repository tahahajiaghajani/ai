import { afterEach, describe, expect, it, vi } from "vitest";
import { BOOT } from "@/components/site/boot-script";
import { reelOverflow } from "@/components/fx/reel";
import { sceneMode } from "@/components/fx/use-gsap";

/** Runs the inline boot script against a tiny stand-in for the browser. */
function boot(path = "/maison") {
  const classes = new Set<string>();
  const html = { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c) }, dataset: {} as Record<string, string> };
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  new Function("document", "localStorage", "sessionStorage", "location", "setTimeout", BOOT)({ documentElement: html }, store(), store(), { pathname: path }, setTimeout);
  return classes;
}

describe("boot script failsafe", () => {
  afterEach(() => vi.useRealTimers());

  it("turns the effects on before paint", () => {
    vi.useFakeTimers();
    const c = boot();
    expect(c.has("js")).toBe(true);
    expect(c.has("fx-late")).toBe(false);
  });

  it("takes them away after 3 s without the app, and records that it did", () => {
    vi.useFakeTimers();
    const c = boot();
    vi.advanceTimersByTime(2999);
    expect(c.has("js")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(c.has("js")).toBe(false);
    expect(c.has("fx-late")).toBe(true);
  });

  it("leaves them alone once the app has taken over", () => {
    vi.useFakeTimers();
    const c = boot();
    c.add("fx-ready");
    vi.advanceTimersByTime(5000);
    expect(c.has("js")).toBe(true);
    expect(c.has("fx-late")).toBe(false);
  });
});

describe("pinned reel distance", () => {
  // 1366 px row with 56 px gutters; the last card measured at the start of the scene
  it("ends the last card at the same gutter as the first one starts (left to right)", () => {
    expect(reelOverflow({ left: 0, right: 1366 }, { left: 2542, right: 2856.2 }, 56, 1366, false)).toBeCloseTo(1546.2, 1);
  });
  it("does the same right to left", () => {
    expect(reelOverflow({ left: 0, right: 1366 }, { left: -1490.2, right: -1176 }, 56, 1366, true)).toBeCloseTo(1546.2, 1);
  });
  it("is the same whatever the row's current shift (both rects move alike)", () => {
    expect(reelOverflow({ left: -700, right: 666 }, { left: 1842, right: 2156.2 }, 56, 1366, false)).toBeCloseTo(1546.2, 1);
  });
  it("is zero when every card fits", () => {
    expect(reelOverflow({ left: 0, right: 1366 }, { left: 900, right: 1200 }, 56, 1366, false)).toBe(0);
  });
});

describe("pinned scene mode", () => {
  afterEach(() => vi.unstubAllGlobals());
  const band = (position: string, seen?: string) => {
    vi.stubGlobal("getComputedStyle", () => ({ position }));
    return { dataset: seen === undefined ? {} : { static: seen }, querySelector: () => ({}) } as unknown as HTMLElement;
  };

  it("pins only where the stage really sticks", () => {
    expect(sceneMode(band("sticky"))).toBe("pin");
    expect(sceneMode(band("relative"))).toBe("pass");
  });
  it("plays as the band passes when the boot failsafe left it static below the fold", () => {
    expect(sceneMode(band("relative", ""))).toBe("pass");
  });
  it("leaves a band the visitor has already seen still as it is", () => {
    expect(sceneMode(band("relative", "seen"))).toBe("still");
    expect(sceneMode(null)).toBe("still");
  });
});
