// Pure logic of configuration management, shared by the server and the screens (unit-tested in
// tests/cmdb-logic.test.ts): the class tree with inherited attributes and settings, impact propagation over the
// relationship graph (typed directions, weights, redundancy groups, cycles), the health score of a CI, baseline
// comparison, CSV parsing for imports and the normalisation of identifiers the reconciliation engine matches on.
// Imported by the UI: keep it free of server imports.
import type { ColorKey, Option } from "../model/types";
import { normalizeSearch } from "../model/conditions";
import {
  CLASS_FAMILIES, CLASS_LIBRARY, REL_TYPES, type AttrDef, type ClassFamily, type ImpactDir, type RelRule,
} from "./classes";

// ---------------------------------------------------------------------------------------------------------------
// Classes

/** A class as the organisation has it (its `ci_class` row, else the built-in pack). */
export interface ClassInfo {
  key: string;
  label: string;
  parent: string | null;
  family: ClassFamily;
  icon: string | null;
  color: ColorKey | null;
  abstract: boolean;
  principal: boolean;
  create_disabled: boolean;
  attrs: AttrDef[];
  required: string[];
  recommended: string[];
  owner_required: boolean;
  stale_days: number | null;
  operational_requires: string[];
  rel_rules: RelRule[];
  controlled: string[];
  active: boolean;
  description?: string | null;
}

/** A class with what it inherits along its ancestry (attributes, settings, rules). */
export interface ResolvedClass extends ClassInfo {
  /** root first, the class itself last */
  ancestry: string[];
  /** own and inherited attributes (an own attribute replaces an inherited one of the same name) */
  allAttrs: (AttrDef & { from: string })[];
  allRequired: string[];
  allRecommended: string[];
  allRelRules: (RelRule & { from: string })[];
  allControlled: string[];
  staleDays: number | null;
  operationalRequires: string[];
  ownerRequired: boolean;
}

const asArr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** A class from a `ci_class` row (or a partial built-in). */
export function classFromRow(r: Record<string, any>): ClassInfo {
  return {
    key: String(r.key),
    label: String(r.label ?? r.key),
    parent: r.parent_key ? String(r.parent_key) : r.parent ? String(r.parent) : null,
    family: (r.family ?? "logical") as ClassFamily,
    icon: r.icon ?? null,
    color: r.color ?? null,
    abstract: !!r.abstract,
    principal: !!r.principal,
    create_disabled: !!r.create_disabled,
    attrs: asArr<AttrDef>(r.attrs),
    required: asArr<string>(r.required_fields ?? r.required),
    recommended: asArr<string>(r.recommended_fields ?? r.recommended),
    owner_required: !!(r.owner_required ?? r.ownerRequired),
    stale_days: r.stale_days ?? r.staleDays ?? null,
    operational_requires: asArr<string>(r.operational_requires ?? r.operationalRequires),
    rel_rules: asArr<RelRule>(r.rel_rules ?? r.relRules),
    controlled: asArr<string>(r.controlled_attrs ?? r.controlled),
    active: r.active !== false,
    description: r.description ?? null,
  };
}

/** The built-in pack as ClassInfo rows. */
export const BUILTIN_CLASSES: ClassInfo[] = CLASS_LIBRARY.map((c) => classFromRow(c));

/** The class tree of an organisation: lookups, ancestry, descendants and inherited settings. */
export class ClassTree {
  readonly byKey = new Map<string, ClassInfo>();
  private readonly children = new Map<string, string[]>();
  private readonly resolved = new Map<string, ResolvedClass>();

  constructor(classes: ClassInfo[]) {
    for (const c of classes) this.byKey.set(c.key, c);
    for (const c of this.byKey.values()) {
      if (!c.parent || !this.byKey.has(c.parent)) continue;
      const list = this.children.get(c.parent) ?? [];
      list.push(c.key);
      this.children.set(c.parent, list);
    }
  }

