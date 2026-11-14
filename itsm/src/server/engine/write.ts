// The write pipeline every create, update, transition and delete goes through, inside the caller's transaction:
//
//   input keys → coerce (values.ts) → field permissions (access provider) → defaults / state model / task
//   behaviours → beforeWrite hooks → row checks (required, dependent choices, conditions, references) →
//   insert/update → field history → events (outbox) → afterWrite hooks
//
// Input rules: unknown keys are refused; base columns (id, number, version, created_*, updated_*…) are ignored, and
// so are system and readonly fields unless the write is trusted (server code stamping its own fields from a service
// or a job — user input never sets them); a field the access provider does not let the caller write
// is refused only when its value would change (so a whole row can be sent back). A change of the state field is a
// transition (allowed transitions, required fields, guards). Records in a locked state category (closed, canceled
// by default) only accept transitions out of it.
import type { FieldDef, StateCategory, TableDef, Transition } from "@shared/model/types";
import { FIELD_TYPES, OPEN_CATEGORIES } from "@shared/model/types";
import type { CondEnv } from "@shared/model/conditions";
import { evaluate, isNever } from "@shared/model/conditions";
import { stateCategory, transitionsFrom, DONE_CATEGORIES } from "@shared/model/task";
import { todayISO } from "@shared/jalali";
import { uuidv7 } from "@shared/id";
import { D } from "@shared/money";
import type { Ctx } from "../context";
import type { Tx } from "../db";
import { AppError, conflict, forbidden } from "../http/errors";
import { access } from "../access/provider";
import { scopeColumns } from "@shared/access";
import { physicalTables } from "@shared/tables";
import { actorId, condEnv, isSystemCtx } from "./env";
import { ensureOrgLock } from "../context";
import { orgSchema, type OrgSchema } from "./schema";
import { checkRefs, coerceValue, isEmpty, KEEP, Problems, sealSecret, validateRow, type ValueContext } from "./values";
import { allocateNumber, formatNumber } from "./numbering";
import { hooksFor, guardFor, type Row, type WriteArgs, type WriteOp } from "./hooks";
import { audited, writeHistory } from "./history";
import { changeSummary, emitEvent, type RecordEventInput } from "./events";
import { canOpenRecords, fromDb, loadReadable } from "./read";
import { notFound } from "../http/errors";
import { invalidateSchema } from "./schema";

export interface WriteOptions {
  /** optimistic concurrency: the `version` the caller read; 409 when the record changed since */
  version?: number;
  /** recorded on events */
  via?: "api" | "import" | "sync";
  /** trusted server code (hooks, services, jobs): may set system and readonly fields; field permissions are not asked */
  trusted?: boolean;
  /** an engine stamp that must not invalidate forms people have open: `version` does not move */
  keepVersion?: boolean;
  /** may change a record in a locked state (watchers, engine stamps) */
  allowLocked?: boolean;
  /** the caller already checked the row's access (watchers: whoever may read a record may watch it) */
  skipAccess?: boolean;
}

/** Base columns a caller may never set (silently ignored in input). */
const IGNORED = new Set(["id", "org_id", "no", "number", "rev", "version", "created_at", "created_by", "updated_at", "updated_by", "deleted_at", "origin", "custom", "domain_id", "unit_id"]);

