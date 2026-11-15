// Integrity of the field library (design F §3.1, package F1) on every path — F1's routes, the generic record API and
// imports — for the system as for people:
//   · field_type: a key u_* that never changes; a built-in base type; a widget of the same storage type; settings the
//     built-in type allows (`typeRowSettings`); its storage kept while library fields use it; deleted only when
//     unused (retire it instead)
//   · field_def: a name u_* that never changes once the field is used; a known, active type (a retired type is not
//     offered for new fields); settings its built-in type allows, a target table for references, a known default token;
//     its storage kept while it is used; deleted only when unused; its group of sensitivity (`field_group`)
//     changed only by holders of `settings` edit once it is attached to tables (`groupChangeRefusal`)
//   · both are changed on the web version or the server edition: a Windows app's push is refused, as for custom fields
import type { FieldDef, FieldType } from "@shared/model/types";
import { validateCond } from "@shared/model/conditions";
import { tableDef } from "@shared/tables";
import {
  LIBRARY_NAME, TYPE_KEY, builtinFieldType, libraryFieldDef, libraryFieldSettings, resolveFieldType, sameStorage, storageChange, typeRowSettings,
  type FieldTypeRow, type LibraryFieldRow, type SettingsEnv,
} from "@shared/forms/fieldtypes";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { bad, forbidden } from "../../http/errors";
import { actorId, invalidateSchema, isSystemCtx, registerHooks, updateIn, webOnly, type WriteArgs } from "../../engine";
import { pgArray } from "../../db";
import { sysOf } from "../admin/common";
import { fieldUsage, fieldsOfType, inUse, type FieldUsage } from "./usage";
import { holdsSettings } from "./grants";

/** What the shared cleaners cannot know: which tables exist and whether a condition fits a table. */
export const SETTINGS_ENV: SettingsEnv = {
  tableExists: (key) => {
    const def = tableDef(key);
    return !!def && !def.virtual;
  },
  condProblem: (table, cond) => {
    const def = tableDef(table);
    return def ? validateCond(cond, def) : `جدول «${table}» وجود ندارد`;
  },
};

/** The organisation's field types (live rows), by key. */
export async function orgFieldTypes(q: Queryable, orgId: string): Promise<Map<string, FieldTypeRow>> {
  const rows = await q.query<FieldTypeRow>(
    `select key, name, base, widget, validation, display, options, choices, status from sm_field_types where org_id = $1 and deleted_at is null`,
    [orgId],
  );
  return new Map(rows.map((r) => [r.key, r]));
}

