// Approvals (docs/spec/services/sla.md §4). An approval rule of a table asks for approval when its condition becomes
// true on a write (on create, or by a change that makes it hold): its levels are resolved into one approval row per
// approver — people, the members of groups, the requester's manager, a user or group field, a module's owner source —
// with separation of duties (whoever requested the record or is assigned to it never approves it, unless the rule
// allows it) and delegation (an absent approver's delegate is asked instead). Levels run one after another or all at
// once; each level's rule (any / all / count / percent) decides it. The record's `approval` field follows the
// aggregate; `record.approval_requested` and `record.approval_decided` are emitted for notifications and flows.
// Whoever has or had an approval on a record reads it — the approver grant, a participant source of reach «grant» of
// the access model: even a requester with no role in the record's area (field groups and confidentiality still apply).
// Reminders and expiry run as the job `approval.timer`.
import type { CondEnv } from "@shared/model/conditions";
import type { TableDef } from "@shared/model/types";
import { DONE_CATEGORIES, stateCategory } from "@shared/model/task";
import { aggregate, levelOutcome, levelsProblem, roundOutcome, type ApprovalRule, type LevelDef, type SourceDef } from "@shared/sla/approvals";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { pgArray } from "../../db";
import { demoPeople, demoQuiet } from "../../db/scope";
import { AppError, bad, forbidden, notFound } from "../../http/errors";
import { access } from "../../access/provider";
import { registerParticipantSource } from "../../access/predicate";
import { subjectOf } from "../../access";
import { grantIn } from "@shared/access/model";
import { enqueue, registerJobHandler } from "../../jobs";
import {
  actorId, addJournalIn, bumpScopeEpoch, condEnv, createIn, defFor, emitEvent, isSystemCtx, loadReadable, orgSchema, RefSet, registerHooks, requireReadable, resolveDisplay,
  systemCtx, updateIn, validationError, type WriteArgs,
} from "../../engine";
import { config, eqAll, holds, liveRow, liveRows, ownTable, recordTitle, rulesFor, systemFrom, withWalks, type Row } from "./common";

const iso = (ms: number) => new Date(ms).toISOString();
const msOf = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
};
const OPEN = new Set(["requested", "waiting"]);

// ---------------------------------------------------------------------------------------------------------------
// Delegations

export interface Delegation {
  from: string;
  to: string;
}

/** Delegations in force at `at` for `scope` («approvals», «assignments», «notifications»). */
export async function activeDelegations(q: Queryable, ctx: Ctx, scope: "approvals" | "assignments" | "notifications", at = Date.now()): Promise<Delegation[]> {
  const rows = await liveRows(q, systemFrom(ctx), "delegation", { and: [{ f: "active", op: "eq", v: true }, { f: "scopes", op: "contains", v: scope }] }, "t.starts_at, t.id");
  return rows
    .filter((r) => (msOf(r.starts_at) ?? 0) <= at && (msOf(r.ends_at) === null || msOf(r.ends_at)! > at) && r.from_user && r.to_user && r.from_user !== r.to_user)
    .map((r) => ({ from: String(r.from_user), to: String(r.to_user) }));
}

/** Who acts for `user` (following delegations up to three steps, never in a circle); `user` when nobody does. */
export function delegateOf(list: readonly Delegation[], user: string): string {
  let at = user;
  const seen = new Set([user]);
  for (let i = 0; i < 3; i++) {
    const d = list.find((x) => x.from === at);
    if (!d || seen.has(d.to)) break;
    seen.add(d.to);
    at = d.to;
  }
  return at;
}

/** The people `user` acts for today (their delegators, directly or through a chain). */
export function delegatorsOf(list: readonly Delegation[], user: string): string[] {
  const out = new Set<string>();
  for (const d of list) if (delegateOf(list, d.from) === user || d.to === user) out.add(d.from);
  out.delete(user);
  return [...out];
}

// ---------------------------------------------------------------------------------------------------------------
// Approver sources

type OwnerSource = (q: Queryable, ctx: Ctx, def: TableDef, row: Row) => Promise<string[]>;
const ownerSources = new Map<string, OwnerSource>();

/**
 * An approver source of a later module (`{ kind: "owner", of: "ci" }` → the owners of the record's CI). Returns an
 * unregister function.
 */
export function registerApproverSource(of: string, fn: OwnerSource): () => void {
  ownerSources.set(of, fn);
  return () => {
    if (ownerSources.get(of) === fn) ownerSources.delete(of);
  };
}

export const approverSources = (): string[] => [...ownerSources.keys()];

/** Of `ids`, the active members of the organisation. */
async function activeMembers(q: Queryable, orgId: string, ids: string[]): Promise<Set<string>> {
  const clean = [...new Set(ids.filter((x) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)))];
  if (!clean.length) return new Set();
  const rows = await q.query<{ user_id: string }>(`select user_id from sm_org_members where org_id = $1 and user_id = any($2::uuid[]) and is_active and deleted_at is null`, [orgId, pgArray(clean)]);
  return new Set(rows.map((r) => r.user_id));
}

/** Members (and leads) of groups, valid now. */
async function groupMembers(q: Queryable, ctx: Ctx, groups: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!groups.length) return out;
  const now = Date.now();
  const rows = await liveRows(q, systemFrom(ctx), "group_member", { and: [{ f: "group_id", op: "in", v: groups }, { f: "kind", op: "in", v: ["member", "lead"] }] }, "t.created_at, t.id");
  for (const r of rows) {
    if ((msOf(r.valid_from) ?? 0) > now || (msOf(r.valid_to) !== null && msOf(r.valid_to)! <= now)) continue;
    out.set(r.group_id, [...(out.get(r.group_id) ?? []), String(r.user_id)]);
  }
  return out;
}

/** The manager of `user` (`depth` 2: the manager's manager): their profile's manager, else their unit's manager. */
export async function managerOf(q: Queryable, ctx: Ctx, user: string, depth = 1): Promise<string | null> {
  const sys = systemFrom(ctx);
  let at = user;
  for (let i = 0; i < depth; i++) {
    const p = (await liveRows(q, sys, "member_profile", eqAll({ user_id: at })))[0];
    let next: string | null = p?.manager_id ?? null;
    let unit: string | null = p?.org_unit_id ?? null;
    for (let hops = 0; !next && unit && hops < 30; hops++) {
      const u = await liveRow(q, sys, "org_unit", unit);
      if (!u) break;
      if (u.manager_id && u.manager_id !== at) next = u.manager_id;
      unit = u.parent_id ?? null;
    }
    if (!next || next === at) return null;
    at = next;
  }
  return at === user ? null : at;
}

/** Fields whose people never approve a record (requester side and assignee), unless the rule allows it. */
function sodFields(def: TableDef): string[] {
  const requester = def.scope.requester ?? (def.scope.own ?? []).filter((n) => n !== "assigned_to");
  return [...new Set([...requester, ...(def.scope.approvalSod ?? []), ...(def.fields.some((f) => f.name === "assigned_to") ? ["assigned_to"] : [])])];
}

function sodUsers(def: TableDef, row: Row): Set<string> {
  const out = new Set<string>();
  for (const n of sodFields(def)) {
    const v = row[n];
    if (Array.isArray(v)) for (const x of v) out.add(String(x));
    else if (typeof v === "string" && v) out.add(v);
  }
  return out;
}

