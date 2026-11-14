// CMDB health (catalogue CMDB-030/031/032): every CI's completeness (its class's required and recommended attributes),
// correctness (duplicates, relationship rules — orphans —, staleness) and compliance (audit and data-quality rules,
// periodic owner certification), combined into a weighted score with the issues behind it (`ci.health_*`). The nightly
// pass also writes one fact row per class and day (trends), each rule's last result (checked, failing, compliance) and
// the remediation findings for the CIs' owners and support groups — one per CI and issue, closed again by the system
// when the issue is gone. Everything runs as the system; people read the results through the engine.
import { ciHealth, isStale, relViolations, type HealthResult } from "@shared/cmdb/logic";
import type { Cond } from "@shared/model/conditions";
import type { ClassHealth, HealthSummary } from "@shared/cmdb/api";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import { lockKey, pgArray } from "../../db";
import type { Queryable, Tx } from "../../db";
import { aggregate, condEnv, createIn, orgSchema, readable, toSql, transitionIn, updateIn } from "../../engine";
import { classTree, cmdbConfig, eqAll, isUuid, liveRows, lockedRow, relTypes, sysOf, type Row } from "./common";
import { edgesAround } from "./graph";

const DAY = 86_400_000;
export const AUTO_FINDINGS = ["missing_owner", "orphan", "stale", "audit"] as const;
const MAX_NEW_FINDINGS = 200;
/** Dedupe-key prefixes of the findings the health pass opens (and so may close). */
export const HEALTH_KEYS = ["missing_owner:", "orphan:", "stale:", "rule:"];

interface RuleRow {
  id: string;
  name: string;
  kind: string;
  class: string | null;
  scope_condition: Cond | null;
  check_condition: Cond | null;
  required_rel: { type: string; direction?: "in" | "out"; min?: number } | null;
  severity: string;
  creates_findings: boolean;
  due_days: number;
}

export interface HealthRun {
  processed: number;
  updated: number;
  findings_opened: number;
  findings_closed: number;
  results: Map<string, HealthResult>;
  /** per class sums (full passes) */
  sums: Record<string, ClassSums>;
  /** per rule: checked / failing */
  rules: Record<string, { checked: number; failing: number }>;
}

export interface ClassSums {
  total: number;
  complete: number;
  correct: number;
  compliant: number;
  stale: number;
  duplicates: number;
  orphans: number;
  no_owner: number;
  score: number;
}

const emptySums = (): ClassSums => ({ total: 0, complete: 0, correct: 0, compliant: 0, stale: 0, duplicates: 0, orphans: 0, no_owner: 0, score: 0 });

/** Ids of the rule's failing CIs among `ids` (SQL through the engine's conditions; system rights). */
async function failingIds(q: Queryable, sys: Ctx, rule: RuleRow, classes: string[] | null, ids: string[]): Promise<{ inScope: Set<string>; failing: Set<string> }> {
  const schema = await orgSchema(sys, q);
  const def = schema.def("ci") ?? tableDef("ci")!;
  const env = await condEnv(sys);
  const params: unknown[] = [];
  const base = [readable(sys, def, "t", params, env)];
  params.push(pgArray(ids));
  base.push(`t.id = any($${params.length}::uuid[])`);
  if (classes) {
    params.push(pgArray(classes));
    base.push(`t.class = any($${params.length}::text[])`);
  }
  if (rule.scope_condition) base.push(toSql(rule.scope_condition, def, "t", params, env, { ctx: sys, lookup: schema.lookup }));
  const scope = await q.query<{ id: string; ok: boolean }>(
    `select t.id, ${rule.check_condition ? `(${toSql(rule.check_condition, def, "t", params, env, { ctx: sys, lookup: schema.lookup })})` : "true"} as ok from ${def.table} t where ${base.join(" and ")}`,
    params,
  );
  return { inScope: new Set(scope.map((r) => r.id)), failing: new Set(scope.filter((r) => !r.ok).map((r) => r.id)) };
}

