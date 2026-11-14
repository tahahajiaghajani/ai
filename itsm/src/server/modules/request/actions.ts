// What people do with a requested item besides the generic record page (REQ-005, REQ-023, REQ-041, REQ-044,
// REQ-045, REQ-048, REQ-049): the answers as the caller may see them (on the item or one of its tasks — fulfillers of
// another group see the answers of the item they work on), editing them (the requester before approval when the item
// allows it, fulfillers while it is open), revealing a secret answer to a fulfiller (journalled), asking the requester
// for information, ordering again with the same answers, moving the item to another catalogue item (answers re-mapped)
// or converting it into an incident, and the progress a requester sees.
import { answersEditable, isItemOpen, stageFor, stageIndex } from "@shared/request/logic";
import { cascade, checkAnswers, isEmptyAnswer, priceOf, titleOf, type Answers, type FormSchema } from "@shared/request/form";
import { DEFAULT_STAGES, STAGES, ORDERABLE_TYPES } from "@shared/request/vocab";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import { AppError, bad, forbidden, notFound } from "../../http/errors";
import { addJournalIn, condEnv, createIn, get, list, readSecret, transitionIn, updateIn, validationError } from "../../engine";
import { access } from "../../access/provider";
import { securityEvent } from "../platform/security";
import { rerunApprovalRulesIn } from "../sla";
import { eqAll, isUuid, liveRow, liveRows, obj, offeredChoice, sysOf, type Row } from "./common";
import { lockedRow } from "../incident/common";
import type { Queryable } from "../../db";
import { versionSchema } from "./definition";
import { canOrder } from "./entitlement";
import { displayOf } from "./fulfil";
import { publicSchema, summaryOf } from "./ordering";
import { MASK, modeOn, requesterOn, splitAnswers, writeFacts } from "./lifecycle";
import { enqueue } from "../../jobs";
import { JOB_LINK } from "./fulfil";

const onRequesterSide = (row: Row, userId: string) => [row.requested_for, row.caller_id, row.opened_by].includes(userId);

/** Does the caller work this item (full write mode — not their own order, whatever their role elsewhere)? */
async function works(ctx: Ctx, id: string): Promise<boolean> {
  return (await modeOn(ctx.db, ctx, "request_item", await liveRow(ctx.db, sysOf(ctx), "request_item", id))) === "full";
}

/** The sealed secret answers of an item (the caller's access to the item was checked before; `readSecret`). */
async function secretAnswers(ctx: Ctx, id: string, q: Queryable = ctx.db): Promise<Answers> {
  const plain = await readSecret(q, ctx, tableDef("request_item")!, id, "secret_answers");
  try {
    return obj(JSON.parse(plain ?? "{}"));
  } catch {
    return {};
  }
}

/** The requested item behind a record the caller reads (the item itself or one of its tasks); 404 otherwise. */
async function itemBehind(ctx: Ctx, table: string, id: string): Promise<{ ritm: Row; via: Row }> {
  if (table !== "request_item" && table !== "request_task") throw notFound();
  if (!isUuid(id)) throw notFound();
  const via = (await get(ctx, table, id)).row as Row;
  const ritm = table === "request_item" ? await liveRow(ctx.db, sysOf(ctx), "request_item", id) : await liveRow(ctx.db, sysOf(ctx), "request_item", via.request_item_id);
  if (!ritm) throw notFound("قلم درخواست‌شده پیدا نشد");
  return { ritm, via };
}

export interface AnswersView {
  item_id: string;
  number: string | null;
  state: string;
  schema: FormSchema;
  answers: Answers;
  /** sensitive answers shown (the caller is on the requester side or holds the «personal» field group) */
  sensitive: boolean;
  /** names of secret answers kept sealed (a fulfiller may reveal one) */
  secrets: string[];
  can_edit: boolean;
  can_reveal: boolean;
  display: Record<string, string>;
}

