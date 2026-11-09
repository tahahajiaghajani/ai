// «درخواست‌های من» and the ticket page of the portal (PTL-010, PTL-011, PTL-034): a federated list over the tables
// registered as the portal's items (incidents, requested items, feedback, interactions, and what later modules add),
// read with the person's own access and narrowed to how the record relates to them:
//   · mine   — they asked or it is for them (the table's requester fields)
//   · shared — they follow it (the watch list) without being its requester
//   · team   — a manager's people: a requester field holds one of their reportees, or the record belongs to a unit they
//              manage (the access model's requester-side visibility; nobody else's records)
// The ticket page is a projection for requesters: public replies only (never internal notes, even for an agent who
// opens their own ticket here), the state history in friendly words, attachments that no internal note uses, the
// actions a requester takes (confirm, reopen, cancel, chase) and no agent-only fields. A record that is not theirs,
// shared with them or their team's answers «پیدا نشد», whoever asks.
import type { Cond } from "@shared/model/conditions";
import type { TableDef } from "@shared/model/types";
import { STAGE_LABELS, STAGE_TONES, isOpenStage, stageOf, stageSteps, type Stage } from "@shared/portal/logic";
import type { PortalAction, PortalAttachment, PortalItemsPage, PortalTicket, PortalTicketCard, TimelineEntry } from "@shared/portal/api";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import { addJournal, get, list, listAttachments, listHistory, listJournal, orgSchema, transition } from "../../engine";
import { access } from "../../access/provider";
import { bad, forbidden, notFound } from "../../http/errors";
import { recordApprovals, recordTimers } from "../sla";
import { answersView } from "../request";
import { isUuid, liveRows, logEvent, portalItemTable, portalItemTables, subjectFor, sysOf, type Row } from "./common";
import type { Subject } from "@shared/access/evaluate";
import { pendingInvitationFor } from "./surveys";

export type ItemsTab = "mine" | "shared" | "team";
export type ItemsState = "open" | "closed" | "all";

const DONE = new Set(["closed", "canceled"]);

/** The requester fields of a table (whose record it is), in priority order. */
export function requesterFields(def: TableDef): string[] {
  const has = (n: string) => def.fields.some((f) => f.name === n);
  const r = def.scope?.requester?.length ? def.scope.requester : (def.scope?.own ?? []).filter((f) => f !== "assigned_to");
  return r.filter(has);
}

const categoryOf = (def: TableDef, state: unknown): string | null => def.states?.states.find((s) => s.value === state)?.category ?? null;

function statesWhere(def: TableDef, state: ItemsState): Cond | null {
  if (state === "all" || !def.states) return null;
  const values = def.states.states.filter((s) => (state === "open" ? !DONE.has(s.category) : DONE.has(s.category))).map((s) => s.value);
  return { f: def.states.field, op: "in", v: values };
}

function mineCond(def: TableDef): Cond | null {
  const fields = requesterFields(def);
  return fields.length ? { or: fields.map((f) => ({ f, op: "is_me" }) as Cond) } : null;
}

const fieldType = (def: TableDef, name: string) => def.fields.find((f) => f.name === name)?.type;

/** How a record relates to the caller, as a condition (null: the tab does not apply to this table or this person). */
function relationCond(s: Subject, def: TableDef, tab: ItemsTab): Cond | null {
  const mine = mineCond(def);
  if (!mine) return null;
  if (tab === "mine") return mine;
  if (tab === "shared") {
    const w = def.scope?.watchers;
    return w && def.fields.some((f) => f.name === w) ? { and: [{ f: w, op: "is_me" }, { not: mine }] } : null;
  }
  const or: Cond[] = [];
  const reportees = s.reportees.slice(0, 500);
  if (reportees.length) for (const f of requesterFields(def)) if (fieldType(def, f) === "user") or.push({ f, op: "in", v: reportees });
  if (s.managedTree.length) or.push({ f: "unit_id", op: "in", v: s.managedTree.slice(0, 500) });
  return or.length ? { and: [{ or }, { not: mine }] } : null;
}

