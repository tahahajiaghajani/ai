// Contact and the mass-drop guard (design A §10): pure and shared. Listing drives only «gone»; stale and missing run
// on the tool's own last contact with the machine, plus the kind's lag (AD's lastLogonTimestamp is up to 14 days late),
// never later than now. The mass-drop guard keeps a broken tool or a lost permission from marking a fleet gone.
// The contact ladder's decisions (stale, missing, retire) are here too; the server's ladder (discovery/stale.ts) applies
// them. Imported by the UI: keep it free of server imports.

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

// ---------------------------------------------------------------------------------------------------------------
// The contact ladder (§10): gone → stale → missing → retired

/** What happens to CIs a connector's data source no longer hears from (`cmdb_data_source.delete_policy`, §10.2). */
export type DeletePolicy = "flag" | "retire" | "none";

export interface LadderInput {
  /** the target's last contact over every source that reports contact, with the kinds' lag (ms; null: unknown) */
  contactAt: number | null;
  now: number;
  /** the thresholds in force for the target (days) */
  staleDays: number;
  missingDays: number;
  /** 0: retirement off */
  retireDays: number;
  deletePolicy: DeletePolicy;
  /** the target has a CI (an ATM may have only an asset) */
  hasCi: boolean;
  /** the target's asset is in use */
  assetInUse: boolean;
}

export interface LadderDecision {
  /** no contact for `staleDays` */
  stale: boolean;
  /** the CI's `is_stale` is the ladder's to set (`flag` and `retire`; never with `none`) */
  flagCi: boolean;
  /** no contact for `missingDays` (the target's `missing_since`, whatever its asset's state) */
  overdue: boolean;
  /** overdue and the asset is in use: a task for the asset manager, or «مفقود» when automatic */
  missing: boolean;
  /** retire the CI: `retire`, `retireDays` without contact from any source, and no asset in use behind it */
  retire: boolean;
  /** whole days since the last contact (null: unknown) */
  days: number | null;
}

/**
 * The ladder's view of one target (pure). An unknown contact decides nothing: listing alone never makes a machine seen,
 * and never makes it stale either. Assets are never retired by a connector (disposal has its own approval).
 */
export function ladder(x: LadderInput): LadderDecision {
  if (x.contactAt === null || !Number.isFinite(x.contactAt)) return { stale: false, flagCi: false, overdue: false, missing: false, retire: false, days: null };
  const age = Math.max(0, x.now - x.contactAt);
  const stale = age > Math.max(1, x.staleDays) * DAY;
  const overdue = age > Math.max(1, x.missingDays) * DAY;
  const retire = x.hasCi && x.deletePolicy === "retire" && x.retireDays > 0 && !x.assetInUse && age > x.retireDays * DAY;
  return { stale, flagCi: x.hasCi && x.deletePolicy !== "none", overdue, missing: overdue && x.assetInUse, retire, days: Math.floor(age / DAY) };
}
