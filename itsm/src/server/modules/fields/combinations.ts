// What an organisation may change on built-in tables (design F §3.3, §4.2, package F1), held on every path — F1's
// routes, the generic record API, imports and the studio — for the system as for people:
//   · `custom_field` override rows: a locked field is never hidden from the form or required in the organisation's
//     name (`lockRefusal`, with its reasons); a field is never both hidden and required — nor hidden while a UI
//     policy makes it mandatory or a transition of the organisation's lifecycle requires it; «همه» is refused where
//     people create through a fixed form that cannot carry the field (`requirementBlockers`: the portal's built-in
//     «گزارش مشکل»);
//   · library rows (`library_id`): a live, active library field, under its own name, never on a process case, never
//     over values an earlier field of that name (deactivated or deleted) left with another meaning;
//   · the `_states` row: a valid lifecycle overlay (`lifecycleProblems`), stored clean;
//   · `ui_policy`: no mandatory field that is hidden from the form;
//   · `choice`: an option a module marks `locked` is never deactivated (relabelled, recoloured, reordered: yes).
// A Windows app's push of UI policies and choice rows meets the same rules (custom_field rows are web-only).
import { CHOICE_LISTS, tableDef } from "@shared/tables";
import type { FieldDef, TableDef } from "@shared/model/types";
import { FORM_ROW } from "@shared/model/arrangement";
import { LABELS_ONLY_LIFECYCLES, STATES_ROW, cleanLifecycle, lifecycleProblems, type EffectiveTransition } from "@shared/model/lifecycle";
import { lockRefusal } from "@shared/forms/locked";
import { isRequiredFor, requirementBlockers } from "@shared/forms/paths";
import { libraryFieldDef, resolveFieldType, storageChange, type LibraryFieldRow } from "@shared/forms/fieldtypes";
import type { Queryable } from "../../db";
import { bad, forbidden } from "../../http/errors";
import { snapshotFor, catalogOf, accessSettings } from "../../access/subject";
import { isSystemCtx, orgSchema, pushGuard, registerHooks, validationError, type WriteArgs } from "../../engine";
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

async function customFieldRules(w: WriteArgs): Promise<void> {
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
  registerHooks("ui_policy", { beforeWrite: uiPolicyRules, validatePush: pushGuard(uiPolicyRules) });
  registerHooks("choice", { beforeWrite: choiceRules, validatePush: pushGuard(choiceRules) });
}