const LOCKED_DEFAULT: StateCategory[] = ["closed", "canceled"];
/** Base columns the access model keeps (src/server/access/hooks.ts): set by hooks, never by callers. */
const ANCHORS = ["unit_id", "domain_id"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LOCKED_MESSAGE = "این رکورد بسته شده است و دیگر ویرایش نمی‌شود؛ برای تغییر، آن را بازگشایی کنید";
export const VERSION_MESSAGE = "این رکورد را کس دیگری در این فاصله تغییر داده است؛ آن را دوباره باز کنید و تغییرهای خود را دوباره اعمال کنید";

/** Is the record in a locked state category (only transitions out of it are allowed)? */
export function isLocked(def: TableDef, row: Row | null): boolean {
  if (!def.states || !row) return false;
  const cat = stateCategory(def.states, row[def.states.field]);
  return !!cat && (def.states.locked ?? LOCKED_DEFAULT).includes(cat);
}

/** Equal stored values (numbers numerically, instants by time, arrays as sets). */
export function sameValue(f: FieldDef, a: unknown, b: unknown): boolean {
  const ea = isEmpty(a) || a === undefined;
  const eb = isEmpty(b) || b === undefined;
  if (f.type === "bool") return !!a === !!b;
  if (ea || eb) return ea && eb;
  const info = FIELD_TYPES[f.type];
  if (info.numeric) {
    try {
      return D(a as string).eq(D(b as string));
    } catch {
      return String(a) === String(b);
    }
  }
  if (f.type === "datetime") return Date.parse(String(a)) === Date.parse(String(b));
  if (info.array && Array.isArray(a) && Array.isArray(b)) return JSON.stringify([...a].map(String).sort()) === JSON.stringify([...b].map(String).sort());
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return String(a) === String(b);
}

function valueContext(ctx: Ctx, def: TableDef, schema: OrgSchema, env: CondEnv, recordId: string): ValueContext & { schema: OrgSchema } {
  return {
    schema,
    tz: env.tz || "Asia/Tehran",
    seal: (f, plain) => sealSecret(ctx.cfg.secret, ctx.org.id, def.key, f.name, recordId, plain, { hint: f.hint }),
  };
}

/** Coerce the caller's input; returns the values it sets (unchanged secrets are left out). */
function coerceInput(def: TableDef, input: Record<string, unknown>, vc: ValueContext, prev: Row | null, opts: WriteOptions, problems: Problems): Row {
  const values: Row = {};
  const byName = new Map(def.fields.map((f) => [f.name, f]));
  for (const [key, raw] of Object.entries(input ?? {})) {
    if (raw === undefined || key.startsWith("$") || IGNORED.has(key)) continue;
    const f = byName.get(key);
    if (!f) {
      problems.add(key, `فیلد «${key}» در «${def.label}» وجود ندارد`);
      continue;
    }
    // base columns never; system and readonly fields only from trusted server code (hooks, services, jobs)
    if ((f.base && f.name !== "workspace_id") || ((f.system || f.readonly) && !opts.trusted)) continue;
    const v = problems.try(() => coerceValue(f, raw, vc, prev ? prev[key] : undefined));
    if (v === undefined || v === KEEP) continue;
    values[key] = v;
  }
  return values;
}

/** A default value of a field (tokens $now, $today, $me, $my_unit, $my_domain resolved). */
function defaultValue(f: FieldDef, ctx: Ctx, env: CondEnv, vc: ValueContext): unknown {
  const d = f.default;
  if (d === undefined) return undefined;
  let v: unknown = d;
  if (d === "$now") v = new Date().toISOString();
  else if (d === "$today") v = todayISO(vc.tz);
  else if (d === "$me") v = actorId(ctx) ? (f.type === "users" ? [actorId(ctx)] : actorId(ctx)) : null;
  else if (d === "$my_unit") v = env.unitId ?? null;
  else if (d === "$my_domain") v = (env as CondEnv & { domainId?: string | null }).domainId ?? null;
  if (v === null) return null;
  try {
    const out = coerceValue(f, v, vc);
    return out === KEEP ? undefined : out;
  } catch {
    return undefined;
  }
}

const has = (def: TableDef, name: string) => def.fields.some((f) => f.name === name && !f.custom);

/**
 * Side effects of entering a state category: resolved → resolved_at/by; closed/canceled → closed_at/by (closing
 * also stamps resolved_at when it is empty); back to an open category from a done one → reopen_count + 1 and the
 * resolved/closed stamps cleared; `active` follows the category.
 */
export function stateEffects(def: TableDef, prev: Row | null, next: Row, actor: string | null, now: string, changed: Set<string>) {
  const model = def.states;
  if (!model) return;
  const field = model.field;
  const to = stateCategory(model, next[field]);
  const from = prev ? stateCategory(model, prev[field]) : undefined;
  const set = (name: string, v: unknown) => {
    if (!has(def, name)) return;
    next[name] = v;
    changed.add(name);
  };
  if (!to) return;
  if (has(def, "active")) {
    const active = OPEN_CATEGORIES.includes(to);
    if (!prev || !!prev.active !== active) set("active", active);
  }
  if (prev && from === to) return;
  if (to === "resolved") {
    set("resolved_at", now);
    set("resolved_by", actor);
  }
  if (to === "closed" || to === "canceled") {
    set("closed_at", now);
    set("closed_by", actor);
    if (to === "closed" && !next.resolved_at) {
      set("resolved_at", now);
      set("resolved_by", actor);
    }
  }
  if (prev && from && DONE_CATEGORIES.includes(from) && OPEN_CATEGORIES.includes(to)) {
    set("reopen_count", Number(prev.reopen_count ?? 0) + 1);
    for (const n of ["resolved_at", "resolved_by", "closed_at", "closed_by"]) if (prev[n] !== null && prev[n] !== undefined) set(n, null);
  }
}

/** The assignment fields of a table: assigned_to and the scope's group field. */
export function assignmentFields(def: TableDef): string[] {
  const out: string[] = [];
  if (has(def, "assigned_to")) out.push("assigned_to");
  if (def.scope.group && has(def, def.scope.group)) out.push(def.scope.group);
  return out;
}

const jsonb = (f: FieldDef) => FIELD_TYPES[f.type].sql === "jsonb";

function columnValue(f: FieldDef, v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (jsonb(f)) return JSON.stringify(v);
  return v;
}

/** A unique violation as a validation error on the fields of the index. */
function uniqueError(def: TableDef, e: unknown): AppError | null {
  const err = e as { code?: string; constraint?: string; constraint_name?: string };
  if (err?.code !== "23505") return null;
  const name = String(err.constraint ?? err.constraint_name ?? "");
  const fields: Record<string, string> = {};
  for (const f of def.fields) if (f.unique && name === `${def.table}_${f.name}_uk`) fields[f.name] = `«${f.label}» تکراری است`;
  for (const u of def.unique ?? []) {
    if (name !== `${def.table}_${u.join("_")}_uk`) continue;
    const labels = u.map((n) => def.fields.find((f) => f.name === n)?.label ?? n);
    for (const n of u) fields[n] = `ترکیب «${labels.join("» و «")}» تکراری است`;
  }
  if (!Object.keys(fields).length) return null;
  return new AppError(409, "duplicate", Object.values(fields)[0], { fields });
}

/** Run `fn` in a savepoint (a failure rolls back only its own changes). */
let spSeq = 0;
export async function savepoint<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  const name = `sm_e${++spSeq}`;
  await tx.query(`savepoint ${name}`);
  try {
    const r = await fn();
    await tx.query(`release savepoint ${name}`);
    return r;
  } catch (e) {
    await tx.query(`rollback to savepoint ${name}`);
    throw e;
  }
}

