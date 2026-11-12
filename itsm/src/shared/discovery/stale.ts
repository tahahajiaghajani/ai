// Contact and the mass-drop guard (design A §10): pure and shared. Listing drives only «gone»; stale and missing run
// on the tool's own last contact with the machine, plus the kind's lag (AD's lastLogonTimestamp is up to 14 days late),
// never later than now. The mass-drop guard keeps a broken tool or a lost permission from marking a fleet gone.
// The contact ladder's decisions (stale, missing, retire) join this file with the stale package (DA1 part 2).
// Imported by the UI: keep it free of server imports.

const DAY = 86_400_000;

/** A complete pass that lists fewer than this share of the last complete pass trips the guard. */
export const MASS_DROP_SHARE = 0.7;
export const MASS_DROP_WARNING = "کاهش ناگهانی";

/**
 * Does a complete pass that listed `listed` items look like a broken tool? Yes when the last complete pass listed some
 * and this one listed none, or fewer than 70 % of them (§10.4). Without an earlier complete pass there is nothing to
 * compare: the first pass is believed.
 */
export function massDrop(listed: number, lastComplete: number | null | undefined): boolean {
  if (!lastComplete || lastComplete <= 0) return false;
  if (listed <= 0) return true;
  return listed < MASS_DROP_SHARE * lastComplete;
}

/** A target's contact from one source: the tool's last contact plus the kind's lag, never later than now (ms). */
export function effectiveContact(lastContactAt: string | null | undefined, lagDays: number, now: number): number | null {
  const at = lastContactAt ? Date.parse(lastContactAt) : NaN;
  if (Number.isNaN(at)) return null;
  return Math.min(at + Math.max(0, lagDays) * DAY, now);
}

/**
 * Does the source still have contact with the machine (the rolling refresh renews only those, §7.4)? Its contact (with
 * the lag) is within `staleDays`. A kind with no notion of contact always has; an item without a reported contact of
 * a kind that reports contact has not.
 */
export function hasContact(lastContactAt: string | null | undefined, contact: { lag_days: number } | null, staleDays: number, now: number): boolean {
  if (!contact) return true;
  const c = effectiveContact(lastContactAt, contact.lag_days, now);
  return c !== null && now - c <= Math.max(1, staleDays) * DAY;
}
