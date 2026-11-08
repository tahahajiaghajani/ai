// Catalogue items as order forms (REQ-002, REQ-005…REQ-011): the draft schema assembled from an item's current rows
// (questions, question sets — single-row ones as sections, multi-row ones as grids —, form policies, fulfilment task
// templates and the item's settings), its problems, and publishing — an immutable `catalog_item_version` whose
// schema every requested item ordered from it keeps, so later edits never change history or running fulfilment.
// Changing any part of a published item marks it «تغییر منتشرنشده» until it is published again.
import { CHOICE_TYPES, NO_VALUE_TYPES, variableType, type FieldClass, type ItemType, type VariableType } from "@shared/request/vocab";
import { isPrivateClass, NAME_RE, RESERVED_NAMES, policyProblem, type FormSchema, type GridDef, type ItemSettings, type PolicyDef, type TaskTemplateDef, type VarDef } from "@shared/request/form";
import type { Cond } from "@shared/model/conditions";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { AppError, bad, forbidden, notFound } from "../../http/errors";
import { createIn, get, transitionIn, updateIn } from "../../engine";
import { arr, eqAll, isUuid, liveRow, liveRows, obj, rowsByIds, sysOf, type Row } from "./common";

export interface DefinitionProblem {
  level: "error" | "warning";
  message: string;
  /** the question, set or policy concerned */
  ref?: string;
}

const cond = (v: unknown): Cond | null => (v && typeof v === "object" && Object.keys(v as object).length ? (v as Cond) : null);
const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

function varOf(r: Row, section: string | null): VarDef {
  const choices = arr<Row>(r.choices)
    .filter((c) => c && typeof c === "object" && c.value !== undefined && c.value !== null && String(c.value) !== "")
    .map((c) => ({ value: String(c.value), label: String(c.label ?? c.value), ...(c.price !== undefined && c.price !== null && c.price !== "" ? { price: String(c.price) } : {}) }));
  return {
    name: String(r.name),
    label: String(r.label ?? r.name),
    type: String(r.type ?? "string") as VariableType,
    order: Number(r.sort_order ?? 100),
    required: !!r.required,
    readonly: !!r.readonly,
    hidden: !!r.hidden,
    default: str(r.default_value),
    ...(choices.length ? { choices } : {}),
    ref_table: str(r.ref_table),
    ref_filter: cond(r.ref_filter),
    min: str(r.min),
    max: str(r.max),
    max_length: r.max_length ? Number(r.max_length) : null,
    regex: str(r.regex),
    regex_message: str(r.regex_message),
    help: str(r.help),
    placeholder: str(r.placeholder),
    width: r.width === "half" ? "half" : "full",
    field_class: (str(r.field_class) ?? "public") as FieldClass,
    map_to: str(r.map_to),
    price_per_unit: str(r.price_per_unit),
    section,
  };
}

function policyOf(r: Row, grid: string | null): PolicyDef {
  return {
    name: String(r.name ?? ""),
    when: cond(r.condition),
    actions: arr<Row>(r.actions)
      .filter((a) => a && typeof a === "object" && typeof a.variable === "string")
      .map((a) => ({
        variable: String(a.variable),
        ...(typeof a.visible === "boolean" ? { visible: a.visible } : {}),
        ...(typeof a.mandatory === "boolean" ? { mandatory: a.mandatory } : {}),
        ...(typeof a.readonly === "boolean" ? { readonly: a.readonly } : {}),
      })),
    applies_to: r.applies_to === "order" || r.applies_to === "fulfil" ? r.applies_to : "both",
    order: Number(r.sort_order ?? 100),
    message: str(r.message),
    grid,
  };
}

function taskOf(r: Row): TaskTemplateDef {
  return {
    id: String(r.id),
    short_description: String(r.short_description ?? ""),
    order: Number(r.sort_order ?? 100),
    assignment_group_id: str(r.assignment_group_id),
    phase: r.phase === "before_approval" ? "before_approval" : "after_approval",
    depends_on_previous: r.depends_on_previous !== false,
    requester_visible: !!r.requester_visible,
    class_of_service: str(r.class_of_service),
    condition: cond(r.condition),
    instructions: str(r.instructions),
    checklist: arr<string>(r.checklist).map(String),
  };
}

