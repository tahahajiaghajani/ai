// Fulfilment of requested items (REQ-016, REQ-026…REQ-030, REQ-036): the delivery promise on the working calendar,
// how an approved item starts — through the item's flows (`startCatalogFlows` for flows bound to the item's code, the
// item's own «گردش‌کار انجام» otherwise), through its task templates, or by hand —, records an item produces in
// another table (field map), delivery and the zero-touch check of flow-driven items (`request.flows` job: a failed
// run hands the item to people with a fallback task; a run that ends without tasks delivers it).
// Everything here runs inside the caller's transaction as the system (`sysOf`), except the job handler.
import { evaluate, type Cond } from "@shared/model/conditions";
import { formDef, isPrivateClass, type Answers, type FormSchema, type ItemSettings, type TaskTemplateDef } from "@shared/request/form";
import { promiseText, workingDaysDue } from "@shared/request/due";
import { stageFor, tasksOutcome } from "@shared/request/logic";
import type { BusinessCalendar } from "@shared/sla/calendar";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { addJournalIn, condEnv, createIn, orgSchema, orgTz, RefSet, resolveDisplay, systemCtx, transitionIn, updateIn } from "../../engine";
import { enqueue, type JobConfig } from "../../jobs";
import { activeFlows, resolveRunAs, startCatalogFlows, startRun } from "../flows";
import type { PublishedFlow } from "../flows/triggers";
import { calendarsOf } from "../sla/calendars";
import { config as slaConfig } from "../sla/common";
import { arr, eqAll, iso, isUuid, liveRow, liveRows, obj, requestConfig, sysOf, type Row } from "./common";
import { versionSchema } from "./definition";

export const JOB_FLOWS = "request.flows";
export const JOB_LINK = "request.link";

/** Display names of members and records (for title templates, answer texts and messages). */
export async function displayOf(q: Queryable, ctx: Ctx, refs: readonly [string, unknown][]): Promise<Record<string, string>> {
  const set = new RefSet();
  for (const [table, id] of refs) set.add(table, id);
  if (!set.byTarget.size) return {};
  const sys = sysOf(ctx);
  return resolveDisplay(q, sys, await condEnv(sys), await orgSchema(sys, q), set);
}

/** The working calendar of an item: its own, the module's default, else the organisation's default calendar. */
export async function calendarOf(q: Queryable, ctx: Ctx, preferred?: string | null): Promise<BusinessCalendar | null> {
  const sys = sysOf(ctx);
  const cfg = await requestConfig(q, ctx);
  const { byId, defaultId } = calendarsOf(await slaConfig(q, sys), orgTz(sys));
  const id = [preferred, cfg.calendar_id, defaultId].find((x): x is string => !!x && byId.has(x)) ?? null;
  return id ? (byId.get(id) ?? null) : null;
}

export interface Promise_ {
  days: number;
  text: string;
  due_at: string | null;
}

/** «حدود ۵ روز کاری» and the due date it means for an order placed at `from` (null when the item promises nothing). */
export async function promiseOf(q: Queryable, ctx: Ctx, item: Pick<ItemSettings, "delivery_days" | "calendar_id">, from = Date.now()): Promise<Promise_ | null> {
  if (item.delivery_days === null || item.delivery_days === undefined) return null;
  const cal = await calendarOf(q, ctx, item.calendar_id);
  const due = workingDaysDue(cal, from, Number(item.delivery_days));
  return { days: Number(item.delivery_days), text: promiseText(item.delivery_days), due_at: due ? iso(due) : null };
}

/** The answers as one object (public, personal and sensitive; never secrets) — what flows and field maps see. */
export function allAnswers(ritm: Row): Answers {
  return { ...obj(ritm.answers), ...obj(ritm.private_answers) };
}

/** Does a template's (or rule's) condition hold on the answers? An empty condition always holds. */
export function holdsOn(cond: Cond | null | undefined, answers: Answers, schema: FormSchema): boolean {
  if (!cond || !Object.keys(cond).length) return true;
  try {
    return evaluate(cond, answers, {}, formDef(schema));
  } catch {
    return false;
  }
}