/** May the caller see «تیم من» (they manage people or units)? */
export async function managesPeople(ctx: Ctx): Promise<boolean> {
  if (ctx.actor === "system") return false;
  const s = await subjectFor(ctx);
  return s.reportees.length > 0 || s.managedTree.length > 0;
}

function relationOf(ctx: Ctx, s: Subject, def: TableDef, row: Row): PortalTicketCard["relation"] | null {
  const me = ctx.user.id;
  const holds = (v: unknown) => (Array.isArray(v) ? v.includes(me) : v === me);
  if (requesterFields(def).some((f) => holds(row[f]))) return "mine";
  const w = def.scope?.watchers;
  if (w && holds(row[w])) return "shared";
  const reportees = new Set(s.reportees);
  if (requesterFields(def).some((f) => typeof row[f] === "string" && reportees.has(row[f] as string))) return "team";
  if (typeof row.unit_id === "string" && s.managedTree.includes(row.unit_id)) return "team";
  return null;
}

const titleField = (def: TableDef): string => portalItemTable(def.key)?.title ?? (def.fields.some((f) => f.name === "short_description") ? "short_description" : def.display);

function stageOfRow(def: TableDef, row: Row): Stage {
  return stageOf(categoryOf(def, row[def.states?.field ?? "state"]), { state: String(row.state ?? ""), hold_reason: (row.hold_reason as string) ?? null, info_requested: row.info_requested === true });
}

function cardOf(ctx: Ctx, def: TableDef, row: Row, display: Record<string, string>, relation: PortalTicketCard["relation"]): PortalTicketCard {
  const stage = stageOfRow(def, row);
  const stateValue = String(row[def.states?.field ?? "state"] ?? "");
  const forId = ["requested_for", "caller_id"].map((f) => row[f]).find((v) => typeof v === "string" && v) as string | undefined;
  return {
    table: def.key,
    kind_label: portalItemTable(def.key)?.kind_label ?? def.label,
    id: String(row.id),
    number: (row.number as string) ?? null,
    title: String(row[titleField(def)] ?? display[String(row.id)] ?? ""),
    state: stateValue,
    state_label: def.states?.states.find((s) => s.value === stateValue)?.label ?? stateValue,
    stage,
    stage_label: STAGE_LABELS[stage],
    tone: STAGE_TONES[stage],
    opened_at: (row.opened_at as string) ?? (row.started_at as string) ?? (row.created_at as string) ?? null,
    updated_at: (row.updated_at as string) ?? null,
    relation,
    for_name: forId && forId !== ctx.user.id ? (display[forId] ?? null) : null,
  };
}

/** The fields a card needs (those the table has). */
function cardFields(def: TableDef): string[] {
  const want = ["number", titleField(def), def.states?.field ?? "state", "opened_at", "started_at", "created_at", "updated_at", "hold_reason", "info_requested", "unit_id", ...requesterFields(def), def.scope?.watchers ?? ""];
  return [...new Set(want.filter((n) => n && def.fields.some((f) => f.name === n)))];
}