/** The settings of an item row a version freezes. */
export function itemSettings(item: Row): ItemSettings {
  return {
    id: String(item.id),
    number: str(item.number),
    name: String(item.name ?? ""),
    code: String(item.code ?? ""),
    type: (str(item.type) ?? "standard") as ItemType,
    catalog_id: str(item.catalog_id),
    category_id: str(item.category_id),
    short_description: str(item.short_description),
    description: str(item.description),
    icon: str(item.icon),
    price: str(item.price),
    recurring_price: str(item.recurring_price),
    recurring_frequency: str(item.recurring_frequency),
    show_price: item.show_price !== false,
    quantity_allowed: !!item.quantity_allowed,
    max_quantity: item.max_quantity ? Number(item.max_quantity) : null,
    multi_user: !!item.multi_user,
    on_behalf: str(item.on_behalf) ?? "anyone",
    cart_allowed: item.cart_allowed !== false,
    delivery_days: item.delivery_days === null || item.delivery_days === undefined ? null : Number(item.delivery_days),
    calendar_id: str(item.calendar_id),
    requires_confirmation: item.requires_confirmation !== false,
    requester_edit: item.requester_edit !== false,
    requester_cancel: str(item.requester_cancel) ?? "before_fulfilment",
    title_template: str(item.title_template),
    stages: arr<string>(item.stages).map(String),
    fulfilment_group_id: str(item.fulfilment_group_id),
    flow_id: str(item.flow_id),
    approval_rule_id: str(item.approval_rule_id),
    target_table: str(item.target_table),
    field_map: item.field_map && typeof item.field_map === "object" ? obj(item.field_map) : null,
    std_change_template: str(item.std_change_template),
    content_url: str(item.content_url),
    ad_hoc: !!item.ad_hoc,
    button_label: str(item.button_label),
    creates_subscription: !!item.creates_subscription,
  };
}

/** The item's form as it stands now (the draft the builder edits and publishing freezes). */
export async function draftSchema(q: Queryable, ctx: Ctx, item: Row): Promise<FormSchema> {
  const sys = sysOf(ctx);
  const own = await liveRows(q, sys, "catalog_variable", eqAll({ item_id: item.id, active: true }), { order: "t.sort_order, t.label, t.id" });
  const variables: VarDef[] = own.map((r) => varOf(r, null));
  const sections: FormSchema["sections"] = [];
  const grids: GridDef[] = [];
  const policies: PolicyDef[] = (await liveRows(q, sys, "catalog_ui_policy", eqAll({ item_id: item.id, active: true }), { order: "t.sort_order, t.id" })).map((r) => policyOf(r, null));
  const setIds = arr<string>(item.variable_sets).filter(isUuid);
  if (setIds.length) {
    const sets = (await rowsByIds(q, sys, "variable_set", setIds)).filter((s) => s.active !== false);
    // in the item's order of sets
    sets.sort((a, b) => setIds.indexOf(a.id) - setIds.indexOf(b.id));
    for (const s of sets) {
      const vars = await liveRows(q, sys, "catalog_variable", eqAll({ set_id: s.id, active: true }), { order: "t.sort_order, t.label, t.id" });
      const setPolicies = await liveRows(q, sys, "catalog_ui_policy", eqAll({ set_id: s.id, active: true }), { order: "t.sort_order, t.id" });
      const code = String(s.code);
      if (s.multi_row) {
        grids.push({
          code,
          label: String(s.name),
          min_rows: Math.max(0, Number(s.min_rows ?? 0)),
          max_rows: Math.max(1, Number(s.max_rows ?? 20)),
          columns: vars.map((r) => varOf(r, null)),
          help: str(s.description),
        });
        policies.push(...setPolicies.map((r) => policyOf(r, code)));
      } else {
        sections.push({ key: code, label: String(s.name) });
        variables.push(...vars.map((r) => varOf(r, code)));
        policies.push(...setPolicies.map((r) => policyOf(r, null)));
      }
    }
  }
  const tasks = (await liveRows(q, sys, "catalog_task_template", eqAll({ item_id: item.id, active: true }), { order: "t.sort_order, t.id" })).map(taskOf);
  return { v: 1, item: itemSettings(item), sections, variables, grids, policies, tasks };
}

const NUMERIC = new Set(["int", "decimal", "money", "rating", "duration"]);