interface Approver {
  user: string;
  group: string | null;
  source: SourceDef["kind"];
  delegatedFrom: string | null;
}

/**
 * The approvers of one level for `row` (deduplicated, separation of duties and delegation applied). `real`: a record of
 * the organisation's own, whose approvers and delegates are never the demo pack's people (see `roundRows`).
 */
async function resolveLevel(q: Queryable, ctx: Ctx, def: TableDef, row: Row, level: LevelDef, opts: { allowSelf: boolean; delegations: Delegation[]; real: boolean }): Promise<Approver[]> {
  const found: { user: string; group: string | null; source: SourceDef["kind"] }[] = [];
  for (const s of level.sources ?? []) {
    if (s.kind === "users") for (const u of s.users ?? []) found.push({ user: u, group: null, source: "users" });
    else if (s.kind === "groups") {
      const m = await groupMembers(q, ctx, s.groups ?? []);
      for (const g of s.groups ?? []) for (const u of m.get(g) ?? []) found.push({ user: u, group: g, source: "groups" });
    } else if (s.kind === "manager") {
      const who = (def.scope.requester ?? []).map((f) => row[f]).find((v) => typeof v === "string" && v);
      const m = who ? await managerOf(q, ctx, who, Number(s.depth) || 1) : null;
      if (m) found.push({ user: m, group: null, source: "manager" });
    } else if (s.kind === "field") {
      const f = def.fields.find((x) => x.name === s.field);
      const v = row[s.field];
      if (f?.type === "user" && typeof v === "string" && v) found.push({ user: v, group: null, source: "field" });
      else if (f?.type === "users" && Array.isArray(v)) for (const u of v) found.push({ user: String(u), group: null, source: "field" });
      else if (f?.type === "group" && typeof v === "string" && v) {
        const m = await groupMembers(q, ctx, [v]);
        for (const u of m.get(v) ?? []) found.push({ user: u, group: v, source: "field" });
      }
    } else if (s.kind === "owner") {
      const fn = ownerSources.get(s.of);
      if (fn) for (const u of await fn(q, ctx, def, row)) found.push({ user: u, group: null, source: "owner" });
    }
  }
  const sod = opts.allowSelf ? new Set<string>() : sodUsers(def, row);
  const people = [...found.map((x) => x.user), ...opts.delegations.map((d) => d.to)];
  const active = await activeMembers(q, ctx.org.id, people);
  const demo = opts.real ? await demoPeople(q, ctx.org.id, people) : new Set<string>();
  const barred = (u: string) => sod.has(u) || demo.has(u.toLowerCase());
  const out: Approver[] = [];
  const seen = new Set<string>();
  for (const x of found) {
    if (!active.has(x.user) || barred(x.user)) continue;
    // an absent approver's delegate is asked instead (unless the delegate may not approve this record)
    const d = delegateOf(opts.delegations, x.user);
    const user = d !== x.user && active.has(d) && !barred(d) ? d : x.user;
    if (seen.has(user)) continue;
    seen.add(user);
    out.push({ user, group: x.group, source: x.source, delegatedFrom: user !== x.user ? x.user : null });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Rounds that settle: the modules' same-transaction reaction (docs/spec/services/sla.md §4)

/** A round of a record's approvals that just settled, in the transaction of the decision, expiry or withdrawal. */
export interface ApprovalSettled {
  tx: Tx;
  /** the system acting in the organisation */
  ctx: Ctx;
  def: TableDef;
  /** the record as it is now (its `approval` field already holds the new aggregate) */
  record: Row;
  /** the rule of the round (null: an ad-hoc request) */
  rule_id: string | null;
  round: number;
  /** `replanned`: a re-run of the record's rules left nothing open (see `aggregate`) */
  outcome: "approved" | "rejected" | "canceled" | "replanned";
  /** the record's approvals altogether (its `approval` field): not_requested / requested / approved / rejected */
  aggregate: string;
  /** who decided or withdrew it (null: an expiry or the system) */
  by: string | null;
}

export type ApprovalSettledFn = (s: ApprovalSettled) => Promise<void> | void;

const settledHooks: { table: string; fn: ApprovalSettledFn }[] = [];

/**
 * React to a round of `table`'s approvals settling — approved, rejected (a decision or an expiry) or canceled
 * (withdrawn) — inside the transaction that settled it ("*": every table). Rounds created settled (auto-approval)
 * and rounds a re-run replaces do not call it: the write that made them sees them — except that a re-run leaving
 * nothing open (every new round auto-approved, or no rule asking any more) settles once as `replanned` with the
 * record's aggregate. A withdrawn round (`canceled`) never counts as an approval. Returns an unregister function.
 */
/**
 * What a settled round means for a record that waits on its approvals as a whole: «approved» when the record's
 * approvals are approved (or nothing asks any more), «rejected» when they are rejected, null while another round is
 * still open or when the round was withdrawn (a withdrawal never approves). A `replanned` settlement is read from the
 * aggregate the same way — never as a rejection.
 */
export function settledVerdict(s: Pick<ApprovalSettled, "outcome" | "aggregate">): "approved" | "rejected" | null {
  if (s.outcome === "canceled") return null;
  if (s.aggregate === "rejected") return "rejected";
  if (s.aggregate === "approved" || s.aggregate === "not_requested") return "approved";
  if (s.outcome === "rejected") return "rejected";
  return null;
}

export function onApprovalSettled(table: string, fn: ApprovalSettledFn): () => void {
  const h = { table, fn };
  settledHooks.push(h);
  return () => {
    const i = settledHooks.indexOf(h);
    if (i >= 0) settledHooks.splice(i, 1);
  };
}

async function fireSettled(s: ApprovalSettled): Promise<void> {
  for (const h of [...settledHooks]) if (h.table === "*" || h.table === s.def.key) await h.fn(s);
}

// ---------------------------------------------------------------------------------------------------------------
// Requesting (on writes)

interface Plan {
  create: Row[];
  update: { id: string; values: Row }[];
  /** rules (ids, "" for ad-hoc) whose timers to schedule */
  timers: boolean;
}

const plans = new WeakMap<Tx, Map<string, Plan>>();
const planKey = (table: string, id: string) => `${table}:${id}`;

interface RuleSpec {
  id: string | null;
  name: string;
  mode: "sequential" | "parallel";
  levels: LevelDef[];
  allowSelf: boolean;
  expireAfter: number | null;
  comment?: string | null;
}

const specOf = (r: Row): RuleSpec => ({
  id: r.id,
  name: String(r.name ?? ""),
  mode: r.mode === "parallel" ? "parallel" : "sequential",
  levels: Array.isArray(r.levels) ? r.levels : [],
  allowSelf: !!r.allow_self_approval,
  expireAfter: Number(r.expire_after) > 0 ? Number(r.expire_after) : null,
});

/**
 * The approval rows of a new round of `spec` for `row` (all levels; later ones wait in sequential mode). `requestedBy`
 * is the person whose write or request asked (null: the system). A rule's level left without approvers asks the
 * requester's manager instead; an ad-hoc request (`managerFallback: false`) names its people and gets no stand-in.
 */
async function roundRows(
  q: Queryable, ctx: Ctx, def: TableDef, row: Row, spec: RuleSpec, round: number, now: number,
  opts: { requestedBy: string | null; managerFallback: boolean },
): Promise<Row[]> {
  const delegations = await activeDelegations(q, ctx, "approvals", now);
  // the demo pack's people approve only the pack's work (docs/DEMO_FA.md): a record of the organisation's own — written
  // outside the demo scope, not a row of the pack — never gets one of them as approver or delegate, whatever names them
  // (a group they were added to, a role a module's source falls back to, a list, a manager)
  const real = !(await demoQuiet(q, ctx.org.id, typeof row.id === "string" ? row.id : null));
  const out: Row[] = [];
  for (let i = 0; i < spec.levels.length; i++) {
    const level = spec.levels[i];
    const active = spec.mode === "parallel" || i === 0;
    const base: Row = {
      table_key: def.key, record_id: String(row.id), rule_id: spec.id, level: i + 1, level_name: level.name ?? null, round,
      rule: (level.rule ?? "any") as ApprovalRule, threshold: level.threshold ?? null, requested_by: opts.requestedBy,
    };
    let approvers = await resolveLevel(q, ctx, def, row, level, { allowSelf: spec.allowSelf, delegations, real });
    if (!approvers.length && opts.managerFallback) {
      // nobody left (no members, or only the record's own people): the requester's manager, else the level is skipped
      const who = (def.scope.requester ?? []).map((f) => row[f]).find((v) => typeof v === "string" && v);
      const m = who ? await managerOf(q, ctx, who) : null;
      if (m && (spec.allowSelf || !sodUsers(def, row).has(m)) && (await activeMembers(q, ctx.org.id, [m])).has(m) && !(real && (await demoPeople(q, ctx.org.id, [m])).size)) {
        approvers = [{ user: m, group: null, source: "manager", delegatedFrom: null }];
      }
    }
    if (!approvers.length) {
      out.push({ ...base, state: "skipped", comments: "تأییدکننده‌ای پیدا نشد (یا فقط افراد خود رکورد بودند)" });
      continue;
    }
    for (const a of approvers) {
      out.push({
        ...base, approver_id: a.user, group_id: a.group, source: a.source, delegated_from: a.delegatedFrom,
        state: active ? "requested" : "waiting",
        requested_at: active ? iso(now) : null,
        due_at: active && spec.expireAfter ? iso(now + spec.expireAfter * 1000) : null,
        comments: spec.comment ?? null,
      });
    }
  }
  return out;
}

/** In sequential mode, a skipped first level hands over to the next one at once. */
function promote(rows: Row[], now: number, expireAfter: number | null): void {
  const levels = [...new Set(rows.map((r) => r.level))].sort((a, b) => a - b);
  for (const l of levels) {
    const xs = rows.filter((r) => r.level === l);
    if (xs.some((r) => OPEN.has(r.state))) {
      for (const r of xs) if (r.state === "waiting") Object.assign(r, { state: "requested", requested_at: iso(now), due_at: expireAfter ? iso(now + expireAfter * 1000) : null });
      return;
    }
  }
}

async function planApprovals(w: WriteArgs): Promise<void> {
  if (w.op === "delete" || ownTable(w.def.key) || w.def.virtual) return;
  const cfg = await config(w.tx, w.ctx);
  const rules = rulesFor(cfg, "approval_rule", w.def.key);
  const model = w.def.states;
  const doneNow = !!model && !!w.prev && w.changed.has(model.field) && DONE_CATEGORIES.includes(stateCategory(model, w.next[model.field])!);
  if (!rules.length && !doneNow) return;
  const sys = systemFrom(w.ctx);
  const existing = w.prev ? await liveRows(w.tx, sys, "approval", eqAll({ table_key: w.def.key, record_id: String(w.next.id) }), "t.round, t.level, t.created_at, t.id") : [];
  const plan: Plan = { create: [], update: [], timers: false };
  const state = new Map(existing.map((r) => [r.id, { ...r }]));
  const now = Date.now();
  if (doneNow) {
    // a record that is resolved, closed or canceled no longer needs its pending approvals
    for (const r of existing) if (OPEN.has(r.state)) {
      plan.update.push({ id: r.id, values: { state: "no_longer_required" } });
      state.get(r.id)!.state = "no_longer_required";
    }
  } else if (rules.length) {
    const schema = await orgSchema(sys, w.tx);
    const env: CondEnv = { ...w.env, prev: w.prev, now };
    const row = await withWalks(w.tx, w.def, w.ctx.org.id, { ...w.next, org_id: w.ctx.org.id }, rules.flatMap((r) => [r.condition, r.auto_approve]), env, schema.lookup);
    const before = w.prev ? await withWalks(w.tx, w.def, w.ctx.org.id, { ...w.prev, org_id: w.ctx.org.id }, rules.map((r) => r.condition), { ...env, prev: w.prev }, schema.lookup) : null;
    for (const r of rules) {
      const nowHolds = holds(r.condition, row, env, w.def, schema.lookup, !w.prev);
      const wasHolding = before ? holds(r.condition, before, { ...env, prev: w.prev }, w.def, schema.lookup, true) : false;
      if (!nowHolds || wasHolding) continue;
      const mine = existing.filter((x) => x.rule_id === r.id);
      if (mine.some((x) => OPEN.has(state.get(x.id)!.state))) continue;
      const round = Math.max(0, ...mine.map((x) => Number(x.round) || 1)) + 1;
      const spec = specOf(r);
      let rows: Row[];
      if (holds(r.auto_approve, row, env, w.def, schema.lookup, false)) {
        rows = [{ table_key: w.def.key, record_id: String(w.next.id), rule_id: r.id, level: 1, round, rule: "any", state: "approved", requested_at: iso(now), requested_by: isSystemCtx(w.ctx) ? null : w.ctx.user.id, decided_at: iso(now), comments: `تأیید خودکار («${spec.name}»)` }];
      } else {
        rows = await roundRows(w.tx, sys, w.def, row, spec, round, now, { requestedBy: isSystemCtx(w.ctx) ? null : w.ctx.user.id, managerFallback: true });
        if (spec.mode === "sequential") promote(rows, now, spec.expireAfter);
      }
      plan.create.push(...rows);
      if (spec.expireAfter || Number(r.remind_every) > 0) plan.timers = true;
    }
  }
  if (!plan.create.length && !plan.update.length) return;
  if (w.def.fields.some((f) => f.name === "approval")) {
    const agg = aggregate([...state.values(), ...plan.create] as never[]);
    if (w.next.approval !== agg) w.next.approval = agg;
  }
  let m = plans.get(w.tx);
  if (!m) plans.set(w.tx, (m = new Map()));
  m.set(planKey(w.def.key, String(w.next.id)), plan);
}

async function applyApprovals(w: WriteArgs & { row: Row }): Promise<void> {
  const m = plans.get(w.tx);
  const key = planKey(w.def.key, String(w.row.id));
  const plan = m?.get(key);
  if (!plan) return;
  m!.delete(key);
  const sys = systemFrom(w.ctx);
  for (const u of plan.update) await updateIn(w.tx, sys, "approval", u.id, u.values, { trusted: true });
  const created: Row[] = [];
  const snap = { record_number: w.def.numbered ? (w.row.number ?? null) : null, record_title: recordTitle(w.row, w.def.display) };
  for (const r of plan.create) created.push(await createIn(w.tx, sys, "approval", { ...r, ...snap }, { trusted: true }));
  await announceRequested(w.tx, sys, w.def, w.row, created.filter((r) => r.state === "requested"));
  if (plan.timers) await scheduleApprovals(w.tx, w.ctx.org.id, w.def.key, String(w.row.id), Date.now() + 1000);
}

/** `record.approval_requested` per (rule, level) of newly requested rows. */
async function announceRequested(tx: Tx, sys: Ctx, def: TableDef, record: Row, rows: Row[], extra: Record<string, unknown> = {}): Promise<void> {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.rule_id ?? ""}:${r.round}:${r.level}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const xs of groups.values()) {
    await emitEvent(tx, sys, {
      kind: "record.approval_requested", table: def.key, id: String(record.id), number: def.numbered ? (record.number ?? null) : null, actor: null,
      data: { rule_id: xs[0].rule_id ?? null, round: xs[0].round, level: xs[0].level, approval_ids: xs.map((x) => x.id), approvers: xs.map((x) => x.approver_id).filter(Boolean), due_at: xs[0].due_at ?? null, ...extra },
    });
  }
}