/** «درخواست‌های من»: one page over every portal item table the caller may read. */
export async function myItems(ctx: Ctx, p: { tab?: ItemsTab; state?: ItemsState; q?: string | null; page?: number; size?: number }): Promise<PortalItemsPage> {
  const tab = p.tab ?? "mine";
  const state = p.state ?? "open";
  const page = Math.max(1, Math.floor(p.page ?? 1));
  const size = Math.min(50, Math.max(1, Math.floor(p.size ?? 20)));
  const team = await managesPeople(ctx);
  const subject = ctx.actor === "system" ? null : await subjectFor(ctx);
  if (ctx.actor === "system" || (tab === "team" && !team)) return { items: [], total: 0, page, size, team };
  const schema = await orgSchema(ctx);
  const cards: PortalTicketCard[] = [];
  let total = 0;
  for (const t of portalItemTables()) {
    const def = schema.def(t.table);
    if (!def || def.virtual || !def.states || !access().canReadTable(ctx, def)) continue;
    const rel = subject ? relationCond(subject, def, tab) : null;
    if (!rel) continue;
    const st = statesWhere(def, state);
    const filter: Cond = st ? { and: [rel, st] } : rel;
    try {
      const r = await list(ctx, def.key, { filter, q: p.q?.trim() || undefined, sort: "-updated_at", size: Math.min(500, page * size), fields: cardFields(def), total: true });
      total += r.total ?? r.rows.length;
      for (const row of r.rows) cards.push(cardOf(ctx, def, row, r.display, tab));
    } catch {
      // a table the person cannot list (a refused filter, a customised table): the others still show
    }
  }
  cards.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
  return { items: cards.slice((page - 1) * size, page * size), total, page, size, team };
}

// ---------------------------------------------------------------------------------------------------------------
// The ticket page

/** Load a portal item the caller may see in the portal (theirs, shared with them, their team's), or 404. */
async function loadTicket(ctx: Ctx, table: string, id: string) {
  if (!portalItemTable(table) || !isUuid(id) || ctx.actor === "system") throw notFound("پیدا نشد");
  const r = await get(ctx, table, id).catch(() => null);
  if (!r) throw notFound("پیدا نشد");
  const { def } = { def: (await orgSchema(ctx)).def(table) ?? tableDef(table)! };
  const relation = relationOf(ctx, await subjectFor(ctx), def, r.row);
  if (!relation) throw notFound("پیدا نشد");
  return { def, ...r, relation };
}

/** Attachments used by internal notes (never listed in the portal, even when the engine would). */
async function internalAttachmentIds(ctx: Ctx, table: string, id: string): Promise<Set<string>> {
  try {
    const all = await listJournal(sysOf(ctx), table, id, { limit: 500 });
    const out = new Set<string>();
    for (const e of all.entries) if (e.visibility !== "public") for (const a of e.attachments) out.add(a.id);
    return out;
  } catch {
    return new Set();
  }
}

const PUBLIC_KINDS = new Set(["comment", "email_in", "email_out"]);

function actionsOf(def: TableDef, row: Row, meta: { transitions: { to: string; label: string; requires: string[]; category: string | null }[]; readonly: string[] }, stage: Stage): PortalAction[] {
  const out: PortalAction[] = [];
  const cat = categoryOf(def, row[def.states?.field ?? "state"]);
  const filled = (f: string) => row[f] !== null && row[f] !== undefined && row[f] !== "";
  for (const t of meta.transitions) {
    // the reason the person writes fills «close_notes» when the transition asks for it and they may write it; any
    // other required field must already have a value (a requester never sets the desk's fields)
    const commentField = t.requires.includes("close_notes") && !meta.readonly.includes("close_notes") ? "close_notes" : null;
    if (!t.requires.every((f) => f === commentField || filled(f))) continue;
    if (cat === "resolved" && t.category === "closed" && !out.some((a) => a.key === "confirm")) out.push({ key: "confirm", label: "مشکلم حل شد؛ بسته شود", to: t.to, comment: "none", tone: "primary" });
    else if (cat === "resolved" && (t.category === "active" || t.category === "new") && !out.some((a) => a.key === "reopen")) out.push({ key: "reopen", label: "هنوز حل نشده است", to: t.to, comment: "required", tone: "default" });
    else if (t.category === "canceled" && cat !== "resolved" && !out.some((a) => a.key === "cancel" || a.key === "withdraw"))
      out.push({ key: def.key === "portal_feedback" ? "withdraw" : "cancel", label: def.key === "portal_feedback" ? "پس گرفتن" : "لغو درخواست", to: t.to, comment: commentField ? "required" : "optional", tone: "danger" });
    else if (def.key === "portal_feedback" && cat === "waiting" && t.category === "active" && !out.some((a) => a.key === "reopen")) out.push({ key: "reopen", label: "پاسخ دادم؛ ادامهٔ بررسی", to: t.to, comment: "optional", tone: "primary" });
  }
  if (isOpenStage(stage) && stage !== "done" && cat !== "resolved") out.push({ key: "chase", label: "پیگیری", to: null, comment: "optional", tone: "default" });
  return out;
}

