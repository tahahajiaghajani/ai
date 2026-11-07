// Rules of records (docs/spec/services/sla.md §5), applied by engine hooks on every write path (API, imports, flows,
// jobs; on a Windows app for its own writes — a sync push is only validated, see policies.ts):
//
//   priority matrix   impact × urgency → priority, on create and whenever impact or urgency changes
//   categories        the tree of a table → its «دسته»/«زیردسته» choice lists (kept in step), the default group of a
//                     category fills an empty assignment group; a category of another workspace is refused
//   business rules    before save: set values, watchers, abort with a message; after save: set values (a new write),
//                     work notes, watchers, related records, abort — in order, at most three nested levels
//   assignment rules  an unassigned record → a group and a person: fixed, round robin (least recently assigned),
//                     least loaded (fewest open records), skills (the members' profile skills), on call (a module's hook)
import type { CondEnv } from "@shared/model/conditions";
import type { TableDef } from "@shared/model/types";
import { OPEN_CATEGORIES } from "@shared/model/types";
import { stateCategory } from "@shared/model/task";
import { todayISO } from "@shared/jalali";
import { actionsProblem, fillTemplate, ITIL_MATRIX, matrixProblem, priorityFrom, type RuleAction } from "@shared/sla/rules";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { pgArray } from "../../db";
import { AppError } from "../../http/errors";
import {
  addJournalIn, createIn, isSystemCtx, orgSchema, orgTz, registerHooks, updateIn, validationError, type WriteArgs,
} from "../../engine";
import { activeDelegations, delegateOf } from "./approvals";
import { config, eqAll, holds, liveRow, liveRows, ownTable, rulesFor, systemFrom, withWalks, type Row, type ServiceConfig } from "./common";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const has = (def: TableDef, name: string) => def.fields.some((f) => f.name === name);
const tableProblem = (key: unknown): string | null => {
  const t = tableDef(String(key ?? ""));
  if (!t || t.virtual) return `جدول «${String(key ?? "")}» وجود ندارد`;
  if (ownTable(t.key)) return "این جدول قاعده نمی‌پذیرد";
  return null;
};

// ---------------------------------------------------------------------------------------------------------------
// Priority matrix

const defaults = new Map<string, Record<string, Record<string, string>>>();

/** A table whose priority follows the ITIL matrix (or `cells`) until the organisation defines its own. */
export function registerPriorityDefault(table: string, cells: Record<string, Record<string, string>> = ITIL_MATRIX): () => void {
  defaults.set(table, cells);
  return () => {
    if (defaults.get(table) === cells) defaults.delete(table);
  };
}

interface Matrix {
  impact: string;
  urgency: string;
  priority: string;
  cells: unknown;
}

function matrixOf(cfg: ServiceConfig, def: TableDef): Matrix | null {
  const row = cfg.rows.priority_matrix.find((r) => r.table_key === def.key);
  if (row) {
    if (row.active === false) return null;
    return { impact: row.impact_field || "impact", urgency: row.urgency_field || "urgency", priority: row.priority_field || "priority", cells: row.cells };
  }
  const d = defaults.get(def.key);
  return d ? { impact: "impact", urgency: "urgency", priority: "priority", cells: d } : null;
}

/** Set the priority from the matrix when impact or urgency changed (or on create). */
function applyMatrix(m: Matrix | null, w: WriteArgs, changed: (n: string) => boolean): void {
  if (!m || !has(w.def, m.impact) || !has(w.def, m.urgency) || !has(w.def, m.priority)) return;
  if (w.op !== "create" && !changed(m.impact) && !changed(m.urgency)) return;
  const p = priorityFrom(m.cells, w.next[m.impact], w.next[m.urgency]);
  if (p !== undefined && w.next[m.priority] !== p) w.next[m.priority] = p;
}

// ---------------------------------------------------------------------------------------------------------------
// Categories

function categoryRows(cfg: ServiceConfig, table: string): Row[] {
  return rulesFor(cfg, "category", table);
}

/** The category rows of `value` for the record's workspace (its own first, then those of every workspace). */
function categoryMatch(rows: Row[], value: unknown, workspace: unknown): Row | null {
  if (value === null || value === undefined || value === "") return null;
  const xs = rows.filter((r) => r.value === value);
  return xs.find((r) => r.workspace_id && r.workspace_id === workspace) ?? xs.find((r) => !r.workspace_id) ?? null;
}