interface PipelineInput {
  tx: Tx;
  ctx: Ctx;
  def: TableDef;
  schema: OrgSchema;
  env: CondEnv;
  op: WriteOp;
  prev: Row | null;
  input: Record<string, unknown>;
  opts: WriteOptions;
  transition?: Transition;
}

async function pipeline(p: PipelineInput): Promise<Row> {
  const { tx, ctx, def, schema, env, op, prev, opts } = p;
  const id = prev ? String(prev.id) : uuidv7();
  const vc = valueContext(ctx, def, schema, env, id);
  const problems = new Problems();
  const actor = actorId(ctx);
  const now = new Date().toISOString();
  const creating = !prev;
  const values = coerceInput(def, p.input, vc, prev, opts, problems);
  problems.throwIfAny();

  // what changes, and may the caller change it?
  const changed = new Set<string>();
  for (const [k, v] of Object.entries(values)) {
    const f = def.fields.find((x) => x.name === k)!;
    if (creating ? !isEmpty(v) || f.type === "bool" : !sameValue(f, prev![k], v)) changed.add(k);
  }
  if (!opts.trusted && !isSystemCtx(ctx)) {
    const visible = access().visibleFields(ctx, def);
    const writable = access().writableFields(ctx, def, prev);
    const denied: Record<string, string> = {};
    for (const k of changed) {
      // the state field changes through transitions only, which the provider judges with canTransition
      if (k === def.states?.field) continue;
      if ((visible && !visible.has(k)) || (writable && !writable.has(k))) {
        const label = def.fields.find((f) => f.name === k)?.label ?? k;
        denied[k] = `اجازهٔ تغییر «${label}» را ندارید`;
      }
    }
    if (Object.keys(denied).length) throw new AppError(403, "forbidden_field", Object.values(denied)[0], { fields: denied });
  }

  const next: Row = creating ? { id } : { ...prev };
  for (const k of changed) next[k] = values[k];
  if (creating) {
    for (const f of def.fields) {
      if (f.base || f.name in values) continue;
      const d = defaultValue(f, ctx, env, vc);
      if (d !== undefined && d !== null) {
        next[f.name] = d;
        changed.add(f.name);
      } else if (f.type === "bool") next[f.name] = false;
      else next[f.name] = null;
    }
    if (values.workspace_id) next.workspace_id = values.workspace_id;
  }

  // the state model: a change of the state field is a transition
  const model = def.states;
  let transition = p.transition;
  if (model && changed.has(model.field)) {
    if (creating) {
      // a record may be created in any state of the model (imports of history); the category effects apply
    } else if (!transition) {
      const t = transitionsFrom(model, prev![model.field]).find((x) => x.to === next[model.field]);
      if (!t) throw transitionError(def, prev![model.field], next[model.field]);
      transition = t;
    }
  }
  if (!creating && isLocked(def, prev) && !transition && !opts.allowLocked && !isSystemCtx(ctx)) {
    throw new AppError(409, "locked", LOCKED_MESSAGE);
  }
  if (transition && !creating && !opts.skipAccess && !isSystemCtx(ctx) && !access().canTransition(ctx, def, prev!, transition)) {
    throw forbidden(`اجازهٔ «${transition.label}» را ندارید`);
  }
  if (model && (creating || changed.has(model.field))) stateEffects(def, prev, next, actor, now, changed);

  // task behaviours
  if (creating) {
    if (has(def, "opened_at") && !next.opened_at) {
      next.opened_at = now;
      changed.add("opened_at");
    }
    if (has(def, "opened_by") && !next.opened_by && actor) {
      next.opened_by = actor;
      changed.add("opened_by");
    }
  } else if (has(def, "reassignment_count")) {
    if (assignmentFields(def).some((n) => changed.has(n) && prev![n] !== null && prev![n] !== undefined)) {
      next.reassignment_count = Number(prev!.reassignment_count ?? 0) + 1;
      changed.add("reassignment_count");
    }
  }

  // module hooks (values they set are coerced like a caller's)
  const hooks = hooksFor(def.key);
  const w: WriteArgs = { tx, ctx, def, op, next, prev, changed, transition, env, input: new Set(Object.keys(values)), via: opts.via, trusted: !!opts.trusted };
  await beforeWriteHooks(hooks, w, vc, problems);

  if (!creating && !changed.size) return prev!;

  // row checks
  validateRow(def, next, changed, vc, creating, problems);
  if (transition) {
    for (const r of transition.requires ?? []) {
      if (isEmpty(next[r])) {
        const label = def.fields.find((f) => f.name === r)?.label ?? r;
        problems.add(r, `برای «${transition.label}»، «${label}» را وارد کنید`);
      }
    }
  }
  problems.throwIfAny();
  await checkRefs(tx, ctx, def, next, changed, schema, env, problems);
  problems.throwIfAny();
  if (transition) {
    const tw = { ...w, transition };
    if (transition.guard) {
      const guard = guardFor(def.key, transition.guard);
      const refusal = guard ? await guard(tw) : `شرط «${transition.guard}» برای «${transition.label}» تعریف نشده است`;
      if (refusal) throw conflict(refusal);
    }
    for (const h of hooks) {
      const refusal = await h.validateTransition?.(tw);
      if (refusal) throw conflict(refusal);
    }
  }
  // the table's write row rule must still hold for the row as it will be stored (a create checks it here)
  if (creating && def.rowAccess?.write && !isSystemCtx(ctx) && !evaluate(def.rowAccess.write, next, env, def, schema.lookup)) {
    throw forbidden(`اجازهٔ ایجاد این ${def.label} را ندارید`);
  }
  if (creating && !opts.skipAccess && !isSystemCtx(ctx) && !access().canCreate(ctx, def, next)) throw forbidden(`اجازهٔ ایجاد ${def.label} را ندارید`);

  // write
  let stored: Row;
  try {
    stored = creating ? await insertRow(tx, ctx, def, next) : await updateRow(tx, ctx, def, prev!, next, changed, opts);
  } catch (e) {
    throw uniqueError(def, e) ?? e;
  }
  stored = fromDb(def, stored);

  await writeHistory(tx, ctx, def, id, prev, stored, changed);
  await recordEvents(tx, ctx, def, op, prev, stored, changed, opts);
  for (const h of hooks) await h.afterWrite?.({ ...w, next: stored, row: stored });
  if (def.key === "custom_field" || def.key === "choice") invalidateSchema(ctx.org.id);
  return stored;
}