/** Requester-safe facts of a record: who it is for, the service, the person working on it (a first name), the item. */
function factsOf(ctx: Ctx, def: TableDef, row: Row, display: Record<string, string>, visible: ReadonlySet<string> | null): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const can = (n: string) => def.fields.some((f) => f.name === n) && (!visible || visible.has(n));
  const name = (v: unknown) => (typeof v === "string" ? display[v] ?? null : null);
  if (can("cat_item_id") && name(row.cat_item_id)) out.push({ label: "خدمت سفارش‌داده‌شده", value: name(row.cat_item_id)! });
  if (can("quantity") && Number(row.quantity) > 1) out.push({ label: "تعداد", value: Number(row.quantity).toLocaleString("fa-IR") });
  if (can("kind") && def.key === "portal_feedback") out.push({ label: "نوع", value: def.fields.find((f) => f.name === "kind")?.choices instanceof Array ? ((def.fields.find((f) => f.name === "kind")!.choices as { value: string; label: string }[]).find((o) => o.value === row.kind)?.label ?? String(row.kind)) : String(row.kind) });
  if (can("service_id") && name(row.service_id)) out.push({ label: "خدمت", value: name(row.service_id)! });
  if (can("requested_for") && row.requested_for && row.requested_for !== ctx.user.id && name(row.requested_for)) out.push({ label: "برای", value: name(row.requested_for)! });
  if (can("caller_id") && row.caller_id && row.caller_id !== ctx.user.id && row.caller_id !== row.requested_for && name(row.caller_id)) out.push({ label: "ثبت به نام", value: name(row.caller_id)! });
  if (can("assigned_to") && name(row.assigned_to)) out.push({ label: "کارشناس رسیدگی‌کننده", value: name(row.assigned_to)!.split(" ")[0] });
  if (can("due_at") && typeof row.due_at === "string") out.push({ label: "موعد", value: row.due_at });
  return out;
}