/** The flows that fulfil an item: those bound to its code (trigger «سفارش از کاتالوگ») and its own «گردش‌کار انجام». */
export async function itemFlows(q: Queryable, orgId: string, item: Pick<ItemSettings, "code" | "flow_id">): Promise<PublishedFlow[]> {
  const all = await activeFlows(q, orgId);
  return all.filter((f) => (item.flow_id && f.id === item.flow_id) || (f.trigger.kind === "catalog" && !!item.code && f.trigger.catalog_item === item.code));
}

/** Fulfilment tasks from the item's templates of one phase (conditions on the answers; each after the previous one). */
export async function createTemplateTasks(tx: Tx, ctx: Ctx, ritm: Row, schema: FormSchema, phase: TaskTemplateDef["phase"]): Promise<Row[]> {
  const sys = sysOf(ctx);
  const answers = allAnswers(ritm);
  const templates = schema.tasks.filter((t) => t.phase === phase && holdsOn(t.condition, answers, schema)).sort((a, b) => a.order - b.order);
  const out: Row[] = [];
  let previous: Row | null = null;
  for (const t of templates) {
    const row: Row = await createIn(tx, sys, "request_task", {
      request_item_id: ritm.id,
      template_id: isUuid(t.id) ? t.id : null,
      short_description: t.short_description,
      sort_order: t.order,
      assignment_group_id: t.assignment_group_id || ritm.assignment_group_id || null,
      requester_visible: t.requester_visible,
      class_of_service: t.class_of_service || "standard",
      instructions: t.instructions || null,
      checklist: (t.checklist ?? []).map((text) => ({ text, done: false })),
      depends_on: t.depends_on_previous && previous ? previous.id : null,
    }, { trusted: true });
    out.push(row);
    previous = row;
  }
  return out;
}

/** Render `{{name}}` placeholders of a field map with the answers and the item's people. */
function renderValue(v: unknown, answers: Answers, ritm: Row): unknown {
  if (typeof v !== "string") return v;
  const whole = /^\{\{\s*([a-z][a-z0-9_]*)\s*\}\}$/.exec(v.trim());
  const pick = (k: string): unknown => (k in answers ? answers[k] : k === "requested_for" ? ritm.requested_for : k === "caller_id" ? ritm.caller_id : k === "number" ? ritm.number : k === "title" ? ritm.short_description : undefined);
  if (whole) return pick(whole[1]) ?? null;
  return v.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (_m, k: string) => {
    const x = pick(k);
    return x === undefined || x === null ? "" : Array.isArray(x) ? x.join("، ") : String(x);
  });
}

/**
 * The values of a record an item produces in `target` (REQ-004, REQ-030): the item's field map (templates on the
 * answers), then every question mapped to a field of the target. Unknown and engine-maintained fields are left out.
 */
export function producedValues(schema: FormSchema, answers: Answers, ritm: Row, target: string): Row {
  const def = tableDef(target);
  if (!def) return {};
  const writable = new Set(def.fields.filter((f) => !f.system && !f.readonly && !f.base).map((f) => f.name));
  // only open answers reach the other table, by mapping or by template: never a secret or a sensitive answer, which
  // would be stored there in clear for everyone who reads it (and indexed for the AI)
  const open = openAnswers(schema, answers);
  const out: Row = {};
  for (const [k, v] of Object.entries(obj(schema.item.field_map))) if (writable.has(k)) out[k] = renderValue(v, open, ritm);
  for (const v of schema.variables) if (v.map_to && writable.has(v.map_to) && open[v.name] !== undefined) out[v.map_to] = open[v.name];
  return out;
}

/** The answers without secret and sensitive ones (questions of type secret, the sensitive and secret classes). */
export function openAnswers(schema: FormSchema, answers: Answers): Answers {
  const closed = new Set<string>();
  for (const v of schema.variables) if (v.type === "secret" || isPrivateClass(v.field_class)) closed.add(v.name);
  for (const g of schema.grids) if (g.columns.some((c) => c.type === "secret" || isPrivateClass(c.field_class))) closed.add(g.code);
  return Object.fromEntries(Object.entries(answers).filter(([k]) => !closed.has(k)));
}

