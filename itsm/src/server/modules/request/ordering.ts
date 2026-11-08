// Ordering (REQ-013…REQ-016, REQ-018…REQ-021, REQ-004, REQ-053): what a person may see in the catalogue (audiences,
// hidden and featured items, search), an item's order form (its published version without the internal parts), the
// server's check of answers with price, title and delivery promise, order guides expanded for a person's answers
// (rules, cascaded answers), the cart, and placing an order — one request with one requested item per line and
// person, in one transaction — or producing a record when the item is a record producer. Every path re-checks
// entitlement, ordering for others and the answers, whatever the channel.
import { cascade, checkAnswers, guideIncludes, priceOf, titleOf, type Answers, type FormSchema } from "@shared/request/form";
import { linePeople, orderTitle } from "@shared/request/logic";
import { sleText } from "@shared/request/due";
import { ORDERABLE_TYPES } from "@shared/request/vocab";
import { add, cmp, isNumeric, mul } from "@shared/money";
import { tableDef } from "@shared/tables";
import type { Cond } from "@shared/model/conditions";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { AppError, bad, forbidden, notFound } from "../../http/errors";
import { condEnv, createIn, removeIn, updateIn, validationError } from "../../engine";
import { allowed, arr, eqAll, isUuid, liveRow, liveRows, obj, offeredChoice, rowsByIds, sysOf, type Row } from "./common";
import { versionSchema } from "./definition";
import { catalogIndex, entitlementFor, onBehalfRefusal } from "./entitlement";
import { displayOf, producedValues, promiseOf } from "./fulfil";

// ---------------------------------------------------------------------------------------------------------------
// Browsing

export interface ItemCard {
  id: string;
  number: string | null;
  code: string;
  name: string;
  type: string;
  short_description: string | null;
  icon: string | null;
  color: string | null;
  catalog_id: string;
  category_id: string | null;
  featured: boolean;
  hidden: boolean;
  price: string | null;
  recurring_price: string | null;
  recurring_frequency: string | null;
  promise: string;
  sle: string;
  button_label: string | null;
  content_url: string | null;
  cart_allowed: boolean;
  multi_user: boolean;
  /** may the person order it (false: listed for information, e.g. a content item, or not for this person) */
  orderable: boolean;
  why: string | null;
}

function cardOf(it: Row, opts: { orderable: boolean; why: string | null }): ItemCard {
  const show = it.show_price !== false;
  return {
    id: String(it.id),
    number: (it.number as string) ?? null,
    code: String(it.code ?? ""),
    name: String(it.name),
    type: String(it.type),
    short_description: (it.short_description as string) ?? null,
    icon: (it.icon as string) ?? null,
    color: (it.color as string) ?? null,
    catalog_id: String(it.catalog_id),
    category_id: (it.category_id as string) ?? null,
    featured: !!it.featured,
    hidden: !!it.hidden,
    price: show && isNumeric(it.price) ? String(it.price) : null,
    recurring_price: show && isNumeric(it.recurring_price) ? String(it.recurring_price) : null,
    recurring_frequency: (it.recurring_frequency as string) ?? null,
    promise: it.delivery_days === null || it.delivery_days === undefined ? "" : promiseTextOf(Number(it.delivery_days)),
    sle: sleText(it.sle_p85 as number | null, it.sle_samples as number | null),
    button_label: (it.button_label as string) ?? null,
    content_url: (it.content_url as string) ?? null,
    cart_allowed: it.cart_allowed !== false && ORDERABLE_TYPES.includes(it.type) && it.type !== "order_guide",
    multi_user: !!it.multi_user,
    orderable: opts.orderable,
    why: opts.why,
  };
}

const promiseTextOf = (days: number) => (days === 0 ? "همان روز کاری" : `حدود ${days.toLocaleString("fa-IR")} روز کاری`);

export interface BrowseResult {
  for: string;
  catalogs: { id: string; name: string; description: string | null; icon: string | null; color: string | null; banner: string | null }[];
  categories: { id: string; catalog_id: string; parent_id: string | null; name: string; description: string | null; icon: string | null; count: number }[];
  items: ItemCard[];
}