const names = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).join("، ")} و ${xs.length - 3} مورد دیگر` : xs.join("، "));

/** Where a field is used, for a message («در جدول‌های «رخدادها»، «مشکلات»»). */
export function whereUsed(u: FieldUsage): string {
  const parts: string[] = [];
  if (u.tables.length) parts.push(`در جدول‌های ${names(u.tables.map((t) => `«${tableDef(t)?.plural ?? t}»`))}`);
  if (u.forms.length) parts.push(`در فرم‌های ${names(u.forms.map((f) => `«${f}»`))}`);
  if (u.versions.length) parts.push(`در نسخه‌های منتشرشدهٔ ${names(u.versions.map((v) => `«${v}»`))}`);
  return parts.join(" و ");
}

// Storage (design F §3.1: kept while used): the storage type, and what the stored values point to — a reference's
// target table (from the built-in type, the type row or the field's own settings) and a choice's list (a shared list's
// key, or the field's own options). Changing either would make the stored values read as something else.

/** Why a used field (or the fields of a type, `ofType`) may not change their storage this way. */
function storageRefusal(change: "type" | "ref" | "list", label: string, where: string, was: FieldDef | null, ofType = false): string {
  const subject = ofType ? `نوع «${label}»` : `«${label}»`;
  const used = ofType ? `فیلدهای ${where} از آن استفاده می‌کنند` : `این فیلد ${where} به کار رفته است`;
  if (change === "ref") return `جدول مقصد ${subject} عوض نمی‌شود: ${used} و مقدارهای ذخیره‌شده به «${tableDef(String(was?.ref ?? ""))?.plural ?? String(was?.ref ?? "")}» اشاره می‌کنند`;
  if (change === "list") return `فهرست گزینه‌های ${subject} عوض نمی‌شود: ${used} و مقدارهای ذخیره‌شده از فهرست کنونی‌اند؛ گزینه‌های همین فهرست را ویرایش کنید`;
  return ofType
    ? `نوع ذخیرهٔ «${label}» عوض نمی‌شود: ${used}؛ فقط نوع پایه‌ای با همان نوع ذخیره پذیرفته می‌شود`
    : `نوع ذخیرهٔ «${label}» عوض نمی‌شود: ${used}؛ فقط نوعی با همان نوع ذخیره پذیرفته می‌شود (مثلاً فهرست کشویی ↔ گزینه‌های تکی)`;
}

/** What a field's definition makes of its stored values when its type or settings change (null: nothing). */
function changeOf(was: FieldDef | null, now: FieldDef | null): "type" | "ref" | "list" | null {
  if (was && now) return storageChange(was, now);
  return !was !== !now ? "ref" : null;
}

async function fieldTypeBefore({ tx, ctx, op, next, prev }: WriteArgs): Promise<void> {
  if (op === "delete") {
    const used = await fieldsOfType(tx, ctx.org.id, String(prev?.key ?? next.key ?? ""));
    if (used.length) throw bad(`نوع «${String(prev?.name ?? next.name ?? "")}» در فیلدهای ${names(used.map((f) => `«${f.label}»`))} به کار رفته است؛ به‌جای حذف، آن را بازنشسته کنید`);
    return;
  }
  if (op !== "create" && op !== "update") return;
  const key = String(next.key ?? "");
  if (op === "update" && prev && prev.key !== next.key) throw bad("کلید نوع فیلد پس از ساخت تغییر نمی‌کند");
  if (!TYPE_KEY.test(key)) throw bad("کلید نوع فیلد باید با u_ شروع شود و فقط حرف کوچک لاتین، رقم و _ داشته باشد (حداکثر ۴۲ نویسه)");
  const base = builtinFieldType(next.base);
  if (!base) throw bad(`نوع پایهٔ «${String(next.base ?? "")}» وجود ندارد`);
  if (base.settings.ref && !SETTINGS_ENV.tableExists!(base.settings.ref)) throw bad(`نوع «${base.label}» هنوز در این سامانه به کار نمی‌رود`);
  if (op === "update" && prev) {
    // the storage of every field of the type, under the type as it was and as it will be (a field's own reference or
    // list wins over the type's, so only the fields that follow the type's are held)
    const was = resolveFieldType(key, new Map([[key, prev as FieldTypeRow]]), SETTINGS_ENV);
    const now = resolveFieldType(key, new Map([[key, next as FieldTypeRow]]), SETTINGS_ENV);
    if (was && now) {
      const fields = await tx.query<LibraryFieldRow & { id: string }>(
        `select id, name, label, type, validation, options, choices from sm_field_defs where org_id = $1 and type = $2 and deleted_at is null order by label`,
        [ctx.org.id, key],
      );
      const moved = fields
        .map((f) => {
          const before = libraryFieldDef(f, was, SETTINGS_ENV);
          return { f, before, change: sameStorage(was, now) ? changeOf(before, libraryFieldDef(f, now, SETTINGS_ENV)) : ("type" as const) };
        })
        .filter((m) => m.change);
      if (moved.length) throw bad(storageRefusal(moved[0].change!, String(next.name ?? key), names(moved.map((m) => `«${m.f.label}»`)), moved[0].before, true));
    }
  }
  const { problems } = typeRowSettings(base, next, SETTINGS_ENV);
  if (problems.length) throw bad(problems[0]);
}

const groupOf = (v: unknown): string | null => (v === undefined || v === null || v === "" ? null : String(v));

/** Does a write change a library field's group of sensitivity (`field_group`)? */
export const groupChanges = (prev: { field_group?: unknown }, next: { field_group?: unknown }): boolean => groupOf(prev.field_group) !== groupOf(next.field_group);

/**
 * A library field's group of sensitivity decides who reads its values on every table it is attached to, so changing
 * it there changes those tables (overrides of tables are `settings` edit, design F §6.1) whatever the person's rights in
 * «طراحی فرم و گردش‌کار». The refusal for a person without `settings` edit, or null.
 */
export async function groupChangeRefusal(q: Queryable, ctx: Ctx, field: { id: string; name: string; label: string }): Promise<string | null> {
  const u = await fieldUsage(q, ctx.org.id, field);
  if (!u.tables.length || (await holdsSettings(ctx, "edit", q))) return null;
  return `گروه فیلد «${field.label}» تغییر نکرد: این فیلد ${whereUsed({ tables: u.tables, forms: [], versions: [] })} به کار رفته است و تغییر گروهش دسترسی «تنظیمات سازمان» می‌خواهد`;
}

/** Default tokens and the storage types they fill. */
const TOKEN_TYPES: Record<string, FieldType[]> = {
  $now: ["datetime"],
  $today: ["date", "datetime"],
  $me: ["user", "users"],
  $my_unit: ["ref"],
  $my_domain: ["ref"],
};

async function fieldDefBefore({ tx, ctx, op, next, prev, trusted }: WriteArgs): Promise<void> {
  if (op === "delete") {
    const u = await fieldUsage(tx, ctx.org.id, { id: String(prev?.id ?? next.id), name: String(prev?.name ?? next.name ?? "") });
    if (inUse(u)) throw bad(`فیلد «${String(prev?.label ?? next.label ?? "")}» ${whereUsed(u)} به کار رفته است؛ به‌جای حذف، آن را بازنشسته کنید`);
    return;
  }
  if (op !== "create" && op !== "update") return;
  const name = String(next.name ?? "");
  const label = String(next.label ?? name);
  if (!LIBRARY_NAME.test(name)) throw bad("نام فنی فیلد باید با u_ شروع شود و فقط حرف کوچک لاتین، رقم و _ داشته باشد (حداکثر ۴۲ نویسه)");
  const types = await orgFieldTypes(tx, ctx.org.id);
  const type = resolveFieldType(next.type, types, SETTINGS_ENV);
  if (!type) throw bad(`نوع فیلد «${String(next.type ?? "")}» وجود ندارد`);
  const typeChanged = op === "create" || prev?.type !== next.type;
  if (typeChanged && type.retired) throw bad(`نوع «${type.label}» بازنشسته است و برای فیلد تازه به کار نمی‌رود`);
  // a built-in type whose fixed target table has not landed yet (the «نقش سازمانی» picker before the positions)
  const fixed = type.builtin.settings.ref;
  if (typeChanged && fixed && !SETTINGS_ENV.tableExists!(fixed)) throw bad(`نوع «${type.builtin.label}» هنوز در این سامانه به کار نمی‌رود`);
  if (op === "update" && prev) {
    const renamed = prev.name !== next.name;
    const before = typeChanged ? resolveFieldType(prev.type, types, SETTINGS_ENV) : type;
    // its storage: the storage type, and the target table or list its values point to — whatever changed, the type or
    // the field's own settings
    const was = before ? libraryFieldDef({ name: String(prev.name ?? ""), label, type: String(prev.type), validation: prev.validation, options: prev.options, choices: prev.choices }, before, SETTINGS_ENV) : null;
    const now = libraryFieldDef({ name, label, type: String(next.type), validation: next.validation, options: next.options, choices: next.choices }, type, SETTINGS_ENV);
    const change = !before ? null : !sameStorage(before, type) ? "type" : changeOf(was, now);
    if (renamed || change) {
      const u = await fieldUsage(tx, ctx.org.id, { id: String(prev.id), name: String(prev.name) });
      if (inUse(u) && renamed) throw bad(`نام فنی «${String(prev.name)}» عوض نمی‌شود: این فیلد ${whereUsed(u)} به کار رفته است`);
      if (inUse(u) && change) throw bad(storageRefusal(change, label, whereUsed(u), was));
    }
    // a person's write (the generic API, imports); F1's route asks the same of the person before it writes as the system
    if (!trusted && !isSystemCtx(ctx) && groupChanges(prev, next)) {
      const refusal = await groupChangeRefusal(tx, ctx, { id: String(prev.id), name: String(prev.name), label: String(prev.label ?? label) });
      if (refusal) throw forbidden(refusal);
    }
  }
  const { problems } = libraryFieldSettings(next, type, SETTINGS_ENV);
  if (problems.length) throw bad(problems[0]);
  const field = libraryFieldDef({ name, label, type: String(next.type), validation: next.validation, options: next.options, choices: next.choices }, type, SETTINGS_ENV);
  if (!field) throw bad(`جدول مقصد «${label}» را برگزینید`);
  const dependsOn = next.depends_on ? String(next.depends_on) : "";
  if (dependsOn) {
    if (type.base !== "choice" && type.base !== "multichoice") throw bad("فقط فیلد گزینه‌ای به فیلد دیگری وابسته می‌شود");
    if (!LIBRARY_NAME.test(dependsOn) || dependsOn === name) throw bad(`فیلد «${dependsOn}» برای وابستگی معتبر نیست`);
  }
  const dflt = next.default_value;
  if (typeof dflt === "string" && dflt.startsWith("$")) {
    const fits = TOKEN_TYPES[dflt];
    if (!fits) throw bad(`مقدار پیش‌فرض «${dflt}» شناخته نیست؛ $today، $now، $me، $my_unit یا $my_domain`);
    const unitRef = dflt === "$my_unit" || dflt === "$my_domain" ? field.ref === "org_unit" : true;
    if (!fits.includes(type.base) || !unitRef) throw bad(`مقدار پیش‌فرض «${dflt}» به نوع «${type.label}» نمی‌خورد`);
  }
}

/**
 * The `custom_field` rows that attach these library fields are written again (as the system, for the person who
 * changed the library): their hook stores the field's new definition on them, and Windows apps receive it.
 */
async function refreshAttached(w: WriteArgs, libraryIds: string[]): Promise<void> {
  if (!libraryIds.length) return;
  const rows = await w.tx.query<{ id: string; library_id: string }>(
    `select id, library_id from sm_custom_fields where org_id = $1 and library_id = any($2::uuid[]) and deleted_at is null`,
    [w.ctx.org.id, pgArray(libraryIds)],
  );
  const sys = sysOf(w.ctx, actorId(w.ctx));
  for (const r of rows) await updateIn(w.tx, sys, "custom_field", r.id, { library_id: r.library_id }, { trusted: true });
}

let installed = false;

export function installFieldHooks(): void {
  if (installed) return;
  installed = true;
  // the schema cache follows both tables through its stamp; the request that changed them sees the change at once, and
  // the tables a changed field (or a field of a changed type) is attached to get its new definition on their rows
  registerHooks("field_type", {
    beforeWrite: fieldTypeBefore,
    async afterWrite(w) {
      invalidateSchema(w.ctx.org.id);
      if (w.op !== "update") return;
      const fields = await w.tx.query<{ id: string }>(`select id from sm_field_defs where org_id = $1 and type = $2 and deleted_at is null`, [w.ctx.org.id, String(w.row.key ?? "")]);
      await refreshAttached(w, fields.map((f) => f.id));
    },
    ...webOnly("نوع فیلد"),
  });
  registerHooks("field_def", {
    beforeWrite: fieldDefBefore,
    async afterWrite(w) {
      invalidateSchema(w.ctx.org.id);
      if (w.op === "update") await refreshAttached(w, [String(w.row.id)]);
    },
    ...webOnly("فیلد"),
  });
}
