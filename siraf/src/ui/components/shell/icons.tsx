// Shell icons: Lucide at 16 px with a 1.4 px stroke (components.md §0.5), and the custom cheque slip
// from the brand package's sprite (same 24 grid and stroke).
import { createLucideIcon, type LucideIcon, type LucideProps } from "lucide-react";

/** The cheque slip: a rounded slip, two text lines, an amount box and a signature squiggle. */
export const ChequeIcon: LucideIcon = createLucideIcon("Cheque", [
  ["rect", { x: "2", y: "5.5", width: "20", height: "13", rx: "2", key: "slip" }],
  ["path", { d: "M6 10h6", key: "l1" }],
  ["path", { d: "M15.5 10h2.5", key: "amt" }],
  ["path", { d: "M6 14.5h3", key: "l2" }],
  ["path", { d: "M13.5 14.5c.8-.9 1.6.9 2.4 0s1.6-.9 2.6 0", key: "sig" }],
]);

/**
 * The AI mark: «AI» in a rounded chip on the 24 grid, for the assistant and every AI feature (it replaces Lucide's
 * sparkles, which read as decoration). Same stroke rules as the Lucide set, so it sits in buttons, menus and badges.
 */
export const AiIcon: LucideIcon = createLucideIcon("SirafAi", [
  ["rect", { x: "2", y: "4", width: "20", height: "16", rx: "4", key: "chip" }],
  ["path", { d: "M6.8 16 9.6 8l2.8 8", key: "a" }],
  ["path", { d: "M7.8 13.2h3.6", key: "bar" }],
  ["path", { d: "M17 8v8", key: "i" }],
]);

/** A Lucide icon drawn to the shell's rules: 16 px, 1.4 px stroke at any size. */
export function Ic({ icon: I, size = 16, ...rest }: { icon: LucideIcon; size?: number } & Omit<LucideProps, "ref">) {
  return <I size={size} strokeWidth={1.4} absoluteStrokeWidth aria-hidden {...rest} />;
}

/** A kbd group: a bare LTR isolate (no margin of its own); wrap it in `.sf-end` to push it to the end. */
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
