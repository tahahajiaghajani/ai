// Empty-state illustrations (docs/DESIGN_SYSTEM.md §Illustration): quiet line drawings on the brand's motifs — the
// kariz arch, the horizon, turquoise water and the saffron nuqta. Colours come only from --ds-illus-* tokens, so they
// follow the theme; strokes are round-ended like the icons. 160 × 120, drawn to read at 120–200 px.
// Use them for page-level and first-run states (nothing yet, nothing found, all done, offline, no access, an error,
// welcome) — never inside dense data views, where EmptyState keeps its icon tile.
import type { ReactNode } from "react";

export type IllustrationName = "empty" | "search" | "done" | "offline" | "locked" | "error" | "welcome";

/** Persian copy to pair with each drawing (a title and one helpful sentence; the page can override both). */
export const ILLUSTRATIONS: Record<IllustrationName, { title: string; hint: string }> = {
  empty: { title: "هنوز موردی ثبت نشده است", hint: "نخستین مورد را بسازید؛ از این پس همین‌جا دیده می‌شود." },
  search: { title: "نتیجه‌ای پیدا نشد", hint: "واژهٔ دیگری را امتحان کنید یا پالایه‌ها را کمتر کنید." },
  done: { title: "همه‌چیز رسیدگی شده است", hint: "کاری در صف شما نمانده؛ موارد تازه همین‌جا می‌آیند." },
  offline: { title: "اتصال برقرار نیست", hint: "کار شما روی همین دستگاه نگه داشته می‌شود و پس از اتصال هم‌گام می‌شود." },
  locked: { title: "به این بخش دسترسی ندارید", hint: "اگر به آن نیاز دارید، از مدیر سازمان بخواهید دسترسی بدهد." },
  error: { title: "مشکلی پیش آمد", hint: "دوباره تلاش کنید؛ اگر تکرار شد، به پشتیبانی خبر دهید." },
  welcome: { title: "به کاریز خوش آمدید", hint: "چند گام کوتاه، و سامانهٔ خدمات سازمان شما آماده است." },
};

const INK = "var(--ds-illus-ink)";
const LINE = "var(--ds-illus-line)";
const SOFT = "var(--ds-illus-soft)";
const WATER = "var(--ds-illus-water)";
const LIGHT = "var(--ds-illus-light)";
const ALERT = "var(--ds-illus-alert)";

const rh = (cx: number, cy: number, r: number) => `M${cx} ${cy - r}l${r} ${r}l${-r} ${r}l${-r} ${-r}z`;
/** the kariz arch: right foot → over → left foot, standing on the ground (y 98) */
const ARCH = "M98 98V70a18 18 0 0 0-36 0v28";
const ground = <path d="M18 98h124" stroke={LINE} strokeWidth={1.5} strokeLinecap="round" />;
const halo = <circle cx={80} cy={64} r={46} fill={SOFT} />;
const arch = <path d={ARCH} fill="none" stroke={INK} strokeWidth={3.2} strokeLinecap="round" />;

const DRAWINGS: Record<IllustrationName, ReactNode> = {
  empty: (
    <>
      {halo}
      {ground}
      {arch}
      <path d="M68 98h24" stroke={INK} strokeWidth={1.6} strokeDasharray="1.5 4.5" strokeLinecap="round" />
      <path d={rh(80, 86, 5)} fill="none" stroke={LIGHT} strokeWidth={1.6} strokeLinejoin="round" />
    </>
  ),
  search: (
    <>
      {halo}
      {ground}
      <circle cx={74} cy={58} r={20} fill="none" stroke={INK} strokeWidth={3.2} />
      <path d="M88.6 72.6 102 86" stroke={INK} strokeWidth={4.2} strokeLinecap="round" />
      {[65, 74, 83].map((x) => (
        <path key={x} d={rh(x, 58, 2.6)} fill="none" stroke={INK} strokeWidth={1.4} strokeLinejoin="round" opacity={0.7} />
      ))}
    </>
  ),
  done: (
    <>
      {halo}
      {ground}
      <path d="M86 98H30" stroke={WATER} strokeWidth={3} strokeLinecap="round" />
      {arch}
      <path d={rh(80, 86, 5.5)} fill={LIGHT} />
      <path d="M80 72.5v-4M70.5 76.5l-3-3M89.5 76.5l3-3" stroke={LIGHT} strokeWidth={1.6} strokeLinecap="round" />
    </>
  ),
  offline: (
    <>
      {halo}
      <path d="M18 98h44M98 98h44" stroke={LINE} strokeWidth={1.5} strokeLinecap="round" />
      <path d="M40 98h20M100 98h20" stroke={WATER} strokeWidth={3} strokeLinecap="round" />
      <path d="M64 96c4-14 28-14 32 0" fill="none" stroke={INK} strokeWidth={1.6} strokeDasharray="1.5 4.5" strokeLinecap="round" />
      <path d={rh(80, 78, 5)} fill="none" stroke={LIGHT} strokeWidth={1.6} strokeLinejoin="round" />
    </>
  ),
  locked: (
    <>
      {halo}
      {ground}
      <path d="M93 98V71a13 13 0 0 0-26 0v27z" fill={INK} opacity={0.16} />
      {arch}
      <path d={rh(80, 80, 4.5)} fill={INK} />
      <path d="M80 85v6" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
    </>
  ),
  error: (
    <>
      {halo}
      {ground}
      {arch}
      <path d="M93 53.5 88 60l5 3.5-4.5 6" fill="none" stroke={SOFT} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M93 53.5 88 60l5 3.5-4.5 6" fill="none" stroke={ALERT} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
      <path d={rh(80, 86, 5.5)} fill={ALERT} />
      <path d="M66 98H48" stroke={WATER} strokeWidth={2} strokeDasharray="2 5" strokeLinecap="round" />
    </>
  ),
  welcome: (
    <>
      <path d="M48 98a32 32 0 0 1 64 0z" fill={LIGHT} opacity={0.22} />
      {ground}
      <path d="M86 98H22" stroke={WATER} strokeWidth={3} strokeLinecap="round" />
      {arch}
      <path d={rh(80, 86, 5.5)} fill={LIGHT} />
      {[112, 124, 136].map((x, i) => (
        <path key={x} d={`M${x} 98v-${6 - i * 1.5}`} stroke={INK} strokeWidth={2.4} strokeLinecap="round" opacity={0.7 - i * 0.15} />
      ))}
    </>
  ),
};

/** One of the empty-state drawings; decorative unless `title` is given (the page usually says it in text). */
export function Illustration({ name, size = 160, title, className }: { name: IllustrationName; size?: number; title?: string; className?: string }) {
  const a11y = title ? { role: "img", "aria-label": title } : { "aria-hidden": true as const };
  return (
    <svg viewBox="0 0 160 120" width={size} height={(size * 3) / 4} className={["ds-illus", className].filter(Boolean).join(" ")} style={{ flex: "none", display: "block" }} {...a11y}>
      {DRAWINGS[name]}
    </svg>
  );
}