function applyCategories(cfg: ServiceConfig, w: WriteArgs): void {
  if (!has(w.def, "category")) return;
  const rows = categoryRows(cfg, w.def.key);
  if (!rows.length) return;
  const touched = w.op === "create" || w.changed.has("category") || w.changed.has("subcategory") || w.changed.has("workspace_id");
  if (!touched) return;
  const fields: Record<string, string> = {};
  for (const name of ["category", "subcategory"]) {
    const v = w.next[name];
    if (v === null || v === undefined || v === "") continue;
    const xs = rows.filter((r) => r.value === v);
    if (xs.length && !categoryMatch(rows, v, w.next.workspace_id)) fields[name] = `«${xs[0].name}» برای این فضای کاری تعریف نشده است`;
  }
  if (Object.keys(fields).length) throw validationError(fields);
  const group = w.def.scope.group;
  if (!group || !has(w.def, group) || w.next[group]) return;
  const sub = categoryMatch(rows, w.next.subcategory, w.next.workspace_id);
  const cat = categoryMatch(rows, w.next.category, w.next.workspace_id);
  const g = sub?.default_group_id ?? cat?.default_group_id ?? null;
  if (g) w.next[group] = g;
}

/** Keep the `<table>.category` / `<table>.subcategory` choice rows in step with a category row. */
async function mirrorCategory(w: WriteArgs & { row: Row }): Promise<void> {
  const sys = systemFrom(w.ctx);
  const row = w.row;
  const table = String(row.table_key);
  const listOf = (r: Row) => (r.parent_id ? `${table}.subcategory` : `${table}.category`);
  const parentValue = async (r: Row) => {
    if (!r.parent_id) return null;
    const p = await liveRow(w.tx, sys, "category", r.parent_id);
    return p ? String(p.value) : null;
  };
  const choiceRow = async (list: string, value: string) => (await liveRows(w.tx, sys, "choice", eqAll({ list, value })))[0] ?? null;
  // what the previous version of the row offered goes inactive (records keep their value)
  if (w.prev && (w.prev.value !== row.value || !!w.prev.parent_id !== !!row.parent_id || w.prev.table_key !== row.table_key || w.op === "delete")) {
    const old = await choiceRow(w.prev.parent_id ? `${w.prev.table_key}.subcategory` : `${w.prev.table_key}.category`, String(w.prev.value));
    if (old && old.active !== false) await updateIn(w.tx, sys, "choice", old.id, { active: false }, { trusted: true });
  }
  if (w.op === "delete") return;
  const values = { label: row.name, parent: await parentValue(row), sort_order: row.sort_order ?? null, active: row.active !== false };
  const list = listOf(row);
  const found = await choiceRow(list, String(row.value));
  if (found) await updateIn(w.tx, sys, "choice", found.id, values, { trusted: true });
  else await createIn(w.tx, sys, "choice", { list, value: row.value, ...values }, { trusted: true });
  // a renamed or moved parent: its children's options name it as their parent
  if (w.prev && w.prev.value !== row.value && !row.parent_id) {
    for (const child of await liveRows(w.tx, sys, "category", eqAll({ parent_id: row.id }))) {
      const c = await choiceRow(`${table}.subcategory`, String(child.value));
      if (c) await updateIn(w.tx, sys, "choice", c.id, { parent: row.value }, { trusted: true });
    }
  }
}

