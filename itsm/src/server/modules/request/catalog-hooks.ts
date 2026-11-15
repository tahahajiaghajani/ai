// Checks and derived values of the catalogue's definition tables (REQ-001…REQ-012), on every write path:
//   catalog_item          a stable code (generated when empty), sane ordering limits; a published item whose
//                         definition changes is marked «تغییر منتشرنشده» until it is published again; «بازگرداندن به
//                         کاتالوگ» needs a published version (guard has_version)
//   catalog_item_version  immutable: only publishing (the system) creates versions
//   catalog_variable      on one item or one question set; technical names, reserved names, unique per form;
//                         options, patterns and references well formed; changes mark the items using it
//   catalog_ui_policy     on one item or set; actions well formed
//   catalog_task_template, order_guide_rule, variable_set   changes mark their items; guides include only orderable items
//   catalog_category      the parent belongs to the same catalogue, no loops
//   request_config        one row per organisation
//   request_cart_line     the version and title of the item, the price of the answers
import { ITEM_TYPES, ORDERABLE_TYPES, VARIABLE_TYPES } from "@shared/request/vocab";
import { NAME_RE, RESERVED_NAMES, priceOf } from "@shared/request/form";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { bad, conflict } from "../../http/errors";
import { isSystemCtx, registerHooks, updateIn, validationError, type WriteArgs } from "../../engine";
import { eqAll, isUuid, liveRow, liveRows, sysOf, type Row } from "./common";
import { lockedRow } from "../incident/common";
import { versionSchema } from "./definition";

const CODE_RE = /^[a-z0-9][a-z0-9_.-]{0,59}$/;

/** Fields of an item that are not part of its definition (publishing, statistics, review dates). */
const NOT_DEFINITION = new Set([
  "state", "version_no", "version_id", "published_at", "dirty", "sle_p50", "sle_p85", "sle_p95", "sle_samples", "orders_90d", "next_review_at",
  "sort_order", "featured", "hidden",
]);

/** Mark published items «تغییر منتشرنشده» (as the system; the open forms keep their version token). */
export async function markDirty(tx: Tx, ctx: Ctx, ids: readonly unknown[]): Promise<void> {
  const sys = sysOf(ctx);
  for (const id of [...new Set(ids.filter(isUuid))]) {
    // the item locked: a publication in flight finishes first, and its «nothing unpublished» is not left over this change
    const item = await lockedRow(tx, sys, "catalog_item", id);
    if (item && item.version_id && !item.dirty) await updateIn(tx, sys, "catalog_item", id, { dirty: true }, { trusted: true, keepVersion: true, allowLocked: true });
  }
}

/** Items that use a question set. */
async function itemsOfSet(tx: Tx, ctx: Ctx, setId: unknown): Promise<string[]> {
  if (!isUuid(setId)) return [];
  const rows = await liveRows(tx, sysOf(ctx), "catalog_item", { f: "variable_sets", op: "eq", v: setId });
  return rows.map((r) => String(r.id));
}

function itemBeforeWrite(w: WriteArgs): void {
  if (w.op === "delete") return;
  const n = w.next;
  if (w.op === "create" || w.changed.has("code")) {
    const code = String(n.code ?? "").trim().toLowerCase();
    if (!code) n.code = `item_${Math.random().toString(36).slice(2, 8)}`;
    else if (!CODE_RE.test(code)) throw validationError({ code: "کد فقط حروف لاتین کوچک، رقم، نقطه، خط تیره و _ دارد" });
    else n.code = code;
  }
  if (!ITEM_TYPES.some((t) => t.value === n.type)) throw validationError({ type: "نوع قلم معتبر نیست" });
  if (n.max_quantity !== null && n.max_quantity !== undefined && Number(n.max_quantity) < 1) throw validationError({ max_quantity: "حداکثر تعداد دست‌کم ۱ است" });
  if (n.type === "record_producer" && n.target_table && !/^[a-z][a-z0-9_]*$/.test(String(n.target_table))) throw validationError({ target_table: "کلید جدول معتبر نیست" });
  if (n.field_map !== null && n.field_map !== undefined && (typeof n.field_map !== "object" || Array.isArray(n.field_map))) throw validationError({ field_map: "نگاشت فیلدها باید یک شیء JSON باشد" });
  if (w.op === "update" && n.version_id && !n.dirty && [...w.changed].some((f) => !NOT_DEFINITION.has(f))) n.dirty = true;
  if (w.changed.has("review_interval_days") && Number(n.review_interval_days) > 0 && !n.next_review_at) {
    n.next_review_at = new Date(Date.now() + Number(n.review_interval_days) * 86_400_000).toISOString().slice(0, 10);
  }
}