/** Queue (or bring forward) the reminders/expiry job of a record's approvals. */
async function scheduleApprovals(q: Queryable, orgId: string, table: string, id: string, at: number): Promise<void> {
  const runAt = new Date(Math.max(at, Date.now())).toISOString();
  const jobId = await enqueue(q, { kind: "approval.timer", orgId, payload: { table, id }, runAt, dedupeKey: `approval.timer:${table}:${id}`, maxAttempts: 10 });
  await q.query(`update sm_jobs set run_at = least(run_at, $2::timestamptz), updated_at = now() where id = $1 and status = 'queued'`, [jobId, runAt]);
}

// ---------------------------------------------------------------------------------------------------------------
// Settling a round after a decision, an expiry or a cancellation

/**
 * Bring the round (`ruleId`, `round`) of a record in step with its rows: a decided level withdraws its open rows and
 * opens the next one; a rejected round withdraws everything still open. Then the record's `approval` follows.
 */
async function settle(tx: Tx, sys: Ctx, def: TableDef, record: Row, ruleId: string | null, round: number, by: string | null = null): Promise<{ aggregate: string; opened: Row[] }> {
  const now = Date.now();
  const cfg = await config(tx, sys);
  const rule = ruleId ? cfg.rows.approval_rule.find((r) => r.id === ruleId) : null;
  const expireAfter = rule && Number(rule.expire_after) > 0 ? Number(rule.expire_after) : null;
  const all = await liveRows(tx, sys, "approval", eqAll({ table_key: def.key, record_id: String(record.id) }), "t.round, t.level, t.created_at, t.id");
  const mine = all.filter((r) => (r.rule_id ?? null) === ruleId && Number(r.round) === round);
  const opened: Row[] = [];
  const set = async (r: Row, values: Row) => {
    Object.assign(r, await updateIn(tx, sys, "approval", r.id, values, { trusted: true }));
  };
  if (roundOutcome(mine as never[]) === "rejected") {
    for (const r of mine) if (OPEN.has(r.state)) await set(r, { state: "no_longer_required" });
  } else {
    const levels = [...new Set(mine.map((r) => Number(r.level)))].sort((a, b) => a - b);
    for (const l of levels) {
      const xs = mine.filter((r) => Number(r.level) === l);
      const o = levelOutcome(xs as { state: string }[], xs[0].rule, xs[0].threshold);
      if (o === "approved" || o === "skipped") {
        for (const r of xs) if (OPEN.has(r.state)) await set(r, { state: "no_longer_required" });
        continue;
      }
      if (o === "pending") {
        for (const r of xs) if (r.state === "waiting") {
          await set(r, { state: "requested", requested_at: iso(now), due_at: expireAfter ? iso(now + expireAfter * 1000) : null });
          opened.push(r);
        }
        // parallel levels are all open already; a sequential one waits for this level
        if (!rule || rule.mode !== "parallel") break;
      }
    }
  }
  const agg = aggregate(all as never[]);
  if (def.fields.some((f) => f.name === "approval") && record.approval !== agg) {
    Object.assign(record, await updateIn(tx, sys, def.key, String(record.id), { approval: agg }, { trusted: true }));
  }
  if (opened.length) {
    await announceRequested(tx, sys, def, record, opened);
    if (expireAfter || Number(rule?.remind_every) > 0) await scheduleApprovals(tx, sys.org.id, def.key, String(record.id), now + 1000);
  }
  // the round was open (a decision or an expiry of one of its rows): settled now?
  const outcome = roundOutcome(mine as never[]);
  if (outcome === "approved" || outcome === "rejected") await fireSettled({ tx, ctx: sys, def, record, rule_id: ruleId, round, outcome, aggregate: agg, by });
  return { aggregate: agg, opened };
}