/** Can the caller see the catalogue at all (read in area catalog)? */
async function needCatalog(ctx: Ctx): Promise<void> {
  if (!(await allowed(ctx, "catalog_item", "read"))) throw forbidden("به کاتالوگ خدمات دسترسی ندارید");
}

/**
 * The catalogue as `forUser` (default: the caller) may order from it: active catalogues and categories their audiences
 * allow, published items they are entitled to (hidden items only when searched or asked for by id), featured first.
 */
export async function browse(ctx: Ctx, opts: { for?: string | null; catalog?: string | null; category?: string | null; q?: string | null; ids?: string[] } = {}): Promise<BrowseResult> {
  await needCatalog(ctx);
  const forUser = isUuid(opts.for) ? opts.for : ctx.user.id;
  const q = ctx.db;
  const sys = sysOf(ctx);
  const ent = await entitlementFor(q, ctx, forUser);
  const where: Cond[] = [{ f: "state", op: "eq", v: "published" }, { f: "version_id", op: "nempty" }];
  if (isUuid(opts.catalog)) where.push({ f: "catalog_id", op: "eq", v: opts.catalog });
  const text = (opts.q ?? "").trim();
  if (text) where.push({ or: ["name", "short_description", "description", "code"].map((f) => ({ f, op: "contains" as const, v: text })) });
  const ids = new Set((opts.ids ?? []).filter(isUuid).map((x) => x.toLowerCase()));
  if (!text && !ids.size) where.push({ f: "hidden", op: "ne", v: true });
  const rows = (await liveRows(q, sys, "catalog_item", { and: where }, { order: "t.featured desc, t.sort_order, t.name", limit: 2000 })).filter((r) => !ids.size || ids.has(String(r.id)));
  const allowed = await ent.check(rows);
  const index = await catalogIndex(q, ctx);
  const catalogs = [...index.catalogs.values()].filter((c) => c.active !== false && ent.allowsLevel(c));
  const catIds = new Set(catalogs.map((c) => String(c.id)));
  const categories = [...index.categories.values()].filter((c) => c.active !== false && catIds.has(String(c.catalog_id)) && ent.allowsLevel(c));
  const visibleCats = new Set(categories.map((c) => String(c.id)));
  // a category is listed only when every category above it is
  const reachable = (id: string | null): boolean => {
    for (let i = 0, cur = id; cur && i < 50; i++) {
      if (!visibleCats.has(cur)) return false;
      cur = (index.categories.get(cur)?.parent_id as string | null) ?? null;
    }
    return true;
  };
  const items: ItemCard[] = [];
  for (const it of rows) {
    if (!allowed.get(String(it.id))) continue;
    if (it.category_id && !reachable(String(it.category_id))) continue;
    if (isUuid(opts.category) && it.category_id !== opts.category && !descendsFrom(index.categories, it.category_id as string | null, opts.category)) continue;
    const orderable = ORDERABLE_TYPES.includes(it.type) || it.type === "record_producer" || it.type === "order_guide";
    const why = forUser !== ctx.user.id && orderable ? await onBehalfRefusal(q, ctx, { on_behalf: it.on_behalf as string }, forUser) : null;
    items.push(cardOf(it, { orderable: orderable && !why, why }));
  }
  const counts = new Map<string, number>();
  for (const it of items) for (let c = it.category_id, i = 0; c && i < 50; i++, c = (index.categories.get(c)?.parent_id as string | null) ?? null) counts.set(c, (counts.get(c) ?? 0) + 1);
  return {
    for: forUser,
    catalogs: catalogs.map((c) => ({ id: String(c.id), name: String(c.name), description: (c.description as string) ?? null, icon: (c.icon as string) ?? null, color: (c.color as string) ?? null, banner: (c.banner as string) ?? null })),
    categories: categories
      .filter((c) => reachable(String(c.id)))
      .map((c) => ({ id: String(c.id), catalog_id: String(c.catalog_id), parent_id: (c.parent_id as string) ?? null, name: String(c.name), description: (c.description as string) ?? null, icon: (c.icon as string) ?? null, count: counts.get(String(c.id)) ?? 0 })),
    items,
  };
}

