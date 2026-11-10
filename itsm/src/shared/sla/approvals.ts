// Approval maths (docs/spec/services/sla.md §4), pure: how many approvers a level needs, what a level, a rule's round
// and a record's approvals add up to, and the checks on an approval rule's levels. Shared by the approval service, the
// approvals panel and the rule builder.
//
// A rule asks for approval in levels; each level names its approvers through sources (people, groups' members, the
// requester's manager, a user or group field of the record, a module's owner source) and a rule over them:
//   any — one approval is enough · all — everyone · count — n of them · percent — p % of them (rounded up) ·
//   first — the first answer settles the level, approval or rejection («یک پاسخ کافی است»).
// A level is rejected as soon as its rule can no longer be met. Levels run one after another («پشت سر هم») or all at
// once («هم‌زمان»); a rule's round is approved when every level is, rejected when one is.
export type ApprovalRule = "any" | "all" | "count" | "percent" | "first";
export type ApprovalState = "waiting" | "requested" | "approved" | "rejected" | "canceled" | "skipped" | "no_longer_required";
export type Outcome = "approved" | "rejected" | "pending";
export type Aggregate = "not_requested" | "requested" | "approved" | "rejected";

export type SourceDef =
  | { kind: "users"; users: string[] }
  | { kind: "groups"; groups: string[] }
  | { kind: "manager"; depth?: number }
  | { kind: "field"; field: string }
  | { kind: "owner"; of: string };

export interface LevelDef {
  name?: string;
  sources: SourceDef[];
  rule?: ApprovalRule;
  /** count: how many; percent: what share (1–100) */
  threshold?: number;
}

/** Rows that take part in a level's count (the others were withdrawn or never asked). */
const COUNTED = new Set<string>(["waiting", "requested", "approved", "rejected"]);

/** Approvals a level of `n` approvers needs under `rule`. */
export function needed(rule: ApprovalRule | string | null | undefined, threshold: number | null | undefined, n: number): number {
  if (n <= 0) return 0;
  const t = Math.max(1, Math.floor(Number(threshold) || 1));
  if (rule === "all") return n;
  if (rule === "count") return Math.min(t, n);
  if (rule === "percent") return Math.min(n, Math.max(1, Math.ceil((n * Math.min(100, t)) / 100)));
  return 1;
}

/** What the rows of one level add up to: approved, rejected (the rule can no longer be met) or still pending. */
export function levelOutcome(rows: readonly { state: string; decided_at?: unknown }[], rule: ApprovalRule | string | null | undefined, threshold?: number | null): Outcome | "skipped" | null {
  const live = rows.filter((r) => COUNTED.has(r.state));
  if (!live.length) return rows.some((r) => r.state === "skipped" || r.state === "approved") ? "skipped" : null;
  if (rule === "first") {
    // the first answer settles it (the service withdraws the others at once; the earliest wins should two exist)
    const answered = live.filter((r) => r.state === "approved" || r.state === "rejected");
    if (!answered.length) return "pending";
    const at = (r: { decided_at?: unknown }) => (typeof r.decided_at === "string" ? Date.parse(r.decided_at) : Number.POSITIVE_INFINITY) || 0;
    return answered.reduce((x, y) => (at(y) < at(x) ? y : x)).state as Outcome;
  }
  const a = live.filter((r) => r.state === "approved").length;
  const r = live.filter((x) => x.state === "rejected").length;
  const need = needed(rule, threshold, live.length);
  if (a >= need) return "approved";
  if (live.length - r < need) return "rejected";
  return "pending";
}

export interface ApprovalRowLike {
  state: string;
  decided_at?: unknown;
  level: number;
  rule?: string | null;
  threshold?: number | null;
  rule_id?: string | null;
  round?: number | null;
}

/** A rule's latest round: rejected when a level is, pending while a level is, else approved (null: nothing asked). */
export function roundOutcome(rows: readonly ApprovalRowLike[]): Outcome | null {
  if (!rows.length) return null;
  const levels = [...new Set(rows.map((r) => Number(r.level) || 1))].sort((a, b) => a - b);
  let pending = false;
  let any = false;
  for (const l of levels) {
    const xs = rows.filter((r) => (Number(r.level) || 1) === l);
    const o = levelOutcome(xs, xs[0].rule, xs[0].threshold);
    if (o === null) continue;
    any = true;
    if (o === "rejected") return "rejected";
    if (o === "pending") pending = true;
  }
  if (!any) return null;
  return pending ? "pending" : "approved";
}

