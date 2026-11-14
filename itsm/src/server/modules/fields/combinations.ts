// What an organisation may change on built-in tables (design F §3.3, §4.2, package F1), held on every path — F1's
// routes, the generic record API, imports and the studio — for the system as for people:
//   · `custom_field` override rows: a locked field is never hidden from the form or required in the organisation's
//     name (`lockRefusal`, with its reasons); a field is never both hidden and required — nor hidden while a UI
//     policy makes it mandatory or a transition of the organisation's lifecycle requires it; «همه» is refused where
//     people create through a fixed form that cannot carry the field (`requirementBlockers`: the portal's built-in
//     «گزارش مشکل»);
//   · library rows (`library_id`): a live, active library field, under its own name, never on a process case, never
//     over values an earlier field of that name (deactivated or deleted) left with another meaning;
//   · the `_states` row: a valid lifecycle overlay (`lifecycleProblems`), stored clean, written by holders of
//     `settings` full; an organisation field it names stays on the table (`keepNamedFields`), and a studio table's
//     overlay goes with the table;
//   · `ui_policy`: no mandatory field that is hidden from the form;
//   · `choice`: an option a module marks `locked` is never deactivated (relabelled, recoloured, reordered: yes);
//   · `portal`: while incident carries a requirement «همه», the portal's «گزارش مشکل» keeps a catalogue form
//     (`portalRules`: the other side of `requirementBlockers`; trusted code excepted).
// A Windows app's push of UI policies, choice rows and portals meets the same rules (custom_field rows are web-only).
import { CHOICE_LISTS, tableDef } from "@shared/tables";
import type { FieldDef, TableDef } from "@shared/model/types";
import { FORM_ROW } from "@shared/model/arrangement";
import { LABELS_ONLY_LIFECYCLES, STATES_ROW, cleanLifecycle, lifecycleProblems, type EffectiveTransition } from "@shared/model/lifecycle";
import { lockRefusal } from "@shared/forms/locked";
import { isRequiredFor, requirementBlockers, tablesBehind } from "@shared/forms/paths";
import { libraryFieldDef, resolveFieldType, storageChange, type LibraryFieldRow } from "@shared/forms/fieldtypes";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { bad, forbidden } from "../../http/errors";
import { snapshotFor, catalogOf, accessSettings } from "../../access/subject";
import { actorId, isSystemCtx, orgSchema, pushGuard, registerHooks, removeIn, validationError, type PushArgs, type WriteArgs } from "../../engine";
import { condPaths } from "@shared/model/conditions";
import { sysOf } from "../admin/common";
import { customFieldDef, snapshotField } from "../../engine/schema";
import { SETTINGS_ENV, orgFieldTypes } from "./hooks";
import { LIFECYCLE_REFUSAL, holdsSettings } from "./grants";

/** Tables that take no library field: a process case keeps its values in one json field (design F §3.6). */
export const NO_LIBRARY_TABLES = new Set(["process_case"]);

/** The name of an active UI policy of `table` that makes `field` mandatory, or null. */
export async function mandatoryPolicy(q: Queryable, orgId: string, table: string, field: string): Promise<string | null> {
  const rows = await q.query<{ name: string; actions: unknown }>(
    `select name, actions from sm_ui_policies where org_id = $1 and table_key = $2 and active and deleted_at is null order by sort_order, name`,
    [orgId, table],
  );
  for (const r of rows) {
    const actions = Array.isArray(r.actions) ? (r.actions as Record<string, unknown>[]) : [];
    if (actions.some((a) => a && a.field === field && a.mandatory === true)) return r.name;
  }
  return null;
}

/** Does every active portal report problems through a catalogue form (portal settings `report_item_id`)? */
export async function portalReportsThroughCatalogue(q: Queryable, orgId: string): Promise<boolean> {
  const rows = await q.query<{ report_item_id: string | null }>(`select report_item_id from sm_portals where org_id = $1 and active and deleted_at is null`, [orgId]);
  return rows.length > 0 && rows.every((r) => !!r.report_item_id);
}

/** The roles of the organisation by key (built-ins under its preset and its own), for `also`. */
async function roleKeys(w: Pick<WriteArgs, "ctx" | "tx">): Promise<Set<string>> {
  return new Set(catalogOf(await snapshotFor(w.ctx, w.tx, true), accessSettings(w.ctx.org)).keys());
}