/** The answers of the item behind `table/id` as the caller may see them. */
export async function answersView(ctx: Ctx, table: string, id: string): Promise<AnswersView> {
  const { ritm } = await itemBehind(ctx, table, id);
  const schema = await versionSchema(ctx.db, ctx, ritm.item_version_id);
  if (!schema) throw notFound("نسخهٔ قلم پیدا نشد");
  const def = tableDef("request_item")!;
  const visible = access().visibleFields(ctx, def);
  const requester = onRequesterSide(ritm, ctx.user.id);
  const sensitive = requester || !visible || visible.has("private_answers");
  const answers: Answers = { ...obj(ritm.answers), ...(sensitive ? obj(ritm.private_answers) : {}) };
  const secrets = Object.keys(await secretAnswers(ctx, String(ritm.id)));
  const canWrite = table === "request_item" ? await writable(ctx, ritm) : false;
  const refs: [string, unknown][] = [];
  for (const v of schema.variables) {
    const value = answers[v.name];
    if (isEmptyAnswer(value)) continue;
    const target = v.type === "user" || v.type === "users" || v.type === "requested_for" ? "user" : v.type === "group" ? "group" : v.type === "location" ? "location" : v.type === "ci" ? "ci" : v.ref_table;
    if (target) for (const x of Array.isArray(value) ? value : [value]) refs.push([target, x]);
  }
  // the person's own item (an agent's own order too) follows the requester's rules
  const reqLike = await requesterOn(ctx.db, ctx, "request_item", ritm);
  // once an approver of the current round decided, the answers they decided on stay until the round is over
  const decided = ritm.state === "awaiting_approval" && (await decidedThisRound(ctx, String(ritm.id)));
  return {
    item_id: String(ritm.id),
    number: (ritm.number as string) ?? null,
    state: String(ritm.state),
    schema: publicSchema(schema),
    answers,
    sensitive,
    secrets,
    can_edit: !decided && (reqLike ? answersEditable(schema.item.requester_edit, String(ritm.state)) : canWrite && isItemOpen(ritm.state)),
    can_reveal: canWrite && !reqLike && isItemOpen(ritm.state) && secrets.length > 0,
    display: await displayOf(ctx.db, ctx, refs),
  };
}

/** Has an approver of the item's current approval round decided (approved or rejected)? */
async function decidedThisRound(ctx: Ctx, id: string, q: Queryable = ctx.db): Promise<boolean> {
  const rows = await liveRows(q, sysOf(ctx), "approval", eqAll({ table_key: "request_item", record_id: id }));
  const round = Math.max(0, ...rows.map((r) => Number(r.round) || 1));
  return rows.some((r) => (Number(r.round) || 1) === round && (r.state === "approved" || r.state === "rejected"));
}

async function writable(ctx: Ctx, ritm: Row): Promise<boolean> {
  try {
    const r = await get(ctx, "request_item", String(ritm.id));
    return !!r.meta?.canWrite;
  } catch {
    return false;
  }
}

/**
 * Edit the answers (REQ-044): checked again, facts rewritten, approvers told when the item waits for them. Decided
 * inside the write, from the item locked: an approval settling at the same moment (decide() locks the item first, then
 * moves it into fulfilment with the answers it approved) finishes first, and the edit is then refused — answers and a
 * price nobody approved never replace the approved ones on an item in fulfilment. The version check and whether the
 * approvers are asked again are decided from the same locked row.
 */
export async function editAnswers(ctx: Ctx, id: string, input: { answers?: Answers; version?: number | null }): Promise<AnswersView> {
  const view = await answersView(ctx, "request_item", id);
  if (!view.can_edit) throw forbidden("پاسخ‌های این قلم را اکنون نمی‌توانید تغییر دهید");
  const env = await condEnv(ctx);
  await ctx.write(async (tx) => {
    const ritm = await lockedRow(tx, sysOf(ctx), "request_item", id);
    if (!ritm) throw notFound("قلم درخواست‌شده پیدا نشد");
    if (input.version !== undefined && input.version !== null && Number(ritm.version) !== Number(input.version)) {
      throw new AppError(409, "version_conflict", "این قلم در این فاصله تغییر کرده است؛ آن را دوباره باز کنید", { version: ritm.version });
    }
    const schema = await versionSchema(tx, ctx, ritm.item_version_id);
    if (!schema) throw notFound("نسخهٔ قلم پیدا نشد");
    const reqLike = await requesterOn(tx, ctx, "request_item", ritm);
    const decided = ritm.state === "awaiting_approval" && (await decidedThisRound(ctx, id, tx));
    const editable = !decided && (reqLike ? answersEditable(schema.item.requester_edit, String(ritm.state)) : isItemOpen(ritm.state));
    if (!editable) throw forbidden("پاسخ‌های این قلم را اکنون نمی‌توانید تغییر دهید");
    const secrets = await secretAnswers(ctx, id, tx);
    const secretsKept = new Set(Object.keys(secrets));
    // values not sent for sensitive questions the caller could not see stay as they are
    const merged: Answers = { ...(view.sensitive ? {} : obj(ritm.private_answers)), ...obj(input.answers) };
    const checked = checkAnswers(schema, merged, { mode: reqLike ? "order" : "fulfil", env, secretsKept });
    if (Object.keys(checked.errors).length) throw validationError(Object.fromEntries(Object.entries(checked.errors).map(([k, v]) => [`answers.${k}`, v])));
    const parts = splitAnswers(schema, checked.answers);
    for (const k of Object.keys(parts.sensitive)) if (parts.sensitive[k] === MASK) delete parts.sensitive[k];
    const values: Row = {
      answers: parts.open,
      private_answers: Object.keys(parts.sensitive).length ? parts.sensitive : null,
    };
    if (Object.keys(parts.secret).length) values.secret_answers = JSON.stringify({ ...secrets, ...parts.secret });
    const price = priceOf(schema, checked.answers, Number(ritm.quantity) || 1);
    values.price = price.unit;
    values.total = price.total;
    const changed = schema.variables.filter((v) => JSON.stringify(obj(ritm.answers)[v.name] ?? obj(ritm.private_answers)[v.name] ?? null) !== JSON.stringify(checked.answers[v.name] ?? null) && v.type !== "secret").map((v) => v.label);
    const sys = sysOf(ctx, ctx.user.id);
    const row = await updateIn(tx, sys, "request_item", id, values, { trusted: true, version: Number(ritm.version) });
    await writeFacts(tx, ctx, { ...ritm, ...row }, schema);
    const note = changed.length ? `پاسخ‌ها ویرایش شد: ${changed.join("، ")}` : "پاسخ‌ها ویرایش شد";
    await addJournalIn(tx, sys, tableDef("request_item")!, ritm, { kind: "system", body: note }, { trusted: true });
    // the approvers decide on the answers as they are now: their open round is asked again (with the note)
    if (ritm.state === "awaiting_approval") await rerunApprovalRulesIn(tx, sysOf(ctx), "request_item", id, { comment: `${note} — پیش از تصمیم، پاسخ‌های تازه را ببینید.` });
  });
  return answersView(ctx, "request_item", id);
}