/** Compute (and store) the health of CIs: `ids`, or a page of every CI after `after` (full passes). */
export async function computeHealth(q: Tx, ctx: Ctx, opts: { ids?: string[]; after?: string | null; limit?: number; full?: boolean; now?: number } = {}): Promise<HealthRun & { last: string | null }> {
  const sys = sysOf(ctx);
  const now = opts.now ?? Date.now();
  const tree = await classTree(q, ctx);
  const types = await relTypes(q, ctx);
  const cfg = await cmdbConfig(q, ctx);
  const weights = { completeness: cfg.w_completeness, correctness: cfg.w_correctness, compliance: cfg.w_compliance };
  let cis: Row[];
  if (opts.ids) cis = opts.ids.length ? await liveRows(q, sys, "ci", { f: "id", op: "in", v: opts.ids.slice(0, 500) }) : [];
  else {
    const cond: Cond | null = opts.after ? { f: "id", op: "gt", v: opts.after } : null;
    cis = await liveRows(q, sys, "ci", cond, { order: "t.id", limit: opts.limit ?? 300 });
  }
  const out: HealthRun & { last: string | null } = { processed: 0, updated: 0, findings_opened: 0, findings_closed: 0, results: new Map(), sums: {}, rules: {}, last: cis.length ? cis[cis.length - 1].id : null };
  if (!cis.length) return out;
  // excluded from health: retired, disposed, canceled and merged CIs
  const live = cis.filter((c) => !["retired", "disposed", "canceled"].includes(c.state) && !c.merged_into);
  const ids = live.map((c) => c.id);
  // relationships and the classes of their other ends
  const edges = await edgesAround(q, ctx, ids, { includeHidden: true });
  const others = [...new Set(edges.flatMap((e) => [e.parent_id, e.child_id]))].filter((x) => !ids.includes(x));
  const otherClass = new Map<string, string>(cis.map((c) => [c.id, c.class]));
  if (others.length) for (const r of await liveRows(q, sys, "ci", { f: "id", op: "in", v: others.slice(0, 5000) })) otherClass.set(r.id, r.class);
  const relsOf = new Map<string, { type: string; direction: "out" | "in"; otherClass: string | null; propagates: boolean }[]>();
  for (const e of edges) {
    const t = types.get(e.type);
    const add = (id: string, direction: "out" | "in", other: string) => {
      const list = relsOf.get(id) ?? [];
      list.push({ type: e.type, direction, otherClass: otherClass.get(other) ?? null, propagates: !!t?.propagates });
      relsOf.set(id, list);
    };
    add(e.parent_id, "out", e.child_id);
    add(e.child_id, "in", e.parent_id);
  }
  // CIs in open de-duplication tasks
  const dup = new Set<string>();
  for (const t of await liveRows(q, sys, "cmdb_dedup_task", { and: [{ f: "active", op: "eq", v: true }, { f: "candidates", op: "in", v: ids }] }, { limit: 5000 })) for (const c of t.candidates ?? []) dup.add(c);
  // rules
  const rules: RuleRow[] = (await liveRows(q, sys, "cmdb_rule", { f: "active", op: "eq", v: true })).map((r) => ({
    id: r.id, name: r.name, kind: r.kind, class: r.class ?? null, scope_condition: r.scope_condition ?? null, check_condition: r.check_condition ?? null,
    required_rel: r.required_rel ?? null, severity: r.severity ?? "medium", creates_findings: r.creates_findings !== false, due_days: Number(r.due_days ?? 14),
  }));
  const ruleFail = new Map<string, Set<string>>();
  const ruleScope = new Map<string, Set<string>>();
  for (const rule of rules) {
    const classes = rule.class ? tree.descendants(rule.class) : null;
    const { inScope, failing } = await failingIds(q, sys, rule, classes, ids);
    if (rule.required_rel) {
      for (const id of inScope) {
        const rr = rule.required_rel;
        const v = relViolations([{ type: rr.type, direction: rr.direction ?? "out", min: rr.min ?? 1 }], relsOf.get(id) ?? [], tree);
        if (v.length) failing.add(id);
      }
    }
    ruleScope.set(rule.id, inScope);
    ruleFail.set(rule.id, failing);
    out.rules[rule.id] = { checked: inScope.size, failing: failing.size };
  }
  // findings already open (to close what is fixed and not duplicate what is not)
  const open = await liveRows(q, sys, "cmdb_finding", { and: [{ f: "active", op: "eq", v: true }, { f: "auto", op: "eq", v: true }, { f: "ci_id", op: "in", v: ids }] }, { limit: 10000 });
  const openByKey = new Map(open.map((f) => [String(f.dedupe_key), f]));
  const wantKeys = new Set<string>();
  const toOpen: { key: string; ci: Row; kind: string; title: string; detail: string; severity: string; rule?: string; due?: number }[] = [];
  for (const ci of live) {
    const cls = tree.resolve(ci.class);
    const applicable = rules.filter((r) => ruleScope.get(r.id)?.has(ci.id));
    const failed = applicable.filter((r) => ruleFail.get(r.id)?.has(ci.id));
    const h = ciHealth({
      ci, cls, now, rels: relsOf.get(ci.id) ?? [], tree, duplicate: dup.has(ci.id),
      audit: { applicable: applicable.length, passed: applicable.length - failed.length },
      certifyWithinDays: cfg.certify_days || null, weights,
    });
    out.results.set(ci.id, h);
    out.processed++;
    // the stored health
    const issues = [...h.issues].sort();
    const prevIssues = [...(ci.health_issues ?? [])].sort();
    const detail = { completeness: h.completeness, recommended: h.recommended, correctness: h.correctness, compliance: h.compliance, missing: h.missing, violations: h.violations, failed_rules: failed.map((r) => r.name), warned: ci.health?.warned ?? null };
    if (ci.health_score !== h.score || JSON.stringify(issues) !== JSON.stringify(prevIssues) || JSON.stringify(ci.health ?? null) !== JSON.stringify(detail) || isStale(ci, cls?.staleDays ?? null, now) !== !!ci.is_stale) {
      // the expiry warning mark as stored now (the CI locked: the warnings job writes it under the same lock), so this
      // write keeps a mark set since the CIs were read
      detail.warned = (await lockedRow(q, sys, "ci", ci.id))?.health?.warned ?? null;
      await updateIn(q, sys, "ci", ci.id, { health_score: h.score, health_issues: issues, health: detail, health_at: new Date(now).toISOString(), is_stale: h.issues.includes("stale") }, { trusted: true, keepVersion: true, allowLocked: true });
      out.updated++;
    }
    // sums per class
    if (opts.full) {
      const s = (out.sums[ci.class] ??= emptySums());
      s.total++;
      if (h.completeness >= 100) s.complete++;
      if (h.correctness >= 100) s.correct++;
      if (h.compliance >= 100) s.compliant++;
      if (h.issues.includes("stale")) s.stale++;
      if (h.issues.includes("duplicate")) s.duplicates++;
      if (h.issues.includes("orphan")) s.orphans++;
      if (!ci.owned_by) s.no_owner++;
      s.score += h.score;
    }
    // findings for what needs a person
    if (cfg.health_findings && cls?.principal) {
      if (h.issues.includes("missing_owner")) toOpen.push({ key: `missing_owner:${ci.id}`, ci, kind: "missing_owner", title: `«${ci.name}» مالک ندارد`, detail: "برای این پیکربندی مالک تعیین کنید.", severity: "high" });
      if (h.issues.includes("orphan")) toOpen.push({ key: `orphan:${ci.id}`, ci, kind: "orphan", title: `«${ci.name}» رابطهٔ لازم را ندارد`, detail: h.violations.join("\n"), severity: "medium" });
      if (h.issues.includes("stale")) toOpen.push({ key: `stale:${ci.id}`, ci, kind: "stale", title: `«${ci.name}» کهنه است`, detail: `این پیکربندی بیش از ${cls?.staleDays ?? "—"} روز دیده یا به‌روز نشده است؛ بودنش را بررسی کنید.`, severity: "low" });
    }
    for (const r of failed) if (r.creates_findings) toOpen.push({ key: `rule:${r.id}:${ci.id}`, ci, kind: r.kind === "audit" ? "audit" : "data_quality", title: `«${ci.name}»: ${r.name}`.slice(0, 200), detail: r.name, severity: r.severity, rule: r.id, due: r.due_days });
  }
  for (const f of toOpen) wantKeys.add(f.key);
  // close automatic findings whose issue is gone (only those of the CIs and rules looked at now, and only the kinds this
  // pass opens: wrong-CI feedback, technology standards and policies are other passes' findings)
  for (const f of open) {
    if (wantKeys.has(String(f.dedupe_key))) continue;
    if (!ids.includes(f.ci_id)) continue;
    if (!HEALTH_KEYS.some((p) => String(f.dedupe_key ?? "").startsWith(p))) continue;
    try {
      await transitionIn(q, sys, "cmdb_finding", f.id, "resolved", { close_notes: "ایراد برطرف شد (بررسی خودکار)" }, { trusted: true });
      out.findings_closed++;
    } catch {
      // a finding someone is working on keeps its state
    }
  }
  for (const f of toOpen) {
    if (openByKey.has(f.key)) continue;
    if (out.findings_opened >= MAX_NEW_FINDINGS) break;
    // the finding's key, then its open finding read again: two passes over one CI at once (its own job, the nightly
    // pass, a person's «بررسی») open it once — a key per new finding, at most MAX_NEW_FINDINGS in a pass
    await lockKey(q, `cmdb.finding:${ctx.org.id}:${f.key}`);
    if ((await liveRows(q, sys, "cmdb_finding", { and: [{ f: "dedupe_key", op: "eq", v: f.key }, { f: "active", op: "eq", v: true }] }, { limit: 1 })).length) continue;
    await createIn(q, sys, "cmdb_finding", {
      short_description: f.title, ci_id: f.ci.id, kind: f.kind, severity: f.severity, rule_id: f.rule ?? null, detail: f.detail, dedupe_key: f.key, auto: true,
      assigned_to: f.ci.owned_by ?? null, assignment_group_id: f.ci.support_group_id ?? null, workspace_id: f.ci.workspace_id ?? null,
      due_at: f.due ? new Date(now + f.due * DAY).toISOString() : null,
    }, { trusted: true });
    out.findings_opened++;
  }
  return out;
}