// ---------------------------------------------------------------------------------------------------------------
// Deciding

export interface DecideInput {
  decision: "approved" | "rejected";
  comment?: string | null;
}

/** May `userId` decide approval row `a` now (as its approver or as their delegate)? Returns on whose behalf. */
function actingFor(a: Row, userId: string, delegations: Delegation[]): { ok: boolean; onBehalfOf: string | null } {
  if (a.approver_id === userId) return { ok: true, onBehalfOf: null };
  if (a.approver_id && delegateOf(delegations, String(a.approver_id)) === userId) return { ok: true, onBehalfOf: String(a.approver_id) };
  return { ok: false, onBehalfOf: null };
}

/** Approve or reject one approval (the caller is its approver or an approver's delegate). */
export async function decide(ctx: Ctx, id: string, input: DecideInput): Promise<{ approval: Row; aggregate: string }> {
  if (input.decision !== "approved" && input.decision !== "rejected") throw bad("تصمیم باید «تأیید» یا «رد» باشد");
  const comment = typeof input.comment === "string" ? input.comment.trim().slice(0, 4000) : "";
  if (input.decision === "rejected" && !comment) throw validationError({ comment: "علت رد را بنویسید" });
  const me = ctx.user.id;
  return ctx.write(async (tx) => {
    const sys = systemFrom(ctx);
    const { def: adef } = await defFor(sys, "approval", tx);
    const env = await condEnv(sys);
    // the record first, then the approval — the order the record's own writes, the approval timer and settling take
    // (record, then its approvals): two approvers of one level, or a decision and a write of the record, wait for
    // each other instead of deadlocking; the approval is read again once locked
    const peek = await loadReadable(tx, sys, adef, id, env);
    if (!peek) throw notFound("این تأیید پیدا نشد");
    const schema = await orgSchema(sys, tx);
    const def = schema.def(String(peek.table_key));
    if (!def || def.virtual) throw notFound("رکورد این تأیید پیدا نشد");
    const record = await loadReadable(tx, sys, def, String(peek.record_id), env, { lock: true });
    if (!record) throw notFound("رکورد این تأیید پیدا نشد");
    const a = await loadReadable(tx, sys, adef, id, env, { lock: true });
    if (!a || a.record_id !== peek.record_id || a.table_key !== peek.table_key) throw notFound("این تأیید پیدا نشد");
    const delegations = await activeDelegations(tx, ctx, "approvals");
    const who = actingFor(a, me, delegations);
    if (!who.ok) throw notFound("این تأیید پیدا نشد");
    if (a.state !== "requested") throw new AppError(409, "conflict", a.state === "waiting" ? "نوبت این تأیید هنوز نرسیده است" : "این تأیید پیش‌تر بسته شده است");
    const cfg = await config(tx, sys);
    const rule = a.rule_id ? cfg.rows.approval_rule.find((r) => r.id === a.rule_id) : null;
    if (!rule?.allow_self_approval && sodUsers(def, record).has(me)) {
      throw forbidden("شما درخواست‌دهنده یا کارشناس این رکورد هستید و نمی‌توانید آن را تأیید یا رد کنید");
    }
    const values: Row = { state: input.decision, decided_at: iso(Date.now()), decided_by: me, comments: comment || a.comments || null };
    if (who.onBehalfOf) values.delegated_from = who.onBehalfOf;
    const stored = await updateIn(tx, sys, "approval", id, values, { trusted: true });
    const settled = await settle(tx, sys, def, record, a.rule_id ?? null, Number(a.round) || 1, me);
    if (def.features?.journal) {
      const verb = input.decision === "approved" ? "تأیید کرد" : "رد کرد";
      const body = `${ctx.user.full_name || ctx.user.email} ${verb}${who.onBehalfOf ? " (به جانشینی)" : ""}${comment ? `: ${comment}` : ""}`;
      await addJournalIn(tx, systemFrom(ctx, me), def, record, { kind: "approval", body, data: { approval: id, decision: input.decision, on_behalf_of: who.onBehalfOf } }, { trusted: true, author: me });
    }
    await emitEvent(tx, sys, {
      kind: "record.approval_decided", table: def.key, id: String(record.id), number: def.numbered ? (record.number ?? null) : null, actor: me,
      data: { approval_id: id, rule_id: a.rule_id ?? null, round: a.round, level: a.level, decision: input.decision, by: me, on_behalf_of: who.onBehalfOf, comment: comment || null, outcome: settled.aggregate },
    });
    return { approval: stored, aggregate: settled.aggregate };
  });
}