  get(key: string | null | undefined): ClassInfo | undefined {
    return key ? this.byKey.get(key) : undefined;
  }

  label(key: string | null | undefined): string {
    return (key && this.byKey.get(key)?.label) || key || "";
  }

  /** The class and its ancestors, root first (a parent cycle stops where it repeats). */
  ancestry(key: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (let k: string | null | undefined = key; k && this.byKey.has(k) && !seen.has(k); k = this.byKey.get(k)?.parent) {
      seen.add(k);
      out.unshift(k);
    }
    return out;
  }

  /** The class and every class below it. */
  descendants(key: string): string[] {
    const out = this.byKey.has(key) ? [key] : [];
    for (let i = 0; i < out.length; i++) for (const c of this.children.get(out[i]) ?? []) if (!out.includes(c)) out.push(c);
    return out;
  }

  /** Is `key` the class `of` or one of its descendants? */
  isA(key: string | null | undefined, of: string): boolean {
    return !!key && this.ancestry(key).includes(of);
  }

  childrenOf(key: string | null): ClassInfo[] {
    if (key === null) return [...this.byKey.values()].filter((c) => !c.parent || !this.byKey.has(c.parent));
    return (this.children.get(key) ?? []).map((k) => this.byKey.get(k)!).filter(Boolean);
  }

  family(key: string | null | undefined): ClassFamily {
    return this.get(key)?.family ?? "logical";
  }

  resolve(key: string): ResolvedClass | null {
    const hit = this.resolved.get(key);
    if (hit) return hit;
    const c = this.byKey.get(key);
    if (!c) return null;
    const ancestry = this.ancestry(key);
    const attrs = new Map<string, AttrDef & { from: string }>();
    const required = new Set<string>();
    const recommended = new Set<string>();
    const controlled = new Set<string>();
    const rules: (RelRule & { from: string })[] = [];
    let staleDays: number | null = null;
    let operational: string[] = [];
    let ownerRequired = false;
    for (const k of ancestry) {
      const a = this.byKey.get(k)!;
      for (const at of a.attrs) if (!at.archived) attrs.set(at.name, { ...at, from: k });
      for (const f of a.required) required.add(f);
      for (const f of a.recommended) recommended.add(f);
      for (const f of a.controlled) controlled.add(f);
      for (const r of a.rel_rules) rules.push({ ...r, from: k });
      if (a.stale_days !== null && a.stale_days !== undefined) staleDays = a.stale_days;
      if (a.operational_requires.length) operational = a.operational_requires;
      if (a.owner_required) ownerRequired = true;
    }
    for (const at of attrs.values()) {
      if (at.required) required.add(attrPath(at.name));
      else if (at.recommended) recommended.add(attrPath(at.name));
    }
    for (const r of required) recommended.delete(r);
    if (ownerRequired) required.add("owned_by");
    const out: ResolvedClass = {
      ...c,
      ancestry,
      allAttrs: [...attrs.values()],
      allRequired: [...required],
      allRecommended: [...recommended],
      allRelRules: rules,
      allControlled: [...controlled],
      staleDays,
      operationalRequires: operational,
      ownerRequired,
    };
    this.resolved.set(key, out);
    return out;
  }

  /** Options of a class picker: indented by depth, abstract classes marked. */
  options(opts: { concreteOnly?: boolean } = {}): (Option & { depth: number; abstract: boolean; family: ClassFamily })[] {
    const out: (Option & { depth: number; abstract: boolean; family: ClassFamily })[] = [];
    const walk = (list: ClassInfo[], depth: number) => {
      for (const c of list) {
        if (!(opts.concreteOnly && (c.abstract || c.create_disabled || !c.active))) out.push({ value: c.key, label: c.label, depth, abstract: c.abstract, family: c.family, order: out.length + 1, color: c.color ?? CLASS_FAMILIES[c.family]?.color });
        walk(this.childrenOf(c.key), depth + 1);
      }
    };
    walk(this.childrenOf(null), 0);
    return out;
  }
}

