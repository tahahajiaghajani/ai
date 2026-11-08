// The lifecycle of orders (REQ-019, REQ-022…REQ-028, REQ-031, REQ-037, REQ-041, REQ-044…REQ-046) as engine hooks,
// so it holds on every write path (the module's checkout, the generic API, imports, flows, schedules, jobs):
//   request_item  on create: the item's published version, the answers checked against it (and split by data class:
//                 public/personal in `answers`, sensitive in `private_answers` (field group «personal»), secrets sealed),
//                 entitlement and ordering-for-others for people's own writes, title, price, delivery promise, SLE and
//                 the order header when none is given; on every state change: stamps, the stage, close codes and the
//                 masking of sensitive answers; the requester's cancel policy. After the SLA service's hooks (one hook
//                 on "*"): approvals decide whether the item waits or starts, fulfilment starts (fulfil.ts), delivered
//                 items close when no confirmation is needed, subscriptions start, open tasks of a closed item stop,
//                 answer facts follow, and the order rolls up.
//   request_task  the order and the person it is shown to, dependencies (a task waits until the one before it is
//                 done), blocked time; done tasks open the next ones and deliver the item when its work is complete.
//   request       created only by ordering; a requester's cancellation cancels its open items (under each item's
//                 policy); its state, stage, totals and the people working on it roll up from the items.
import { cancelRefusal, closeCodeFor, isItemDone, isItemOpen, isTaskDone, readyTasks, rollupRequest as rollupLogic, stageFor, tasksOutcome } from "@shared/request/logic";
import { answerText, checkAnswers, isEmptyAnswer, priceOf, titleOf, type Answers, type FormSchema } from "@shared/request/form";
import { ORDERABLE_TYPES } from "@shared/request/vocab";
import { add, cmp, isNumeric, mul } from "@shared/money";
import { grantIn } from "@shared/access";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { bad, forbidden } from "../../http/errors";
import { addJournalIn, condEnv, createIn, isSystemCtx, onRecordEvent, registerHooks, removeIn, systemCtx, transitionIn, updateIn, validationError, type RecordEvent, type WriteArgs } from "../../engine";
import type { JobConfig } from "../../jobs";
import { prepareSubject, subjectOf } from "../../access";
import { arr, eqAll, isUuid, liveRow, liveRows, obj, secondsBetween, sysOf, type Row } from "./common";
import { versionSchema } from "./definition";
import { canOrder, onBehalfRefusal } from "./entitlement";
import { calendarOf, createTemplateTasks, deliver, displayOf, flowRunStates, runsActive, startFulfilment } from "./fulfil";
import { workingDaysDue } from "@shared/request/due";

const WORKING = ["in_fulfilment", "awaiting_info", "backordered"];
const AGENT_SCOPES = new Set(["group", "unit", "unit_tree", "domain", "all"]);
const MASK = "••••";

/** Fields of a requested item a question may fill through «نگاشت به فیلد» (never the module's own). */
const NOT_MAPPABLE = new Set([
  "state", "request_id", "cat_item_id", "item_version_id", "category_id", "answers", "private_answers", "secret_answers", "price", "total",
  "recurring_price", "recurring_frequency", "fulfilment", "approval_rule_id", "produced_table", "produced_id", "flow_runs", "fulfillers",
  "stage", "approval", "caller_id", "opened_by", "watch_list", "parent_id", "rating", "feedback", "quantity",
]);

/** Version schemas read during one transaction (a write reads its item's version at most once). */
const schemas = new WeakMap<object, Map<string, Promise<FormSchema | null>>>();
export function cachedSchema(q: Queryable, ctx: Ctx, versionId: unknown): Promise<FormSchema | null> {
  if (!isUuid(versionId)) return Promise.resolve(null);
  let m = schemas.get(q);
  if (!m) schemas.set(q, (m = new Map()));
  let p = m.get(versionId);
  if (!p) m.set(versionId, (p = versionSchema(q, ctx, versionId)));
  return p;
}

/** Is the acting member only a requester in the area (write scope none or own)? */
export async function requesterLike(q: Queryable, ctx: Ctx): Promise<boolean> {
  if (isSystemCtx(ctx)) return false;
  await prepareSubject(ctx, q);
  return !AGENT_SCOPES.has(grantIn(subjectOf(ctx).eff, "request").write);
}