/** Decide several approvals; each on its own (one failing does not stop the others). */
export async function decideMany(ctx: Ctx, ids: string[], input: DecideInput): Promise<{ done: number; failed: { id: string; message: string }[] }> {
  const failed: { id: string; message: string }[] = [];
  let done = 0;
  for (const id of [...new Set(ids)].slice(0, 200)) {
    try {
      await decide(ctx, id, input);
      done++;
    } catch (e) {
      failed.push({ id, message: e instanceof AppError ? e.message : "انجام نشد" });
    }
  }
  return { done, failed };
}

// ---------------------------------------------------------------------------------------------------------------
// Ad-hoc requests from the record page

export interface RequestInput {
  users?: string[];
  groups?: string[];
  rule?: ApprovalRule;
  threshold?: number | null;
  comment?: string | null;
  /** hours until the request expires (rejected) */
  expire_hours?: number | null;
  /** what is asked (the level's name: a flow step's title) */
  name?: string | null;
}

/** «درخواست تأیید» on a record the caller may change: one level of the people and groups named. */
export async function requestApproval(ctx: Ctx, table: string, id: string, input: RequestInput): Promise<{ approvals: Row[]; aggregate: string; round: number }> {
  const { def } = await defFor(ctx, table);
  requestLevel(def, input);
  return ctx.write((tx) => requestApprovalIn(tx, ctx, def.key, id, input));
}

function requestLevel(def: TableDef, input: RequestInput): LevelDef {
  if (ownTable(def.key) || def.virtual) throw bad("این جدول تأیید ندارد");
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : "";
  const level: LevelDef = { ...(name ? { name } : {}), sources: [], rule: input.rule ?? "any", threshold: input.threshold ?? undefined };
  if (input.users?.length) level.sources.push({ kind: "users", users: input.users });
  if (input.groups?.length) level.sources.push({ kind: "groups", groups: input.groups });
  const problem = levelsProblem([level], (n) => def.fields.find((f) => f.name === n)?.type);
  if (problem) throw validationError({ users: problem });
  return level;
}

/**
 * `requestApproval` inside the caller's write transaction (a flow's «درخواست تأیید» step: its approvals commit with
 * the step). The request is an ad-hoc round (`rule_id` null) of the record; its rows are returned with the round.
 */
export async function requestApprovalIn(tx: Tx, ctx: Ctx, table: string, id: string, input: RequestInput): Promise<{ approvals: Row[]; aggregate: string; round: number }> {
  const { def } = await defFor(ctx, table, tx);
  const level = requestLevel(def, input);
  const env = await condEnv(ctx);
  const record = await requireReadable(ctx, def, id, env, tx, { lock: true });
  if (!isSystemCtx(ctx) && (!access().canWrite(ctx, def, record) || record.$writable === false)) throw forbidden(`اجازهٔ تغییر این ${def.label} را ندارید`);
  const sys = systemFrom(ctx);
  const existing = await liveRows(tx, sys, "approval", eqAll({ table_key: def.key, record_id: id }), "t.round, t.level, t.id");
  const adhoc = existing.filter((r) => !r.rule_id);
  if (adhoc.some((r) => OPEN.has(r.state))) throw new AppError(409, "conflict", "درخواست تأیید پیشین این رکورد هنوز باز است");
  const round = Math.max(0, ...adhoc.map((r) => Number(r.round) || 1)) + 1;
  const now = Date.now();
  const expire = Number(input.expire_hours) > 0 ? Math.round(Number(input.expire_hours) * 3600) : null;
  const spec: RuleSpec = { id: null, name: "درخواست موردی", mode: "sequential", levels: [level], allowSelf: false, expireAfter: expire, comment: input.comment?.trim().slice(0, 4000) || null };
  const requestedBy = actorId(ctx);
  const rows = await roundRows(tx, systemFrom(ctx, requestedBy), def, record, spec, round, now, { requestedBy, managerFallback: false });
  if (rows.every((r) => r.state === "skipped")) throw validationError({ users: "هیچ‌یک از افراد نام‌برده نمی‌توانند این رکورد را تأیید کنند" });
  const snap = { record_number: def.numbered ? (record.number ?? null) : null, record_title: recordTitle(record, def.display) };
  const created: Row[] = [];
  for (const r of rows) created.push(await createIn(tx, sys, "approval", { ...r, ...snap }, { trusted: true }));
  const agg = aggregate([...existing, ...created] as never[]);
  if (def.fields.some((f) => f.name === "approval") && record.approval !== agg) await updateIn(tx, sys, def.key, id, { approval: agg }, { trusted: true });
  await announceRequested(tx, sys, def, record, created.filter((r) => r.state === "requested"), { adhoc: true });
  if (expire) await scheduleApprovals(tx, ctx.org.id, def.key, id, now + expire * 1000);
  return { approvals: created, aggregate: agg, round };
}

export interface CancelOptions {
  /** only this ad-hoc round (the flow that asked for it ended) */
  adhocRound?: number;
  /** `canceled` (default: its people changed their mind) or `no_longer_required` (the record moved on without them) */
  state?: "canceled" | "no_longer_required";
  /** the note on the withdrawn rows */
  comment?: string | null;
}

/**
 * Withdraw the open approvals of a record (its people changed their mind): the round ends as canceled. `adhocRound`
 * withdraws only that ad-hoc round (the flow that asked for it ended). Who may: holders of the area's approve right
 * (every open round), or whoever asked for an ad-hoc round (that round) — never someone who reaches the record only as
 * its requester; a withdrawn round never counts as an approval (`onApprovalSettled`).
 */