/** Problems of a `_states` row for `base` (the module's definition); the stored overlay is cleaned. */
async function statesRules(w: WriteArgs, base: TableDef): Promise<void> {
  const schema = await orgSchema(w.ctx, w.tx);
  const eff = schema.def(base.key) ?? base;
  const roles = await roleKeys(w);
  const field = (n: string): FieldDef | undefined => eff.fields.find((f) => f.name === n);
  const problems = lifecycleProblems(base, w.next.options, {
    field,
    formHidden: (n) => !!field(n)?.formHidden,
    roleExists: (k) => roles.has(k),
    labelsOnly: LABELS_ONLY_LIFECYCLES.has(base.key),
    def: eff,
    lookup: schema.lookup,
  });
  if (problems.length) throw bad(problems[0], { problems });
  w.next.options = cleanLifecycle(w.next.options);
}

/** Columns of an earlier row of a field on a table: its values stay in `custom`, a deleted row's too. */
interface EarlierRow {
  library_id: string | null;
  deleted_at: string | null;
  name: string;
  label: string;
  type: string | null;
  choices: string | null;
  options: unknown;
  ref: string | null;
  required: boolean;
  list: boolean;
  search: boolean;
  filter: boolean;
  help: string | null;
  section: string | null;
  field_group: string | null;
  max_length: number | null;
}

/**
 * Why the library field `lib` (whose definition is `field`) cannot take its name on `base`: an earlier row of that name
 * on the table — deactivated or deleted, its values still in `custom` — stood for another library field, or for a
 * field whose stored values mean something else (`storageChange`: another storage type, target table or list). Null
 * when it can; a row of the same library field is its own (its storage holds while the row lives).
 */
function earlierRowProblem(base: TableDef, lib: { id: string; name: string }, field: FieldDef, rows: EarlierRow[]): string | null {
  for (const r of rows) {
    const was = r.library_id ? (String(r.library_id) === lib.id ? snapshotField(r.options) : null) : customFieldDef(r);
    const same = r.library_id && String(r.library_id) === lib.id ? !was || !storageChange(was, field) : !!was && !storageChange(was, field);
    if (same) continue;
    return r.deleted_at
      ? `«${base.plural}» پیش‌تر فیلد دیگری به نام «${lib.name}» داشته است و مقدارهایش در رکوردها مانده است؛ فیلدی با نام فنی دیگر به کار ببرید`
      : `«${base.plural}» فیلدی به نام «${lib.name}» دارد`;
  }
  return null;
}

/**
 * A library row: an active library field of the organisation, under its own name, on a table that takes one, and
 * never over values an earlier field of that name left behind with another meaning (`earlierRowProblem`).
 */
async function libraryRules(w: WriteArgs, base: TableDef, field: FieldDef | null): Promise<void> {
  const { tx, ctx, op, next, prev, changed } = w;
  const reactivated = prev?.active === false && next.active !== false;
  if (!(op === "create" || reactivated || changed.has("library_id") || changed.has("name") || changed.has("table_key"))) return;
  if (NO_LIBRARY_TABLES.has(base.key)) throw bad("پرونده‌های گردش‌کار فیلد کتابخانه نمی‌گیرند؛ فیلدهای پرونده در فرم‌های گردش‌کار تعریف می‌شوند");
  const lib = await tx.one<{ id: string; name: string; label: string; type: string; status: string | null }>(
    `select id, name, label, type, status from sm_field_defs where org_id = $1 and id = $2 and deleted_at is null`,
    [ctx.org.id, String(next.library_id)],
  );
  if (!lib) throw bad("فیلد کتابخانه پیدا نشد");
  if (lib.status === "retired" && (op === "create" || changed.has("library_id"))) throw bad(`فیلد «${lib.label}» بازنشسته است و به جدول تازه‌ای افزوده نمی‌شود`);
  if (String(next.name ?? "") !== lib.name) throw bad(`نام فیلد در جدول همان نام فنی فیلد کتابخانه است: «${lib.name}»`);
  if (base.fields.some((f) => f.name === lib.name)) throw bad(`«${base.plural}» فیلدی به نام «${lib.name}» دارد`);
  if (!resolveFieldType(lib.type, await orgFieldTypes(tx, ctx.org.id), SETTINGS_ENV)) throw bad(`نوع فیلد «${lib.label}» دیگر وجود ندارد`);
  if (!field) return;
  const rows = await tx.query<EarlierRow>(
    `select library_id, deleted_at, name, label, type, choices, options, ref, required, list, search, filter, help, section, field_group, max_length
     from sm_custom_fields where org_id = $1 and table_key = $2 and name = $3 and id <> $4`,
    [ctx.org.id, base.key, lib.name, String(next.id)],
  );
  // the row itself as it was, when it already held values under this name (a plain field given a library field)
  if (prev && prev.table_key === next.table_key && prev.name === next.name) rows.push(prev as EarlierRow);
  const problem = earlierRowProblem(base, lib, field, rows);
  if (problem) throw bad(problem);
}

