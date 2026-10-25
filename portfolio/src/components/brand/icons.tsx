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