/** `attrs.<name>` — how class attributes are named in required/recommended lists, filters and mappings. */
export const attrPath = (name: string) => `attrs.${name}`;

const ATTR_NAME = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * Problems of a class's own attribute list (the class manager refuses them): bad or duplicate names, names that clash
 * with an inherited attribute of another type or with a CI field, choices without options.
 */
export function attrProblems(attrs: AttrDef[], inherited: AttrDef[], ciFields: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of attrs) {
    if (!a || typeof a !== "object") {
      out.push("ویژگی نامعتبر است");
      continue;
    }
    if (!ATTR_NAME.test(String(a.name ?? ""))) out.push(`نام «${a.name ?? ""}» معتبر نیست (حروف کوچک لاتین، رقم و _)`);
    if (!String(a.label ?? "").trim()) out.push(`ویژگی «${a.name}» برچسب ندارد`);
    if (seen.has(a.name)) out.push(`ویژگی «${a.name}» دو بار آمده است`);
    seen.add(a.name);
    if (ciFields.has(a.name)) out.push(`«${a.name}» نام یکی از فیلدهای پیکربندی است`);
    const up = inherited.find((x) => x.name === a.name);
    if (up && up.type !== a.type) out.push(`«${a.label}» در کلاس بالادست با نوع دیگری تعریف شده است`);
    if ((a.type === "choice" || a.type === "multichoice") && !(a.choices ?? []).length) out.push(`«${a.label}» گزینه ندارد`);
  }
  return out;
}

/**
 * A class change keeps what CIs hold (catalogue CMDB-001: only additive changes): an attribute that disappears from the
 * list comes back archived, so its values stay on the CIs and its history stays readable.
 */
export function keepArchived(next: AttrDef[], prev: AttrDef[]): AttrDef[] {
  const names = new Set(next.map((a) => a.name));
  return [...next, ...prev.filter((a) => !names.has(a.name)).map((a) => ({ ...a, archived: true }))];
}

// ---------------------------------------------------------------------------------------------------------------
// Relationship types and impact propagation

export interface RelTypeInfo {
  key: string;
  label: string;
  inverse: string;
  symmetric: boolean;
  propagates: boolean;
  impact: ImpactDir;
  color: ColorKey | null;
  category: string | null;
  active: boolean;
}

export const BUILTIN_REL_TYPES: RelTypeInfo[] = REL_TYPES.map((t) => ({
  key: t.key, label: t.label, inverse: t.inverse, symmetric: !!t.symmetric, propagates: t.propagates, impact: t.impact, color: t.color, category: t.category, active: true,
}));

export function relTypeFromRow(r: Record<string, any>): RelTypeInfo {
  return {
    key: String(r.key),
    label: String(r.label ?? r.key),
    inverse: String(r.inverse_label ?? r.inverse ?? r.label ?? r.key),
    symmetric: !!r.symmetric,
    propagates: r.propagates !== false && r.impact !== "none",
    impact: (r.impact ?? "child_to_parent") as ImpactDir,
    color: r.color ?? null,
    category: r.category ?? null,
    active: r.active !== false,
  };
}

/** A relationship as the algorithms see it: «parent <type> child», with its impact weight (0–100). */
export interface GEdge {
  id: string;
  parent: string;
  child: string;
  type: string;
  weight?: number | null;
}

/** A redundancy group (catalogue CMDB-012): the cluster CI is down only when too few of its members are up. */
export interface Redundancy {
  cluster: string;
  /** the members; empty = the CIs related to the cluster by «عضوِ» */
  members?: string[] | null;
  minUp?: number | null;
  minUpPct?: number | null;
}

/** Severity of a CI's state: 1 down, 0.5 degraded, 0 fine. */
export type SimState = "down" | "degraded" | "maintenance";
export const STATE_SEVERITY: Record<SimState, number> = { down: 1, maintenance: 1, degraded: 0.5 };