/**
 * The beforeWrite hooks of a write (the table's, then «*»'s): values they set are coerced like a caller's and decide
 * `changed`; the access anchors (unit_id, domain_id) are never taken from input — the access model's hook sets them.
 */
async function beforeWriteHooks(hooks: ReturnType<typeof hooksFor>, w: WriteArgs, vc: ValueContext, problems: Problems): Promise<void> {
  if (!hooks.some((h) => h.beforeWrite)) return;
  const { def, next, prev, changed } = w;
  const creating = !prev;
  const before = { ...next };
  for (const h of hooks) await h.beforeWrite?.(w);
  for (const f of def.fields) {
    if (f.base || sameValue(f, before[f.name], next[f.name])) continue;
    const v = problems.try(() => coerceValue(f, next[f.name], vc, prev?.[f.name]));
    if (v !== undefined && v !== KEEP) next[f.name] = v;
    if (creating || !sameValue(f, prev?.[f.name], next[f.name])) changed.add(f.name);
    else changed.delete(f.name);
  }
  for (const k of ANCHORS) {
    const v = typeof next[k] === "string" && UUID.test(next[k]) ? String(next[k]).toLowerCase() : null;
    if ((before[k] ?? null) === v) continue;
    next[k] = v;
    if (creating ? v !== null : (prev?.[k] ?? null) !== v) changed.add(k);
    else changed.delete(k);
  }
  problems.throwIfAny();
}