/** A secret answer for a fulfiller of the open item (journalled and recorded as a security event). */
export async function revealSecret(ctx: Ctx, id: string, name: string): Promise<{ name: string; value: unknown }> {
  const view = await answersView(ctx, "request_item", id);
  if (!view.can_reveal || !view.secrets.includes(name)) throw forbidden("این پاسخ را نمی‌توانید ببینید");
  const ritm = (await liveRow(ctx.db, sysOf(ctx), "request_item", id))!;
  const all = await secretAnswers(ctx, id);
  const label = view.schema.variables.find((v) => v.name === name)?.label ?? name;
  await ctx.write(async (tx) => {
    await addJournalIn(tx, sysOf(ctx, ctx.user.id), tableDef("request_item")!, ritm, { kind: "system", body: `پاسخ محرمانهٔ «${label}» دیده شد`, visibility: "internal" }, { trusted: true });
    await securityEvent(tx, { kind: "request_secret_revealed", user_id: ctx.user.id, org_id: ctx.org.id, data: { table: "request_item", id, number: ritm.number ?? null, variable: name } });
  });
  return { name, value: all[name] ?? null };
}

/** «درخواست اطلاعات» (REQ-045): the question goes to the requester as a comment and the item waits (SLA paused). */
export async function requestInfo(ctx: Ctx, id: string, input: { message?: string }): Promise<Row> {
  const message = String(input.message ?? "").trim();
  if (!message) throw validationError({ message: "پرسش خود از درخواست‌کننده را بنویسید" });
  const r = await get(ctx, "request_item", id);
  if (!(await works(ctx, id))) throw forbidden("فقط کارشناس از درخواست‌کننده اطلاعات می‌خواهد");
  const row = r.row as Row;
  if (!["in_fulfilment", "backordered"].includes(String(row.state))) throw bad("فقط قلمی که در حال انجام است منتظر اطلاعات می‌ماند");
  return ctx.write(async (tx) => {
    // the question goes out as the person; the move is the module's (the transition is not offered on its own)
    await addJournalIn(tx, ctx, tableDef("request_item")!, row, { kind: "comment", body: message });
    return transitionIn(tx, sysOf(ctx, ctx.user.id), "request_item", id, "awaiting_info", {}, { trusted: true });
  });
}

/**
 * The requester's feedback on a delivered or closed item (REQ-046): a rating of 1–5 and a short comment, also after
 * the item closed (written by the module: closed records refuse ordinary updates).
 */
