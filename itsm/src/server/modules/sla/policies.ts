// UI policies stored as records (`ui_policy`, docs/spec/services/sla.md §5): the record UI applies them live through
// `setPolicySource` (GET /api/o/:org/rules/ui-policies/:table); the server enforces their mandatory and read-only
// fields on every write path — API, imports and the Windows app's pushes — so no path bypasses them:
//
// - mandatory: a field a policy requires must not be left empty when the record is created, when the write empties
//   it, or when the write changes a field the policy's condition looks at (the moment the policy starts to apply);
//   a field the caller can never fill (engine-maintained, read-only, hidden or not writable for them) is not asked;
// - read-only: a field a policy makes read-only must not be changed by the caller's input.
// Trusted server code and the system (rules, flows, jobs) are not held to UI policies.
import { condPaths, type Cond, type CondEnv } from "@shared/model/conditions";
import type { TableDef } from "@shared/model/types";
import { policyActionsProblem, policyOf } from "@shared/sla/rules";
import { policyEffects, type UiPolicyLike } from "@shared/sla/policy-types";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { access } from "../../access/provider";
import { forbidden } from "../../http/errors";
import { defFor, isLocked, isSystemCtx, orgSchema, registerHooks, validationError, type PushArgs, type WriteArgs } from "../../engine";
import { isEmpty } from "../../engine/values";
import { config, derived, holds, ownTable, rulesFor, systemFrom, withWalks, type Row, type ServiceConfig } from "./common";

/** The organisation's active UI policies of `table`, in the record UI's shape. */
export function policiesOf(cfg: ServiceConfig, table: string): UiPolicyLike[] {
  return derived(cfg, `policies:${table}`, () => rulesFor(cfg, "ui_policy", table).map(policyOf));
}

/** GET /rules/ui-policies/:table — the policies of a table the caller may read. */
export async function uiPolicies(ctx: Ctx, table: string): Promise<{ policies: UiPolicyLike[] }> {
  const { def } = await defFor(ctx, table);
  if (!access().canReadTable(ctx, def)) throw forbidden(`به «${def.plural}» دسترسی ندارید`);
  const cfg = await config(ctx.db, ctx);
  return { policies: policiesOf(cfg, def.key) };
}

interface Check {
  q: Queryable;
  ctx: Ctx;
  def: TableDef;
  prev: Row | null;
  next: Row;
  changed: Set<string>;
  /** the fields the caller set */
  input: ReadonlySet<string>;
  env: CondEnv;
}

/** The refusals of a write under the table's policies (field → Persian message). */
async function problems(c: Check): Promise<Record<string, string>> {
  const cfg = await config(c.q, c.ctx);
  const policies = policiesOf(cfg, c.def.key);
  if (!policies.length) return {};
  const schema = await orgSchema(systemFrom(c.ctx), c.q);
  const row = await withWalks(c.q, c.def, c.ctx.org.id, { ...c.next, org_id: c.ctx.org.id }, policies.map((p) => p.when), c.env, schema.lookup);
  const mode = c.prev ? "update" : "create";
  const { mandatory, readonly } = policyEffects(policies, mode, (when) => holds(when, row, c.env, c.def, schema.lookup, true));
  const out: Record<string, string> = {};
  if (!mandatory.size && !readonly.size) return out;
  const system = isSystemCtx(c.ctx);
  const visible = system ? null : access().visibleFields(c.ctx, c.def);
  const writable = system ? null : access().writableFields(c.ctx, c.def, c.prev);
  const locked = !!c.prev && isLocked(c.def, c.prev) && !c.changed.has(c.def.states?.field ?? "state");
  const fillable = (name: string) => {
    const f = c.def.fields.find((x) => x.name === name);
    if (!f || f.system || f.base || f.readonly || locked) return false;
    if (visible && !visible.has(name)) return false;
    if (writable && !writable.has(name)) return false;
    return !readonly.has(name);
  };
  for (const [name, p] of mandatory) {
    if (!fillable(name) || !isEmpty(c.next[name])) continue;
    const startsNow = !c.prev || c.changed.has(name) || [...condPaths(p.when as Cond | null)].some((path) => c.changed.has(path.split(".")[0]));
    if (!startsNow) continue;
    const f = c.def.fields.find((x) => x.name === name)!;
    out[name] = p.message ? `${p.message} — «${f.label}» را وارد کنید` : `«${f.label}» را وارد کنید`;
  }
  for (const [name] of readonly) {
    if (!c.input.has(name) || !c.changed.has(name) || out[name]) continue;
    const f = c.def.fields.find((x) => x.name === name);
    if (f) out[name] = `«${f.label}» در این وضعیت تغییر نمی‌کند`;
  }
  return out;
}

async function enforce(w: WriteArgs): Promise<void> {
  if (w.op === "delete" || ownTable(w.def.key) || w.def.virtual || w.trusted || isSystemCtx(w.ctx)) return;
  const out = await problems({ q: w.tx, ctx: w.ctx, def: w.def, prev: w.prev, next: w.next, changed: w.changed, input: w.input ?? w.changed, env: w.env });
  if (Object.keys(out).length) throw validationError(out);
}

async function enforcePush(p: PushArgs): Promise<string | null> {
  if (ownTable(p.def.key) || p.def.virtual || isSystemCtx(p.ctx)) return null;
  const out = await problems({ q: p.tx, ctx: p.ctx, def: p.def, prev: p.prev, next: p.next, changed: p.changed, input: p.changed, env: p.env });
  const first = Object.values(out)[0];
  return first ?? null;
}

/** Hooks: checks on `ui_policy` rows, and the enforcement on every table (writes and pushes). */
export function installPolicies(): void {
  registerHooks("ui_policy", {
    beforeWrite(w) {
      if (w.op === "delete") return;
      const t = tableDef(String(w.next.table_key ?? ""));
      if (!t || t.virtual || ownTable(t.key)) throw validationError({ table_key: `جدول «${String(w.next.table_key ?? "")}» سیاست فرم نمی‌پذیرد` });
      const p = policyActionsProblem(w.next.actions, (n) => t.fields.some((f) => f.name === n));
      if (p) throw validationError({ actions: p });
    },
  });
  registerHooks("*", { beforeWrite: (w) => enforce(w), validatePush: (p) => enforcePush(p) });
}
