import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

/**
 * The jewel-box frame: a 1px metal rule (copper on light grounds, champagne on dark), a second hairline
 * inside it, a small rhombus at each inner corner and, optionally, a keystone on the top edge. The panel's
 * own ground (glass, porcelain, espresso…) comes from the caller's classes.
 */
export function LuxFrame({
  tone = "light",
  keystone = false,
  className = "",
  style,
  children,
  ...rest
}: { tone?: "light" | "dark"; keystone?: boolean; className?: string; style?: CSSProperties; children: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, "className" | "style" | "children">) {
  return (
    <div data-frame={tone} className={`lux-frame ${className}`} style={style} {...rest}>
      <span aria-hidden className="lux-frame-orn" />
      {keystone && <span aria-hidden className="lux-frame-key" />}
      {children}
    </div>
  );
}