export async function giveFeedback(ctx: Ctx, id: string, input: { rating: number; feedback?: string | null }): Promise<Row> {
  const row = (await get(ctx, "request_item", id)).row as Row;
  if (!onRequesterSide(row, ctx.user.id)) throw forbidden("بازخورد را درخواست‌کننده ثبت می‌کند");
  if (!["delivered", "closed_complete", "closed_incomplete"].includes(String(row.state))) throw bad("بازخورد پس از تحویل ثبت می‌شود");
  const rating = Math.round(Number(input.rating));
  if (!(rating >= 1 && rating <= 5)) throw validationError({ rating: "امتیاز میان ۱ و ۵ است" });
  return ctx.write((tx) =>
    updateIn(tx, sysOf(ctx, ctx.user.id), "request_item", id, { rating, feedback: (input.feedback ?? "").trim().slice(0, 2000) || null }, { trusted: true, allowLocked: true, keepVersion: true }),
  );
}

/** What «سفارش دوباره» starts from (REQ-044): the item and the open answers (never sensitive or secret ones). */
export async function reorder(ctx: Ctx, id: string): Promise<{ item_id: string; answers: Answers; quantity: number; requested_for: string | null; available: boolean }> {
  const row = (await get(ctx, "request_item", id)).row as Row;
  const item = await liveRow(ctx.db, sysOf(ctx), "catalog_item", row.cat_item_id);
  const available = !!item && item.state === "published" && (await canOrder(ctx.db, ctx, item, String(row.requested_for ?? ctx.user.id)));
  return { item_id: String(row.cat_item_id), answers: obj(row.answers), quantity: Number(row.quantity) || 1, requested_for: (row.requested_for as string) ?? null, available };
}

/**
 * Move an open item to another catalogue item (REQ-048): answers with the same name and a compatible type carry over,
 * the rest is asked again (`force` keeps the item even when required answers are missing — a fulfiller completes
 * them). The item keeps its number, history and links.
 */
export async function changeItem(ctx: Ctx, id: string, input: { item_id: string; force?: boolean }): Promise<Row> {
  await get(ctx, "request_item", id);
  if (!(await works(ctx, id))) throw forbidden("فقط کارشناس قلم را عوض می‌کند");
  const ritm = (await liveRow(ctx.db, sysOf(ctx), "request_item", id))!;
  if (!isItemOpen(ritm.state)) throw bad("فقط قلم باز را می‌توان عوض کرد");
  const target = await liveRow(ctx.db, sysOf(ctx), "catalog_item", input.item_id);
  if (!target || target.state !== "published" || !target.version_id) throw validationError({ item_id: "قلم مقصد در کاتالوگ نیست" });
  if (!ORDERABLE_TYPES.includes(target.type)) throw validationError({ item_id: "قلم مقصد سفارش‌دادنی نیست" });
  if (!(await canOrder(ctx.db, ctx, target, String(ritm.requested_for)))) throw validationError({ item_id: "قلم مقصد برای این شخص در دسترس نیست" });
  const from = (await versionSchema(ctx.db, ctx, ritm.item_version_id))!;
  const to = (await versionSchema(ctx.db, ctx, target.version_id))!;
  const mapped = cascade({ ...obj(ritm.answers), ...obj(ritm.private_answers) }, from.variables, to);
  const env = await condEnv(ctx);
  const checked = checkAnswers(to, mapped, { mode: "fulfil", env });
  if (Object.keys(checked.errors).length && !input.force) throw validationError(Object.fromEntries(Object.entries(checked.errors).map(([k, v]) => [`answers.${k}`, v])));
  const parts = splitAnswers(to, checked.answers);
  const price = priceOf(to, checked.answers, Number(ritm.quantity) || 1);
  const display = await displayOf(ctx.db, ctx, [["user", ritm.requested_for]]);
  return ctx.write(async (tx) => {
    const sys = sysOf(ctx, ctx.user.id);
    const row = await updateIn(tx, sys, "request_item", id, {
      cat_item_id: target.id, item_version_id: target.version_id, category_id: to.item.category_id ?? null,
      answers: parts.open, private_answers: Object.keys(parts.sensitive).length ? parts.sensitive : null,
      price: price.unit, total: price.total, recurring_price: price.recurring, recurring_frequency: price.recurring ? to.item.recurring_frequency ?? null : null,
      short_description: titleOf(to, checked.answers, { requestedFor: ritm.requested_for as string, quantity: Number(ritm.quantity) || 1, display }),
      approval_rule_id: to.item.approval_rule_id ?? null,
    }, { trusted: true });
    await writeFacts(tx, ctx, row, to);
    await addJournalIn(tx, sys, tableDef("request_item")!, ritm, { kind: "system", body: `قلم از «${from.item.name}» به «${to.item.name}» تغییر کرد` }, { trusted: true });
    return row;
  });
}

/**
 * Convert an open item into an incident (REQ-048), when incident management is installed: the incident gets the
 * requester, the title and the answers, the two are linked and the item is cancelled as «تبدیل شد».
 */