/** Store a full pass: one fact row per class for `day` (replacing the day's earlier rows) and each rule's result. */
export async function storeFacts(q: Tx, ctx: Ctx, day: string, sums: Record<string, ClassSums>, rules: Record<string, { checked: number; failing: number }>): Promise<void> {
  const sys = sysOf(ctx);
  for (const [cls, s] of Object.entries(sums)) {
    const values = { total: s.total, complete: s.complete, correct: s.correct, compliant: s.compliant, stale: s.stale, duplicates: s.duplicates, orphans: s.orphans, no_owner: s.no_owner, score: s.total ? Math.round(s.score / s.total) : 0 };
    const [found] = await liveRows(q, sys, "cmdb_health_fact", eqAll({ day, class: cls }), { limit: 1 });
    if (found) await updateIn(q, sys, "cmdb_health_fact", found.id, values, { trusted: true, keepVersion: true });
    else await createIn(q, sys, "cmdb_health_fact", { day, class: cls, ...values }, { trusted: true });
  }
  const at = new Date().toISOString();
  for (const [id, r] of Object.entries(rules)) {
    if (!isUuid(id)) continue;
    await updateIn(q, sys, "cmdb_rule", id, { last_run_at: at, last_checked: r.checked, last_failing: r.failing, compliance: r.checked ? String(Math.round(((r.checked - r.failing) / r.checked) * 1000) / 10) : null }, { trusted: true, keepVersion: true });
  }
}