/** What stands between the draft and publishing (errors) or deserves a look (warnings). */
export function schemaProblems(schema: FormSchema, opts: { guideRules?: number } = {}): DefinitionProblem[] {
  const out: DefinitionProblem[] = [];
  const err = (message: string, ref?: string) => out.push({ level: "error", message, ref });
  const warn = (message: string, ref?: string) => out.push({ level: "warning", message, ref });
  const seen = new Set<string>();
  const checkVar = (v: VarDef, where: string) => {
    const at = `${where}«${v.label}»`;
    if (!NAME_RE.test(v.name)) err(`${at}: نام فنی باید با حرف لاتین کوچک آغاز شود و فقط حرف لاتین کوچک، رقم و _ داشته باشد`, v.name);
    if (!variableType(v.type)) err(`${at}: نوع «${v.type}» شناخته نیست`, v.name);
    if (CHOICE_TYPES.has(v.type) && !(v.choices ?? []).length) err(`${at}: گزینه‌ای تعریف نشده است`, v.name);
    if (v.type === "reference" || v.type === "list_collector") {
      const t = v.ref_table ? tableDef(v.ref_table) : undefined;
      if (!v.ref_table) err(`${at}: جدول ارجاع را مشخص کنید`, v.name);
      else if (!t) warn(`${at}: جدول «${v.ref_table}» هنوز در این سامانه نیست`, v.name);
    }
    if (v.regex) {
      try {
        new RegExp(v.regex, "u");
      } catch {
        err(`${at}: الگوی اعتبارسنجی درست نیست`, v.name);
      }
      if (NUMERIC.has(v.type)) warn(`${at}: الگو فقط بر پاسخ‌های متنی اعمال می‌شود`, v.name);
    }
    if (v.price_per_unit && !NUMERIC.has(v.type)) warn(`${at}: مبلغ هر واحد فقط برای پرسش‌های عددی است`, v.name);
  };
  for (const v of schema.variables) {
    if (seen.has(v.name)) err(`نام فنی «${v.name}» دو بار آمده است (پرسش‌ها و مجموعه‌پرسش‌ها نام یکسان نگیرند)`, v.name);
    seen.add(v.name);
    if (RESERVED_NAMES.has(v.name)) err(`نام فنی «${v.name}» رزرو شده است`, v.name);
    // a field of a record is read by everyone who reads the record: a secret or sensitive answer is never mapped there
    if (v.map_to && (v.type === "secret" || isPrivateClass(v.field_class))) err(`پرسش «${v.label}» محرمانه یا حساس است و به فیلد «${v.map_to}» نگاشته نمی‌شود`, v.name);
    checkVar(v, "");
  }
  for (const g of schema.grids) {
    if (seen.has(g.code)) err(`کد «${g.code}» با نام یک پرسش یکی است`, g.code);
    seen.add(g.code);
    if (!g.columns.length) err(`جدول «${g.label}» ستونی ندارد`, g.code);
    if (g.min_rows > g.max_rows) err(`جدول «${g.label}»: کمترین سطر از بیشترین بیشتر است`, g.code);
    const cols = new Set<string>();
    for (const c of g.columns) {
      if (cols.has(c.name)) err(`جدول «${g.label}»: نام فنی «${c.name}» دو بار آمده است`, g.code);
      cols.add(c.name);
      if (c.type === "secret" || c.type === "attachment") err(`جدول «${g.label}»: پرسش «${c.label}» از این نوع در جدول نمی‌آید`, g.code);
      checkVar(c, `جدول «${g.label}» ← `);
    }
  }
  for (const p of schema.policies) {
    const why = policyProblem(schema, p);
    if (why) err(`سیاست «${p.name || "بی‌نام"}»: ${why}`, p.name);
  }
  const item = schema.item;
  if (item.type === "record_producer") {
    if (!item.target_table) err("فرم ثبت رکورد جدول مقصد می‌خواهد");
    else if (!tableDef(item.target_table) || tableDef(item.target_table)?.virtual) err(`جدول مقصد «${item.target_table}» در این سامانه نیست`);
  }
  if (item.type === "content" && !item.content_url && !item.description) err("قلم محتوا نشانی یا شرح می‌خواهد");
  if (item.type === "order_guide" && opts.guideRules === 0) warn("این راهنما هنوز قاعده‌ای ندارد؛ قلمی در سفارش گنجانده نمی‌شود");
  if (!item.catalog_id) err("کاتالوگ قلم را مشخص کنید");
  for (const t of schema.tasks) if (!t.short_description) err("یکی از وظایف انجام عنوان ندارد");
  if (!schema.variables.some((v) => !NO_VALUE_TYPES.has(v.type)) && !schema.grids.length && item.type !== "content") warn("فرم پرسشی ندارد؛ سفارش فقط با تأیید ثبت می‌شود");
  return out;
}