export const SIM_STATES: Option[] = [
  { value: "down", label: "از کار افتاده", color: "red", order: 1 },
  { value: "degraded", label: "افت کیفیت", color: "orange", order: 2 },
  { value: "maintenance", label: "در نگهداری برنامه‌ریزی‌شده", color: "blue", order: 3 },
];

export interface ImpactHit {
  id: string;
  severity: number;
  depth: number;
  /** the CI the impact came from and the relationship it travelled (null for the starting CIs) */
  from: string | null;
  edge: string | null;
  /** a redundancy group absorbed part of the failure */
  absorbed?: boolean;
  source: boolean;
}

/** Whom a relationship's failure reaches: [from, to] pairs of «if from fails, to is affected». */
export function impactSteps(e: GEdge, t: Pick<RelTypeInfo, "propagates" | "impact"> | undefined): [string, string][] {
  if (!t || !t.propagates) return [];
  if (t.impact === "child_to_parent") return [[e.child, e.parent]];
  if (t.impact === "parent_to_child") return [[e.parent, e.child]];
  if (t.impact === "both") return [[e.child, e.parent], [e.parent, e.child]];
  return [];
}

const MIN_SEVERITY = 0.05;

/**
 * Impact propagation (catalogue CMDB-011/012/013): from the failing CIs along every propagating relationship in its
 * impact direction, a CI's severity is the strongest that reaches it (each hop multiplied by the relationship's
 * weight); a redundancy cluster takes the severity of its members' failure only when fewer than the minimum stay up
 * (otherwise it is degraded and marked absorbed). Monotonic, so cycles end; bounded by `maxDepth` hops.
 */
export function propagate(
  sources: Map<string, number>,
  edges: GEdge[],
  types: Map<string, Pick<RelTypeInfo, "propagates" | "impact">>,
  opts: { maxDepth?: number; redundancy?: Redundancy[] } = {},
): Map<string, ImpactHit> {
  const maxDepth = Math.max(1, Math.min(20, opts.maxDepth ?? 8));
  const out = new Map<string, ImpactHit>();
  const adj = new Map<string, { to: string; edge: GEdge }[]>();
  for (const e of edges) {
    for (const [a, b] of impactSteps(e, types.get(e.type))) {
      if (a === b) continue;
      const list = adj.get(a) ?? [];
      list.push({ to: b, edge: e });
      adj.set(a, list);
    }
  }
  // redundancy groups: their members (given, or the CIs that are «عضوِ» the cluster)
  const groups = new Map<string, { members: string[]; minUp: number | null; minUpPct: number | null }>();
  for (const r of opts.redundancy ?? []) {
    const members = r.members?.length ? [...new Set(r.members)] : [...new Set(edges.filter((e) => e.type === "member_of" && e.child === r.cluster).map((e) => e.parent))];
    if (members.length && (r.minUp || r.minUpPct)) groups.set(r.cluster, { members, minUp: r.minUp ?? null, minUpPct: r.minUpPct ?? null });
  }
  for (const [id, s] of sources) out.set(id, { id, severity: Math.min(1, Math.max(0, s)), depth: 0, from: null, edge: null, source: true });
  const queue = [...sources.keys()];
  let guard = 0;
  const limit = 50_000;
  const groupSeverity = (cluster: string): number => {
    const g = groups.get(cluster)!;
    const down = g.members.filter((m) => (out.get(m)?.severity ?? 0) >= 0.99).length;
    const hurt = g.members.filter((m) => (out.get(m)?.severity ?? 0) >= MIN_SEVERITY).length;
    const up = g.members.length - down;
    const failed = (g.minUp !== null && up < g.minUp) || (g.minUpPct !== null && (up / g.members.length) * 100 < g.minUpPct);
    if (failed) return 1;
    return hurt ? 0.3 : 0;
  };
  while (queue.length && guard++ < limit) {
    const u = queue.shift()!;
    const hu = out.get(u)!;
    if (hu.depth >= maxDepth) continue;
    for (const { to, edge } of adj.get(u) ?? []) {
      const weight = Math.max(0, Math.min(100, edge.weight ?? 100)) / 100;
      let candidate = hu.severity * weight;
      let absorbed = false;
      const g = groups.get(to);
      if (g && edge.type === "member_of" && g.members.includes(u)) {
        const gs = groupSeverity(to);
        absorbed = gs < 1;
        candidate = gs;
      }
      if (candidate < MIN_SEVERITY) {
        if (absorbed && !out.has(to)) out.set(to, { id: to, severity: 0, depth: hu.depth + 1, from: u, edge: edge.id, absorbed: true, source: false });
        continue;
      }
      const prev = out.get(to);
      if (prev && prev.severity >= candidate - 1e-9) {
        if (absorbed && !prev.source) prev.absorbed = true;
        continue;
      }
      if (prev?.source) continue;
      out.set(to, { id: to, severity: candidate, depth: hu.depth + 1, from: u, edge: edge.id, absorbed: absorbed || undefined, source: false });
      queue.push(to);
    }
  }
  return out;
}