/** The record's approval field from all its approval rows: rejected > requested > approved > not requested. */
export function aggregate(rows: readonly ApprovalRowLike[]): Aggregate {
  const byRule = new Map<string, ApprovalRowLike[]>();
  for (const r of rows) {
    const k = r.rule_id ?? "";
    byRule.set(k, [...(byRule.get(k) ?? []), r]);
  }
  const outcomes: (Outcome | null)[] = [];
  for (const xs of byRule.values()) {
    const latest = Math.max(...xs.map((x) => Number(x.round) || 1));
    outcomes.push(roundOutcome(xs.filter((x) => (Number(x.round) || 1) === latest)));
  }
  if (outcomes.includes("rejected")) return "rejected";
  if (outcomes.includes("pending")) return "requested";
  if (outcomes.includes("approved")) return "approved";
  return "not_requested";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RULES = ["any", "all", "count", "percent", "first"];

/**
 * Why `raw` is not a valid list of levels (Persian), or null. `fieldType` answers the type of a field of the rule's
 * table (for `field` sources); `owners` are the owner sources modules registered.
 */
export function levelsProblem(raw: unknown, fieldType: (name: string) => string | undefined, owners: readonly string[] = []): string | null {
  if (!Array.isArray(raw) || !raw.length) return "دست‌کم یک سطح تأیید لازم است";
  if (raw.length > 10) return "حداکثر ده سطح تأیید";
  for (let i = 0; i < raw.length; i++) {
    const at = `سطح ${(i + 1).toLocaleString("fa-IR")}`;
    const l = raw[i] as Record<string, unknown>;
    if (!l || typeof l !== "object" || Array.isArray(l)) return `${at}: ساختار معتبر نیست`;
    if (l.name !== undefined && l.name !== null && (typeof l.name !== "string" || l.name.length > 120)) return `${at}: نام معتبر نیست`;
    if (l.rule !== undefined && !RULES.includes(String(l.rule))) return `${at}: قاعدهٔ «${String(l.rule)}» شناخته نیست`;
    if (l.rule === "count" || l.rule === "percent") {
      const t = Number(l.threshold);
      if (!Number.isInteger(t) || t < 1 || (l.rule === "percent" && t > 100) || t > 1000) return `${at}: حد نصاب معتبر نیست`;
    }
    if (!Array.isArray(l.sources) || !l.sources.length) return `${at}: دست‌کم یک منبع تأییدکننده لازم است`;
    if (l.sources.length > 20) return `${at}: منبع‌ها بیش از حد است`;
    for (const s of l.sources as Record<string, unknown>[]) {
      if (!s || typeof s !== "object") return `${at}: منبع معتبر نیست`;
      if (s.kind === "users") {
        if (!Array.isArray(s.users) || !s.users.length || s.users.length > 200 || s.users.some((u) => typeof u !== "string" || !UUID.test(u))) return `${at}: افراد را انتخاب کنید`;
      } else if (s.kind === "groups") {
        if (!Array.isArray(s.groups) || !s.groups.length || s.groups.length > 50 || s.groups.some((g) => typeof g !== "string" || !UUID.test(g))) return `${at}: گروه‌ها را انتخاب کنید`;
      } else if (s.kind === "manager") {
        if (s.depth !== undefined && ![1, 2].includes(Number(s.depth))) return `${at}: سطح مدیر یک یا دو است`;
      } else if (s.kind === "field") {
        const t = typeof s.field === "string" ? fieldType(s.field) : undefined;
        if (!t) return `${at}: فیلد «${String(s.field ?? "")}» در جدول نیست`;
        if (!["user", "users", "group"].includes(t)) return `${at}: فیلد «${String(s.field)}» کاربر یا گروه نیست`;
      } else if (s.kind === "owner") {
        if (typeof s.of !== "string" || !owners.includes(s.of)) return `${at}: منبع مالک «${String(s.of ?? "")}» هنوز در دسترس نیست`;
      } else return `${at}: نوع منبع «${String(s.kind ?? "")}» شناخته نیست`;
    }
  }
  return null;
}