/** Merge per-class sums of two pages of a full pass. */
export function addSums(a: Record<string, ClassSums>, b: Record<string, ClassSums>): Record<string, ClassSums> {
  const out: Record<string, ClassSums> = JSON.parse(JSON.stringify(a));
  for (const [k, s] of Object.entries(b)) {
    const t = (out[k] ??= emptySums());
    for (const f of Object.keys(t) as (keyof ClassSums)[]) t[f] += s[f];
  }
  return out;
}

export function addRules(a: Record<string, { checked: number; failing: number }>, b: Record<string, { checked: number; failing: number }>) {
  const out = { ...a };
  for (const [k, r] of Object.entries(b)) out[k] = { checked: (out[k]?.checked ?? 0) + r.checked, failing: (out[k]?.failing ?? 0) + r.failing };
  return out;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 100);

/** The health dashboard for the caller: classes from the CIs they may read (live aggregates), trends from the facts. */
export async function healthSummary(ctx: Ctx): Promise<HealthSummary> {
  const tree = await classTree(ctx.db, ctx);
  const base: Cond = { f: "state", op: "nin", v: ["retired", "disposed", "canceled"] };
  const groups = await aggregate(ctx, "ci", { filter: base, groupBy: ["class"], metrics: [{ fn: "count" }, { fn: "avg", field: "health_score" }], limit: 500 });
  const issueAgg = await aggregate(ctx, "ci", { filter: base, groupBy: ["class", "health_issues"], metrics: [{ fn: "count" }], limit: 5000 });
  const issues = new Map<string, Record<string, number>>();
  for (const r of issueAgg.rows) {
    const cls = String(r.keys?.[0] ?? "");
    const issue = String(r.keys?.[1] ?? "");
    const m = issues.get(cls) ?? {};
    m[issue] = Number(r.values?.count ?? 0);
    issues.set(cls, m);
  }
  const classes: ClassHealth[] = groups.rows.map((r) => {
    const cls = String(r.keys?.[0] ?? "");
    const total = Number(r.values?.count ?? 0);
    const m = issues.get(cls) ?? {};
    const incomplete = m.missing_required ?? 0;
    const incorrect = Math.min(total, (m.duplicate ?? 0) + (m.orphan ?? 0) + (m.stale ?? 0));
    const noncompliant = Math.min(total, (m.audit_failed ?? 0) + (m.not_certified ?? 0));
    return {
      class: cls, label: tree.label(cls), total,
      completeness: pct(total - incomplete, total), correctness: pct(total - incorrect, total), compliance: pct(total - noncompliant, total),
      score: Math.round(Number(r.values?.["avg:health_score"] ?? 0)) || 0,
      stale: m.stale ?? 0, duplicates: m.duplicate ?? 0, orphans: m.orphan ?? 0, no_owner: m.missing_owner ?? 0,
    };
  }).sort((a, b) => b.total - a.total);
  const total = classes.reduce((s, c) => s + c.total, 0);
  const w = (f: (c: ClassHealth) => number) => (total ? Math.round(classes.reduce((s, c) => s + f(c) * c.total, 0) / total) : null);
  const facts = await aggregate(ctx, "cmdb_health_fact", { groupBy: [{ field: "day", bucket: "day" }], metrics: [{ fn: "sum", field: "total" }, { fn: "sum", field: "complete" }, { fn: "avg", field: "score" }], limit: 120 }).catch(() => null);
  const trend = (facts?.rows ?? []).map((r) => ({ day: String(r.keys?.[0] ?? ""), score: Math.round(Number(r.values?.["avg:score"] ?? 0)), total: Number(r.values?.["sum:total"] ?? 0) })).slice(-90);
  const count = async (table: string): Promise<number> => {
    try {
      const r = await aggregate(ctx, table, { filter: { f: "active", op: "eq", v: true }, groupBy: [], metrics: [{ fn: "count" }] });
      return Number(r.totals?.count ?? r.rows[0]?.values?.count ?? 0);
    } catch {
      return 0;
    }
  };
  const sources = await liveRows(ctx.db, ctx, "cmdb_data_source", null, { order: "t.priority, t.name", limit: 20 }).catch(() => [] as Row[]);
  const latest = await liveRows(ctx.db, sysOf(ctx), "ci", { f: "health_at", op: "nempty" }, { order: "t.health_at desc", limit: 1 });
  return {
    score: w((c) => c.score), completeness: w((c) => c.completeness), correctness: w((c) => c.correctness), compliance: w((c) => c.compliance),
    total, classes, trend,
    open_findings: await count("cmdb_finding"), open_dedup: await count("cmdb_dedup_task"), open_drift: await count("ci_drift"),
    stale: classes.reduce((s, c) => s + c.stale, 0),
    computed_at: latest[0]?.health_at ?? null,
    sources: sources.map((s) => ({ id: s.id, name: s.name, kind: s.kind, last_run_at: s.last_run_at ?? null, last_status: s.last_status ?? null })),
  };
}