/** The chain of CIs (and relationships) the impact travelled from a starting CI to `id`. */
export function impactPath(hits: Map<string, ImpactHit>, id: string): { nodes: string[]; edges: string[] } {
  const nodes: string[] = [];
  const edges: string[] = [];
  const seen = new Set<string>();
  for (let h = hits.get(id); h && !seen.has(h.id); h = h.from ? hits.get(h.from) : undefined) {
    seen.add(h.id);
    nodes.unshift(h.id);
    if (h.edge) edges.unshift(h.edge);
  }
  return { nodes, edges };
}

export function severityLabel(s: number): { label: string; color: ColorKey; key: "down" | "major" | "degraded" | "none" } {
  if (s >= 0.99) return { label: "از کار افتاده", color: "red", key: "down" };
  if (s >= 0.5) return { label: "افت شدید", color: "orange", key: "major" };
  if (s >= MIN_SEVERITY) return { label: "افت کیفیت", color: "gold", key: "degraded" };
  return { label: "بی‌اثر (افزونگی)", color: "green", key: "none" };
}

/**
 * Which side of a relationship depends on the other (for maps): the dependent CI sits above its dependency. Symmetric and
 * non-propagating relationships have no side.
 */
export function dependentSide(e: GEdge, t: Pick<RelTypeInfo, "propagates" | "impact"> | undefined): { dependent: string; dependency: string } | null {
  const steps = impactSteps(e, t);
  if (steps.length !== 1) return null;
  const [failing, affected] = steps[0];
  return { dependent: affected, dependency: failing };
}

/** «<parent> وابسته به <child>» — the display of a relationship. */
export function relLabel(parent: string, type: Pick<RelTypeInfo, "label"> | undefined, child: string, typeKey = ""): string {
  return `${parent} ${type?.label ?? typeKey} ${child}`.replace(/\s+/g, " ").slice(0, 300);
}

// ---------------------------------------------------------------------------------------------------------------
// Health (catalogue CMDB-030)

export interface HealthWeights {
  completeness: number;
  correctness: number;
  compliance: number;
}
export const DEFAULT_WEIGHTS: HealthWeights = { completeness: 40, correctness: 40, compliance: 20 };

export interface HealthInput {
  ci: Record<string, any>;
  cls: ResolvedClass | null;
  now: number;
  /** relationships of the CI: type, direction and the class of the other end */
  rels: { type: string; direction: "out" | "in"; otherClass: string | null; propagates: boolean }[];
  /** the class tree (to match relationship rules' target classes with descendants) */
  tree: ClassTree;
  duplicate: boolean;
  audit: { applicable: number; passed: number };
  /** the CI must have been certified within this many days (null = no certification requirement) */
  certifyWithinDays?: number | null;
  weights?: HealthWeights;
}