async function checkCategory(w: WriteArgs): Promise<void> {
  const sys = systemFrom(w.ctx);
  if (w.op === "delete") {
    const kids = await liveRows(w.tx, sys, "category", eqAll({ parent_id: String(w.prev!.id) }));
    if (kids.length) throw new AppError(409, "conflict", "این دسته زیردسته دارد؛ نخست زیردسته‌ها را حذف یا جابه‌جا کنید");
    return;
  }
  const fields: Record<string, string> = {};
  const tp = tableProblem(w.next.table_key);
  const t = tableDef(String(w.next.table_key ?? ""));
  if (tp) fields.table_key = tp;
  else if (!t?.fields.some((f) => f.name === "category" && f.type === "choice")) fields.table_key = "این جدول فیلد «دسته» ندارد";
  if (!/^[a-z0-9][a-z0-9_.-]{0,79}$/i.test(String(w.next.value ?? ""))) fields.value = "کد فقط حروف لاتین، رقم و _ . - دارد";
  if (w.next.parent_id) {
    if (w.next.parent_id === w.next.id) fields.parent_id = "دسته نمی‌تواند زیرمجموعهٔ خودش باشد";
    else {
      const p = await liveRow(w.tx, sys, "category", w.next.parent_id);
      if (!p || p.table_key !== w.next.table_key) fields.parent_id = "دستهٔ بالادستی از همین جدول نیست";
      else if (p.parent_id) fields.parent_id = "دسته‌ها حداکثر دو سطح دارند (دسته و زیردسته)";
      else if (w.prev) {
        const kids = await liveRows(w.tx, sys, "category", eqAll({ parent_id: String(w.next.id) }));
        if (kids.length) fields.parent_id = "دسته‌ای که زیردسته دارد خودش زیردسته نمی‌شود";
      }
    }
  }
  if (Object.keys(fields).length) throw validationError(fields);
}

// ---------------------------------------------------------------------------------------------------------------
// Business rules

function eventMatches(r: Row, w: WriteArgs): boolean {
  const events: string[] = Array.isArray(r.events) ? r.events : [];
  if (w.op === "create") return events.includes("insert");
  if (w.op === "delete") return false;
  const state = w.def.states?.field;
  if (events.includes("update")) return true;
  return events.includes("state_change") && !!state && w.changed.has(state);
}

function setValue(a: Extract<RuleAction, { type: "set" }>, w: WriteArgs, row: Row): unknown {
  if (a.token === "$now") return new Date().toISOString();
  if (a.token === "$today") return todayISO(orgTz(w.ctx));
  if (a.token === "$me") return isSystemCtx(w.ctx) && w.ctx.user.id === "00000000-0000-0000-0000-000000000000" ? null : w.ctx.user.id;
  if (a.token === "$empty") return null;
  if (a.from) return row[a.from] ?? null;
  return fillTemplate(a.value ?? null, row);
}

function watchers(w: WriteArgs, row: Row, a: Extract<RuleAction, { type: "watcher" }>, current: unknown): string[] | null {
  const field = w.def.scope.watchers ?? (has(w.def, "watch_list") ? "watch_list" : null);
  if (!field) return null;
  const people = new Set<string>((a.users ?? []).filter((u) => UUID.test(u)));
  if (a.field) {
    const v = row[a.field];
    for (const u of Array.isArray(v) ? v : [v]) if (typeof u === "string" && UUID.test(u)) people.add(u);
  }
  const list = new Set<string>(Array.isArray(current) ? current.map(String) : []);
  for (const u of people) a.op === "add" ? list.add(u) : list.delete(u);
  return [...list];
}

/** Deferred actions of rules that ran before the save (work notes, related records) — run after it. */
const deferred = new WeakMap<Tx, Map<string, { rule: Row; actions: RuleAction[] }[]>>();
const depth = new WeakMap<Tx, number>();
/** Nested writes caused by rules that run after a save (beyond this, rules wait for the next person's write). */
export const MAX_RULE_DEPTH = 3;

async function beforeRules(cfg: ServiceConfig, w: WriteArgs, matrix: Matrix | null): Promise<void> {
  const rules = rulesFor(cfg, "business_rule", w.def.key).filter((r) => r.timing !== "after" && eventMatches(r, w));
  if (!rules.length) return;
  const schema = await orgSchema(systemFrom(w.ctx), w.tx);
  const env: CondEnv = { ...w.env, prev: w.prev };
  const set = new Set<string>();
  for (const r of rules) {
    const row = await withWalks(w.tx, w.def, w.ctx.org.id, { ...w.next, org_id: w.ctx.org.id }, [r.condition], env, schema.lookup);
    if (!holds(r.condition, row, env, w.def, schema.lookup, true)) continue;
    const later: RuleAction[] = [];
    for (const a of (Array.isArray(r.actions) ? r.actions : []) as RuleAction[]) {
      if (a.type === "abort") throw new AppError(400, "rule", a.message);
      if (a.type === "set" && has(w.def, a.field)) {
        w.next[a.field] = setValue(a, w, row);
        set.add(a.field);
      } else if (a.type === "watcher") {
        const list = watchers(w, row, a, w.next[w.def.scope.watchers ?? "watch_list"]);
        if (list) w.next[w.def.scope.watchers ?? "watch_list"] = list;
      } else if (a.type === "work_note" || a.type === "create") later.push(a);
    }
    if (later.length) {
      let m = deferred.get(w.tx);
      if (!m) deferred.set(w.tx, (m = new Map()));
      const key = `${w.def.key}:${w.next.id}`;
      m.set(key, [...(m.get(key) ?? []), { rule: r, actions: later }]);
    }
  }
  // a rule that set impact or urgency: the matrix answers again
  if (set.size) applyMatrix(matrix, w, (n) => set.has(n));
}