export async function convertToIncident(ctx: Ctx, id: string, input: { note?: string } = {}): Promise<{ table: string; id: string; number: string | null }> {
  if (!tableDef("incident")) throw bad("مدیریت رخداد در این سامانه نصب نیست");
  await get(ctx, "request_item", id);
  if (!(await works(ctx, id))) throw forbidden("فقط کارشناس قلم را تبدیل می‌کند");
  const ritm = (await liveRow(ctx.db, sysOf(ctx), "request_item", id))!;
  if (!isItemOpen(ritm.state)) throw bad("فقط قلم باز را می‌توان تبدیل کرد");
  const schema = (await versionSchema(ctx.db, ctx, ritm.item_version_id))!;
  const display = await displayOf(ctx.db, ctx, [["user", ritm.requested_for]]);
  // the item's channel when incidents know it (not «دستیار هوشمند», «زمان‌بندی» or «گردش‌کار»), else the incident's default
  const channel = await offeredChoice(ctx.db, ctx, "incident", "channel", ritm.channel);
  return ctx.write(async (tx) => {
    const inc = await createIn(tx, ctx, "incident", {
      short_description: ritm.short_description,
      description: [`از ${ritm.number ?? "قلم درخواست‌شده"} تبدیل شد.`, input.note?.trim() || "", summaryOf(schema, obj(ritm.answers), display)].filter(Boolean).join("\n\n"),
      caller_id: ritm.requested_for ?? ritm.caller_id ?? null,
      ...(channel ? { channel } : {}),
    });
    await transitionIn(tx, sysOf(ctx, ctx.user.id), "request_item", id, "cancelled", { close_code: "converted", close_notes: `به رخداد ${inc.number ?? ""} تبدیل شد`.trim() }, { trusted: true });
    await enqueue(tx, { kind: JOB_LINK, orgId: ctx.org.id, payload: { from_table: "request_item", from_id: id, kind: "related", to_table: "incident", to_id: inc.id }, maxAttempts: 5 });
    return { table: "incident", id: String(inc.id), number: (inc.number as string) ?? null };
  });
}

export interface Progress {
  stages: { key: string; label: string; done: boolean; current: boolean }[];
  state: string;
  stage: string;
  due_at: string | null;
  overdue: boolean;
  tasks: { id: string; number: string | null; title: string; state: string }[];
  approvals: { pending: number; approved: number; rejected: number };
}

/** The progress bar of an item (REQ-023) and what the caller may see of its tasks and approvals. */
export async function progress(ctx: Ctx, id: string): Promise<Progress> {
  const row = (await get(ctx, "request_item", id)).row as Row;
  const schema = await versionSchema(ctx.db, ctx, row.item_version_id);
  const bar = schema?.item.stages?.length ? schema.item.stages : DEFAULT_STAGES;
  const stage = String(row.stage || stageFor(String(row.state), bar));
  const at = stageIndex(stage, bar);
  const terminal = stage === "rejected" || stage === "cancelled";
  const label = (k: string) => STAGES.find((s) => s.value === k)?.label ?? k;
  const stages = bar.map((k, i) => ({ key: k, label: label(k), done: !terminal && (stage === "completed" || i < at), current: !terminal && i === at && stage !== "completed" }));
  if (terminal) stages.push({ key: stage, label: label(stage), done: false, current: true });
  // tasks through the caller's access (requesters see only those shown to them)
  const tasks: Progress["tasks"] = [];
  try {
    const res = await list(ctx, "request_task", { filter: { f: "request_item_id", op: "eq", v: id }, sort: "sort_order", size: 100, fields: ["number", "short_description", "state"] });
    for (const t of res.rows as Row[]) tasks.push({ id: String(t.id), number: (t.number as string) ?? null, title: String(t.short_description ?? ""), state: String(t.state) });
  } catch {
    // no read access to tasks
  }
  const appr = await liveRows(ctx.db, sysOf(ctx), "approval", eqAll({ table_key: "request_item", record_id: id }));
  const due = row.due_at ? Date.parse(String(row.due_at)) : NaN;
  return {
    stages,
    state: String(row.state),
    stage,
    due_at: (row.due_at as string) ?? null,
    overdue: Number.isFinite(due) && due < Date.now() && isItemOpen(row.state),
    tasks,
    approvals: {
      pending: appr.filter((a) => a.state === "requested" || a.state === "waiting").length,
      approved: appr.filter((a) => a.state === "approved").length,
      rejected: appr.filter((a) => a.state === "rejected").length,
    },
  };
}