function transitionError(def: TableDef, from: unknown, to: unknown): AppError {
  const label = (v: unknown) => def.states?.states.find((s) => s.value === v)?.label ?? String(v ?? "—");
  return new AppError(409, "transition", `انتقال از «${label(from)}» به «${label(to)}» مجاز نیست`);
}

async function insertRow(tx: Tx, ctx: Ctx, def: TableDef, next: Row): Promise<Row> {
  await ensureOrgLock(tx, ctx.org.id);
  const cols: string[] = ["id", "org_id", "created_by", "updated_by", "origin"];
  const actor = actorId(ctx);
  const params: unknown[] = [next.id, ctx.org.id, actor, actor, ctx.cfg.origin ?? null];
  const vals: string[] = ["$1", "$2", "$3", "$4", "$5"];
  const push = (col: string, v: unknown, cast = "") => {
    cols.push(col);
    params.push(v);
    vals.push(`$${params.length}${cast}`);
  };
  if (def.numbered) push("no", await allocateNumber(tx, def, ctx.org.id));
  if (next.workspace_id) push("workspace_id", next.workspace_id);
  for (const k of ANCHORS) if (next[k]) push(k, next[k]);
  const custom: Row = {};
  for (const f of def.fields) {
    if (f.base) continue;
    if (f.custom) {
      if (!isEmpty(next[f.name])) custom[f.name] = next[f.name];
      continue;
    }
    if (next[f.name] === undefined) continue;
    push(f.name, columnValue(f, next[f.name]), jsonb(f) ? "::jsonb" : "");
  }
  push("custom", JSON.stringify(custom), "::jsonb");
  return (await tx.one<Row>(`insert into ${def.table} (${cols.join(", ")}) values (${vals.join(", ")}) returning *`, params))!;
}

async function updateRow(tx: Tx, ctx: Ctx, def: TableDef, prev: Row, next: Row, changed: Set<string>, opts: WriteOptions): Promise<Row> {
  await ensureOrgLock(tx, ctx.org.id);
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, v: unknown, cast = "") => {
    params.push(v);
    sets.push(`${col} = $${params.length}${cast}`);
  };
  let customChanged = false;
  for (const name of changed) {
    const f = def.fields.find((x) => x.name === name);
    if (!f) continue;
    if (f.custom) {
      customChanged = true;
      continue;
    }
    if (f.base && f.name !== "workspace_id" && !ANCHORS.includes(f.name)) continue;
    set(f.name, columnValue(f, next[f.name]), jsonb(f) ? "::jsonb" : "");
  }
  if (customChanged) {
    const custom: Row = { ...(prev.custom && typeof prev.custom === "object" ? prev.custom : {}) };
    for (const f of def.fields) {
      if (!f.custom || !changed.has(f.name)) continue;
      if (isEmpty(next[f.name])) delete custom[f.name];
      else custom[f.name] = next[f.name];
    }
    set("custom", JSON.stringify(custom), "::jsonb");
  }
  sets.push("updated_at = now()");
  // an engine stamp (watchers, first response…) is nobody's edit: version and updated_by stay
  if (!opts.keepVersion) {
    set("updated_by", actorId(ctx));
    sets.push("version = version + 1");
  }
  params.push(prev.id, ctx.org.id);
  return (await tx.one<Row>(`update ${def.table} set ${sets.join(", ")} where id = $${params.length - 1} and org_id = $${params.length} returning *`, params))!;
}

/** Parent-scoped tables (`scope.parent`) by the parent table they follow. */
let scopedChildren: Map<string, { table: string; field: string }[]> | null = null;
let scopedOf = 0;
function childrenOf(parent: string): { table: string; field: string }[] {
  const tables = physicalTables();
  if (!scopedChildren || scopedOf !== tables.length) {
    scopedChildren = new Map();
    scopedOf = tables.length;
    for (const d of tables) {
      const p = scopeColumns(d).parent;
      if (p) scopedChildren.set(p.table, [...(scopedChildren.get(p.table) ?? []), { table: d.table, field: p.field }]);
    }
  }
  return scopedChildren.get(parent) ?? [];
}

/** The columns of a row that decide who reads it (scope fields, confidentiality, its own parent). */
function accessColumns(def: TableDef): string[] {
  const c = scopeColumns(def);
  return [...c.own, ...c.requester, ...c.readers].map((f) => f.name).concat(
    [c.watchers, c.group, c.unit, c.domain, c.workspace, c.confidential ? "confidential" : null, c.accessList, c.parent?.field ?? null].filter((x): x is string => !!x),
  );
}