async function runLater(w: WriteArgs & { row: Row }, rule: Row, actions: RuleAction[], row: Row): Promise<void> {
  const sys = systemFrom(w.ctx, isSystemCtx(w.ctx) ? null : w.ctx.user.id);
  const values: Row = {};
  for (const a of actions) {
    if (a.type === "abort") throw new AppError(400, "rule", a.message);
    if (a.type === "set" && has(w.def, a.field)) values[a.field] = setValue(a, w, row);
    else if (a.type === "watcher") {
      const field = w.def.scope.watchers ?? "watch_list";
      const list = watchers(w, row, a, values[field] ?? row[field]);
      if (list) values[field] = list;
    } else if (a.type === "work_note" && w.def.features?.journal) {
      await addJournalIn(w.tx, sys, w.def, row, { kind: "work_note", body: String(fillTemplate(a.body, row) ?? ""), data: { business_rule: rule.id } }, { trusted: true });
    } else if (a.type === "create") {
      const data: Row = {};
      for (const [k, v] of Object.entries(a.values ?? {})) data[k] = fillTemplate(v, row);
      await createIn(w.tx, sys, a.table, data, { trusted: true });
    }
  }
  if (Object.keys(values).length) await updateIn(w.tx, sys, w.def.key, String(row.id), values, { trusted: true, allowLocked: true });
}

