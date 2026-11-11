/**
 * Small line icons drawn on a 16 grid around its centre, so they sit exactly in the middle of a round button or
 * badge (text glyphs such as ✓ and ✕ carry the font's side bearings and baseline, and never centre cleanly).
 */
type IconProps = { className?: string; strokeWidth?: number };

function Icon({ className = "size-3", strokeWidth = 1.6, d }: IconProps & { d: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export const CrossIcon = (p: IconProps) => <Icon {...p} d="M3.5 3.5l9 9M12.5 3.5l-9 9" />;
// the tick's bounding box (3–13 × 4.5–11.5) is centred on 8,8
export const CheckIcon = (p: IconProps) => <Icon {...p} d="M3 8.2l3.2 3.3L13 4.5" />;
export const DashIcon = (p: IconProps) => <Icon {...p} d="M4 8h8" />;
export const PlusIcon = (p: IconProps) => <Icon {...p} d="M8 2.5v11M2.5 8h11" />;
// the shackle's top (y 3) and the body's foot (y 13) are centred on 8
export const LockIcon = (p: IconProps) => <Icon {...p} d="M4.5 7h7a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5ZM5.75 7V5.25a2.25 2.25 0 0 1 4.5 0V7" />;
// external links point up and away in both reading directions, like the ↗ used in text
export const ArrowUpRightIcon = (p: IconProps) => <Icon {...p} d="M4.5 11.5l7-7M6 4.5h5.5V10" />;
export const GlobeIcon = (p: IconProps) => <Icon {...p} d="M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11ZM2.5 8h11M8 2.5c-1.5 1.6-2.3 3.4-2.3 5.5s.8 3.9 2.3 5.5M8 2.5c1.5 1.6 2.3 3.4 2.3 5.5s-.8 3.9-2.3 5.5" />;
// a monitor on its stand: a generic desktop, not any vendor's logo
export const DesktopIcon = (p: IconProps) => <Icon {...p} d="M2.5 3h11v7.5h-11ZM6 13h4M8 10.5V13" />;
export const ServerIcon = (p: IconProps) => <Icon {...p} d="M3 3h10v4H3ZM3 9h10v4H3ZM5.25 5h.01M5.25 11h.01" />;
// points to the reading start's side (left); mirror it for "next" in LTR or "previous" in RTL
export const ChevronIcon = (p: IconProps) => <Icon {...p} d="M9.75 3.5L5.25 8l4.5 4.5" />;