/**
 * A parent whose readers changed (made confidential, another owner, another group…): its parent-scoped children get
 * a new sync revision (cloud only), so every Windows app re-reads them through the parent's new rule — a child the
 * account may no longer read goes down as a tombstone. Grandchildren follow through their own parent's touch.
 */
async function touchScopedChildren(tx: Tx, def: TableDef, op: WriteOp, prev: Row | null, changed: Set<string>, id: string): Promise<void> {
  const kids = childrenOf(def.key);
  if (!kids.length || !prev || (op !== "delete" && !accessColumns(def).some((n) => changed.has(n)))) return;
  for (const k of kids) {
    await tx.query(`update ${k.table} set rev = rev where ${k.field} = $1 and deleted_at is null and coalesce(current_setting('itsm.mode', true), '') <> 'desktop'`, [id]);
  }
}

/** The events of a write (record.created / updated / state_changed / assigned / deleted). */
export async function recordEvents(tx: Tx, ctx: Ctx, def: TableDef, op: WriteOp, prev: Row | null, row: Row, changed: Set<string>, opts: { via?: WriteOptions["via"] } = {}): Promise<void> {
  await touchScopedChildren(tx, def, op, prev, changed, String(row.id));
  const base = { table: def.key, id: String(row.id), number: def.numbered ? (row.number ?? formatNumber(def, row.no)) : null, via: opts.via ?? "api" };
  if (op === "delete") {
    await emitEvent(tx, ctx, { ...base, kind: "record.deleted" });
    return;
  }
  const secret = (n: string) => def.fields.find((f) => f.name === n)?.type === "secret";
  if (!prev) await emitEvent(tx, ctx, { ...base, kind: "record.created" });
  else {
    const names = [...changed];
    await emitEvent(tx, ctx, { ...base, kind: "record.updated", changed: names, changes: changeSummary(names, prev, row, secret) });
  }
  const model = def.states;
  if (model && prev && changed.has(model.field)) {
    await emitEvent(tx, ctx, {
      ...base,
      kind: "record.state_changed",
      from: prev[model.field] ?? null,
      to: row[model.field] ?? null,
      from_category: stateCategory(model, prev[model.field]) ?? null,
      to_category: stateCategory(model, row[model.field]) ?? null,
    });
  }
  const assign = assignmentFields(def);
  if (assign.some((n) => changed.has(n) && !(prev === null && isEmpty(row[n])))) {
    const e: RecordEventInput = { ...base, kind: "record.assigned" };
    if (assign.includes("assigned_to")) e.assigned_to = { from: prev?.assigned_to ?? null, to: row.assigned_to ?? null };
    if (def.scope.group && assign.includes(def.scope.group)) e.assignment_group = { from: prev?.[def.scope.group] ?? null, to: row[def.scope.group] ?? null };
    await emitEvent(tx, ctx, e);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Entry points inside a transaction (modules, flows and jobs call these with their own tx and ctx)

async function prepare(tx: Tx, ctx: Ctx, table: string) {
  const schema = await orgSchema(ctx, tx);
  const def = schema.def(table);
  if (!def || def.virtual) throw notFound(`جدول «${table}» وجود ندارد`);
  const env = await condEnv(ctx);
  return { def, schema, env };
}

/** Lock and check the row a write starts from (404 when unreadable, 403 without write access, 409 on a stale version). */
async function startFrom(tx: Tx, ctx: Ctx, def: TableDef, env: CondEnv, id: string, opts: WriteOptions, op: "write" | "delete"): Promise<Row> {
  // a participant reads the record (an approver), so a write of it is refused rather than answered as unknown
  if (!(await canOpenRecords(ctx, def, tx))) throw notFound(`${def.label} پیدا نشد`);
  // the organisation's write lock before the row's: every writer takes them in this order (an ordinary write took the
  // first when it began). A `late`/`internal` write that locked the row first and then waited for the organisation's
  // lock at its update would deadlock with an ordinary write holding that lock and waiting for the row.
  await ensureOrgLock(tx, ctx.org.id);
  const prev = await loadReadable(tx, ctx, def, id, env, { lock: true });
  if (!prev) throw notFound(`${def.label} پیدا نشد`);
  if (!opts.skipAccess && !isSystemCtx(ctx)) {
    const ok = op === "delete" ? access().canDelete(ctx, def, prev) : access().canWrite(ctx, def, prev);
    if (!ok || prev.$writable === false) throw forbidden(op === "delete" ? `اجازهٔ حذف این ${def.label} را ندارید` : `اجازهٔ تغییر این ${def.label} را ندارید`);
  }
  delete prev.$writable;
  if (opts.version !== undefined && opts.version !== null && Number(prev.version) !== Number(opts.version)) {
    throw new AppError(409, "version_conflict", VERSION_MESSAGE, { version: Number(prev.version) });
  }
  return prev;
}

/** Create a record inside `tx`; returns the stored row (engine shape). */
export async function createIn(tx: Tx, ctx: Ctx, table: string, data: Record<string, unknown>, opts: WriteOptions = {}): Promise<Row> {
  const { def, schema, env } = await prepare(tx, ctx, table);
  // a table only the platform writes (rowAccess.write NEVER: computed scores, deliveries, logs) refuses a person's
  // create before looking at the values — the same answer whatever was sent (meta offers no «… تازه» or import)
  if (!isSystemCtx(ctx) && isNever(def.rowAccess?.write)) throw forbidden(`«${def.plural}» را فقط سامانه می‌نویسد`);
  if (!opts.skipAccess && !isSystemCtx(ctx) && !access().canCreate(ctx, def, null)) throw forbidden(`اجازهٔ ایجاد ${def.label} را ندارید`);
  return pipeline({ tx, ctx, def, schema, env, op: "create", prev: null, input: data, opts });
}

/** Update a record inside `tx` (a state change in `data` is a transition). */
export async function updateIn(tx: Tx, ctx: Ctx, table: string, id: string, data: Record<string, unknown>, opts: WriteOptions = {}): Promise<Row> {
  const { def, schema, env } = await prepare(tx, ctx, table);
  const prev = await startFrom(tx, ctx, def, env, id, opts, "write");
  return pipeline({ tx, ctx, def, schema, env, op: "update", prev, input: data, opts });
}

/** Take the transition to state `to` (with the values it needs, e.g. close_code) inside `tx`. */
export async function transitionIn(tx: Tx, ctx: Ctx, table: string, id: string, to: string, data: Record<string, unknown> = {}, opts: WriteOptions = {}): Promise<Row> {
  const { def, schema, env } = await prepare(tx, ctx, table);
  const model = def.states;
  if (!model) throw new AppError(400, "no_states", `«${def.plural}» گردش وضعیت ندارد`);
  const prev = await startFrom(tx, ctx, def, env, id, opts, "write");
  const t = transitionsFrom(model, prev[model.field]).find((x) => x.to === to);
  if (!t) throw transitionError(def, prev[model.field], to);
  return pipeline({ tx, ctx, def, schema, env, op: "transition", prev, input: { ...data, [model.field]: to }, opts, transition: t });
}

/** A value as `jsonb_to_recordset` reads it (json and array fields stay JSON, decimals and instants become text). */
function recordsetValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && !Array.isArray(v) && "toFixed" in (v as object) && "isZero" in (v as object)) return (v as { toFixed(): string }).toFixed();
  return v;
}