export async function cancelApprovals(ctx: Ctx, table: string, id: string, opts: CancelOptions = {}): Promise<{ canceled: number; aggregate: string }> {
  const { def } = await defFor(ctx, table);
  return ctx.write(async (tx) => {
    const env = await condEnv(ctx);
    const record = await requireReadable(ctx, def, id, env, tx, { lock: true });
    if (isSystemCtx(ctx)) return cancelOpen(tx, ctx, def, record, opts);
    const denied = forbidden("پس گرفتن تأییدها با تأییدکنندگان این بخش یا کسی است که آن تأیید را خواسته است");
    if (!access().canWrite(ctx, def, record) || record.$writable === false) throw forbidden(`اجازهٔ تغییر این ${def.label} را ندارید`);
    if (access().writeMode?.(ctx, def, record) === "requester") throw denied;
    if (grantIn(subjectOf(ctx).eff, def.area).approve) return cancelOpen(tx, ctx, def, record, opts);
    // their own ad-hoc request only
    const me = ctx.user.id;
    const asked = (r: Row) => !r.rule_id && r.requested_by === me;
    const open = (await liveRows(tx, systemFrom(ctx), "approval", eqAll({ table_key: def.key, record_id: String(record.id) }), "t.round, t.level, t.id")).filter((r) => OPEN.has(r.state));
    const mine = open.filter((r) => asked(r) && (opts.adhocRound === undefined || Number(r.round) === opts.adhocRound));
    if (!mine.length || open.some((r) => !asked(r) && (opts.adhocRound === undefined || (!r.rule_id && Number(r.round) === opts.adhocRound)))) throw denied;
    return cancelOpen(tx, ctx, def, record, opts);
  });
}

export interface RerunOptions {
  /** why the record's approvals are asked again (the comment of the new rows: «پاسخ‌ها تغییر کرد») */
  comment?: string | null;
  /** also ask again the rules whose latest round was already decided */
  decided?: boolean;
}

/**
 * Plan a record's approvals again after what they depend on changed (a requested item's answers): every open round
 * is withdrawn (`canceled`, with the comment) and each active rule of the table whose condition holds now starts a
 * new round — auto-approval included; a rule whose condition no longer holds just loses its open round. Rules whose
 * latest round is decided are left alone unless `decided`. Replaced rounds do not call `onApprovalSettled`; the new
 * ones settle later. Returns what was withdrawn and started and the record's aggregate.
 */
export async function rerunApprovalRules(ctx: Ctx, table: string, id: string, opts: RerunOptions = {}): Promise<{ canceled: number; started: number; aggregate: string }> {
  const { def } = await defFor(ctx, table);
  return ctx.write((tx) => rerunApprovalRulesIn(tx, ctx, def.key, id, opts));
}

/** `rerunApprovalRules` inside the caller's write transaction. */
export async function rerunApprovalRulesIn(tx: Tx, ctx: Ctx, table: string, id: string, opts: RerunOptions = {}): Promise<{ canceled: number; started: number; aggregate: string }> {
  const { def } = await defFor(ctx, table, tx);
  if (ownTable(def.key) || def.virtual) throw bad("این جدول تأیید ندارد");
  const env = await condEnv(ctx);
  const record = await requireReadable(ctx, def, id, env, tx, { lock: true });
  if (!isSystemCtx(ctx) && (!access().canWrite(ctx, def, record) || record.$writable === false)) throw forbidden(`اجازهٔ تغییر این ${def.label} را ندارید`);
  const sys = systemFrom(ctx);
  const cfg = await config(tx, sys);
  const rules = rulesFor(cfg, "approval_rule", def.key);
  const existing = await liveRows(tx, sys, "approval", eqAll({ table_key: def.key, record_id: id }), "t.round, t.level, t.created_at, t.id");
  const schema = await orgSchema(sys, tx);
  const now = Date.now();
  const renv: CondEnv = { ...env, now };
  const row = await withWalks(tx, def, ctx.org.id, { ...record, org_id: ctx.org.id }, rules.flatMap((r) => [r.condition, r.auto_approve]), renv, schema.lookup);
  const comment = opts.comment ? String(opts.comment).trim().slice(0, 4000) || null : null;
  const requestedBy = actorId(ctx);
  let canceled = 0;
  const created: Row[] = [];
  let timers = false;
  const withdraw = async (r: Row) => {
    await updateIn(tx, sys, "approval", r.id, { state: "canceled", decided_at: iso(now), decided_by: requestedBy, comments: comment ?? "تأیید دوباره خواسته شد" }, { trusted: true });
    r.state = "canceled";
    canceled++;
  };
  for (const r of rules) {
    const mine = existing.filter((x) => x.rule_id === r.id);
    const latest = Math.max(0, ...mine.map((x) => Number(x.round) || 1));
    const open = mine.filter((x) => OPEN.has(x.state));
    const decidedLatest = !open.length && mine.some((x) => (Number(x.round) || 1) === latest);
    for (const x of open) await withdraw(x);
    if (!holds(r.condition, row, renv, def, schema.lookup, true)) continue;
    if (decidedLatest && !opts.decided) continue;
    const round = latest + 1;
    const spec = specOf(r);
    let rows: Row[];
    if (holds(r.auto_approve, row, renv, def, schema.lookup, false)) {
      rows = [{ table_key: def.key, record_id: id, rule_id: r.id, level: 1, round, rule: "any", state: "approved", requested_at: iso(now), requested_by: requestedBy, decided_at: iso(now), comments: `تأیید خودکار («${spec.name}»)` }];
    } else {
      rows = await roundRows(tx, sys, def, row, { ...spec, comment: comment ?? spec.comment }, round, now, { requestedBy, managerFallback: true });
      if (spec.mode === "sequential") promote(rows, now, spec.expireAfter);
    }
    const snap = { record_number: def.numbered ? (record.number ?? null) : null, record_title: recordTitle(record, def.display) };
    for (const x of rows) created.push(await createIn(tx, sys, "approval", { ...x, ...snap }, { trusted: true }));
    if (spec.expireAfter || Number(r.remind_every) > 0) timers = true;
  }
  // ad-hoc rounds still open are withdrawn too (they were asked about what changed)
  for (const x of existing) if (!x.rule_id && OPEN.has(x.state)) await withdraw(x);
  const agg = aggregate([...existing, ...created] as never[]);
  let fresh = record;
  if (def.fields.some((f) => f.name === "approval") && record.approval !== agg) fresh = await updateIn(tx, sys, def.key, id, { approval: agg }, { trusted: true });
  await announceRequested(tx, sys, def, record, created.filter((x) => x.state === "requested"), { rerun: true });
  if (timers) await scheduleApprovals(tx, ctx.org.id, def.key, id, now + 1000);
  // what was waiting was withdrawn and nothing is open now (auto-approved, or no rule asks any more): the record moves
  // on as after any settled round — it never stays waiting with nothing to decide
  if (canceled && ![...existing, ...created].some((x) => OPEN.has(x.state))) {
    const last = created[created.length - 1] ?? null;
    await fireSettled({ tx, ctx: sys, def, record: fresh, rule_id: (last?.rule_id as string) ?? null, round: Number(last?.round) || 0, outcome: "replanned", aggregate: agg, by: requestedBy });
  }
  return { canceled, started: created.length, aggregate: agg };
}

/**
 * The same inside `tx`, for server code that already decided the record leaves what its approvals were for (a
 * knowledge version back to draft, a change leaving authorization): no access check. Every round that loses its open
 * rows settles as `opts.state` (`onApprovalSettled`).
 */