/**
 * An override or organisation field row: the refused combinations. Asked only when the write touches what they
 * depend on, so an older row (a requirement made before a field was locked) can still be relabelled.
 */
async function fieldRules(w: WriteArgs, base: TableDef): Promise<void> {
  const { tx, ctx, op, next, prev, changed } = w;
  const touched = (cols: string[]) => op === "create" || prev?.active === false || cols.some((c) => changed.has(c));
  if (!touched(["form_hidden", "required", "required_for", "table_key", "name", "library_id"])) return;
  const name = String(next.name ?? "");
  const own = base.fields.find((f) => f.name === name && !f.custom);
  const label = own?.label ?? String(next.label ?? name);
  const hide = next.form_hidden === true;
  const require = next.required === true;
  if (hide && require) {
    throw bad(changed.has("form_hidden") && !changed.has("required") && op !== "create"
      ? `«${label}» الزامی است و از فرم پنهان نمی‌شود؛ نخست الزام را بردارید`
      : `«${label}» در فرم پنهان است و الزامی نمی‌شود؛ نخست آن را در فرم نشان دهید`);
  }
  if (own) {
    const refusal = (hide && lockRefusal(base, name, "hide")) || (require && lockRefusal(base, name, "require"));
    if (refusal) throw bad(refusal);
  }
  if (hide) {
    const policy = await mandatoryPolicy(tx, ctx.org.id, base.key, name);
    if (policy) throw bad(`«${label}» در سیاست فرم «${policy}» الزامی است و از فرم پنهان نمی‌شود`);
    const eff = (await orgSchema(ctx, tx)).def(base.key);
    const t = eff?.states?.transitions.find((x) => (x as EffectiveTransition).needs?.includes(name));
    if (t) throw bad(`«${label}» برای «${t.label}» لازم است و از فرم پنهان نمی‌شود`);
  }
  if (require) {
    const rf = isRequiredFor(next.required_for) ? next.required_for : "all";
    const blockers = requirementBlockers(base.key, rf, { portalReportItem: await portalReportsThroughCatalogue(tx, ctx.org.id) });
    if (blockers.length) throw bad(blockers[0]);
  }
}

/**
 * The field a library row stands for, as its table needs it (`libraryFieldDef` of the field and its type), kept on the
 * row in `options.field`: a Windows app whose account does not read «طراحی فرم و گردش‌کار» still has it (it receives the
 * `custom_field` row, not the library's), so a library field behaves there like any custom field.
 */
export async function librarySnapshot(q: Queryable, orgId: string, libraryId: string): Promise<FieldDef | null> {
  const lib = await q.one<LibraryFieldRow>(
    `select name, label, type, help, placeholder, default_value, options, choices, depends_on, validation, field_group, list, search, filter, status
     from sm_field_defs where org_id = $1 and id = $2 and deleted_at is null`,
    [orgId, libraryId],
  );
  if (!lib) return null;
  const type = resolveFieldType(lib.type, await orgFieldTypes(q, orgId), SETTINGS_ENV);
  return type ? libraryFieldDef(lib, type, SETTINGS_ENV) : null;
}

const ORG_FIELD = /^u_[a-z0-9_]{1,40}$/;

/**
 * An organisation field the lifecycle overlay names — in a transition's organisation fields (`requires`) or its
 * condition (`when`) — stays on its table while the overlay names it: switched off, deleted, renamed or moved away,
 * people could never take that transition again (design F §4.2). The overlay is changed first. Held for every writer:
 * nothing may leave the overlay naming a missing field (the schema leaves such names out as well, `pruneLifecycle`).
 */
