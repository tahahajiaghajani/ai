// Quick actions of the agent workspace that are more than one field change: escalation (functional or hierarchical),
// merging duplicates into a primary incident, child / copy / follow-up incidents, applying a known error's workaround,
// what still blocks a resolution, similar incidents and matching known errors. Every action runs with the caller's
// context: the engine and the access provider decide what they may read and change.
import type { Cond } from "@shared/model/conditions";
import { stateCategory } from "@shared/model/task";
import { knownErrorMatch, similarity, SIMILAR_MIN, words } from "@shared/incident/logic";
import type { KnownErrorHit, Readiness, SimilarHit } from "@shared/incident/api";
import { ACTIVE_KE_STATES } from "@shared/problem/logic";
import type { Ctx } from "../../context";
import { createIn, defFor, get, list, savepoint, transitionIn, updateIn } from "../../engine";
import { AppError } from "../../http/errors";
import { bad, conflict, forbidden, notFound } from "../../http/errors";
import { notifyPeople } from "../notify";
import { faList, isUuid, liveRow, sysOf, type Row } from "./common";
import { openMandatoryTasks } from "./hooks";
import { canWork, lockIncident, workNote } from "./major";
import { incidentAi } from "./ai";

const OPEN = ["new", "active", "waiting"];
const me = (ctx: Ctx) => (ctx.actor === "system" ? null : ctx.user.id);

// ---------------------------------------------------------------------------------------------------------------
// Escalation

export interface EscalateInput {
  kind: "functional" | "hierarchical";
  group_id?: string | null;
  reason: string;
}