async function afterRules(cfg: ServiceConfig, w: WriteArgs & { row: Row }): Promise<void> {
  const key = `${w.def.key}:${w.row.id}`;
  const pending = deferred.get(w.tx)?.get(key) ?? [];
  deferred.get(w.tx)?.delete(key);
  const rules = rulesFor(cfg, "business_rule", w.def.key).filter((r) => r.timing === "after" && eventMatches(r, w));
  if (!rules.length && !pending.length) return;
  const d = depth.get(w.tx) ?? 0;
  if (d >= MAX_RULE_DEPTH) return;
  depth.set(w.tx, d + 1);
  try {
    for (const p of pending) await runLater(w, p.rule, p.actions, w.row);
    if (!rules.length) return;
    const schema = await orgSchema(systemFrom(w.ctx), w.tx);
    const env: CondEnv = { ...w.env, prev: w.prev };
    for (const r of rules) {
      const row = await withWalks(w.tx, w.def, w.ctx.org.id, { ...w.row, org_id: w.ctx.org.id }, [r.condition], env, schema.lookup);
      if (!holds(r.condition, row, env, w.def, schema.lookup, true)) continue;
      await runLater(w, r, (Array.isArray(r.actions) ? r.actions : []) as RuleAction[], row);
    }
  } finally {
    depth.set(w.tx, d);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Assignment rules

type OnCall = (q: Queryable, ctx: Ctx, groupId: string, at: number) => Promise<string | null>;
let onCall: OnCall | null = null;

/** The on-call module's resolver of «آماده‌به‌کار» (who is on call in a group now). */
export function setOnCallResolver(fn: OnCall | null): void {
  onCall = fn;
}

/** Members (and leads) of a group who can take work now: valid membership, active member, not away. */
async function candidates(q: Queryable, ctx: Ctx, groupId: string): Promise<string[]> {
  const sys = systemFrom(ctx);
  const now = Date.now();
  const rows = await liveRows(q, sys, "group_member", { and: [{ f: "group_id", op: "eq", v: groupId }, { f: "kind", op: "in", v: ["member", "lead"] }] }, "t.user_id");
  const valid = rows.filter((r) => (r.valid_from ? Date.parse(r.valid_from) <= now : true) && (r.valid_to ? Date.parse(r.valid_to) > now : true)).map((r) => String(r.user_id));
  if (!valid.length) return [];
  const active = await q.query<{ user_id: string }>(`select user_id from sm_org_members where org_id = $1 and user_id = any($2::uuid[]) and is_active and deleted_at is null`, [ctx.org.id, pgArray([...new Set(valid)])]);
  const away = new Set(
    (await liveRows(q, sys, "member_profile", { and: [{ f: "user_id", op: "in", v: active.map((a) => a.user_id) }, { f: "out_of_office", op: "eq", v: true }] }))
      .filter((p) => !p.ooo_until || Date.parse(p.ooo_until) > now)
      .map((p) => String(p.user_id)),
  );
  return active.map((a) => a.user_id).filter((u) => !away.has(u)).sort();
}

/** When each candidate was last given a record of `table` (from the field history). */
async function lastAssigned(q: Queryable, orgId: string, table: string, users: string[]): Promise<Map<string, number>> {
  const rows = await q.query<{ user_id: string; at: string }>(
    `select (h.new #>> '{}') as user_id, max(h.at) as at from sm_history h
     where h.org_id = $1 and h.table_key = $2 and h.field = 'assigned_to' and (h.new #>> '{}') = any($3::text[]) group by 1`,
    [orgId, table, pgArray(users)],
  );
  return new Map(rows.map((r) => [r.user_id, Date.parse(r.at)]));
}

/** Open records of `table` assigned to each candidate. */
async function openLoad(q: Queryable, def: TableDef, orgId: string, users: string[]): Promise<Map<string, number>> {
  const open = has(def, "active") ? " and t.active" : "";
  const rows = await q.query<{ user_id: string; n: number }>(
    `select t.assigned_to as user_id, count(*)::int as n from ${def.table} t where t.org_id = $1 and t.deleted_at is null and t.assigned_to = any($2::uuid[])${open} group by 1`,
    [orgId, pgArray(users)],
  );
  return new Map(rows.map((r) => [r.user_id, Number(r.n)]));
}

async function pickUser(q: Queryable, ctx: Ctx, def: TableDef, rule: Row): Promise<string | null> {
  const method = String(rule.method ?? "fixed");
  if (method === "fixed") return rule.user_id ?? null;
  if (!rule.group_id) return null;
  if (method === "oncall") return onCall ? onCall(q, ctx, rule.group_id, Date.now()) : null;
  let users = await candidates(q, ctx, rule.group_id);
  if (method === "skills") {
    const need = (Array.isArray(rule.skills) ? rule.skills : []).map((s: string) => String(s).trim().toLowerCase()).filter(Boolean);
    if (need.length) {
      const profiles = await liveRows(q, systemFrom(ctx), "member_profile", { f: "user_id", op: "in", v: users });
      const skilled = new Set(profiles.filter((p) => {
        const mine = new Set((Array.isArray(p.skills) ? p.skills : []).map((s: string) => String(s).trim().toLowerCase()));
        return need.every((s: string) => mine.has(s));
      }).map((p) => String(p.user_id)));
      users = users.filter((u) => skilled.has(u));
    }
  }
  if (!users.length) return null;
  const last = await lastAssigned(q, ctx.org.id, def.key, users);
  const byLast = (a: string, b: string) => (last.get(a) ?? 0) - (last.get(b) ?? 0) || (a < b ? -1 : 1);
  if (method === "round_robin") return [...users].sort(byLast)[0];
  // least loaded (and skills): fewest open records, then the one who waited longest
  const load = await openLoad(q, def, ctx.org.id, users);
  return [...users].sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || byLast(a, b))[0];
}

async function assignmentRules(cfg: ServiceConfig, w: WriteArgs): Promise<void> {
  const group = w.def.scope.group;
  const assignee = has(w.def, "assigned_to") ? "assigned_to" : null;
  if (!group || !has(w.def, group) || w.next[group] || (assignee && w.next[assignee])) return;
  const model = w.def.states;
  if (model) {
    const cat = stateCategory(model, w.next[model.field]);
    if (cat && !OPEN_CATEGORIES.includes(cat)) return;
  }
  const rules = rulesFor(cfg, "assignment_rule", w.def.key);
  if (!rules.length) return;
  const schema = await orgSchema(systemFrom(w.ctx), w.tx);
  const env: CondEnv = { ...w.env, prev: w.prev };
  const row = await withWalks(w.tx, w.def, w.ctx.org.id, { ...w.next, org_id: w.ctx.org.id }, rules.map((r) => r.condition), env, schema.lookup);
  for (const r of rules) {
    if (!holds(r.condition, row, env, w.def, schema.lookup, true)) continue;
    if (r.group_id) w.next[group] = r.group_id;
    if (assignee) {
      let user = await pickUser(w.tx, w.ctx, w.def, r);
      if (user) {
        // someone away hands their new work to their delegate
        const delegations = await activeDelegations(w.tx, w.ctx, "assignments");
        user = delegateOf(delegations, user);
        w.next[assignee] = user;
      }
    }
    return;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Checks on the rule rows themselves

function checkRuleRow(kind: "business_rule" | "assignment_rule" | "priority_matrix", w: WriteArgs, schemaChoices: (list: string) => string[]): void {
  if (w.op === "delete") return;
  const fields: Record<string, string> = {};
  const tp = tableProblem(w.next.table_key);
  const t = tableDef(String(w.next.table_key ?? ""));
  if (tp) fields.table_key = tp;
  if (t && !tp) {
    const field = (n: string) => t.fields.find((f) => f.name === n);
    if (kind === "business_rule") {
      const p = actionsProblem(w.next.actions, { field, table: (k) => !!tableDef(k) && !tableDef(k)!.virtual, stateField: t.states?.field ?? null, timing: String(w.next.timing ?? "before") });
      if (p) fields.actions = p;
      if (!Array.isArray(w.next.events) || !w.next.events.length) fields.events = "دست‌کم یک رویداد را برگزینید";
    } else if (kind === "assignment_rule") {
      if (!t.scope.group || !field(t.scope.group)) fields.table_key = "این جدول گروه پشتیبانی ندارد";
      const m = String(w.next.method ?? "fixed");
      if (m !== "fixed" && !w.next.group_id) fields.group_id = "برای این روش، گروه را برگزینید";
      if (m === "fixed" && !w.next.group_id && !w.next.user_id) fields.group_id = "گروه یا کارشناس را برگزینید";
    } else {
      const names = [w.next.impact_field || "impact", w.next.urgency_field || "urgency", w.next.priority_field || "priority"];
      const missing = names.find((n) => field(n)?.type !== "choice");
      if (missing) fields.table_key = `فیلد انتخابی «${missing}» در این جدول نیست`;
      else {
        const opts = names.map((n) => {
          const f = field(n)!;
          return Array.isArray(f.choices) ? f.choices.map((o) => o.value) : typeof f.choices === "string" ? schemaChoices(f.choices) : [];
        });
        const p = matrixProblem(w.next.cells, opts[0], opts[1], opts[2]);
        if (p) fields.cells = p;
      }
    }
  }
  if (Object.keys(fields).length) throw validationError(fields);
}

// ---------------------------------------------------------------------------------------------------------------
// Installation

/** Hooks of the rules: on rule rows (checks, the category mirror) and on every table ("*", in a fixed order). */
export function installRules(): void {
  for (const kind of ["business_rule", "assignment_rule", "priority_matrix"] as const) {
    registerHooks(kind, {
      async beforeWrite(w) {
        if (w.op === "delete") return;
        const schema = await orgSchema(systemFrom(w.ctx), w.tx);
        checkRuleRow(kind, w, (list) => schema.choices(list).map((o) => o.value));
      },
    });
  }
  registerHooks("category", {
    beforeWrite: (w) => checkCategory(w),
    afterWrite: (w) => mirrorCategory(w),
  });
  registerHooks("*", {
    async beforeWrite(w) {
      if (w.op === "delete" || ownTable(w.def.key) || w.def.virtual) return;
      const cfg = await config(w.tx, w.ctx);
      const matrix = matrixOf(cfg, w.def);
      applyMatrix(matrix, w, (n) => w.changed.has(n));
      applyCategories(cfg, w);
      await beforeRules(cfg, w, matrix);
      await assignmentRules(cfg, w);
    },
    async afterWrite(w) {
      if (ownTable(w.def.key) || w.def.virtual) return;
      if (w.op === "delete") return;
      const cfg = await config(w.tx, w.ctx);
      await afterRules(cfg, w);
    },
  });
}