/**
 * Create many rows of `table` with ONE insert statement — set-based output of the platform itself (the bell rows of a
 * notification for every recipient at once). System contexts only. Each row is coerced, defaulted, given to the
 * beforeWrite hooks (the access anchors…) and validated as a create is, the stored rows go to the afterWrite hooks, and
 * the sync trigger gives each its revision. Left out on purpose: a statement per row and the record events (no
 * `record.created` per row: nothing reacts to the rows one by one), and the reference checks (the system names people
 * and records it read). Numbered tables, tables with a state model and tables that keep field history are refused.
 * `ids` gives rows their ids up front (a log can name them before the insert). In a `late` write the organisation's
 * write lock is taken only for the insert itself, after the per-row work. Returns the stored rows in input order.
 */
export async function insertManyIn(tx: Tx, ctx: Ctx, table: string, inputs: Record<string, unknown>[], opts: { ids?: string[] } = {}): Promise<Row[]> {
  if (!inputs.length) return [];
  if (!isSystemCtx(ctx)) throw forbidden(`ردیف‌های «${table}» را فقط خود سامانه دسته‌ای می‌سازد`);
  const { def, schema, env } = await prepare(tx, ctx, table);
  if (def.numbered || def.states || def.fields.some((f) => audited(def, f))) throw new Error(`insertManyIn: «${def.key}» is numbered, has states or keeps history`);
  const hooks = hooksFor(def.key);
  const actor = actorId(ctx);
  const nexts: { next: Row; w: WriteArgs }[] = [];
  for (const [i, input] of inputs.entries()) {
    const given = opts.ids?.[i];
    const id = typeof given === "string" && UUID.test(given) ? given.toLowerCase() : uuidv7();
    const vc = valueContext(ctx, def, schema, env, id);
    const problems = new Problems();
    const values = coerceInput(def, input, vc, null, { trusted: true }, problems);
    problems.throwIfAny();
    const next: Row = { id };
    const changed = new Set<string>();
    for (const [k, v] of Object.entries(values)) {
      next[k] = v;
      if (!isEmpty(v) || def.fields.find((f) => f.name === k)?.type === "bool") changed.add(k);
    }
    for (const f of def.fields) {
      if (f.base || f.name in values) continue;
      const d = defaultValue(f, ctx, env, vc);
      if (d !== undefined && d !== null) {
        next[f.name] = d;
        changed.add(f.name);
      } else next[f.name] = f.type === "bool" ? false : null;
    }
    if (values.workspace_id) next.workspace_id = values.workspace_id;
    const w: WriteArgs = { tx, ctx, def, op: "create", next, prev: null, changed, env, input: new Set(Object.keys(values)), trusted: true };
    await beforeWriteHooks(hooks, w, vc, problems);
    validateRow(def, next, changed, vc, true, problems);
    problems.throwIfAny();
    nexts.push({ next, w });
  }
  const fields = def.fields.filter((f) => !f.base && !f.custom);
  const base: [string, string][] = [["id", "uuid"], ["org_id", "uuid"], ["created_by", "uuid"], ["updated_by", "uuid"], ["origin", "text"], ["workspace_id", "uuid"], ["unit_id", "uuid"], ["domain_id", "uuid"], ["custom", "jsonb"]];
  const present = new Set(def.fields.map((f) => f.name));
  const cols: [string, string][] = [...base.filter(([c]) => !["workspace_id", "unit_id", "domain_id"].includes(c) || present.has(c)), ...fields.map((f) => [f.name, FIELD_TYPES[f.type].sql] as [string, string])];
  const records = nexts.map(({ next }) => {
    const custom: Row = {};
    for (const f of def.fields) if (f.custom && !isEmpty(next[f.name])) custom[f.name] = next[f.name];
    const r: Row = { id: next.id, org_id: ctx.org.id, created_by: actor, updated_by: actor, origin: ctx.cfg.origin ?? null, custom };
    for (const k of ["workspace_id", ...ANCHORS]) if (present.has(k)) r[k] = next[k] ?? null;
    for (const f of fields) r[f.name] = recordsetValue(next[f.name]);
    return r;
  });
  const names = cols.map(([c]) => c).join(", ");
  // the per-row work above ran without the organisation's write lock when the transaction is `late`: take it now
  await ensureOrgLock(tx, ctx.org.id);
  let stored: Row[];
  try {
    stored = await tx.query<Row>(
      `insert into ${def.table} (${names}) select ${names} from jsonb_to_recordset($1::jsonb) as x(${cols.map(([c, t]) => `${c} ${t}`).join(", ")}) returning *`,
      [JSON.stringify(records)],
    );
  } catch (e) {
    throw uniqueError(def, e) ?? e;
  }
  const byId = new Map(stored.map((r) => [String(r.id), fromDb(def, r)]));
  const out: Row[] = [];
  for (const { next, w } of nexts) {
    const row = byId.get(String(next.id))!;
    for (const h of hooks) await h.afterWrite?.({ ...w, next: row, row });
    out.push(row);
  }
  return out;
}