export async function cancelApprovalsIn(tx: Tx, ctx: Ctx, table: string, id: string, opts: CancelOptions = {}): Promise<{ canceled: number; aggregate: string }> {
  const sys = systemFrom(ctx);
  const { def } = await defFor(sys, table, tx);
  const record = await requireReadable(sys, def, id, await condEnv(sys), tx, { lock: true });
  return cancelOpen(tx, ctx, def, record, opts);
}

async function cancelOpen(tx: Tx, ctx: Ctx, def: TableDef, record: Row, opts: CancelOptions): Promise<{ canceled: number; aggregate: string }> {
  const id = String(record.id);
  const sys = systemFrom(ctx);
  const rows = await liveRows(tx, sys, "approval", eqAll({ table_key: def.key, record_id: id }), "t.round, t.level, t.id");
  const mine = (r: Row) => opts.adhocRound === undefined || (!r.rule_id && Number(r.round) === opts.adhocRound);
  const state = opts.state ?? "canceled";
  const rounds = new Map<string, { rule: string | null; round: number }>();
  let canceled = 0;
  for (const r of rows) if (OPEN.has(r.state) && mine(r)) {
    const values: Row = { state, decided_at: iso(Date.now()), decided_by: actorId(ctx) };
    if (opts.comment) values.comments = String(opts.comment).slice(0, 4000);
    await updateIn(tx, sys, "approval", r.id, values, { trusted: true });
    r.state = state;
    rounds.set(`${r.rule_id ?? ""}:${r.round}`, { rule: (r.rule_id as string) ?? null, round: Number(r.round) || 1 });
    canceled++;
  }
  const agg = aggregate(rows as never[]);
  let fresh = record;
  if (def.fields.some((f) => f.name === "approval") && record.approval !== agg) fresh = await updateIn(tx, sys, def.key, id, { approval: agg }, { trusted: true });
  for (const r of rounds.values()) await fireSettled({ tx, ctx: sys, def, record: fresh, rule_id: r.rule, round: r.round, outcome: "canceled", aggregate: agg, by: actorId(ctx) });
  return { canceled, aggregate: agg };
}

// ---------------------------------------------------------------------------------------------------------------
// Reading: «تأییدهای من» and the record's panel

export interface ApprovalView extends Row {
  table_label: string;
  rule_name: string | null;
  on_behalf_of: string | null;
  can_decide: boolean;
}

function viewOf(r: Row, ruleNames: Map<string, string>, me: string, delegations: Delegation[]): ApprovalView {
  const who = actingFor(r, me, delegations);
  const t = tableDef(String(r.table_key));
  return {
    ...r,
    table_label: t?.label ?? String(r.table_key),
    rule_name: r.rule_id ? ruleNames.get(r.rule_id) ?? null : "درخواست موردی",
    on_behalf_of: who.onBehalfOf,
    can_decide: r.state === "requested" && who.ok,
  };
}

async function displayOf(ctx: Ctx, rows: Row[]): Promise<Record<string, string>> {
  const { schema } = await defFor(ctx, "approval");
  const env = await condEnv(ctx);
  const refs = new RefSet();
  for (const r of rows) for (const k of ["approver_id", "decided_by", "delegated_from", "requested_by"]) refs.add("user", r[k]);
  for (const r of rows) refs.add("group", r.group_id);
  return resolveDisplay(ctx.db, ctx, env, schema, refs);
}

/** How many approvals wait for the caller (also as a delegate): the nav count of «تأییدهای من». */
export async function myApprovalCount(ctx: Ctx): Promise<number> {
  const delegations = await activeDelegations(ctx.db, ctx, "approvals");
  const who = [ctx.user.id, ...delegatorsOf(delegations, ctx.user.id)];
  const rows = await liveRows(ctx.db, systemFrom(ctx), "approval", { and: [{ f: "state", op: "eq", v: "requested" }, { f: "approver_id", op: "in", v: who }] }, "t.id limit 1000");
  return rows.length;
}

/** The caller's approvals: waiting for them (also as a delegate), or decided by them. */
export async function myApprovals(ctx: Ctx, opts: { scope?: "pending" | "decided"; limit?: number } = {}): Promise<{ approvals: ApprovalView[]; display: Record<string, string>; delegators: string[] }> {
  const sys = systemFrom(ctx);
  const me = ctx.user.id;
  const delegations = await activeDelegations(ctx.db, ctx, "approvals");
  const delegators = delegatorsOf(delegations, me);
  const cfg = await config(ctx.db, ctx);
  const names = new Map(cfg.rows.approval_rule.map((r) => [String(r.id), String(r.name)]));
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const rows = opts.scope === "decided"
    ? await liveRows(ctx.db, sys, "approval", eqAll({ decided_by: me }), `t.decided_at desc nulls last, t.id limit ${limit}`)
    : await liveRows(ctx.db, sys, "approval", { and: [{ f: "state", op: "eq", v: "requested" }, { f: "approver_id", op: "in", v: [me, ...delegators] }] }, `t.due_at nulls last, t.requested_at, t.id limit ${limit}`);
  return { approvals: rows.map((r) => viewOf(r, names, me, delegations)), display: await displayOf(ctx, rows), delegators };
}

/** Every approval of a record the caller may read, newest round first. */
export async function recordApprovals(ctx: Ctx, table: string, id: string): Promise<{ approvals: ApprovalView[]; display: Record<string, string>; aggregate: string; can_request: boolean }> {
  const { def } = await defFor(ctx, table);
  const env = await condEnv(ctx);
  const record = await requireReadable(ctx, def, id, env);
  const sys = systemFrom(ctx);
  const rows = await liveRows(ctx.db, sys, "approval", eqAll({ table_key: def.key, record_id: id }), "t.round desc, t.level, t.created_at, t.id");
  const delegations = await activeDelegations(ctx.db, ctx, "approvals");
  const cfg = await config(ctx.db, ctx);
  const names = new Map(cfg.rows.approval_rule.map((r) => [String(r.id), String(r.name)]));
  const canWrite = isSystemCtx(ctx) || (access().canWrite(ctx, def, record) && record.$writable !== false);
  return { approvals: rows.map((r) => viewOf(r, names, ctx.user.id, delegations)), display: await displayOf(ctx, rows), aggregate: aggregate(rows as never[]), can_request: canWrite && !ownTable(def.key) };
}

// ---------------------------------------------------------------------------------------------------------------
// Reminders and expiry (job)