export const hasErrors = (ps: readonly DefinitionProblem[]) => ps.some((p) => p.level === "error");

/** Transactions publishing a version (the only writes `catalog_item_version` accepts besides the system's). */
export const publishing = new WeakSet<object>();

/** The item and whether the caller may change it (404 when unreadable). */
export async function itemFor(ctx: Ctx, id: string, write = false): Promise<{ row: Row; canWrite: boolean }> {
  if (!isUuid(id)) throw notFound("قلم کاتالوگ پیدا نشد");
  const r = await get(ctx, "catalog_item", id);
  const canWrite = !!r.meta?.canWrite;
  if (write && !canWrite) throw forbidden("اجازهٔ تغییر این قلم کاتالوگ را ندارید");
  return { row: r.row as Row, canWrite };
}

/** Publish the item's draft as a new version (refused while it has errors); the item becomes «منتشرشده». */
export async function publishItem(ctx: Ctx, id: string, input: { note?: string | null; version?: number | null } = {}): Promise<{ version: { id: string; version_no: number }; problems: DefinitionProblem[] }> {
  const { row } = await itemFor(ctx, id, true);
  if (input.version !== undefined && input.version !== null && Number(row.version) !== Number(input.version)) {
    throw new AppError(409, "version_conflict", "این قلم را کس دیگری در این فاصله تغییر داده است؛ آن را دوباره باز کنید", { version: row.version });
  }
  if (row.state === "retired") throw bad("قلم بازنشسته است؛ نخست آن را برای ویرایش بازگشایی کنید");
  const sys = sysOf(ctx, ctx.user.id);
  return ctx.write(async (tx) => {
    const schema = await draftSchema(tx, ctx, row);
    const guideRules = row.type === "order_guide" ? (await liveRows(tx, sys, "order_guide_rule", eqAll({ guide_id: id, active: true }))).length : undefined;
    const problems = schemaProblems(schema, { guideRules });
    if (hasErrors(problems)) throw bad("قلم ایراد دارد و منتشر نشد", { problems });
    const version = await snapshotIn(tx, sys, row, schema, input.note ?? null);
    return { version, problems };
  });
}

/** Write a version of `schema` and point the item at it (inside `tx`, as the system acting for the publisher). */
export async function snapshotIn(tx: Tx, sys: Ctx, item: Row, schema: FormSchema, note: string | null): Promise<{ id: string; version_no: number }> {
  const last = await tx.one<{ n: number }>(`select coalesce(max(version_no), 0)::int as n from sm_catalog_item_versions where org_id = $1 and item_id = $2`, [sys.org.id, item.id]);
  const no = (last?.n ?? 0) + 1;
  publishing.add(tx);
  const v = await createIn(tx, sys, "catalog_item_version", {
    item_id: item.id, version_no: no, title: `${item.name} — نسخهٔ ${no}`.slice(0, 200), note: (note ?? "").trim().slice(0, 300) || null, schema,
  }, { trusted: true });
  await updateIn(tx, sys, "catalog_item", String(item.id), { version_id: v.id, version_no: no, published_at: new Date().toISOString(), dirty: false }, { trusted: true });
  if (item.state !== "published") await transitionIn(tx, sys, "catalog_item", String(item.id), "published", {}, { trusted: true });
  return { id: String(v.id), version_no: no };
}

/** The schema of a published version (null when it is not one of the organisation's). */
export async function versionSchema(q: Queryable, ctx: Ctx, versionId: unknown): Promise<FormSchema | null> {
  const v = await liveRow(q, sysOf(ctx), "catalog_item_version", versionId);
  const s = v?.schema;
  return s && typeof s === "object" && (s as FormSchema).v === 1 ? (s as FormSchema) : null;
}

/** An item's current published schema with its version id (null while unpublished). */
export async function publishedSchema(q: Queryable, ctx: Ctx, item: Row): Promise<{ schema: FormSchema; versionId: string } | null> {
  if (!item.version_id) return null;
  const schema = await versionSchema(q, ctx, item.version_id);
  return schema ? { schema, versionId: String(item.version_id) } : null;
}