export interface HealthResult {
  completeness: number;
  recommended: number;
  correctness: number;
  compliance: number;
  score: number;
  issues: string[];
  missing: string[];
  violations: string[];
}

const filled = (v: unknown) => !(v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && v !== null && !Object.keys(v as object).length));

/** The value of a CI field or `attrs.<name>`. */
export function ciValue(ci: Record<string, any>, path: string): unknown {
  if (path.startsWith("attrs.")) return (ci.attrs ?? {})[path.slice(6)];
  if (path in ci) return ci[path];
  return (ci.attrs ?? {})[path];
}

/** Relationship rules a CI breaks: fewer than the minimum, or more than the maximum, of a type in a direction. */
export function relViolations(rules: RelRule[], rels: HealthInput["rels"], tree: ClassTree): string[] {
  const out: string[] = [];
  for (const r of rules) {
    const n = rels.filter((x) => x.direction === r.direction && (r.type === "*" ? x.propagates : x.type === r.type) && (!r.target || (x.otherClass && tree.isA(x.otherClass, r.target)))).length;
    if (r.min && n < r.min) out.push(r.label || `دست‌کم ${r.min} رابطهٔ «${r.type}» لازم است`);
    if (r.max !== null && r.max !== undefined && r.max > 0 && n > r.max) out.push(r.label || `بیش از ${r.max} رابطهٔ «${r.type}» مجاز نیست`);
  }
  return out;
}

const DAY = 86_400_000;

/** Is the CI stale: not seen by a source (or, never discovered, not updated) within its class threshold? */
export function isStale(ci: Record<string, any>, staleDays: number | null | undefined, now: number): boolean {
  if (!staleDays || staleDays <= 0) return false;
  const seen = Date.parse(String(ci.last_discovered_at ?? ci.updated_at ?? ci.created_at ?? ""));
  if (Number.isNaN(seen)) return false;
  return now - seen > staleDays * DAY;
}

/** One CI's health: completeness of its class's attributes, correctness (duplicate, orphan, stale), compliance. */
export function ciHealth(h: HealthInput): HealthResult {
  const w = h.weights ?? DEFAULT_WEIGHTS;
  const cls = h.cls;
  const required = cls?.allRequired ?? ["owned_by"];
  const recommended = cls?.allRecommended ?? [];
  const missing = required.filter((p) => !filled(ciValue(h.ci, p)));
  const completeness = required.length ? Math.round(((required.length - missing.length) / required.length) * 100) : 100;
  const recFilled = recommended.filter((p) => filled(ciValue(h.ci, p))).length;
  const rec = recommended.length ? Math.round((recFilled / recommended.length) * 100) : 100;
  const violations = cls ? relViolations(cls.allRelRules, h.rels, h.tree) : [];
  const stale = isStale(h.ci, cls?.staleDays ?? null, h.now);
  const issues: string[] = [];
  if (missing.length) issues.push("missing_required");
  if (!filled(h.ci.owned_by) && (cls?.ownerRequired || required.includes("owned_by"))) issues.push("missing_owner");
  if (!filled(h.ci.support_group_id) && required.includes("support_group_id")) issues.push("missing_support");
  if (stale) issues.push("stale");
  if (h.duplicate) issues.push("duplicate");
  if (violations.length) issues.push("orphan");
  if (h.audit.applicable > h.audit.passed) issues.push("audit_failed");
  let certified = true;
  if (h.certifyWithinDays) {
    const at = Date.parse(String(h.ci.certified_at ?? ""));
    certified = !Number.isNaN(at) && h.now - at <= h.certifyWithinDays * DAY;
    if (!certified) issues.push("not_certified");
  }
  const expires = Date.parse(String(h.ci.expires_at ?? ""));
  if (!Number.isNaN(expires) && expires - h.now < 30 * DAY) issues.push("expiring");
  const correctness = Math.max(0, 100 - (h.duplicate ? 40 : 0) - (violations.length ? 30 : 0) - (stale ? 30 : 0));
  const checks = h.audit.applicable + (h.certifyWithinDays ? 1 : 0);
  const passed = h.audit.passed + (h.certifyWithinDays && certified ? 1 : 0);
  const compliance = checks ? Math.round((passed / checks) * 100) : 100;
  const total = w.completeness + w.correctness + w.compliance || 1;
  const score = Math.round((completeness * w.completeness + correctness * w.correctness + compliance * w.compliance) / total);
  return { completeness, recommended: rec, correctness, compliance, score, issues, missing, violations };
}