function descendsFrom(categories: Map<string, Row>, id: string | null, ancestor: string): boolean {
  for (let cur = id, i = 0; cur && i < 50; i++) {
    if (cur === ancestor) return true;
    cur = (categories.get(cur)?.parent_id as string | null) ?? null;
  }
  return false;
}

/** What a person's order form needs from a version: everything but the fulfilment internals. */
export function publicSchema(schema: FormSchema): FormSchema {
  const { fulfilment_group_id: _g, flow_id: _f, approval_rule_id: _a, field_map: _m, std_change_template: _s, ...item } = schema.item;
  return { ...schema, item: { ...item, fulfilment_group_id: null, flow_id: null, approval_rule_id: null, field_map: null, std_change_template: null }, tasks: [] };
}

export interface ItemForm {
  item: ItemCard;
  version_id: string;
  schema: FormSchema;
  promise: { days: number; text: string; due_at: string | null } | null;
  /** answers to start from (defaults are applied by the form) */
  for: string;
  display: Record<string, string>;
}

/** An item's order form for `forUser` (404 when the person may not see it). */
export async function itemForm(ctx: Ctx, id: string, opts: { for?: string | null } = {}): Promise<ItemForm> {
  await needCatalog(ctx);
  const forUser = isUuid(opts.for) ? opts.for : ctx.user.id;
  const q = ctx.db;
  const item = await liveRow(q, sysOf(ctx), "catalog_item", id);
  if (!item || item.state !== "published" || !item.version_id) throw notFound("قلم کاتالوگ پیدا نشد");
  const ent = await entitlementFor(q, ctx, forUser);
  if (!(await ent.check([item])).get(String(item.id))) throw notFound("قلم کاتالوگ پیدا نشد");
  const schema = await versionSchema(q, ctx, item.version_id);
  if (!schema) throw notFound("نسخهٔ قلم کاتالوگ پیدا نشد");
  const why = forUser !== ctx.user.id ? await onBehalfRefusal(q, ctx, schema.item, forUser) : null;
  const orderable = ORDERABLE_TYPES.includes(schema.item.type) || schema.item.type === "record_producer" || schema.item.type === "order_guide";
  return {
    item: cardOf(item, { orderable: orderable && !why, why }),
    version_id: String(item.version_id),
    schema: publicSchema(schema),
    promise: await promiseOf(q, ctx, schema.item),
    for: forUser,
    display: await displayOf(q, ctx, [["user", forUser]]),
  };
}

export interface CheckResult {
  errors: Record<string, string>;
  price: { unit: string; total: string; recurring: string | null; recurring_total: string | null } | null;
  title: string;
  promise: { days: number; text: string; due_at: string | null } | null;
}