async function approvalTimer(sys: Ctx, table: string, id: string): Promise<number | null> {
  return sys.write(async (tx) => {
    const schema = await orgSchema(sys, tx);
    const def = schema.def(table);
    if (!def || def.virtual) return null;
    const env = await condEnv(sys);
    const record = await loadReadable(tx, sys, def, id, env, { lock: true });
    if (!record) return null;
    const cfg = await config(tx, sys);
    const rows = await liveRows(tx, sys, "approval", eqAll({ table_key: table, record_id: id }), "t.round, t.level, t.id");
    const now = Date.now();
    let next: number | null = null;
    const later = (t: number) => (next = next === null ? t : Math.min(next, t));
    const toSettle = new Map<string, { rule: string | null; round: number }>();
    const reminded: Row[] = [];
    for (const r of rows) {
      if (r.state !== "requested") continue;
      const rule = r.rule_id ? cfg.rows.approval_rule.find((x) => x.id === r.rule_id) : null;
      const due = msOf(r.due_at);
      if (due !== null && due <= now) {
        const action = rule?.expire_action ?? "reject";
        const state = action === "approve" ? "approved" : action === "cancel" ? "canceled" : "rejected";
        await updateIn(tx, sys, "approval", r.id, { state, decided_at: iso(now), comments: "مهلت تأیید به پایان رسید" }, { trusted: true });
        toSettle.set(`${r.rule_id ?? ""}:${r.round}`, { rule: r.rule_id ?? null, round: Number(r.round) || 1 });
        continue;
      }
      if (due !== null) later(due);
      const every = Number(rule?.remind_every) > 0 ? Number(rule!.remind_every) * 1000 : 0;
      if (every) {
        const last = msOf(r.reminded_at) ?? msOf(r.requested_at) ?? now;
        if (last + every <= now) {
          await updateIn(tx, sys, "approval", r.id, { reminded_at: iso(now) }, { trusted: true, keepVersion: true });
          reminded.push(r);
          later(now + every);
        } else later(last + every);
      }
    }
    if (reminded.length) await announceRequested(tx, sys, def, record, reminded, { reminder: true });
    for (const s of toSettle.values()) {
      const out = await settle(tx, sys, def, record, s.rule, s.round);
      await emitEvent(tx, sys, {
        kind: "record.approval_decided", table: def.key, id, number: def.numbered ? (record.number ?? null) : null, actor: null,
        data: { rule_id: s.rule, round: s.round, decision: "expired", by: null, outcome: out.aggregate },
      });
      for (const o of out.opened) if (o.due_at) later(msOf(o.due_at)!);
    }
    return next;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Installation

/**
 * Members who named `u` (a SQL uuid expression) their delegate for approvals in the organisation `org` (a SQL uuid
 * expression), in force now — a delegation of another organisation never counts.
 */
const delegatorsSql = (u: string, org: string) =>
  `select d.from_user from sm_delegations d where d.to_user = ${u} and d.org_id = ${org} and d.active and d.deleted_at is null
     and d.starts_at <= now() and (d.ends_at is null or d.ends_at > now()) and d.scopes ? 'approvals'`;

/** Hooks, the participant source and the job of approvals; `plan` runs after the other rules (installed late). */
export function installApprovals(): { apply: () => void; plan: () => void; rest: () => void } {
  return {
    apply: () => void registerHooks("*", { afterWrite: (w) => applyApprovals(w) }),
    plan: () => void registerHooks("*", { beforeWrite: (w) => planApprovals(w) }),
    rest: () => {
      // approval and timer rows are the engine's own: nobody writes them through the API
      registerHooks("approval", {
        beforeWrite(w) {
          if (!isSystemCtx(w.ctx)) throw forbidden("تأییدها فقط از «تأییدهای من» یا صفحهٔ رکورد ثبت می‌شوند");
        },
      });
      registerHooks("task_sla", {
        beforeWrite(w) {
          if (!isSystemCtx(w.ctx)) throw forbidden("زمان‌سنج‌های توافق را فقط سامانه می‌نویسد");
        },
      });
      registerHooks("approval_rule", {
        beforeWrite(w) {
          if (w.op === "delete") return;
          const t = tableDef(String(w.next.table_key ?? ""));
          if (!t || t.virtual) throw validationError({ table_key: `جدول «${String(w.next.table_key ?? "")}» وجود ندارد` });
          if (ownTable(t.key)) throw validationError({ table_key: "برای این جدول قاعدهٔ تأیید تعریف نمی‌شود" });
          const p = levelsProblem(w.next.levels, (n) => t.fields.find((f) => f.name === n)?.type, approverSources());
          if (p) throw validationError({ levels: p });
        },
      });
      registerHooks("delegation", {
        beforeWrite(w) {
          if (w.op === "delete") return;
          const fields: Record<string, string> = {};
          if (w.next.to_user && w.next.to_user === w.next.from_user) fields.to_user = "جانشین باید کس دیگری باشد";
          const s = msOf(w.next.starts_at);
          const e = msOf(w.next.ends_at);
          if (s !== null && e !== null && e <= s) fields.ends_at = "پایان جانشینی باید پس از آغاز آن باشد";
          if (Object.keys(fields).length) throw validationError(fields);
        },
        // the grant of a delegation starts and ends with time, when nothing is written: the scope epochs of both
        // members move then too (a write moves them at once — trigger sm_access_delegations)
        async afterWrite(w) {
          if (w.op === "delete" || !w.row) return;
          const users = [w.row.from_user, w.row.to_user].filter((x): x is string => typeof x === "string");
          for (const at of [msOf(w.row.starts_at), msOf(w.row.ends_at)]) {
            if (at === null || at <= Date.now()) continue;
            await enqueue(w.tx, { kind: "approval.delegation_epoch", orgId: w.ctx.org.id, payload: { users, at }, delayMs: at - Date.now() + 1000, dedupeKey: `delegation_epoch:${String(w.row.id)}:${at}` });
          }
        },
      });
      // the approver grant: whoever has or had an approval on a record reads it (the approver, the person they stood
      // in for, whoever decided it, and the delegate of an open one) — even without any role in its area
      registerParticipantSource({
        name: "approvals",
        reach: "grant",
        sql(def, alias, params, userId) {
          if (def.virtual || ownTable(def.key) || !def.fields.some((f) => f.name === "approval")) return null;
          params.push(def.key);
          const k = `$${params.length}`;
          params.push(userId);
          const u = `$${params.length}::uuid`;
          return `${alias}.id = any(array(select a.record_id::uuid from sm_approvals a where a.table_key = ${k} and a.deleted_at is null and a.state <> 'skipped'
            and (a.approver_id = ${u} or a.delegated_from = ${u} or a.decided_by = ${u}
              or (a.state in ('requested', 'waiting') and a.approver_id in (${delegatorsSql(u, "a.org_id")})))))`;
        },
        async tables(q, orgId, userId) {
          const rows = await q.query<{ table_key: string }>(
            `select distinct a.table_key from sm_approvals a where a.org_id = $1 and a.deleted_at is null and a.state <> 'skipped'
              and (a.approver_id = $2::uuid or a.delegated_from = $2::uuid or a.decided_by = $2::uuid
                or (a.state in ('requested', 'waiting') and a.approver_id in (${delegatorsSql("$2::uuid", "$1::uuid")})))`,
            [orgId, userId],
          );
          return rows.map((r) => r.table_key);
        },
      });
      registerJobHandler("approval.delegation_epoch", async (job, jctx) => {
        if (!job.org_id) return;
        for (const u of Array.isArray(job.payload?.users) ? (job.payload.users as unknown[]) : []) {
          if (typeof u === "string" && /^[0-9a-f-]{36}$/i.test(u)) await bumpScopeEpoch(jctx.cfg.db, job.org_id, u);
        }
      });
      registerJobHandler("approval.timer", async (job, jctx) => {
        if (!job.org_id || !job.payload?.table || !job.payload?.id) return;
        const sys = await systemCtx(jctx.cfg, job.org_id);
        const next = await approvalTimer(sys, String(job.payload.table), String(job.payload.id));
        if (next !== null) return { again: Math.max(1000, next - Date.now()) };
      });
    },
  };
}