/** The ticket page of the portal (see the file's head). */
export async function ticketView(ctx: Ctx, table: string, id: string): Promise<PortalTicket> {
  const { def, row, display, meta, relation } = await loadTicket(ctx, table, id);
  const card = cardOf(ctx, def, row, display, relation);
  const visible = access().visibleFields(ctx, def);
  const requesters = new Set(requesterFields(def).map((f) => row[f]).filter((v): v is string => typeof v === "string"));

  // public replies (never internal notes) and the state's history in friendly words
  const timeline: TimelineEntry[] = [{ id: `created:${row.id}`, kind: "created", at: card.opened_at ?? String(row.created_at ?? ""), author_name: display[String(row.opened_by ?? row.created_by ?? "")] ?? null, mine: (row.opened_by ?? row.created_by) === ctx.user.id, staff: false, body: null, label: "ثبت شد" }];
  const hidden = await internalAttachmentIds(ctx, table, id);
  if (def.features?.journal) {
    const j = await listJournal(ctx, table, id, { limit: 300 }).catch(() => ({ entries: [], display: {} as Record<string, string> }));
    for (const e of j.entries) {
      if (e.visibility !== "public" || !PUBLIC_KINDS.has(e.kind)) continue;
      timeline.push({ id: e.id, kind: "comment", at: e.created_at, author_name: e.author ? (j.display[e.author] ?? display[e.author] ?? null) : null, mine: e.author === ctx.user.id, staff: !!e.author && !requesters.has(e.author) && e.author !== ctx.user.id, body: e.body, label: null, attachments: e.attachments.filter((a) => !hidden.has(a.id)).map((a) => ({ id: a.id, name: a.name })) });
    }
  }
  if (def.states && def.features?.history !== false) {
    const h = await listHistory(ctx, table, id, { limit: 300 }).catch(() => ({ entries: [], display: {} as Record<string, string> }));
    for (const e of h.entries) {
      if (e.field !== def.states.field || e.old === null || e.old === undefined) continue;
      const cat = categoryOf(def, e.new);
      const stage = stageOf(cat, { state: String(e.new ?? "") });
      timeline.push({ id: e.id, kind: "state", at: e.at, author_name: null, mine: e.actor === ctx.user.id, staff: false, body: null, label: STAGE_LABELS[stage] === card.stage_label && cat === "waiting" ? def.states.states.find((s) => s.value === e.new)?.label ?? STAGE_LABELS[stage] : STAGE_LABELS[stage] });
    }
  }
  timeline.sort((a, b) => a.at.localeCompare(b.at));

  let attachments: PortalAttachment[] = [];
  if (def.features?.attachments) {
    const a = await listAttachments(ctx, table, id).catch(() => ({ attachments: [] }));
    attachments = a.attachments.filter((x) => !hidden.has(x.id)).map((x) => ({ id: x.id, name: x.name, mime: x.mime, size: x.size, previewable: x.previewable, created_at: x.created_at, mine: x.uploaded_by === ctx.user.id }));
  }

  let approvals: PortalTicket["approvals"] = null;
  if (def.fields.some((f) => f.name === "approval")) {
    const r = await recordApprovals(ctx, table, id).catch(() => null);
    if (r && r.approvals.length) {
      const pending = r.approvals.filter((x) => x.state === "requested").length;
      const decided = r.approvals.filter((x) => x.state === "approved" || x.state === "rejected").length;
      const label = pending ? "در انتظار تأیید" : r.approvals.some((x) => x.state === "rejected") ? "رد شد" : "تأیید شد";
      approvals = { state: r.aggregate, label, pending, decided };
    }
  }

  let promise: PortalTicket["promise"] = null;
  if (isOpenStage(card.stage) && card.stage !== "done") {
    const timers = await recordTimers(ctx.db, ctx, table, id).catch(() => []);
    const live = timers.map((t) => t.view).filter((v) => v.state === "in_progress" && !v.paused && v.due_at);
    const t = live.find((v) => v.type === "response") ?? live.find((v) => v.type === "resolution") ?? live[0];
    if (t?.due_at) promise = { label: t.type === "response" ? "پاسخ تا" : "انجام تا", due_at: t.due_at, late: t.breached };
  }

  let outage: PortalTicket["outage"] = null;
  if (table === "incident") {
    const [a] = await liveRows(ctx.db, sysOf(ctx), "announcement", { and: [{ f: "incident_id", op: "eq", v: id }, { f: "state", op: "eq", v: "published" }] }, { limit: 1 });
    if (a) outage = { title: String(a.title ?? ""), kind: String(a.kind ?? "outage") };
  }

  let answers: { label: string; value: string }[] = [];
  if (table === "request_item") {
    const v = await answersView(ctx, table, id).catch(() => null);
    if (v) {
      for (const q of v.schema.variables) {
        if (q.type === "secret" || q.field_class === "sensitive" || q.field_class === "secret" || !(q.name in v.answers)) continue;
        const value = v.answers[q.name];
        if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) continue;
        const text = Array.isArray(value) ? value.map((x) => v.display[String(x)] ?? String(x)).join("، ") : typeof value === "boolean" ? (value ? "بله" : "خیر") : v.display[String(value)] ?? q.choices?.find((c) => c.value === String(value))?.label ?? String(value);
        answers.push({ label: q.label, value: text });
      }
    }
  }

  const invitation = await pendingInvitationFor(ctx, table, id).catch(() => null);
  const rating = typeof row.satisfaction === "number" ? row.satisfaction : typeof row.rating === "number" ? row.rating : null;
  // the official answer of feedback, or the resolution notes — only when the person's field groups show the field
  const shows = (n: string) => def.fields.some((f) => f.name === n) && (!visible || visible.has(n)) && typeof row[n] === "string" && String(row[n]).trim() !== "";
  const resolution = shows("response") ? String(row.response) : card.stage === "done" || card.stage === "closed" ? (shows("close_notes") ? String(row.close_notes) : null) : null;
  return {
    ...card,
    description: typeof row.description === "string" ? row.description : null,
    steps: stageSteps(card.stage),
    facts: factsOf(ctx, def, row, display, visible),
    timeline,
    attachments,
    actions: relation === "mine" ? actionsOf(def, row, meta, card.stage) : [],
    can_comment: card.stage !== "closed" && card.stage !== "canceled",
    approvals,
    promise,
    outage,
    survey: invitation ? { invitation_id: invitation } : null,
    answers,
    rating,
    resolution,
  };
}

