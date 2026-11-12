// What an organisation may change on built-in tables (design F §3.3, §4.2, package F1), held on every path — F1's
// routes, the generic record API, imports and the studio — for the system as for people:
//   · `custom_field` override rows: a locked field is never hidden from the form or required in the organisation's
//     name (`lockRefusal`, with its reasons); a field is never both hidden and required — nor hidden while a UI
//     policy makes it mandatory or a transition of the organisation's lifecycle requires it; «همه» is refused where
//     people create through a fixed form that cannot carry the field (`requirementBlockers`: the portal's built-in
//     «گزارش مشکل»);
//   · library rows (`library_id`): a live, active library field, under its own name, never on a process case;
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
import { libraryFieldDef, resolveFieldType, type LibraryFieldRow } from "@shared/forms/fieldtypes";
import type { Queryable } from "../../db";
import { bad, forbidden } from "../../http/errors";
import { snapshotFor, catalogOf, accessSettings } from "../../access/subject";
import { isSystemCtx, orgSchema, pushGuard, registerHooks, validationError, type WriteArgs } from "../../engine";
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

/** A library row: an active library field of the organisation, under its own name, on a table that takes one. */
async function libraryRules(w: WriteArgs, base: TableDef): Promise<void> {
  const { tx, ctx, op, next, changed } = w;
  if (!(op === "create" || changed.has("library_id") || changed.has("name") || changed.has("table_key"))) return;
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
  if (w.next.active === false) return;
  const base = tableDef(String(w.next.table_key ?? ""));
  if (!base || base.virtual) return;
  const name = String(w.next.name ?? "");
  if (name === FORM_ROW) return;
  if (name === STATES_ROW) {
    if (w.op === "create" || w.prev?.active === false || ["options", "table_key", "name"].some((c) => w.changed.has(c))) await statesRules(w, base);
    return;
  }
  if (w.next.library_id) {
    await libraryRules(w, base);
    // whatever the write says, the row carries the library's current definition
    const field = await librarySnapshot(w.tx, w.ctx.org.id, String(w.next.library_id));
    w.next.options = field ? { field } : null;
  }
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