async function keepNamedFields(w: WriteArgs): Promise<void> {
  const prev = w.prev;
  if (!prev || prev.active === false || !ORG_FIELD.test(String(prev.name ?? ""))) return;
  const away = w.op === "delete" || w.next.active === false || w.next.name !== prev.name || w.next.table_key !== prev.table_key;
  if (!away) return;
  const name = String(prev.name);
  const eff = (await orgSchema(w.ctx, w.tx)).def(String(prev.table_key ?? ""));
  const t = eff?.states?.transitions.find((x) => {
    const e = x as EffectiveTransition;
    return !!e.needs?.includes(name) || (!!e.when && condPaths(e.when).has(name));
  });
  if (t) throw bad(`«${String(prev.label ?? name)}» برای «${t.label}» در چرخهٔ عمر «${eff!.plural}» به کار رفته است و از جدول برداشته نمی‌شود؛ نخست آن را از چرخهٔ عمر بردارید`);
}

/** Remove a table's lifecycle overlay (as the system, for the person): a studio table's goes with the table. */
export async function removeLifecycleOverlay(tx: Tx, ctx: Ctx, table: string): Promise<void> {
  const rows = await tx.query<{ id: string }>(`select id from sm_custom_fields where org_id = $1 and table_key = $2 and name = $3 and deleted_at is null`, [ctx.org.id, table, STATES_ROW]);
  if (!rows.length) return;
  const sys = sysOf(ctx, actorId(ctx));
  for (const r of rows) await removeIn(tx, sys, "custom_field", String(r.id), { trusted: true });
}

async function customFieldRules(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return keepNamedFields(w);
  if (w.op !== "create" && w.op !== "update") return;
  // the lifecycle overlay is the administrator's (`settings` full, design F §6.1) on every path — creating, changing or
  // switching it off through the generic record API as on F1's route (which checks the person, then writes as the system)
  if ((w.next.name === STATES_ROW || w.prev?.name === STATES_ROW) && !w.trusted && !isSystemCtx(w.ctx) && !(await holdsSettings(w.ctx, "full", w.tx))) {
    throw forbidden(LIFECYCLE_REFUSAL);
  }
  const base = tableDef(String(w.next.table_key ?? ""));
  if (!base || base.virtual) return;
  const name = String(w.next.name ?? "");
  if (name === FORM_ROW) return;
  if (name === STATES_ROW) {
    if (w.next.active !== false && (w.op === "create" || w.prev?.active === false || ["options", "table_key", "name"].some((c) => w.changed.has(c)))) await statesRules(w, base);
    return;
  }
  await keepNamedFields(w);
  // a library row is held whether or not it is active: a row given a library field while off would come back with it
  if (w.next.library_id) {
    const field = await librarySnapshot(w.tx, w.ctx.org.id, String(w.next.library_id));
    await libraryRules(w, base, field);
    // whatever the write says, the row carries the library's current definition
    w.next.options = field ? { field } : null;
  }
  if (w.next.active === false) return;
  await fieldRules(w, base);
}

/** A UI policy never makes mandatory a field hidden from the form. */
async function uiPolicyRules(w: WriteArgs): Promise<void> {
  if ((w.op !== "create" && w.op !== "update") || w.next.active === false) return;
  const actions = Array.isArray(w.next.actions) ? (w.next.actions as Record<string, unknown>[]) : [];
  const mandatory = actions.filter((a) => a && a.mandatory === true && typeof a.field === "string").map((a) => String(a.field));
  if (!mandatory.length) return;
  const eff = (await orgSchema(w.ctx, w.tx)).def(String(w.next.table_key ?? ""));
  if (!eff) return;
  for (const n of mandatory) {
    const f = eff.fields.find((x) => x.name === n);
    if (f?.formHidden) throw validationError({ actions: `«${f.label}» در فرم پنهان است و سیاست فرم آن را الزامی نمی‌کند؛ نخست آن را در فرم نشان دهید` });
  }
}

/** The tables people report through the portal's «گزارش مشکل», whose built-in form cannot carry a field (incident). */
const PORTAL_REPORT_TABLES = tablesBehind("portal_report_item");

/** A requirement «همه» on a table people report through the portal's built-in form (the first one), or null. */
async function requirementForAll(w: Pick<WriteArgs, "ctx" | "tx">): Promise<{ field: FieldDef; def: TableDef } | null> {
  const schema = await orgSchema(w.ctx, w.tx);
  for (const t of PORTAL_REPORT_TABLES) {
    const def = schema.def(t);
    const field = def?.fields.find((f) => f.formRequired === "all");
    if (def && field) return { field, def };
  }
  return null;
}