/** Add a public reply to a ticket (as the person; attachments of the same record). */
export async function replyToTicket(ctx: Ctx, table: string, id: string, body: string, attachments: string[] = []): Promise<void> {
  const t = await loadTicket(ctx, table, id);
  const stage = stageOfRow(t.def, t.row);
  if (stage === "closed" || stage === "canceled") throw bad("این مورد بسته شده است؛ اگر هنوز مشکل دارید مورد تازه‌ای ثبت کنید");
  const text = body.trim();
  if (!text) throw bad("متن پاسخ خالی است");
  await addJournal(ctx, table, id, { kind: "comment", body: text.slice(0, 20_000), attachments });
}

/** A requester's action on their ticket (confirm, reopen, cancel/withdraw, chase). */
export async function ticketAction(ctx: Ctx, table: string, id: string, input: { action: PortalAction["key"]; comment?: string | null; rating?: number | null }): Promise<void> {
  const t = await loadTicket(ctx, table, id);
  if (t.relation !== "mine") throw forbidden("این کار را فقط درخواست‌کننده انجام می‌دهد");
  const stage = stageOfRow(t.def, t.row);
  const action = actionsOf(t.def, t.row, t.meta, stage).find((a) => a.key === input.action);
  if (!action) throw bad("این کار اکنون روی این مورد ممکن نیست");
  const comment = (input.comment ?? "").trim().slice(0, 4000);
  if (action.comment === "required" && !comment) throw bad("علت را بنویسید");
  if (action.key === "chase") {
    const recent = await ctx.db.one(`select 1 from sm_portal_events where org_id = $1 and kind = 'click' and user_id = $2 and ref_id = $3 and data->>'action' = 'chase' and at > now() - interval '1 day' limit 1`, [ctx.org.id, ctx.user.id, id]);
    if (recent) throw bad("پیگیری این مورد امروز ثبت شده است؛ کارشناس به‌زودی پاسخ می‌دهد");
    await addJournal(ctx, table, id, { kind: "comment", body: comment ? `پیگیری درخواست‌کننده: ${comment}` : "درخواست‌کننده وضعیت این مورد را پیگیری کرد." });
    await logEvent(ctx.db, ctx, { kind: "click", ref_table: table, ref_id: id, data: { action: "chase" } });
    return;
  }
  const data: Record<string, unknown> = {};
  const req = t.meta.transitions.find((x) => x.to === action.to);
  if (req?.requires.includes("close_notes") && comment) data.close_notes = comment;
  if (action.key === "confirm" && typeof input.rating === "number" && input.rating >= 1 && input.rating <= 5) {
    if (t.def.fields.some((f) => f.name === "satisfaction") && !t.meta.readonly.includes("satisfaction")) data.satisfaction = Math.round(input.rating);
    else if (t.def.fields.some((f) => f.name === "rating") && !t.meta.readonly.includes("rating")) data.rating = Math.round(input.rating);
  }
  if (comment && !data.close_notes) await addJournal(ctx, table, id, { kind: "comment", body: comment });
  await transition(ctx, table, id, action.to!, data, { version: Number(t.row.version) });
}