function variableBeforeWrite(w: WriteArgs): Promise<void> | void {
  if (w.op === "delete") return;
  const n = w.next;
  if (!!n.item_id === !!n.set_id) throw validationError({ item_id: "پرسش یا به یک قلم تعلق دارد یا به یک مجموعه‌پرسش" });
  const name = String(n.name ?? "").trim();
  if (!NAME_RE.test(name)) throw validationError({ name: "نام فنی با حرف لاتین کوچک آغاز می‌شود و فقط حرف لاتین کوچک، رقم و _ دارد" });
  if (RESERVED_NAMES.has(name)) throw validationError({ name: `نام «${name}» رزرو شده است` });
  n.name = name;
  if (!VARIABLE_TYPES.some((t) => t.value === n.type)) throw validationError({ type: "نوع پرسش معتبر نیست" });
  if (n.choices !== null && n.choices !== undefined) {
    if (!Array.isArray(n.choices)) throw validationError({ choices: "گزینه‌ها باید فهرستی از {value, label} باشد" });
    const seen = new Set<string>();
    for (const c of n.choices as unknown[]) {
      const o = c as Row;
      if (!o || typeof o !== "object" || o.value === undefined || o.value === null || String(o.value) === "") throw validationError({ choices: "هر گزینه مقدار (value) می‌خواهد" });
      if (seen.has(String(o.value))) throw validationError({ choices: `گزینهٔ «${o.value}» دو بار آمده است` });
      seen.add(String(o.value));
      if (o.price !== undefined && o.price !== null && o.price !== "" && !Number.isFinite(Number(o.price))) throw validationError({ choices: `مبلغ گزینهٔ «${o.label ?? o.value}» عدد نیست` });
    }
  }
  if (n.regex) {
    try {
      new RegExp(String(n.regex), "u");
    } catch {
      throw validationError({ regex: "الگوی اعتبارسنجی درست نیست" });
    }
  }
  if (n.min !== null && n.min !== undefined && n.max !== null && n.max !== undefined && Number(n.min) > Number(n.max)) throw validationError({ min: "کمینه از بیشینه بزرگ‌تر است" });
  return (async () => {
    const sys = sysOf(w.ctx);
    // the form (item or question set) locked: two questions of one name added at once take turns, the second is refused
    await lockedRow(w.tx, sys, n.item_id ? "catalog_item" : "variable_set", n.item_id ?? n.set_id);
    const where = n.item_id ? { item_id: n.item_id, name } : { set_id: n.set_id, name };
    const same = (await liveRows(w.tx, sys, "catalog_variable", eqAll(where), { limit: 2 })).filter((r) => r.id !== n.id);
    if (same.length) throw validationError({ name: `پرسشی با نام فنی «${name}» در همین فرم هست` });
    if (n.set_id) {
      const set = await liveRow(w.tx, sys, "variable_set", n.set_id);
      if (set?.multi_row && (n.type === "secret" || n.type === "attachment" || n.type === "label")) throw validationError({ type: "این نوع پرسش در جدول چندسطری نمی‌آید" });
    }
  })();
}

function policyBeforeWrite(w: WriteArgs): void {
  if (w.op === "delete") return;
  const n = w.next;
  if (!!n.item_id === !!n.set_id) throw validationError({ item_id: "سیاست یا به یک قلم تعلق دارد یا به یک مجموعه‌پرسش" });
  if (n.condition !== null && n.condition !== undefined && (typeof n.condition !== "object" || Array.isArray(n.condition))) throw validationError({ condition: "شرط معتبر نیست" });
  const actions = n.actions;
  if (!Array.isArray(actions) || !actions.length) throw validationError({ actions: "دست‌کم یک اقدام لازم است" });
  for (const a of actions as Row[]) {
    if (!a || typeof a !== "object" || typeof a.variable !== "string" || !a.variable) throw validationError({ actions: "هر اقدام نام پرسش (variable) می‌خواهد" });
    for (const k of ["visible", "mandatory", "readonly"]) if (a[k] !== undefined && typeof a[k] !== "boolean") throw validationError({ actions: `«${k}» باید true یا false باشد` });
  }
}

async function guideRuleBeforeWrite(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const sys = sysOf(w.ctx);
  const guide = await liveRow(w.tx, sys, "catalog_item", w.next.guide_id);
  if (!guide || guide.type !== "order_guide") throw validationError({ guide_id: "راهنمای سفارش پیدا نشد" });
  const item = await liveRow(w.tx, sys, "catalog_item", w.next.item_id);
  if (!item) throw validationError({ item_id: "قلم پیدا نشد" });
  if (!ORDERABLE_TYPES.includes(item.type)) throw validationError({ item_id: "راهنما فقط اقلام سفارش‌دادنی را در بر می‌گیرد" });
  if (w.next.condition !== null && w.next.condition !== undefined && (typeof w.next.condition !== "object" || Array.isArray(w.next.condition))) throw validationError({ condition: "شرط معتبر نیست" });
}

