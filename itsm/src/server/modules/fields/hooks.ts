// Integrity of the field library (design F §3.1, package F1) on every path — F1's routes, the generic record API and
// imports — for the system as for people:
//   · field_type: a key u_* that never changes; a built-in base type; a widget of the same storage type; settings the
//     built-in type allows (`typeRowSettings`); its storage type kept while library fields use it; deleted only when
//     unused (retire it instead)
//   · field_def: a name u_* that never changes once the field is used; a known, active type (a retired type is not
//     offered for new fields); settings its built-in type allows, a target table for references, a known default token;
//     its storage type kept while it is used; deleted only when unused
//   · both are changed on the web version or the server edition: a Windows app's push is refused, as for custom fields
import type { FieldType } from "@shared/model/types";
import { validateCond } from "@shared/model/conditions";
import { tableDef } from "@shared/tables";
import {
  LIBRARY_NAME, TYPE_KEY, builtinFieldType, libraryFieldDef, libraryFieldSettings, resolveFieldType, sameStorage, typeRowSettings,
  type FieldTypeRow, type SettingsEnv,
} from "@shared/forms/fieldtypes";
import type { Queryable } from "../../db";
import { bad } from "../../http/errors";
import { invalidateSchema, registerHooks, webOnly, type WriteArgs } from "../../engine";
import { fieldUsage, fieldsOfType, inUse, type FieldUsage } from "./usage";

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
  if (op === "update" && prev && prev.base !== next.base) {
    const before = builtinFieldType(prev.base);
    if (before && before.base !== base.base) {
      const used = await fieldsOfType(tx, ctx.org.id, key);
      if (used.length) {
        throw bad(`نوع ذخیرهٔ «${String(next.name ?? key)}» عوض نمی‌شود: فیلدهای ${names(used.map((f) => `«${f.label}»`))} از آن استفاده می‌کنند؛ فقط نوع پایه‌ای با همان نوع ذخیره پذیرفته می‌شود`);
      }
    }
  }
  const { problems } = typeRowSettings(base, next, SETTINGS_ENV);
  if (problems.length) throw bad(problems[0]);
}

/** Default tokens and the storage types they fill. */
const TOKEN_TYPES: Record<string, FieldType[]> = {
  $now: ["datetime"],
  $today: ["date", "datetime"],
  $me: ["user", "users"],
  $my_unit: ["ref"],
  $my_domain: ["ref"],
};

async function fieldDefBefore({ tx, ctx, op, next, prev }: WriteArgs): Promise<void> {
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
    const storageChanged = !!before && !sameStorage(before, type);
    if (renamed || storageChanged) {
      const u = await fieldUsage(tx, ctx.org.id, { id: String(prev.id), name: String(prev.name) });
      if (inUse(u) && renamed) throw bad(`نام فنی «${String(prev.name)}» عوض نمی‌شود: این فیلد ${whereUsed(u)} به کار رفته است`);
      if (inUse(u)) throw bad(`نوع ذخیرهٔ «${label}» عوض نمی‌شود: این فیلد ${whereUsed(u)} به کار رفته است؛ فقط نوعی با همان نوع ذخیره پذیرفته می‌شود (مثلاً فهرست کشویی ↔ گزینه‌های تکی)`);
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

let installed = false;

export function installFieldHooks(): void {
  if (installed) return;
  installed = true;
  // the schema cache follows both tables through its stamp; the request that changed them sees the change at once
  const fresh = ({ ctx }: WriteArgs) => invalidateSchema(ctx.org.id);
  registerHooks("field_type", { beforeWrite: fieldTypeBefore, afterWrite: fresh, ...webOnly("نوع فیلد") });
  registerHooks("field_def", { beforeWrite: fieldDefBefore, afterWrite: fresh, ...webOnly("فیلد") });
}