/** The server's verdict on answers (the same checks as an order): errors, price, title and promise. */
export async function checkItem(ctx: Ctx, id: string, input: { answers?: Answers; quantity?: number; for?: string | null }): Promise<CheckResult> {
  const form = await itemForm(ctx, id, { for: input.for });
  const full = await versionSchema(ctx.db, ctx, form.version_id);
  const schema = full ?? form.schema;
  const env = await condEnv(ctx);
  const r = checkAnswers(schema, obj(input.answers), { mode: "order", env });
  const quantity = Math.max(1, Math.floor(Number(input.quantity) || 1));
  const display = await displayOf(ctx.db, ctx, [["user", form.for]]);
  return {
    errors: r.errors,
    price: schema.item.show_price === false ? null : priceOf(schema, r.answers, quantity),
    title: titleOf(schema, r.answers, { requestedFor: form.for, quantity, display }),
    promise: form.promise,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Order guides

type GuideRule = Row & { condition?: Cond | null; active?: boolean | null };

export interface GuideLine {
  rule_id: string;
  item: ItemCard;
  version_id: string;
  schema: FormSchema;
  mandatory: boolean;
  selected: boolean;
  quantity: number;
  answers: Answers;
}

/** The items a guide includes for its answers (REQ-021), with the answers cascaded to them; for `forUser`. */
export async function expandGuide(ctx: Ctx, guideId: string, input: { answers?: Answers; for?: string | null }): Promise<{ guide: ItemCard; lines: GuideLine[]; errors: Record<string, string> }> {
  const form = await itemForm(ctx, guideId, { for: input.for });
  if (form.item.type !== "order_guide") throw bad("این قلم راهنمای سفارش نیست");
  const q = ctx.db;
  const sys = sysOf(ctx);
  const guideSchema = (await versionSchema(q, ctx, form.version_id))!;
  const env = await condEnv(ctx);
  const checked = checkAnswers(guideSchema, obj(input.answers), { mode: "order", env });
  const rules = await liveRows(q, sys, "order_guide_rule", eqAll({ guide_id: guideId, active: true }), { order: "t.sort_order, t.created_at" });
  const included = guideIncludes(rules as GuideRule[], guideSchema, checked.answers, env);
  const items = await rowsByIds(q, sys, "catalog_item", included.map((r) => r.item_id));
  const ent = await entitlementFor(q, ctx, form.for);
  const allowed = await ent.check(items);
  const lines: GuideLine[] = [];
  for (const r of included) {
    const it = items.find((x) => x.id === r.item_id);
    if (!it || it.state !== "published" || !it.version_id || !allowed.get(String(it.id))) continue;
    const schema = await versionSchema(q, ctx, it.version_id);
    if (!schema) continue;
    lines.push({
      rule_id: String(r.id),
      item: cardOf(it, { orderable: true, why: null }),
      version_id: String(it.version_id),
      schema: publicSchema(schema),
      mandatory: !!r.mandatory,
      selected: !!r.mandatory || r.selected !== false,
      quantity: Math.max(1, Number(r.quantity) || 1),
      answers: r.cascade !== false ? cascade(checked.answers, guideSchema.variables, schema) : {},
    });
  }
  return { guide: form.item, lines, errors: checked.errors };
}

// ---------------------------------------------------------------------------------------------------------------
// Placing orders

export interface LineInput {
  item_id: string;
  answers?: Answers;
  quantity?: number;
  requested_for?: string | null;
  requested_for_list?: string[] | null;
  guide_id?: string | null;
  /** the version the answers were given for (a cart line); a newer version re-checks them */
  version_id?: string | null;
}

export interface OrderInput {
  lines: LineInput[];
  /** order guides of the lines (their answers decide which items are mandatory) */
  guides?: { id: string; answers?: Answers }[];
  requested_for?: string | null;
  needed_by?: string | null;
  location_id?: string | null;
  cost_center_id?: string | null;
  instructions?: string | null;
  channel?: string | null;
}

export interface OrderResult {
  request: { id: string; number: string | null } | null;
  items: { id: string; number: string | null; title: string; state: string; requested_for: string }[];
  produced: { table: string; id: string; number: string | null } | null;
}

interface Prepared {
  line: LineInput;
  item: Row;
  schema: FormSchema;
  people: string[];
  answers: Answers;
  quantity: number;
}

/** Problems of an order per line: `lines.<i>.<field>` → message. */
function lineError(i: number, field: string, message: string): AppError {
  return validationError({ [`lines.${i}.${field}`]: message });
}

async function prepare(q: Queryable, ctx: Ctx, input: OrderInput): Promise<Prepared[]> {
  if (!Array.isArray(input.lines) || !input.lines.length) throw bad("سفارش قلمی ندارد");
  if (input.lines.length > 50) throw bad("یک سفارش حداکثر ۵۰ قلم دارد");
  const sys = sysOf(ctx);
  const env = await condEnv(ctx);
  const fallback = isUuid(input.requested_for) ? input.requested_for : ctx.user.id;
  const out: Prepared[] = [];
  const ents = new Map<string, Awaited<ReturnType<typeof entitlementFor>>>();
  for (const [i, line] of input.lines.entries()) {
    const item = await liveRow(q, sys, "catalog_item", line.item_id);
    if (!item || item.state !== "published" || !item.version_id) throw lineError(i, "item_id", "این قلم در کاتالوگ نیست");
    const schema = await versionSchema(q, ctx, item.version_id);
    if (!schema) throw lineError(i, "item_id", "نسخهٔ قلم پیدا نشد");
    if (!ORDERABLE_TYPES.includes(schema.item.type) && !(schema.item.type === "record_producer" && input.lines.length === 1)) {
      throw lineError(i, "item_id", schema.item.type === "record_producer" ? "فرم ثبت رکورد جداگانه ثبت می‌شود" : `«${item.name}» سفارش‌دادنی نیست`);
    }
    const people = linePeople(line, fallback, !!schema.item.multi_user);
    if (people.length > 100) throw lineError(i, "requested_for_list", "یک قلم را حداکثر برای ۱۰۰ نفر می‌توان سفارش داد");
    for (const p of people) {
      if (!isUuid(p)) throw lineError(i, "requested_for", "شخص معتبر نیست");
      const why = await onBehalfRefusal(q, ctx, schema.item, p);
      if (why) throw lineError(i, "requested_for", why);
      let ent = ents.get(p);
      if (!ent) ents.set(p, (ent = await entitlementFor(q, ctx, p)));
      if (!ent.facts) throw lineError(i, "requested_for", "این شخص عضو فعال سازمان نیست");
      if (!(await ent.check([item])).get(String(item.id))) {
        const name = (await displayOf(q, ctx, [["user", p]]))[p] ?? "این شخص";
        throw lineError(i, "item_id", `«${item.name}» برای ${name} در دسترس نیست`);
      }
    }
    const checked = checkAnswers(schema, obj(line.answers), { mode: "order", env });
    const errs = Object.entries(checked.errors);
    if (errs.length) {
      const changed = line.version_id && line.version_id !== item.version_id ? `«${item.name}» تغییر کرده است؛ پاسخ‌ها را بازبینی کنید. ` : "";
      throw validationError(Object.fromEntries(errs.map(([k, v]) => [`lines.${i}.answers.${k}`, changed + v])));
    }
    const quantity = schema.item.quantity_allowed ? Math.max(1, Math.min(Number(schema.item.max_quantity) || 1000, Math.floor(Number(line.quantity) || 1))) : 1;
    out.push({ line, item, schema, people, answers: checked.answers, quantity });
  }
  // order guides: their mandatory items must be in the order (for the guide's answers)
  for (const g of input.guides ?? []) {
    if (!isUuid(g.id)) continue;
    const guide = await liveRow(q, sys, "catalog_item", g.id);
    if (!guide?.version_id) continue;
    const gs = await versionSchema(q, ctx, guide.version_id);
    if (!gs) continue;
    const rules = await liveRows(q, sys, "order_guide_rule", eqAll({ guide_id: g.id, active: true, mandatory: true }));
    const must = guideIncludes(rules as GuideRule[], gs, checkAnswers(gs, obj(g.answers), { mode: "order", env }).answers, env);
    for (const r of must) {
      if (!out.some((p) => p.item.id === r.item_id && p.line.guide_id === g.id)) {
        const it = await liveRow(q, sys, "catalog_item", r.item_id);
        throw bad(`«${it?.name ?? "قلمی"}» در «${guide.name}» اجباری است`);
      }
    }
  }
  return out;
}

/** May the caller order at all (create in area request)? */
async function needOrder(ctx: Ctx): Promise<void> {
  if (!(await allowed(ctx, "request_item", "create"))) throw forbidden("اجازهٔ ثبت درخواست خدمت را ندارید");
}

/**
 * Place an order: one request (the header) and one requested item per line and person, in one transaction, as the
 * system acting for the caller (the module checked entitlement, ordering for others and the answers). A single
 * record-producer line makes its record instead, with the caller's own access (REQ-004).
 */
export async function placeOrder(ctx: Ctx, input: OrderInput, opts: { inTx?: Tx; afterOrder?: (tx: Tx, result: OrderResult) => Promise<void> } = {}): Promise<OrderResult> {
  await needCatalog(ctx);
  await needOrder(ctx);
  const run = async (tx: Tx): Promise<OrderResult> => {
    const lines = await prepare(tx, ctx, input);
    if (lines.length === 1 && lines[0].schema.item.type === "record_producer") {
      const produced = await produce(tx, ctx, lines[0], input);
      const result: OrderResult = { request: null, items: [], produced };
      await opts.afterOrder?.(tx, result);
      return result;
    }
    const sys = sysOf(ctx, ctx.user.id);
    const first = lines[0];
    const requestedFor = first.people[0];
    const titles = lines.flatMap((l) => l.people.map(() => l.schema.item.name));
    const req = await createIn(tx, sys, "request", {
      short_description: orderTitle(titles),
      description: (input.instructions ?? "").trim().slice(0, 20000) || null,
      caller_id: ctx.user.id,
      requested_for: requestedFor,
      channel: input.channel ?? "portal",
      needed_by: input.needed_by ?? null,
      location_id: isUuid(input.location_id) ? input.location_id : null,
      cost_center_id: isUuid(input.cost_center_id) ? input.cost_center_id : null,
    }, { trusted: true });
    const items: OrderResult["items"] = [];
    for (const l of lines) {
      for (const person of l.people) {
        const row = await createIn(tx, sys, "request_item", {
          request_id: req.id,
          cat_item_id: l.item.id,
          item_version_id: l.item.version_id,
          answers: l.answers,
          quantity: l.quantity,
          caller_id: ctx.user.id,
          requested_for: person,
          channel: input.channel ?? "portal",
          location_id: isUuid(input.location_id) ? input.location_id : null,
        }, { trusted: true });
        items.push({ id: String(row.id), number: (row.number as string) ?? null, title: String(row.short_description), state: String(row.state), requested_for: person });
      }
    }
    const fresh = await liveRow(tx, sysOf(ctx), "request", req.id);
    const result: OrderResult = { request: { id: String(req.id), number: (fresh?.number as string) ?? (req.number as string) ?? null }, items, produced: null };
    // the states after approvals and fulfilment started inside the transaction
    for (const it of result.items) {
      const r = await liveRow(tx, sysOf(ctx), "request_item", it.id);
      if (r) it.state = String(r.state);
    }
    await opts.afterOrder?.(tx, result);
    return result;
  };
  return opts.inTx ? run(opts.inTx) : ctx.write(run);
}

/** A record producer's record (REQ-004): the field map and mapped questions, created with the caller's access. */
async function produce(tx: Tx, ctx: Ctx, l: Prepared, input: OrderInput): Promise<OrderResult["produced"]> {
  const target = l.schema.item.target_table;
  const def = target ? tableDef(target) : undefined;
  if (!target || !def || def.virtual) throw bad("جدول مقصد این فرم در سامانه نیست");
  const person = l.people[0];
  const fake: Row = { requested_for: person, caller_id: ctx.user.id, short_description: l.schema.item.name };
  const values = producedValues(l.schema, l.answers, fake, target);
  const display = await displayOf(tx, ctx, [["user", person]]);
  if (def.fields.some((f) => f.name === "short_description") && !values.short_description) values.short_description = titleOf(l.schema, l.answers, { requestedFor: person, display });
  if (def.fields.some((f) => f.name === "caller_id") && !values.caller_id) values.caller_id = person;
  if (!values.channel) {
    // the order's channel when the target knows it (an incident has no «دستیار هوشمند»), else the target's default
    const channel = await offeredChoice(tx, ctx, target, "channel", input.channel);
    if (channel) values.channel = channel;
  }
  const summary = summaryOf(l.schema, l.answers, display);
  if (def.fields.some((f) => f.name === "description") && !values.description) values.description = summary;
  // the person's own access decides (a requester creates what they could create by hand)
  const row = await createIn(tx, ctx, target, values);
  return { table: target, id: String(row.id), number: (row.number as string) ?? null };
}

/** «پرسش: پاسخ» lines of the open answers, for a produced record's description. */
export function summaryOf(schema: FormSchema, answers: Answers, display: Record<string, string> = {}): string {
  const lines: string[] = [];
  for (const v of schema.variables) {
    if (v.type === "secret" || v.field_class === "sensitive" || v.field_class === "secret" || !(v.name in answers)) continue;
    const value = answers[v.name];
    const text = Array.isArray(value) ? value.map((x) => display[String(x)] ?? String(x)).join("، ") : typeof value === "boolean" ? (value ? "بله" : "خیر") : display[String(value)] ?? v.choices?.find((c) => c.value === String(value))?.label ?? String(value);
    lines.push(`- **${v.label}:** ${text}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// The cart

export interface CartView {
  cart: Row;
  lines: (Row & { item: ItemCard | null; problem: string | null })[];
  totals: { total: string; recurring: string | null; count: number };
  display: Record<string, string>;
}

/** The caller's current cart (created on first use when `create`). */
async function currentCart(q: Queryable, ctx: Ctx, create: boolean, tx?: Tx): Promise<Row | null> {
  const [cart] = await liveRows(q, ctx, "request_cart", { and: [{ f: "user_id", op: "is_me" }, { f: "kind", op: "eq", v: "cart" }, { f: "checked_out_at", op: "empty" }] }, { order: "t.created_at desc", limit: 1 });
  if (cart || !create || !tx) return cart ?? null;
  return createIn(tx, ctx, "request_cart", { name: "سبد سفارش", kind: "cart", user_id: ctx.user.id });
}

export async function cartView(ctx: Ctx): Promise<CartView> {
  await needCatalog(ctx);
  const q = ctx.db;
  const cart = (await currentCart(q, ctx, false)) ?? { id: null, name: "سبد سفارش", kind: "cart", user_id: ctx.user.id };
  const lines = cart.id ? await liveRows(q, ctx, "request_cart_line", eqAll({ cart_id: cart.id }), { order: "t.sort_order, t.created_at" }) : [];
  const items = await rowsByIds(q, sysOf(ctx), "catalog_item", lines.map((l) => l.item_id));
  let total = "0";
  let recurring = "0";
  const out: CartView["lines"] = [];
  for (const l of lines) {
    const it = items.find((x) => x.id === l.item_id) ?? null;
    const problem = !it || it.state !== "published" ? "این قلم دیگر در کاتالوگ نیست" : it.version_id !== l.version_id ? "قلم تغییر کرده است؛ پاسخ‌ها را بازبینی کنید" : null;
    if (!l.saved && !problem) {
      if (isNumeric(l.price)) total = add(total, String(l.price));
      if (it && isNumeric(it.recurring_price)) recurring = add(recurring, mul(String(it.recurring_price), String(l.quantity ?? 1)));
    }
    out.push({ ...l, item: it ? cardOf(it, { orderable: true, why: null }) : null, problem });
  }
  const people = [cart.requested_for, ...lines.flatMap((l) => [l.requested_for, ...arr(l.requested_for_list)])].filter(isUuid).map((id) => ["user", id] as [string, unknown]);
  return {
    cart,
    lines: out,
    totals: { total, recurring: cmp(recurring, "0") > 0 ? recurring : null, count: out.filter((l) => !l.saved).length },
    display: await displayOf(q, ctx, people),
  };
}

/** Add a line to the caller's cart (answers checked now and again at checkout). */
export async function addLine(ctx: Ctx, input: LineInput & { saved?: boolean }): Promise<Row> {
  await needCatalog(ctx);
  await needOrder(ctx);
  return ctx.write(async (tx) => {
    const [p] = await prepare(tx, ctx, { lines: [input] });
    if (p.schema.item.cart_allowed === false || p.schema.item.type === "record_producer") throw bad(`«${p.item.name}» به سبد افزوده نمی‌شود؛ آن را مستقیم ثبت کنید`);
    const cart = (await currentCart(tx, ctx, true, tx))!;
    return createIn(tx, ctx, "request_cart_line", {
      cart_id: cart.id,
      user_id: ctx.user.id,
      item_id: p.item.id,
      quantity: p.quantity,
      answers: p.answers,
      requested_for: input.requested_for ?? null,
      requested_for_list: p.schema.item.multi_user ? (input.requested_for_list ?? []) : [],
      saved: !!input.saved,
      guide_id: isUuid(input.guide_id) ? input.guide_id : null,
      title: titleOf(p.schema, p.answers, { quantity: p.quantity }),
    });
  });
}

/** Change a line of the caller's cart (answers, quantity, people, «برای بعد»). */
export async function updateLine(ctx: Ctx, id: string, patch: Partial<LineInput> & { saved?: boolean }): Promise<Row> {
  return ctx.write(async (tx) => {
    const line = await liveRow(tx, ctx, "request_cart_line", id);
    if (!line) throw notFound("این قلم در سبد شما نیست");
    const next: LineInput = {
      item_id: String(line.item_id),
      answers: patch.answers ?? (line.answers as Answers) ?? {},
      quantity: patch.quantity ?? (line.quantity as number),
      requested_for: patch.requested_for !== undefined ? patch.requested_for : (line.requested_for as string | null),
      requested_for_list: patch.requested_for_list !== undefined ? patch.requested_for_list : arr<string>(line.requested_for_list),
    };
    const [p] = await prepare(tx, ctx, { lines: [next] });
    return updateIn(tx, ctx, "request_cart_line", id, {
      answers: p.answers,
      quantity: p.quantity,
      requested_for: next.requested_for ?? null,
      requested_for_list: next.requested_for_list ?? [],
      ...(patch.saved !== undefined ? { saved: !!patch.saved } : {}),
      title: titleOf(p.schema, p.answers, { quantity: p.quantity }),
      item_id: p.item.id,
    });
  });
}

export async function removeLine(ctx: Ctx, id: string): Promise<void> {
  await ctx.write(async (tx) => {
    const line = await liveRow(tx, ctx, "request_cart_line", id);
    if (!line) throw notFound("این قلم در سبد شما نیست");
    // a cart line is the caller's own (read through their access): the module removes it for them
    await removeIn(tx, sysOf(ctx), "request_cart_line", id);
  });
}

/** Order the cart's lines (not those saved for later); the ordered lines leave the cart. */
export async function checkoutCart(ctx: Ctx, input: Omit<OrderInput, "lines"> = {}): Promise<OrderResult> {
  await needCatalog(ctx);
  return ctx.write(async (tx) => {
    const cart = await currentCart(tx, ctx, false);
    if (!cart) throw bad("سبد شما خالی است");
    const lines = (await liveRows(tx, ctx, "request_cart_line", eqAll({ cart_id: cart.id }), { order: "t.sort_order, t.created_at" })).filter((l) => !l.saved);
    if (!lines.length) throw bad("سبد شما قلمی برای سفارش ندارد");
    const order: OrderInput = {
      ...input,
      requested_for: input.requested_for ?? (cart.requested_for as string | null) ?? null,
      needed_by: input.needed_by ?? (cart.needed_by as string | null) ?? null,
      location_id: input.location_id ?? (cart.location_id as string | null) ?? null,
      cost_center_id: input.cost_center_id ?? (cart.cost_center_id as string | null) ?? null,
      instructions: input.instructions ?? (cart.instructions as string | null) ?? null,
      lines: lines.map((l) => ({
        item_id: String(l.item_id),
        answers: (l.answers as Answers) ?? {},
        quantity: Number(l.quantity) || 1,
        requested_for: (l.requested_for as string | null) ?? null,
        requested_for_list: arr<string>(l.requested_for_list),
        guide_id: (l.guide_id as string | null) ?? null,
        version_id: (l.version_id as string | null) ?? null,
      })),
    };
    return placeOrder(ctx, order, {
      inTx: tx,
      afterOrder: async (t, result) => {
        // the lines are the caller's own (read through their access above); the module removes them
        for (const l of lines) await removeIn(t, sysOf(ctx), "request_cart_line", String(l.id));
        await updateIn(t, ctx, "request_cart", String(cart.id), { request_id: result.request?.id ?? null }, { trusted: true });
      },
    });
  });
}

/** Change the cart's order details (for whom, where, when, cost centre, instructions). */
export async function updateCart(ctx: Ctx, patch: { requested_for?: string | null; location_id?: string | null; needed_by?: string | null; cost_center_id?: string | null; instructions?: string | null }): Promise<Row> {
  await needCatalog(ctx);
  return ctx.write(async (tx) => {
    const cart = (await currentCart(tx, ctx, true, tx))!;
    const values: Row = {};
    for (const k of ["requested_for", "location_id", "needed_by", "cost_center_id", "instructions"] as const) if (patch[k] !== undefined) values[k] = patch[k];
    if (isUuid(values.requested_for) && values.requested_for !== ctx.user.id) {
      const why = await onBehalfRefusal(tx, ctx, { on_behalf: "anyone" }, String(values.requested_for));
      if (why) throw validationError({ requested_for: why });
    }
    return Object.keys(values).length ? updateIn(tx, ctx, "request_cart", String(cart.id), values) : cart;
  });
}

export { cardOf };