/** The record of a target table an item makes (as the system acting for the requester); null when nothing is set. */
async function produceRecord(tx: Tx, ctx: Ctx, ritm: Row, schema: FormSchema): Promise<Row | null> {
  const target = schema.item.target_table;
  if (!target || !tableDef(target) || tableDef(target)?.virtual) return null;
  const values = producedValues(schema, allAnswers(ritm), ritm, target);
  const def = tableDef(target)!;
  if (def.fields.some((f) => f.name === "short_description") && !values.short_description) values.short_description = ritm.short_description;
  if (def.fields.some((f) => f.name === "caller_id") && !values.caller_id) values.caller_id = ritm.requested_for ?? ritm.caller_id ?? null;
  const row = await createIn(tx, sysOf(ctx, (ritm.caller_id as string) ?? null), target, values, { trusted: true });
  await enqueue(tx, { kind: JOB_LINK, orgId: ctx.org.id, payload: { from_table: "request_item", from_id: ritm.id, kind: "related", to_table: target, to_id: row.id }, maxAttempts: 5 });
  return row;
}

/**
 * Start fulfilling an approved (or approval-free) item: its group, the mode — flows, task templates or by hand —, a
 * produced record when the item names a target table, and the stage. Called by the lifecycle hook on the item.
 */
export async function startFulfilment(tx: Tx, ctx: Ctx, ritm: Row, schema: FormSchema): Promise<void> {
  const sys = sysOf(ctx);
  const cfg = await requestConfig(tx, ctx);
  const flows = await itemFlows(tx, ctx.org.id, schema.item);
  const answers = allAnswers(ritm);
  const templates = schema.tasks.filter((t) => t.phase === "after_approval" && holdsOn(t.condition, answers, schema));
  const mode = flows.length ? "flow" : templates.length ? "tasks" : "manual";
  const group = ritm.assignment_group_id || schema.item.fulfilment_group_id || cfg.default_group_id || null;
  const now = new Date().toISOString();
  const moved = await transitionIn(tx, sys, "request_item", String(ritm.id), "in_fulfilment", {
    fulfilment: mode,
    assignment_group_id: group,
    fulfilment_started_at: now,
    ...(ritm.approval === "approved" && !ritm.approved_at ? { approved_at: now } : {}),
    stage: stageFor("in_fulfilment", schema.item.stages),
  }, { trusted: true });
  const live: Row = { ...ritm, ...moved };
  if (schema.item.target_table && schema.item.type !== "record_producer" && !live.produced_id) {
    const made = await produceRecord(tx, ctx, live, schema);
    if (made) await updateIn(tx, sys, "request_item", String(ritm.id), { produced_table: schema.item.target_table, produced_id: String(made.id) }, { trusted: true, keepVersion: true });
  }
  if (mode === "tasks") {
    await createTemplateTasks(tx, ctx, live, schema, "after_approval");
    return;
  }
  if (mode === "flow") {
    const runs = await startFlows(tx, ctx, live, schema, flows);
    // each run tells the item when it ends (`record.flow_ended`): the zero-touch check follows then, no polling
    if (runs.length) await updateIn(tx, sys, "request_item", String(ritm.id), { flow_runs: [...arr<string>(live.flow_runs), ...runs] }, { trusted: true, keepVersion: true });
  }
}

/** Start the item's flows on the requested item (inputs: the answers without secrets). */
async function startFlows(tx: Tx, ctx: Ctx, ritm: Row, schema: FormSchema, flows: PublishedFlow[]): Promise<string[]> {
  const inputs: Answers = { ...allAnswers(ritm), quantity: ritm.quantity ?? 1, requested_for: ritm.requested_for ?? null };
  const actor = (ritm.caller_id as string) ?? null;
  const byCode = flows.some((f) => f.trigger.kind === "catalog" && f.trigger.catalog_item === schema.item.code);
  const ids = byCode ? await startCatalogFlows(tx, ctx.org.id, { item: schema.item.code, table: "request_item", id: String(ritm.id), actorId: actor, inputs }) : [];
  // the item's own flow, when it is not one of those bound to the code (a manual flow, or one bound elsewhere)
  const own = flows.find((f) => f.id === schema.item.flow_id && !(f.trigger.kind === "catalog" && f.trigger.catalog_item === schema.item.code));
  if (own) {
    ids.push(
      await startRun(tx, {
        orgId: ctx.org.id,
        flow: { id: own.id, name: own.name },
        version: { id: own.version_id, no: own.version_no },
        trigger: { kind: "catalog", table: "request_item", id: String(ritm.id), number: (ritm.number as string) ?? null, actor, inputs, item: schema.item.code },
        actorId: actor,
        runAs: resolveRunAs(own.trigger, actor, own.publisher),
        depth: 0,
        table: own.trigger.table ?? "request_item",
      }),
    );
  }
  return ids;
}

