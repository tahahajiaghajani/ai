// Shell icons: Lucide at 16 px with a 1.4 px stroke (components.md §0.5), and the AI mark drawn to the same 24 grid.
import { createLucideIcon, type LucideIcon, type LucideProps } from "lucide-react";

/**
 * The AI mark: «AI» in a rounded chip on the 24 grid, for the assistant and every AI feature (it replaces Lucide's
 * sparkles, which read as decoration). Same stroke rules as the Lucide set, so it sits in buttons, menus and badges.
 */
export const AiIcon: LucideIcon = createLucideIcon("BrandAi", [
  ["rect", { x: "2", y: "4", width: "20", height: "16", rx: "4", key: "chip" }],
  ["path", { d: "M6.8 16 9.6 8l2.8 8", key: "a" }],
  ["path", { d: "M7.8 13.2h3.6", key: "bar" }],
  ["path", { d: "M17 8v8", key: "i" }],
]);

/** A Lucide icon drawn to the shell's rules: 16 px, 1.4 px stroke at any size. */
export function Ic({ icon: I, size = 16, ...rest }: { icon: LucideIcon; size?: number } & Omit<LucideProps, "ref">) {
  return <I size={size} strokeWidth={1.4} absoluteStrokeWidth aria-hidden {...rest} />;
}

/** A kbd group: a bare LTR isolate (no margin of its own); wrap it in `.ds-end` to push it to the end. */
export function Keys({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <bdi dir="ltr" className={`sh-keys ${className ?? ""}`}>
      {keys.map((k) => (
        <kbd key={k} className="sh-kbd">
          {k}
        </kbd>
      ))}
    </bdi>
  );
}
