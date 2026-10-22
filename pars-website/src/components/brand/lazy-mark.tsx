"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";

type MarkProps = { animated?: boolean; idPrefix?: string; className?: string };

/**
 * The inline, animatable mark is ~27 kB of path data: it is loaded as a separate chunk only when
 * its section approaches the viewport, inside a box of the mark's aspect ratio (no layout shift).
 */
export function LazyMark(props: MarkProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [Mark, setMark] = useState<ComponentType<MarkProps> | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        void import("@/components/brand/logo").then((m) => setMark(() => m.Mark));
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="aspect-[662/700] w-full">
      {Mark && <Mark {...props} />}
    </div>
  );
}