/** Mark an item delivered (the lifecycle closes it at once when no confirmation is needed). */
export async function deliver(tx: Tx, ctx: Ctx, ritm: Row, opts: { zeroTouch?: boolean; note?: string } = {}): Promise<void> {
  const sys = sysOf(ctx);
  await transitionIn(tx, sys, "request_item", String(ritm.id), "delivered", { ...(opts.zeroTouch ? { zero_touch: true } : {}) }, { trusted: true });
  if (opts.note) await addJournalIn(tx, sys, tableDef("request_item")!, ritm, { kind: "system", body: opts.note }, { trusted: true });
}

const ACTIVE_RUN = new Set(["running", "waiting"]);

/** The states of the item's flow runs (id → state, error). */
export async function flowRunStates(q: Queryable, orgId: string, ids: readonly string[]): Promise<{ id: string; state: string; error: string | null }[]> {
  const list = ids.filter(isUuid);
  if (!list.length) return [];
  return q.query<{ id: string; state: string; error: string | null }>(`select id, state, error from sm_flow_runs where org_id = $1 and id = any($2::uuid[])`, [orgId, `{${list.join(",")}}`]);
}

export const runsActive = (runs: readonly { state: string }[]) => runs.some((r) => ACTIVE_RUN.has(r.state));

/**
 * The flow check of one item, when one of its runs ended (`record.flow_ended`): while a run is still active, the next
 * end checks again; a failed or canceled run gets a manual fallback task (once); when every run ended and the item
 * has no tasks it is delivered without a person (zero-touch); with tasks, the task roll-up delivers it.
 */
export async function checkFlows(cfg: JobConfig, orgId: string, id: string): Promise<"wait" | "done"> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write(async (tx) => {
    const ritm = await liveRow(tx, sys, "request_item", id);
    if (!ritm || !["in_fulfilment", "awaiting_info", "backordered"].includes(String(ritm.state))) return "done";
    const runs = await flowRunStates(tx, orgId, arr<string>(ritm.flow_runs));
    if (runsActive(runs)) return "wait";
    const failed = runs.filter((r) => r.state === "failed" || r.state === "canceled");
    const tasks = await liveRows(tx, sys, "request_task", eqAll({ request_item_id: id }), { order: "t.sort_order, t.created_at" });
    if (failed.length && !tasks.some((t) => t.short_description === FALLBACK_TITLE)) {
      await createIn(tx, sys, "request_task", {
        request_item_id: id,
        short_description: FALLBACK_TITLE,
        assignment_group_id: ritm.assignment_group_id ?? null,
        instructions: `گردش‌کار انجام این قلم کامل نشد: ${failed.map((r) => r.error || "بی‌پیام").join("؛ ")}\n\nکار را دستی انجام دهید و سپس این وظیفه را ببندید.`,
        class_of_service: "expedite",
      }, { trusted: true });
      await addJournalIn(tx, sys, tableDef("request_item")!, ritm, { kind: "work_note", body: "گردش‌کار انجام ناموفق بود؛ وظیفهٔ «انجام دستی» ساخته شد." }, { trusted: true });
      return "done";
    }
    const outcome = tasksOutcome(tasks);
    if (outcome === "none") await deliver(tx, sys, ritm, { zeroTouch: !failed.length, note: "گردش‌کار انجام بدون دخالت کارشناس پایان یافت." });
    else if (outcome === "done") await deliver(tx, sys, ritm);
    return "done";
  });
}

export const FALLBACK_TITLE = "انجام دستی (گردش‌کار کامل نشد)";

/** The schema of an item's version, or a refusal when it is gone (versions are never deleted). */
export async function schemaOf(q: Queryable, ctx: Ctx, ritm: Row): Promise<FormSchema | null> {
  return versionSchema(q, ctx, ritm.item_version_id);
}