/** Functional escalation hands the incident to another group; hierarchical raises its level and tells the managers. */
export async function escalate(ctx: Ctx, id: string, input: EscalateInput): Promise<Row> {
  const reason = (input.reason ?? "").trim();
  if (!reason) throw bad("دلیل تشدید را بنویسید");
  return ctx.write(async (tx) => {
    const { def, row } = await lockIncident(tx, ctx, id);
    if (!canWork(ctx, def, row)) throw forbidden("اجازهٔ کار روی این رخداد را ندارید");
    if (!OPEN.includes(String(stateCategory(def.states, row.state)))) throw conflict("رخداد حل‌شده یا بسته را نمی‌توان تشدید کرد");
    const level = Math.min(10, Number(row.escalation ?? 0) + 1);
    const sys = sysOf(ctx);
    if (input.kind === "functional") {
      if (!isUuid(input.group_id)) throw bad("گروه مقصد را انتخاب کنید");
      if (input.group_id === row.assignment_group_id) throw bad("رخداد همین حالا در این گروه است");
      const g = await liveRow(tx, sys, "group", input.group_id);
      if (!g) throw bad("گروه مقصد پیدا نشد");
      const next = await updateIn(tx, ctx, "incident", id, { assignment_group_id: input.group_id, assigned_to: null, escalation: level }, { trusted: false });
      await workNote(tx, ctx, def, next, `ارجاع وظیفه‌ای به گروه «${g.name}» (سطح تشدید ${level}): ${reason}`, { escalation: "functional", level });
      return next;
    }
    const next = await updateIn(tx, ctx, "incident", id, { escalation: level }, { trusted: true });
    const people = new Set<string>();
    if (row.assignment_group_id) {
      const g = await liveRow(tx, sys, "group", row.assignment_group_id);
      if (isUuid(g?.manager_id)) people.add(g!.manager_id);
    }
    if (isUuid(row.mi_manager_id)) people.add(row.mi_manager_id);
    const actor = me(ctx);
    if (actor) people.delete(actor);
    if (people.size) {
      await notifyPeople(tx, ctx.org.id, {
        table: "incident", id, users: [...people], event: "custom", label: "تشدید رخداد",
        subject: "تشدید رخداد {{record.number}} به سطح " + level, body: reason, channels: ["in_app", "email"], actor, source: "تشدید رخداد",
      });
    }
    await workNote(tx, ctx, def, next, `تشدید سلسله‌مراتبی به سطح ${level}${people.size ? ` و اطلاع به ${people.size} مدیر` : ""}: ${reason}`, { escalation: "hierarchical", level });
    return next;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Merging duplicates

export interface MergeResult {
  merged: string[];
  failed: { id: string; number?: string | null; message: string }[];
}

/**
 * Merge open duplicates into `primaryId`: each one is canceled as «تکراری» with `merged_into`, a note on both sides;
 * their requesters, affected people and watchers follow the primary (as affected people and watchers) and their
 * worked time adds up there. Each duplicate succeeds or fails on its own.
 */
export async function mergeIncidents(ctx: Ctx, primaryId: string, ids: string[]): Promise<MergeResult> {
  const unique = [...new Set(ids.filter(isUuid).map((x) => x.toLowerCase()))].filter((x) => x !== primaryId.toLowerCase());
  if (!unique.length) throw bad("رخدادهای تکراری را انتخاب کنید");
  if (unique.length > 50) throw bad("در هر بار حداکثر ۵۰ رخداد ادغام می‌شود");
  return ctx.write(async (tx) => {
    const { def, row: primary } = await lockIncident(tx, ctx, primaryId);
    if (!canWork(ctx, def, primary)) throw forbidden("اجازهٔ کار روی رخداد اصلی را ندارید");
    if (!OPEN.includes(String(stateCategory(def.states, primary.state)))) throw conflict("رخداد اصلی باید باز باشد");
    const out: MergeResult = { merged: [], failed: [] };
    const watch = new Set<string>(primary.watch_list ?? []);
    const affected = new Set<string>(primary.affected_users ?? []);
    let worked = Number(primary.time_worked ?? 0);
    const lines: string[] = [];
    for (const sid of unique) {
      try {
        await savepoint(tx, async () => {
          const { row: s } = await lockIncident(tx, ctx, sid);
          if (!canWork(ctx, def, s)) throw forbidden("اجازهٔ کار روی این رخداد را ندارید");
          if (!OPEN.includes(String(stateCategory(def.states, s.state)))) throw conflict("فقط رخدادهای باز ادغام می‌شوند");
          if (s.merged_into) throw conflict("این رخداد پیش‌تر ادغام شده است");
          if (s.parent_id === primary.id || primary.parent_id === s.id) throw conflict("رخداد والد و فرزند را ادغام نکنید؛ پیوندشان کافی است");
          const done = await transitionIn(tx, ctx, "incident", sid, "canceled", { close_code: "duplicate", close_notes: `تکراری؛ در ${primary.number} ادغام شد`, merged_into: primary.id }, { trusted: true });
          await workNote(tx, ctx, def, done, `این رخداد در ${primary.number} ادغام شد؛ پیگیری در آن‌جا ادامه دارد.`, { merged_into: primary.id });
          for (const u of [s.caller_id, s.requested_for, ...(s.affected_users ?? [])]) if (isUuid(u) && u !== primary.caller_id && u !== primary.requested_for) affected.add(u);
          for (const u of s.watch_list ?? []) if (isUuid(u)) watch.add(u);
          worked += Number(s.time_worked ?? 0);
          lines.push(`- ${s.number}: ${String(s.short_description ?? "").slice(0, 160)}`);
          out.merged.push(String(s.number ?? sid));
        });
      } catch (e) {
        const message = e instanceof AppError ? e.message : "ادغام انجام نشد";
        out.failed.push({ id: sid, message });
      }
    }
    if (out.merged.length) {
      const next = await updateIn(tx, ctx, "incident", primaryId, { watch_list: [...watch], affected_users: [...affected], time_worked: worked }, { trusted: true });
      await workNote(tx, ctx, def, next, `${out.merged.length} رخداد تکراری در این رخداد ادغام شد:\n${lines.join("\n")}`, { merged: out.merged });
    }
    return out;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Child, copy and follow-up incidents

const COPIED = ["short_description", "description", "caller_id", "requested_for", "channel", "category", "subcategory", "impact", "urgency", "service_id", "offering_id", "ci_id", "location_id", "assignment_group_id", "affected_services", "affected_cis"];

export type RelatedMode = "child" | "copy" | "follow_up";

/** A new incident from this one: a child (linked to it as parent), a copy, or a follow-up of a done incident. */
export async function createRelated(ctx: Ctx, id: string, mode: RelatedMode, input: { short_description?: string | null } = {}): Promise<Row> {
  return ctx.write(async (tx) => {
    const { def, row } = await lockIncident(tx, ctx, id);
    const cat = String(stateCategory(def.states, row.state));
    if (mode === "follow_up") {
      if (OPEN.includes(cat)) throw conflict("رخداد باز را بازگشایی لازم نیست؛ همان را ادامه دهید");
    } else if (!canWork(ctx, def, row)) throw forbidden("اجازهٔ کار روی این رخداد را ندارید");
    const data: Row = {};
    for (const f of COPIED) if (row[f] !== null && row[f] !== undefined && !(Array.isArray(row[f]) && !row[f].length)) data[f] = row[f];
    if (input.short_description?.trim()) data.short_description = input.short_description.trim();
    if (mode === "child") data.parent_id = row.id;
    if (mode === "follow_up") {
      data.follow_up_of = row.id;
      data.short_description = input.short_description?.trim() || `پیگیری ${row.number}: ${row.short_description}`.slice(0, 200);
      delete data.assignment_group_id;
    }
    const created = await createIn(tx, ctx, "incident", data, { trusted: mode === "follow_up" });
    const label = mode === "child" ? "رخداد فرزند" : mode === "copy" ? "رونوشت" : "رخداد پیگیری";
    await workNote(tx, ctx, def, row, `${label} ${created.number} ساخته شد.`, { related: created.id, mode });
    await workNote(tx, ctx, def, created, `${label}ِ ${row.number}.`, { source: row.id, mode });
    return created;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Known errors on incidents

/** Link a known error to an incident, copy its workaround, count the use — and resolve with it when asked. */
export async function applyKnownError(ctx: Ctx, incidentId: string, keId: string, opts: { resolve?: boolean } = {}): Promise<Row> {
  const ke = (await get(ctx, "known_error", keId).catch(() => null))?.row;
  if (!ke) throw notFound("خطای شناخته‌شده پیدا نشد");
  if (!ACTIVE_KE_STATES.includes(String(ke.state))) throw conflict("فقط خطای شناخته‌شدهٔ منتشرشده به کار می‌رود");
  return ctx.write(async (tx) => {
    const { def, row } = await lockIncident(tx, ctx, incidentId);
    if (!canWork(ctx, def, row)) throw forbidden("اجازهٔ کار روی این رخداد را ندارید");
    if (!OPEN.includes(String(stateCategory(def.states, row.state)))) throw conflict("راه‌حل موقت روی رخداد باز به کار می‌رود");
    const data: Row = { known_error_id: ke.id };
    if (!row.workaround && ke.workaround) data.workaround = ke.workaround;
    if (!row.problem_id && ke.problem_id) data.problem_id = ke.problem_id;
    let next = await updateIn(tx, ctx, "incident", incidentId, data, { trusted: false });
    await workNote(tx, ctx, def, next, `راه‌حل موقت خطای شناخته‌شدهٔ ${ke.number} به کار رفت.${ke.workaround ? `\n\n${String(ke.workaround).slice(0, 4000)}` : ""}`, { known_error: ke.id });
    const sys = sysOf(ctx);
    const fresh = await liveRow(tx, sys, "known_error", ke.id);
    if (fresh) await updateIn(tx, sys, "known_error", ke.id, { use_count: Number(fresh.use_count ?? 0) + 1, last_used_at: new Date().toISOString() }, { trusted: true, keepVersion: true, allowLocked: true });
    if (opts.resolve) {
      next = await transitionIn(tx, ctx, "incident", incidentId, "resolved", {
        close_code: "known_error",
        close_notes: row.close_notes || `با راه‌حل موقت خطای شناخته‌شدهٔ ${ke.number} حل شد.`,
      });
    }
    return next;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// What blocks a resolution (the resolve dialog's checklist)


export async function readiness(ctx: Ctx, id: string): Promise<Readiness> {
  const r = await get(ctx, "incident", id);
  const { def } = await defFor(ctx, "incident");
  const blockers: string[] = [];
  const open = await openMandatoryTasks(ctx.db, ctx, id);
  if (open.length) blockers.push(`${open.length} کار الزامی باز است`);
  const t = def.states?.transitions.find((x) => x.to === "resolved");
  const missing = (t?.requires ?? []).filter((f) => r.row[f] === null || r.row[f] === undefined || r.row[f] === "").map((f) => def.fields.find((x) => x.name === f)?.label ?? f);
  if (!r.meta.transitions.some((x) => x.to === "resolved")) blockers.push("در وضعیت کنونی یا با دسترسی شما «حل شد» در دسترس نیست");
  return {
    can_resolve: !blockers.length,
    blockers,
    tasks: open.map((x) => ({ id: x.id, number: x.number ?? null, short_description: String(x.short_description ?? ""), state: String(x.state) })),
    missing,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Similar incidents and matching known errors

const SIMILAR_FIELDS = ["number", "short_description", "description", "state", "priority", "category", "subcategory", "ci_id", "service_id", "caller_id", "opened_at", "resolved_at", "close_code", "close_notes", "problem_id", "known_error_id", "assigned_to", "parent_id", "merged_into", "active"];


/** The longest distinctive words of a title (search candidates). */
const keyWords = (text: unknown, n = 2) => [...new Set(words(text))].sort((a, b) => b.length - a.length).slice(0, n);

/**
 * Incidents like this one that the caller may read, scored and explained (`similarity`): candidates from the same CI,
 * service, (sub)category and requester, and from the title's longest words; the AI layer's semantic neighbours join
 * when it is registered (`registerIncidentAi`), re-read with the caller's access.
 */
export async function similarIncidents(ctx: Ctx, id: string, limit = 8): Promise<{ hits: SimilarHit[]; display: Record<string, string> }> {
  const inc = (await get(ctx, "incident", id)).row;
  const ors: Cond[] = [];
  if (inc.ci_id) ors.push({ f: "ci_id", op: "eq", v: inc.ci_id });
  if (inc.service_id) ors.push({ f: "service_id", op: "eq", v: inc.service_id });
  if (inc.subcategory) ors.push({ f: "subcategory", op: "eq", v: inc.subcategory });
  else if (inc.category) ors.push({ f: "category", op: "eq", v: inc.category });
  if (inc.caller_id) ors.push({ and: [{ f: "caller_id", op: "eq", v: inc.caller_id }, { f: "opened_at", op: "relative", v: { unit: "day", n: 14, dir: "past" } }] });
  const pools = [];
  if (ors.length) pools.push(list(ctx, "incident", { filter: { or: ors }, size: 100, sort: "-opened_at", fields: SIMILAR_FIELDS, total: false }));
  for (const w of keyWords(inc.short_description)) pools.push(list(ctx, "incident", { q: w, size: 50, sort: "-opened_at", fields: SIMILAR_FIELDS, total: false }));
  const ai = incidentAi().similar;
  if (ai) {
    const ids = (await ai(ctx, id, { limit: 20 }).catch(() => [])).map((x) => x.id).filter(isUuid);
    if (ids.length) pools.push(list(ctx, "incident", { ids, fields: SIMILAR_FIELDS, total: false, size: ids.length }));
  }
  const results = await Promise.all(pools.map((p) => p.catch(() => null)));
  const display: Record<string, string> = {};
  const seen = new Map<string, Row>();
  for (const r of results) {
    if (!r) continue;
    Object.assign(display, r.display);
    for (const x of r.rows) if (x.id !== inc.id && x.parent_id !== inc.id && !x.merged_into) seen.set(x.id, x);
  }
  const hits: SimilarHit[] = [];
  for (const x of seen.values()) {
    const m = similarity(inc, x);
    if (m.score < SIMILAR_MIN) continue;
    hits.push({
      ...m,
      id: x.id,
      number: x.number ?? null,
      short_description: String(x.short_description ?? ""),
      state: String(x.state ?? ""),
      priority: x.priority ?? null,
      opened_at: x.opened_at ?? null,
      resolved_at: x.resolved_at ?? null,
      close_code: x.close_code ?? null,
      close_notes: x.close_notes ? String(x.close_notes).slice(0, 400) : null,
      open: !!x.active,
      problem_id: x.problem_id ?? null,
    });
  }
  hits.sort((a, b) => b.score - a.score || Date.parse(b.opened_at ?? "") - Date.parse(a.opened_at ?? ""));
  return { hits: hits.slice(0, Math.max(1, Math.min(30, limit))), display };
}


/** Published known errors that fit an incident (empty when the caller may not read the KEDB). */
export async function knownErrorMatches(ctx: Ctx, id: string, limit = 5): Promise<{ hits: KnownErrorHit[] }> {
  const inc = (await get(ctx, "incident", id)).row;
  const active: Cond = { f: "state", op: "in", v: ACTIVE_KE_STATES };
  const ors: Cond[] = [];
  if (inc.ci_id) ors.push({ f: "ci_id", op: "eq", v: inc.ci_id }, { f: "affected_cis", op: "contains", v: inc.ci_id });
  if (inc.service_id) ors.push({ f: "service_id", op: "eq", v: inc.service_id });
  if (inc.category) ors.push({ f: "category", op: "eq", v: inc.category });
  const fields = ["number", "short_description", "symptoms", "workaround", "state", "category", "subcategory", "ci_id", "service_id", "affected_cis", "problem_id", "use_count"];
  const pools = [];
  if (ors.length) pools.push(list(ctx, "known_error", { filter: { and: [active, { or: ors }] }, size: 100, fields, total: false }));
  for (const w of keyWords(`${inc.short_description ?? ""}`, 3)) pools.push(list(ctx, "known_error", { q: w, filter: active, size: 30, fields, total: false }));
  const seen = new Map<string, Row>();
  for (const r of await Promise.all(pools.map((p) => p.catch(() => null)))) for (const x of r?.rows ?? []) seen.set(x.id, x);
  const hits: KnownErrorHit[] = [];
  for (const x of seen.values()) {
    const m = knownErrorMatch(inc, x);
    if (m.score < 20) continue;
    hits.push({ ...m, id: x.id, number: x.number ?? null, short_description: String(x.short_description ?? ""), state: String(x.state), workaround: x.workaround ? String(x.workaround).slice(0, 2000) : null, problem_id: x.problem_id ?? null, use_count: Number(x.use_count ?? 0) });
  }
  hits.sort((a, b) => b.score - a.score || b.use_count - a.use_count);
  return { hits: hits.slice(0, Math.max(1, Math.min(20, limit))) };
}

export { faList };
export type { KnownErrorHit, Readiness, SimilarHit };