/** Normal-approximation 95 % interval of a verified accuracy (catalogue CMDB-033 KPI): p ± 1.96·√(p(1−p)/n). */
export function accuracyInterval(matches: number, n: number): { p: number; low: number; high: number } | null {
  if (!n) return null;
  const p = matches / n;
  const half = 1.96 * Math.sqrt((p * (1 - p)) / n);
  return { p, low: Math.max(0, p - half), high: Math.min(1, p + half) };
}

// ---------------------------------------------------------------------------------------------------------------
// Baselines (catalogue CMDB-037)

export interface SnapRel {
  type: string;
  dir: "out" | "in";
  other: string;
  other_label?: string;
}

export interface SnapItem {
  id: string;
  number?: string | null;
  name: string;
  class: string;
  state?: string | null;
  values: Record<string, unknown>;
  rels: SnapRel[];
}

export interface FieldDiff {
  field: string;
  before: unknown;
  after: unknown;
}

export interface SnapDiff {
  added: SnapItem[];
  removed: SnapItem[];
  modified: { id: string; number?: string | null; name: string; class: string; fields: FieldDiff[]; relsAdded: SnapRel[]; relsRemoved: SnapRel[] }[];
  unchanged: number;
}

const stable = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "";
  if (Array.isArray(v)) return JSON.stringify([...v].map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).sort());
  if (typeof v === "object") return JSON.stringify(Object.keys(v as object).sort().reduce((o, k) => ({ ...o, [k]: (v as Record<string, unknown>)[k] }), {}));
  return String(v);
};

const relKey = (r: SnapRel) => `${r.dir}|${r.type}|${r.other}`;

/** Compare two snapshots by CI id: added (only when the scope is a query), removed, and modified fields and relationships. */
export function diffSnapshots(before: SnapItem[], after: SnapItem[], opts: { includeAdded?: boolean } = {}): SnapDiff {
  const b = new Map(before.map((x) => [x.id, x]));
  const a = new Map(after.map((x) => [x.id, x]));
  const out: SnapDiff = { added: [], removed: [], modified: [], unchanged: 0 };
  for (const [id, x] of b) if (!a.has(id)) out.removed.push(x);
  if (opts.includeAdded !== false) for (const [id, x] of a) if (!b.has(id)) out.added.push(x);
  for (const [id, x] of b) {
    const y = a.get(id);
    if (!y) continue;
    const fields: FieldDiff[] = [];
    const names = new Set([...Object.keys(x.values), ...Object.keys(y.values)]);
    for (const f of [...names].sort()) if (stable(x.values[f]) !== stable(y.values[f])) fields.push({ field: f, before: x.values[f] ?? null, after: y.values[f] ?? null });
    if (stable(x.name) !== stable(y.name)) fields.unshift({ field: "name", before: x.name, after: y.name });
    if (x.class !== y.class) fields.unshift({ field: "class", before: x.class, after: y.class });
    if ((x.state ?? "") !== (y.state ?? "")) fields.push({ field: "state", before: x.state ?? null, after: y.state ?? null });
    const xr = new Set(x.rels.map(relKey));
    const yr = new Set(y.rels.map(relKey));
    const relsAdded = y.rels.filter((r) => !xr.has(relKey(r)));
    const relsRemoved = x.rels.filter((r) => !yr.has(relKey(r)));
    if (fields.length || relsAdded.length || relsRemoved.length) out.modified.push({ id, number: y.number ?? x.number, name: y.name, class: y.class, fields, relsAdded, relsRemoved });
    else out.unchanged++;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Identification (catalogue CMDB-023)

/** The comparable form of an identifier: MAC addresses as aa:bb:…, serials upper-case, names Persian-normalised. */
/** Persian and Arabic-Indic digits → ASCII (identifiers are often typed on a Persian keyboard). */
const latinDigits = (s: string) => s.replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));