/** Soft-delete a record inside `tx`. */
export async function removeIn(tx: Tx, ctx: Ctx, table: string, id: string, opts: WriteOptions = {}): Promise<void> {
  const { def, env } = await prepare(tx, ctx, table);
  const prev = await startFrom(tx, ctx, def, env, id, opts, "delete");
  const hooks = hooksFor(def.key);
  const w: WriteArgs = { tx, ctx, def, op: "delete", next: { ...prev, deleted_at: new Date().toISOString() }, prev, changed: new Set(["deleted_at"]), env, input: new Set(), via: opts.via, trusted: !!opts.trusted };
  for (const h of hooks) await h.beforeWrite?.(w);
  await ensureOrgLock(tx, ctx.org.id);
  const row = await tx.one<Row>(
    `update ${def.table} set deleted_at = now(), updated_at = now(), updated_by = $3, version = version + 1 where id = $1 and org_id = $2 returning *`,
    [prev.id, ctx.org.id, actorId(ctx)],
  );
  const stored = fromDb(def, row!);
  await recordEvents(tx, ctx, def, "delete", prev, stored, new Set(), opts);
  for (const h of hooks) await h.afterWrite?.({ ...w, next: stored, row: stored });
  if (def.key === "custom_field" || def.key === "choice") invalidateSchema(ctx.org.id);
}