async function categoryBeforeWrite(w: WriteArgs): Promise<void> {
  if (w.op === "delete") {
    const sys = sysOf(w.ctx);
    const children = await liveRows(w.tx, sys, "catalog_category", eqAll({ parent_id: w.prev!.id }), { limit: 1 });
    if (children.length) throw conflict("این دسته زیردسته دارد؛ نخست زیردسته‌ها را جابه‌جا یا حذف کنید");
    return;
  }
  const n = w.next;
  if (!n.parent_id) return;
  const sys = sysOf(w.ctx);
  let id: unknown = n.parent_id;
  const seen = new Set<string>([String(n.id)]);
  for (let i = 0; i < 50 && isUuid(id); i++) {
    if (seen.has(String(id))) throw validationError({ parent_id: "دسته نمی‌تواند زیرمجموعهٔ خودش باشد" });
    seen.add(String(id));
    // the parent read shared (the first one): a deletion of it in flight finishes first and this is refused
    const p = i === 0 ? await lockedRow(w.tx, sys, "catalog_category", id, "share") : await liveRow(w.tx, sys, "catalog_category", id);
    if (!p) throw validationError({ parent_id: "دستهٔ بالاتر پیدا نشد" });
    if (i === 0 && p.catalog_id !== n.catalog_id) throw validationError({ parent_id: "دستهٔ بالاتر از کاتالوگ دیگری است" });
    id = p.parent_id;
  }
}

async function cartLineBeforeWrite(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (w.op !== "create" && !w.changed.has("item_id") && !w.changed.has("answers") && !w.changed.has("quantity")) return;
  const sys = sysOf(w.ctx);
  const item = await liveRow(w.tx, sys, "catalog_item", n.item_id);
  if (!item || !item.version_id) throw validationError({ item_id: "این قلم در کاتالوگ نیست" });
  n.version_id = item.version_id;
  if (!n.title) n.title = String(item.name).slice(0, 200);
  const schema = await versionSchema(w.tx, w.ctx, item.version_id);
  if (schema) n.price = priceOf(schema, (n.answers as Row) ?? {}, Number(n.quantity) || 1).total;
}

let installed = false;

export function installCatalogHooks(): void {
  if (installed) return;
  installed = true;
  registerHooks("catalog_item", {
    beforeWrite: itemBeforeWrite,
    guards: { has_version: (w) => (w.next.version_id ? null : "این قلم هنوز نسخهٔ منتشرشده‌ای ندارد؛ آن را منتشر کنید") },
  });
  registerHooks("catalog_item_version", {
    beforeWrite(w) {
      if (isSystemCtx(w.ctx)) return;
      throw bad("نسخه‌های اقلام فقط با «انتشار» ساخته می‌شوند و تغییر نمی‌کنند");
    },
  });
  registerHooks("catalog_variable", {
    beforeWrite: variableBeforeWrite,
    async afterWrite(w) {
      const sets = [w.row.set_id, w.prev?.set_id].filter(isUuid);
      const items: unknown[] = [w.row.item_id, w.prev?.item_id];
      for (const s of sets) items.push(...(await itemsOfSet(w.tx, w.ctx, s)));
      await markDirty(w.tx, w.ctx, items);
    },
  });
  registerHooks("catalog_ui_policy", {
    beforeWrite: policyBeforeWrite,
    async afterWrite(w) {
      const items = [w.row.item_id, w.prev?.item_id];
      for (const s of [w.row.set_id, w.prev?.set_id].filter(isUuid)) items.push(...(await itemsOfSet(w.tx, w.ctx, s)));
      await markDirty(w.tx, w.ctx, items);
    },
  });
  registerHooks("catalog_task_template", { afterWrite: (w) => markDirty(w.tx, w.ctx, [w.row.item_id, w.prev?.item_id]) });
  registerHooks("order_guide_rule", { beforeWrite: guideRuleBeforeWrite, afterWrite: (w) => markDirty(w.tx, w.ctx, [w.row.guide_id, w.prev?.guide_id]) });
  registerHooks("variable_set", {
    beforeWrite(w) {
      if (w.op === "delete") return;
      const code = String(w.next.code ?? "").trim();
      if (!NAME_RE.test(code)) throw validationError({ code: "کد با حرف لاتین کوچک آغاز می‌شود و فقط حرف لاتین کوچک، رقم و _ دارد" });
      if (Number(w.next.min_rows ?? 0) > Number(w.next.max_rows ?? 20)) throw validationError({ min_rows: "کمترین سطر از بیشترین بیشتر است" });
    },
    async afterWrite(w) {
      if (w.op === "create") return;
      await markDirty(w.tx, w.ctx, await itemsOfSet(w.tx, w.ctx, w.row.id));
    },
  });
  registerHooks("catalog_category", { beforeWrite: categoryBeforeWrite });
  registerHooks("request_config", {
    async beforeWrite(w) {
      if (w.op !== "create") return;
      const rows = await liveRows(w.tx, sysOf(w.ctx), "request_config", null, { limit: 1 });
      if (rows.length) throw conflict("تنظیمات درخواست خدمت فقط یک ردیف دارد؛ همان را ویرایش کنید");
    },
  });
  registerHooks("request_cart_line", { beforeWrite: cartLineBeforeWrite });
}