export function normalizeIdent(attr: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let s = latinDigits(String(value)).trim();
  if (!s) return null;
  const bare = attr.replace(/^attrs\./, "");
  if (bare === "mac_address") {
    const hex = s.toLowerCase().replace(/[^0-9a-f]/g, "");
    if (hex.length !== 12) return null;
    return hex.match(/.{2}/g)!.join(":");
  }
  if (bare === "serial_number" || bare === "asset_tag" || bare === "cert_serial" || bare === "bios_uuid" || bare === "imei") {
    s = s.toUpperCase().replace(/\s+/g, "");
    // placeholders some firmware reports are not identifiers
    if (/^(0+|N\/?A|NONE|DEFAULT|TOBEFILLEDBYO\.?E\.?M\.?|SYSTEMSERIALNUMBER|123456789|NOTSPECIFIED|UNKNOWN|-)$/.test(s)) return null;
    return s;
  }
  if (bare === "fqdn" || bare === "hostname") return s.toLowerCase().replace(/\.$/, "");
  if (bare === "ip_address" || bare === "mgmt_ip") return s.toLowerCase();
  if (bare === "cloud_resource_id") return s;
  return normalizeSearch(s).replace(/\s+/g, " ").trim() || null;
}

/** MAC addresses written in any notation, normalised (null when not a MAC address). */
export const normalizeMac = (v: unknown) => normalizeIdent("mac_address", v);

// ---------------------------------------------------------------------------------------------------------------
// CSV (imports from a file or a URL)

/** Splits CSV text into rows: RFC 4180 quotes, CRLF, a BOM, and the delimiter guessed among , ; tab and |. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const d = delimiter ?? ([",", ";", "\t", "|"].map((c) => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0]);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === d) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** CSV rows as objects keyed by the header row (headers trimmed; empty headers dropped). */
export function csvObjects(text: string, delimiter?: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text, delimiter);
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()]).filter(([k]) => k)));
}

/** The array a JSON document holds at `path` (dot path, e.g. `data.items`), or the document itself when it is one. */
export function jsonArrayAt(doc: unknown, path?: string | null): Record<string, unknown>[] {
  let cur: unknown = doc;
  for (const part of String(path ?? "").split(".").map((s) => s.trim()).filter(Boolean)) {
    if (cur && typeof cur === "object" && !Array.isArray(cur)) cur = (cur as Record<string, unknown>)[part];
    else return [];
  }
  if (!Array.isArray(cur)) return [];
  return cur.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
}

/** Flatten nested objects into dot paths (`{ os: { name } }` → `os.name`), arrays kept as values. */
export function flatten(obj: Record<string, unknown>, prefix = "", out: Record<string, unknown> = {}, depth = 0): Record<string, unknown> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && depth < 4) flatten(v as Record<string, unknown>, key, out, depth + 1);
    else out[key] = v;
  }
  return out;
}

/** The family layer of a class (0 = business services at the top of a layered map, 5 = facilities at the bottom). */
export const familyLayer = (f: ClassFamily | undefined) => CLASS_FAMILIES[f ?? "logical"]?.layer ?? 2;
