"use client";

/**
 * Inverts the whole page. Where the View Transitions API exists the new colours grow out of the button as a circle;
 * elsewhere the colours cross-fade. The choice is remembered (read before the first paint by the boot script).
 */
export function ThemeToggle({ label }: { label: string }) {
  const flip = (e: React.MouseEvent<HTMLButtonElement>) => {
    const d = document.documentElement;
    const next = d.dataset.theme === "light" ? "dark" : "light";
    const apply = () => {
      if (next === "light") d.dataset.theme = "light";
      else delete d.dataset.theme;
      try {
        localStorage.setItem("theme", next);
      } catch {}
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "light" ? "#f3f3ef" : "#050505");
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const vt = (document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }).startViewTransition;
    if (!vt || reduce) return apply();
    const r = e.currentTarget.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const t = vt.call(document, apply);
    t.ready.then(() => {
      d.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 900, easing: "cubic-bezier(0.65, 0, 0.35, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    });
  };
  return (
    <button type="button" onClick={flip} aria-label={label} title={label} className="group grid size-10 place-items-center rounded-full border border-white/30">
      <span aria-hidden className="relative block size-4 overflow-hidden rounded-full border border-current">
        <span className="absolute inset-y-0 end-0 w-1/2 bg-current transition-transform duration-700 ease-[var(--ease-out-expo)] group-hover:-translate-x-full rtl:group-hover:translate-x-full" />
      </span>
    </button>
  );
}
