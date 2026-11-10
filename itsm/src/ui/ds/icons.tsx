// Iconography (docs/DESIGN_SYSTEM.md §Icons). One set: lucide-react (1.59.0) at 16 px with a 1.4 px stroke at every
// size (absoluteStrokeWidth), coloured by text tokens (text-3 at rest, text when active) — never by the accent alone.
//
// RTL rule: only DIRECTIONAL icons follow the reading direction — arrows, chevrons, back/forward, undo/redo, send,
// reply, indent, log in/out, external link. Everything else never mirrors: clocks and history, checkmarks, search,
// media playback, charts and trends, brand marks, objects (a truck, a phone).
// This app is RTL-only and older screens pick the visual icon directly (ArrowRight for «بازگشت» in PageHeader): that
// stays correct. New code names the direction instead — <DirIcon name="back" /> — which draws the LTR-authored icon and
// mirrors it whenever its element is right-to-left (class .ds-icon-dir, tokens.css §8, by the nearest [dir]), so the same
// component is right in an LTR island too (code, a Latin document).
import type { CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpRight,
  CornerDownLeft,
  Undo2,
  Redo2,
  Reply,
  ReplyAll,
  Forward,
  SendHorizontal,
  LogIn,
  LogOut,
  IndentIncrease,
  IndentDecrease,
  PanelLeftOpen,
  PanelLeftClose,
  createLucideIcon,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

/** The DS defaults: 16 px, a 1.4 px stroke at any size, decorative unless labelled. */
export const ICON_PROPS = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

/** A Lucide icon drawn to the system's rules. `mirror` flips it in RTL (only for directional icons). */
export function Icon({ icon: I, size = 16, mirror, className, label, ...rest }: { icon: LucideIcon; size?: number; mirror?: boolean; label?: string } & Omit<LucideProps, "ref" | "size">) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return <I size={size} strokeWidth={1.4} absoluteStrokeWidth className={[mirror ? "ds-icon-dir" : null, className].filter(Boolean).join(" ") || undefined} {...a11y} {...rest} />;
}

/**
 * Logical directional icons, each authored for left-to-right reading (where «forward» points right). In RTL they are
 * mirrored by CSS, so «back» points right and «next» points left — the way Persian reads.
 */
export const DIRECTIONAL = {
  back: ArrowLeft,
  forward: ArrowRight,
  prev: ChevronLeft,
  next: ChevronRight,
  first: ChevronsLeft,
  last: ChevronsRight,
  external: ArrowUpRight,
  enter: CornerDownLeft,
  undo: Undo2,
  redo: Redo2,
  reply: Reply,
  "reply-all": ReplyAll,
  "forward-message": Forward,
  send: SendHorizontal,
  login: LogIn,
  logout: LogOut,
  indent: IndentIncrease,
  outdent: IndentDecrease,
  "panel-open": PanelLeftOpen,
  "panel-close": PanelLeftClose,
} as const satisfies Record<string, LucideIcon>;
export type DirectionalName = keyof typeof DIRECTIONAL;

/** A directional icon by meaning; it points the way the text around it reads. */
export function DirIcon({ name, size = 16, className, style, label }: { name: DirectionalName; size?: number; className?: string; style?: CSSProperties; label?: string }) {
  return <Icon icon={DIRECTIONAL[name]} size={size} mirror className={className} style={style} label={label} />;
}

/**
 * The brand's spark: the rhombic nuqta with a smaller one beside it — for AI moments that are not the «AI» chip
 * (a suggestion appearing, a prediction, «ask»). Drawn to Lucide's 24 grid and stroke rules.
 */
export const NuqtaSpark: LucideIcon = createLucideIcon("NuqtaSpark", [
  ["path", { d: "M10 4.5 15.5 10 10 15.5 4.5 10z", key: "big" }],
  ["path", { d: "M17.5 14.5 20 17l-2.5 2.5L15 17z", key: "small" }],
]);
