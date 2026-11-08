// Sharing of report and dashboard definitions (catalogue ANA-013) and the JSON bundle that moves definitions between
// organisations (ANA-050's export/import). Private by default; a definition is shared with people, groups, units
// (alone or with their sub-units), roles or everyone who reads reports — as viewer or editor. Sharing shares the
// definition, never data: every viewer's numbers come from their own access. Row rules of the engine test a row's
// own columns, so the entries are compiled into columns (`r_*` readers, `w_*` editors); role holders are resolved by
// the server (and recomputed when roles change). Pure.
import type { AnalyticsBundle, BundleDashboard, BundleIndicator, BundleReport, CompiledShares, DashboardLayout, Share, ShareKind, ShareRight } from "./types";
import { cleanLayout } from "./layout";

export const SHARE_KINDS: Record<ShareKind, string> = {
  user: "شخص",
  group: "گروه",
  unit: "واحد",
  unit_tree: "واحد و زیرمجموعه‌ها",
  role: "نقش",
  everyone: "همهٔ خوانندگان گزارش‌ها",
};
export const SHARE_RIGHTS: Record<ShareRight, string> = { view: "مشاهده", edit: "ویرایش" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE = /^[a-z][a-z0-9_]{0,40}$/;

/** Why a sharing list is not valid (Persian), or null. */
export function sharesProblem(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (!Array.isArray(input)) return "فهرست اشتراک معتبر نیست";
  if (input.length > 100) return "حداکثر ۱۰۰ مورد اشتراک";
  for (const s of input as Share[]) {
    if (!s || typeof s !== "object" || !(s.kind in SHARE_KINDS)) return "نوع اشتراک شناخته نیست";
    if (s.right && !(s.right in SHARE_RIGHTS)) return "سطح اشتراک شناخته نیست";
    if (s.kind === "everyone") continue;
    if (s.kind === "role" ? !ROLE.test(String(s.id ?? "")) : !UUID.test(String(s.id ?? ""))) return `شناسهٔ «${SHARE_KINDS[s.kind]}» معتبر نیست`;
  }
  return null;
}

/** Entries made tidy: ids lower-cased, duplicates merged (edit wins). */
export function cleanShares(input: unknown): Share[] {
  if (!Array.isArray(input)) return [];
  const out = new Map<string, Share>();
  for (const s of input as Share[]) {
    if (!s || !(s.kind in SHARE_KINDS)) continue;
    const id = s.kind === "everyone" ? null : String(s.id ?? "").toLowerCase();
    const key = `${s.kind}:${id ?? ""}`;
    const right: ShareRight = s.right === "edit" ? "edit" : "view";
    const prev = out.get(key);
    out.set(key, { kind: s.kind, id, right: prev?.right === "edit" ? "edit" : right });
  }
  return [...out.values()];
}

/** The columns a sharing list compiles into; `holders(role)` lists the members holding a role. */
export function compileShares(shares: Share[], holders: (role: string) => string[]): CompiledShares {
  const set = () => new Set<string>();
  const r = { users: set(), groups: set(), units: set(), lines: set() };
  const w = { users: set(), groups: set() };
  const roles = set();
  let all = false;
  for (const s of cleanShares(shares)) {
    const edit = s.right === "edit";
    const id = s.id ?? "";
    switch (s.kind) {
      case "everyone":
        all = true;
        break;
      case "user":
        r.users.add(id);
        if (edit) w.users.add(id);
        break;
      case "group":
        r.groups.add(id);
        if (edit) w.groups.add(id);
        break;
      case "unit":
        r.units.add(id);
        break;
      case "unit_tree":
        r.lines.add(id);
        break;
      case "role":
        roles.add(id);
        for (const u of holders(id)) {
          r.users.add(u);
          if (edit) w.users.add(u);
        }
        break;
    }
  }
  const sorted = (s: Set<string>) => [...s].sort();
  return { r_users: sorted(r.users), r_groups: sorted(r.groups), r_units: sorted(r.units), r_lines: sorted(r.lines), r_all: all, w_users: sorted(w.users), w_groups: sorted(w.groups), role_keys: sorted(roles) };
}

// ----- the bundle ----------------------------------------------------------------------------------------------------

export const BUNDLE_FORMAT = "itsm.analytics";

/** Why a bundle cannot be imported (Persian), or null. */
export function bundleProblem(input: unknown): string | null {
  const b = input as Partial<AnalyticsBundle> | null;
  if (!b || typeof b !== "object") return "پرونده معتبر نیست";
  if (b.format !== BUNDLE_FORMAT) return "این پرونده خروجی گزارش‌ها و داشبوردها نیست";
  if (b.version !== 1) return "نسخهٔ این پرونده پشتیبانی نمی‌شود";
  for (const k of ["reports", "dashboards", "indicators"] as const) if (b[k] !== undefined && !Array.isArray(b[k])) return "پرونده معتبر نیست";
  const n = (b.reports?.length ?? 0) + (b.dashboards?.length ?? 0) + (b.indicators?.length ?? 0);
  if (!n) return "پرونده خالی است";
  if (n > 300) return "حداکثر ۳۰۰ تعریف در یک پرونده";
  return null;
}

/** A layout whose widgets name saved reports by the bundle's refs instead of ids (and indicators by keys). */
export function layoutToBundle(layout: DashboardLayout, reportRef: (id: string) => string | null, indicatorKey: (id: string) => string | null): DashboardLayout {
  const clean = cleanLayout(layout);
  return {
    tabs: clean.tabs,
    widgets: clean.widgets.map((w) => {
      const out = { ...w };
      if (w.report_id) out.report_id = reportRef(w.report_id);
      if (w.indicator_id) {
        out.indicator_key = indicatorKey(w.indicator_id) ?? w.indicator_key ?? null;
        out.indicator_id = null;
      }
      if (w.indicator_ids?.length) {
        out.indicator_keys = w.indicator_ids.map(indicatorKey).filter((k): k is string => !!k);
        out.indicator_ids = null;
      }
      return out;
    }),
  };
}

/** The reverse: refs and keys back to this organisation's ids (unknown ones dropped from the widget). */
export function layoutFromBundle(layout: DashboardLayout, reportId: (ref: string) => string | null, indicatorId: (key: string) => string | null): DashboardLayout {
  const clean = cleanLayout(layout);
  return {
    tabs: clean.tabs,
    widgets: clean.widgets.map((w) => {
      const out = { ...w };
      if (w.report_id) out.report_id = reportId(w.report_id);
      if (w.indicator_key) out.indicator_id = indicatorId(w.indicator_key);
      if (w.indicator_keys?.length) out.indicator_ids = w.indicator_keys.map(indicatorId).filter((x): x is string => !!x);
      return out;
    }),
  };
}

export function makeBundle(parts: { reports: BundleReport[]; dashboards: BundleDashboard[]; indicators: BundleIndicator[] }, now = new Date()): AnalyticsBundle {
  return { format: BUNDLE_FORMAT, version: 1, exported_at: now.toISOString(), ...parts };
}