const onRequesterSide = (row: Row | null, userId: string) => !!row && [row.requested_for, row.caller_id, row.opened_by].includes(userId);

/** Answers split by data class (REQ-041): what the item keeps in the open, behind the field group, sealed. */
export function splitAnswers(schema: FormSchema, answers: Answers): { open: Answers; sensitive: Answers; secret: Answers } {
  const open: Answers = {};
  const sensitive: Answers = {};
  const secret: Answers = {};
  for (const v of schema.variables) {
    if (!(v.name in answers)) continue;
    if (v.type === "secret" || v.field_class === "secret") secret[v.name] = answers[v.name];
    else if (v.field_class === "sensitive") sensitive[v.name] = answers[v.name];
    else open[v.name] = answers[v.name];
  }
  for (const g of schema.grids) {
    if (!(g.code in answers)) continue;
    if (g.columns.some((c) => c.field_class === "sensitive" || c.field_class === "secret")) sensitive[g.code] = answers[g.code];
    else open[g.code] = answers[g.code];
  }
  return { open, sensitive, secret };
}

/** The display names a title template and answer texts need (members and referenced records). */
async function answerDisplay(q: Queryable, ctx: Ctx, schema: FormSchema, answers: Answers, extra: unknown[] = []): Promise<Record<string, string>> {
  const refs: [string, unknown][] = extra.map((id) => ["user", id]);
  for (const v of schema.variables) {
    const value = answers[v.name];
    if (isEmptyAnswer(value)) continue;
    const target = v.type === "user" || v.type === "users" || v.type === "requested_for" ? "user" : v.type === "group" ? "group" : v.type === "location" ? "location" : v.type === "ci" ? "ci" : v.ref_table;
    if (!target) continue;
    for (const id of Array.isArray(value) ? value : [value]) refs.push([target, id]);
  }
  try {
    return await displayOf(q, ctx, refs);
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------------------------------------------
// request_item

async function prepareCreate(w: WriteArgs): Promise<void> {
  const { tx, ctx } = w;
  const n = w.next;
  const sys = sysOf(ctx);
  const item = await liveRow(tx, sys, "catalog_item", n.cat_item_id);
  if (!item) throw validationError({ cat_item_id: "قلم کاتالوگ پیدا نشد" });
  const versionId = isUuid(n.item_version_id) && w.trusted ? n.item_version_id : item.version_id;
  if (!versionId) throw validationError({ cat_item_id: `«${item.name}» هنوز منتشر نشده است` });
  const schema = await cachedSchema(tx, ctx, versionId);
  if (!schema || schema.item.id !== String(item.id)) throw validationError({ cat_item_id: "نسخهٔ قلم کاتالوگ پیدا نشد" });
  if (!ORDERABLE_TYPES.includes(schema.item.type)) throw validationError({ cat_item_id: `«${item.name}» سفارش‌دادنی نیست` });
  const actor = isSystemCtx(ctx) ? null : ctx.user.id;
  n.caller_id = n.caller_id || actor || n.requested_for || null;
  n.requested_for = n.requested_for || n.caller_id || null;
  if (!n.requested_for) throw validationError({ requested_for: "درخواست برای چه کسی است؟" });
  // people's own writes (the generic API, imports): the same checks as checkout
  if (!w.trusted && !isSystemCtx(ctx)) {
    if (item.state !== "published") throw validationError({ cat_item_id: `«${item.name}» در کاتالوگ نیست` });
    const why = await onBehalfRefusal(tx, ctx, schema.item, String(n.requested_for));
    if (why) throw validationError({ requested_for: why });
    if (!(await canOrder(tx, ctx, item, String(n.requested_for)))) throw validationError({ cat_item_id: `«${item.name}» برای این شخص در دسترس نیست` });
  }
  const env = await condEnv(ctx);
  const checked = checkAnswers(schema, obj(n.answers), { mode: "order", env });
  if (Object.keys(checked.errors).length) throw validationError(Object.fromEntries(Object.entries(checked.errors).map(([k, v]) => [`answers.${k}`, v])));
  const parts = splitAnswers(schema, checked.answers);
  n.answers = parts.open;
  n.private_answers = Object.keys(parts.sensitive).length ? parts.sensitive : null;
  n.secret_answers = Object.keys(parts.secret).length ? JSON.stringify(parts.secret) : null;
  // questions mapped to fields of the requested item (e.g. «پایان دسترسی»)
  for (const v of schema.variables) {
    if (!v.map_to || NOT_MAPPABLE.has(v.map_to) || !(v.name in parts.open)) continue;
    const f = w.def.fields.find((x) => x.name === v.map_to);
    if (f && !f.system && !f.base) n[v.map_to] = parts.open[v.name];
  }
  const quantity = schema.item.quantity_allowed ? Math.max(1, Math.min(Number(schema.item.max_quantity) || 1000, Math.floor(Number(n.quantity) || 1))) : 1;
  n.quantity = quantity;
  const price = priceOf(schema, checked.answers, quantity);
  n.price = price.unit;
  n.total = price.total;
  n.recurring_price = price.recurring;
  n.recurring_frequency = price.recurring ? schema.item.recurring_frequency ?? null : null;
  if (!n.short_description) {
    const display = await answerDisplay(tx, ctx, schema, checked.answers, [n.requested_for]);
    n.short_description = titleOf(schema, checked.answers, { requestedFor: n.requested_for, quantity, display });
  }
  n.item_version_id = versionId;
  n.category_id = schema.item.category_id ?? null;
  n.approval_rule_id = schema.item.approval_rule_id ?? null;
  n.requires_confirmation = schema.item.requires_confirmation !== false;
  n.ad_hoc = !!schema.item.ad_hoc;
  // the module moves new items on (approvals, fulfilment); an import may bring an item in any state
  if (!n.state || !w.trusted) n.state = "pending";
  n.stage = stageFor(String(n.state), schema.item.stages);
  if (!n.due_at && schema.item.delivery_days !== null && schema.item.delivery_days !== undefined) {
    const cal = await calendarOf(tx, ctx, schema.item.calendar_id);
    const due = workingDaysDue(cal, Date.now(), Number(schema.item.delivery_days));
    if (due) n.due_at = new Date(due).toISOString();
  }
  if (item.sle_p85 && Number(item.sle_samples ?? 0) >= 5) n.sle_p85 = item.sle_p85;
  if (!isUuid(n.request_id)) {
    const req = await createIn(tx, sysOf(ctx, actor), "request", {
      short_description: n.short_description,
      caller_id: n.caller_id,
      requested_for: n.requested_for,
      channel: n.channel ?? null,
      location_id: n.location_id ?? null,
    }, { trusted: true });
    n.request_id = req.id;
  }
}

async function itemBeforeWrite(w: WriteArgs): Promise<void> {
  if (w.op === "create") return prepareCreate(w);
  if (w.op === "delete") return;
  const n = w.next;
  const p = w.prev!;
  const person = !w.trusted && !isSystemCtx(w.ctx);
  if (person && w.changed.has("answers")) throw bad("پاسخ‌ها را از «ویرایش پاسخ‌ها» تغییر دهید");
  if (person && (w.changed.has("rating") || w.changed.has("feedback")) && !["delivered", "closed_complete", "closed_incomplete"].includes(String(n.state))) {
    throw validationError({ rating: "بازخورد پس از تحویل ثبت می‌شود" });
  }
  if (!w.changed.has("state")) return;
  const from = String(p.state);
  const to = String(n.state);
  const now = new Date().toISOString();
  const schema = await cachedSchema(w.tx, w.ctx, n.item_version_id);
  if (to === "awaiting_info") {
    n.info_requested = true;
    n.info_since = now;
    n.reminded_at = null;
  }
  if (from === "awaiting_info" && to !== "awaiting_info") {
    n.info_wait = Number(p.info_wait ?? 0) + (secondsBetween(p.info_since, now) ?? 0);
    n.info_since = null;
  }
  if (to === "awaiting_approval" && !n.approval_requested_at) n.approval_requested_at = now;
  if (from === "awaiting_approval" && to !== "rejected" && to !== "cancelled" && !n.approved_at) n.approved_at = now;
  if (isItemDone(to)) {
    n.close_code = closeCodeFor(to, n.close_code as string | null);
    // sensitive answers are masked and secrets dropped once the work is over (REQ-041)
    const priv = obj(n.private_answers);
    if (Object.keys(priv).length) n.private_answers = Object.fromEntries(Object.keys(priv).map((k) => [k, MASK]));
    if (n.secret_answers) n.secret_answers = null;
  }
  const explicit = w.input?.has("stage") ? (n.stage as string | null) : null;
  n.stage = stageFor(to, schema?.item.stages, explicit);
}

async function itemValidateTransition(w: WriteArgs & { transition: { to: string } }): Promise<string | null> {
  if (w.transition.to !== "cancelled" || isSystemCtx(w.ctx) || !onRequesterSide(w.prev, w.ctx.user.id)) return null;
  if (!(await requesterLike(w.tx, w.ctx))) return null;
  const schema = await cachedSchema(w.tx, w.ctx, w.prev?.item_version_id);
  return cancelRefusal(schema?.item.requester_cancel, String(w.prev?.state));
}

/** The order's facts of one item: typed public and personal answers for rules and reports (REQ-005, REQ-054). */
export async function writeFacts(tx: Tx, ctx: Ctx, ritm: Row, schema: FormSchema): Promise<void> {
  const sys = sysOf(ctx);
  for (const old of await liveRows(tx, sys, "request_answer", eqAll({ request_item_id: ritm.id }))) await removeIn(tx, sys, "request_answer", String(old.id));
  const answers = obj(ritm.answers);
  const display = await answerDisplay(tx, ctx, schema, answers);
  for (const v of schema.variables) {
    const value = answers[v.name];
    if (isEmptyAnswer(value) || v.type === "secret" || v.type === "attachment" || v.field_class === "sensitive" || v.field_class === "secret") continue;
    const text = answerText(v, value, display).slice(0, 500);
    const numeric = !Array.isArray(value) && typeof value !== "boolean" && isNumeric(value) ? String(value) : null;
    const date = (v.type === "date" || v.type === "datetime") && typeof value === "string" ? value.slice(0, 10) : null;
    await createIn(tx, sys, "request_answer", {
      label: v.label.slice(0, 200), variable: v.name, request_item_id: ritm.id, item_id: ritm.cat_item_id,
      value_text: text || null, value_num: numeric, value_date: date,
      requested_for: ritm.requested_for ?? null, caller_id: ritm.caller_id ?? null, assignment_group_id: ritm.assignment_group_id ?? null,
    }, { trusted: true });
  }
}

/** A subscription for a delivered item with a recurring charge (REQ-037). */
async function startSubscription(tx: Tx, ctx: Ctx, ritm: Row, schema: FormSchema): Promise<void> {
  if (!schema.item.creates_subscription || ritm.subscription_id) return;
  const sys = sysOf(ctx);
  const sub = await createIn(tx, sys, "request_subscription", {
    name: String(ritm.short_description ?? schema.item.name).slice(0, 200),
    item_id: ritm.cat_item_id,
    subscriber_id: ritm.requested_for,
    request_item_id: ritm.id,
    quantity: ritm.quantity ?? 1,
    recurring_price: ritm.recurring_price ?? null,
    recurring_frequency: ritm.recurring_frequency ?? null,
    start_on: new Date().toISOString().slice(0, 10),
    state: "active",
  }, { trusted: true });
  await updateIn(tx, sys, "request_item", String(ritm.id), { subscription_id: sub.id }, { trusted: true, keepVersion: true, allowLocked: true });
}

/** After the SLA service's hooks: move the item on, keep its tasks and facts in step, roll the order up. */
async function advance(w: WriteArgs & { row: Row }): Promise<void> {
  const { tx, ctx } = w;
  const row = w.row;
  if (w.op === "delete") {
    if (row.request_id) await rollupRequest(tx, ctx, String(row.request_id));
    return;
  }
  const schema = await cachedSchema(tx, ctx, row.item_version_id);
  const sys = sysOf(ctx);
  const id = String(row.id);
  if (w.op === "create" && schema) {
    await writeFacts(tx, ctx, row, schema);
    await createTemplateTasks(tx, ctx, row, schema, "before_approval");
  } else if (w.changed.has("assignment_group_id")) {
    for (const f of await liveRows(tx, sys, "request_answer", eqAll({ request_item_id: id }))) {
      await updateIn(tx, sys, "request_answer", String(f.id), { assignment_group_id: row.assignment_group_id ?? null }, { trusted: true, keepVersion: true });
    }
  }
  const state = String(row.state);
  if (state === "pending" && schema && (w.op === "create" || w.changed.has("approval") || w.changed.has("state"))) {
    if (row.approval === "requested") await transitionIn(tx, sys, "request_item", id, "awaiting_approval", {}, { trusted: true });
    else if (row.approval === "rejected") await transitionIn(tx, sys, "request_item", id, "rejected", {}, { trusted: true });
    else await startFulfilment(tx, ctx, row, schema);
    return;
  }
  if (state === "awaiting_approval" && w.changed.has("approval") && schema) {
    if (row.approval === "rejected") await transitionIn(tx, sys, "request_item", id, "rejected", { close_notes: "در مرحلهٔ تأیید رد شد" }, { trusted: true });
    else if (row.approval === "approved" || row.approval === "not_requested") await startFulfilment(tx, ctx, row, schema);
    return;
  }
  if (w.changed.has("state")) {
    if (state === "delivered" && schema) {
      await startSubscription(tx, ctx, row, schema);
      if (!row.requires_confirmation) {
        await transitionIn(tx, sys, "request_item", id, "closed_complete", {}, { trusted: true });
        return;
      }
    }
    if (state === "closed_complete" && schema) await startSubscription(tx, ctx, row, schema);
    if (isItemDone(state)) {
      // the work stops with the item
      for (const t of await liveRows(tx, sys, "request_task", eqAll({ request_item_id: id }))) {
        if (isTaskDone(t.state)) continue;
        await transitionIn(tx, sys, "request_task", String(t.id), t.state === "pending" ? "skipped" : "cancelled", { close_notes: "قلم درخواست‌شده بسته شد" }, { trusted: true });
      }
    }
  }
  if (row.request_id && (w.op === "create" || ["state", "stage", "assigned_to", "assignment_group_id", "total", "quantity", "fulfillers"].some((f) => w.changed.has(f)))) {
    await rollupRequest(tx, ctx, String(row.request_id));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// request_task

async function taskBeforeWrite(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const sys = sysOf(w.ctx);
  if (w.op === "create") {
    const ritm = await liveRow(w.tx, sys, "request_item", n.request_item_id);
    if (!ritm) throw validationError({ request_item_id: "قلم درخواست‌شده پیدا نشد" });
    if (!isItemOpen(ritm.state) && ritm.state !== "delivered" && !isSystemCtx(w.ctx)) throw validationError({ request_item_id: "این قلم درخواست‌شده بسته است" });
    n.request_id = ritm.request_id ?? null;
    n.caller_id = null;
    if (!n.assignment_group_id) n.assignment_group_id = ritm.assignment_group_id ?? null;
    if (!w.input?.has("priority")) n.priority = ritm.priority ?? n.priority;
    if (n.depends_on) {
      const dep = await liveRow(w.tx, sys, "request_task", n.depends_on);
      if (!dep || dep.request_item_id !== ritm.id) throw validationError({ depends_on: "وظیفهٔ پیشین باید از همین قلم باشد" });
      if (!isTaskDone(dep.state) && (n.state === "open" || !n.state)) n.state = "pending";
    }
    n.requested_for = n.requester_visible ? (ritm.requested_for ?? null) : null;
  } else if (w.changed.has("requester_visible") || w.changed.has("request_item_id")) {
    const ritm = await liveRow(w.tx, sys, "request_item", n.request_item_id);
    n.requested_for = n.requester_visible && ritm ? (ritm.requested_for ?? null) : null;
  }
  if (w.changed.has("blocked")) {
    const now = new Date().toISOString();
    if (n.blocked) {
      n.blocked_since = now;
      if (!n.blocked_reason) throw validationError({ blocked_reason: "علت انسداد را بنویسید" });
    } else if (w.prev?.blocked_since) {
      n.blocked_time = Number(w.prev.blocked_time ?? 0) + (secondsBetween(w.prev.blocked_since, now) ?? 0);
      n.blocked_since = null;
    }
  }
  if (w.changed.has("depends_on") && n.depends_on && n.depends_on === n.id) throw validationError({ depends_on: "وظیفه نمی‌تواند پس از خودش باشد" });
}

async function taskAfterWrite(w: WriteArgs & { row: Row }): Promise<void> {
  const row = w.row;
  const ritmId = String(row.request_item_id ?? "");
  if (!isUuid(ritmId)) return;
  const stateChanged = w.op === "create" || w.op === "delete" || w.changed.has("state");
  if (!stateChanged && !w.changed.has("assigned_to")) return;
  const sys = sysOf(w.ctx);
  if (w.op !== "create" && isTaskDone(row.state) && w.changed.has("state")) {
    const siblings = await liveRows(w.tx, sys, "request_task", eqAll({ request_item_id: ritmId }));
    for (const id of readyTasks(siblings.map((t) => ({ id: String(t.id), state: String(t.state), depends_on: (t.depends_on as string) ?? null })))) {
      await transitionIn(w.tx, sys, "request_task", id, "open", {}, { trusted: true });
    }
  }
  await rollupTasks(w.tx, w.ctx, ritmId, { announce: w.op !== "create" && w.changed.has("state") && isTaskDone(row.state) });
}

/** People working the item's tasks, and delivery once its tasks are done (flows: once their runs ended too). */
export async function rollupTasks(tx: Tx, ctx: Ctx, ritmId: string, opts: { announce?: boolean } = {}): Promise<void> {
  const sys = sysOf(ctx);
  const ritm = await liveRow(tx, sys, "request_item", ritmId);
  if (!ritm) return;
  const tasks = await liveRows(tx, sys, "request_task", eqAll({ request_item_id: ritmId }));
  const people = [...new Set(tasks.map((t) => t.assigned_to).filter(isUuid))].sort();
  if (people.join() !== [...arr<string>(ritm.fulfillers)].sort().join()) {
    await updateIn(tx, sys, "request_item", ritmId, { fulfillers: people }, { trusted: true, keepVersion: true, allowLocked: true });
  }
  if (!WORKING.includes(String(ritm.state)) || ritm.fulfilment === "manual") return;
  const outcome = tasksOutcome(tasks);
  if (outcome === "done") {
    if (ritm.fulfilment === "flow" && runsActive(await flowRunStates(tx, ctx.org.id, arr<string>(ritm.flow_runs)))) return;
    await deliver(tx, sys, ritm);
  } else if (outcome === "failed" && opts.announce) {
    await addJournalIn(tx, sys, tableDef("request_item")!, ritm, { kind: "work_note", body: "همهٔ وظایف این قلم بسته شد ولی هیچ‌کدام انجام نشد؛ قلم را بررسی و تکلیف آن را روشن کنید." }, { trusted: true });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// request (the order header)

const rolling = new WeakMap<object, Set<string>>();

/** An order's state, stage, totals and people from its items. */
export async function rollupRequest(tx: Tx, ctx: Ctx, requestId: string): Promise<void> {
  const sys = sysOf(ctx);
  const req = await liveRow(tx, sys, "request", requestId);
  if (!req) return;
  const items = await liveRows(tx, sys, "request_item", eqAll({ request_id: requestId }), { order: "t.created_at, t.id" });
  const r = rollupLogic(items.map((i) => ({ state: String(i.state), stage: (i.stage as string) ?? null })));
  const counted = items.filter((i) => i.state !== "cancelled" && i.state !== "rejected");
  let total = "0";
  let recurring = "0";
  for (const i of counted) {
    if (isNumeric(i.total)) total = add(total, String(i.total));
    if (isNumeric(i.recurring_price)) recurring = add(recurring, mul(String(i.recurring_price), String(i.quantity ?? 1)));
  }
  const people = [...new Set(items.flatMap((i) => [i.assigned_to, ...arr(i.fulfillers)]).filter(isUuid))].sort();
  const patch: Row = {};
  if (Number(req.items_count ?? 0) !== items.length) patch.items_count = items.length;
  if (!isNumeric(req.total_price) || cmp(String(req.total_price), total) !== 0) patch.total_price = total;
  const rec = cmp(recurring, "0") > 0 ? recurring : null;
  if ((req.recurring_total ?? null) === null ? rec !== null : rec === null || cmp(String(req.recurring_total), rec) !== 0) patch.recurring_total = rec;
  if (people.join() !== [...arr<string>(req.fulfillers)].sort().join()) patch.fulfillers = people;
  const group = items.find((i) => i.assignment_group_id)?.assignment_group_id ?? null;
  if (!req.assignment_group_id && group) patch.assignment_group_id = group;
  if (r && r.stage !== req.stage) patch.stage = r.stage;
  if (r && r.state !== req.state) {
    let m = rolling.get(tx);
    if (!m) rolling.set(tx, (m = new Set()));
    m.add(requestId);
    try {
      await transitionIn(tx, sys, "request", requestId, r.state, patch, { trusted: true });
    } finally {
      m.delete(requestId);
    }
  } else if (Object.keys(patch).length) {
    await updateIn(tx, sys, "request", requestId, patch, { trusted: true, keepVersion: true, allowLocked: true });
  }
}

async function requestValidateTransition(w: WriteArgs & { transition: { to: string } }): Promise<string | null> {
  if (w.transition.to !== "cancelled" || isSystemCtx(w.ctx)) return null;
  const sys = sysOf(w.ctx);
  const items = await liveRows(w.tx, sys, "request_item", eqAll({ request_id: w.prev!.id }));
  const requester = onRequesterSide(w.prev, w.ctx.user.id) && (await requesterLike(w.tx, w.ctx));
  for (const i of items) {
    if (!isItemOpen(i.state)) continue;
    if (requester) {
      const schema = await cachedSchema(w.tx, w.ctx, i.item_version_id);
      const why = cancelRefusal(schema?.item.requester_cancel, String(i.state));
      if (why) return `«${i.short_description}»: ${why}`;
    }
  }
  return null;
}

async function requestAfterWrite(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op !== "transition" || w.row.state !== "cancelled" || rolling.get(w.tx)?.has(String(w.row.id))) return;
  // a person cancelled the whole order: its open items follow
  const sys = sysOf(w.ctx, isSystemCtx(w.ctx) ? null : w.ctx.user.id);
  const note = String(w.row.close_notes ?? "").trim() || "سفارش لغو شد";
  for (const i of await liveRows(w.tx, sys, "request_item", eqAll({ request_id: w.row.id }))) {
    if (isItemOpen(i.state)) await transitionIn(w.tx, sys, "request_item", String(i.id), "cancelled", { close_notes: note }, { trusted: true });
  }
}

// ---------------------------------------------------------------------------------------------------------------

/** The requester's public reply to an item waiting for information resumes the work (REQ-045). */
async function onReply(e: RecordEvent, cfg: JobConfig): Promise<void> {
  if (e.via === "sync" || !e.actor || !e.entry || (e.entry.kind !== "comment" && e.entry.kind !== "email_in")) return;
  const sys = await systemCtx(cfg, e.org_id);
  await sys.write(async (tx) => {
    const ritm = await liveRow(tx, sys, "request_item", e.id);
    if (!ritm || ritm.state !== "awaiting_info" || !onRequesterSide(ritm, e.actor!)) return;
    await transitionIn(tx, sys, "request_item", e.id, "in_fulfilment", {}, { trusted: true });
    await addJournalIn(tx, sys, tableDef("request_item")!, ritm, { kind: "system", body: "درخواست‌کننده پاسخ داد؛ انجام ادامه می‌یابد." }, { trusted: true });
  });
}

let installed = false;

/** Register the lifecycle (after the SLA service: the hook on "*" must see approvals planned). */
export function installLifecycle(): void {
  if (installed) return;
  installed = true;
  registerHooks("request_item", { beforeWrite: itemBeforeWrite, validateTransition: itemValidateTransition });
  registerHooks("request_task", { beforeWrite: taskBeforeWrite, afterWrite: taskAfterWrite });
  registerHooks("request", {
    beforeWrite(w) {
      if (w.op === "create" && !w.trusted && !isSystemCtx(w.ctx)) throw forbidden("درخواست خدمت با سفارش از کاتالوگ ثبت می‌شود");
    },
    validateTransition: requestValidateTransition,
    afterWrite: requestAfterWrite,
  });
  registerHooks("*", {
    async afterWrite(w) {
      if (w.def.key === "request_item") await advance(w);
    },
  });
  onRecordEvent("request.replies", (e, jctx) => onReply(e, jctx.cfg), { tables: ["request_item"], kinds: ["record.commented"] });
}

export { MASK };