/**
 * The portal's side of a requirement «همه» (design F §3.3): it is saved only while every active portal reports problems
 * through a catalogue form (`requirementBlockers`), since the built-in form cannot carry the field and requesters could
 * then not report at all. While it stands, a portal write that brings the built-in form back is refused: an active
 * portal without a catalogue form (created, switched on, or its form cleared), and taking away — switching off or
 * deleting — the last active portal that has one (with no portal at all, the portal's defaults use the built-in form).
 * Trusted code (the portal's own seed) is not asked.
 */
async function portalRules(w: WriteArgs): Promise<void> {
  if (w.trusted || (w.op !== "create" && w.op !== "update" && w.op !== "delete")) return;
  const before = !!w.prev && w.prev.active !== false && !w.prev.deleted_at;
  const after = w.op !== "delete" && w.next.active !== false;
  const had = before && !!w.prev!.report_item_id;
  const has = after && !!w.next.report_item_id;
  // an active portal on the built-in form that was not one, or the catalogue form of an active portal taken away
  const opens = after && !has && !(before && !had);
  const closes = had && !has;
  if (!opens && !closes) return;
  const req = await requirementForAll(w);
  if (!req) return;
  const why = `«${req.field.label}» در «${req.def.plural}» برای «همه» الزامی است و فرم پیش‌فرض «گزارش مشکل» درگاه آن را ندارد`;
  if (opens) throw bad(`«گزارش مشکل» این درگاه فرم کاتالوگ می‌خواهد: ${why}. قلمی از کاتالوگ برای «گزارش مشکل» برگزینید، یا نخست الزام را «فقط کارشناسان» کنید`);
  const other = await w.tx.one(
    `select 1 from sm_portals where org_id = $1 and id <> $2 and active and deleted_at is null and report_item_id is not null limit 1`,
    [w.ctx.org.id, String(w.prev!.id)],
  );
  if (!other) throw bad(`این آخرین درگاهی است که «گزارش مشکل» را با فرم کاتالوگ می‌گیرد: ${why}. نخست درگاه دیگری با فرم کاتالوگ فعال کنید، یا الزام را «فقط کارشناسان» کنید`);
}

/** A Windows app's pushed deletion of a portal, judged like the API's (`validatePushDelete`: `next` is the stored row). */
async function portalPushDelete(p: PushArgs): Promise<string | null> {
  try {
    await portalRules({ tx: p.tx, ctx: p.ctx, def: p.def, op: "delete", next: { ...p.next }, prev: p.prev ?? p.next, changed: new Set(["deleted_at"]), env: p.env, via: "sync", trusted: false });
    return null;
  } catch (e) {
    const status = (e as { status?: unknown })?.status;
    if (typeof status === "number" && status >= 400 && status < 500) return String((e as Error).message);
    throw e;
  }
}

/** An option module code tests is never deactivated by the organisation's row. */
function choiceRules(w: WriteArgs): void {
  if ((w.op !== "create" && w.op !== "update") || w.next.active !== false) return;
  const o = CHOICE_LISTS.get(String(w.next.list ?? ""))?.find((x) => x.value === String(w.next.value ?? ""));
  if (o?.locked) throw bad(`گزینهٔ «${o.label}» را ماژول به کار می‌برد و غیرفعال نمی‌شود؛ برچسب، رنگ و ترتیبش را می‌توانید تغییر دهید`);
}

let installed = false;

export function installCombinationHooks(): void {
  if (installed) return;
  installed = true;
  registerHooks("custom_field", { beforeWrite: customFieldRules });
  // a studio table's lifecycle overlay goes with the table: a table made later in the slot starts from the module's
  registerHooks("custom_table", {
    async afterWrite(w) {
      if (w.op === "delete" && w.row.slot) await removeLifecycleOverlay(w.tx, w.ctx, String(w.row.slot));
    },
  });
  registerHooks("ui_policy", { beforeWrite: uiPolicyRules, validatePush: pushGuard(uiPolicyRules) });
  registerHooks("choice", { beforeWrite: choiceRules, validatePush: pushGuard(choiceRules) });
  registerHooks("portal", { beforeWrite: portalRules, validatePush: pushGuard(portalRules), validatePushDelete: portalPushDelete });
}
