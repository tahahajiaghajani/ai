// Operations of problem management that are more than one field change (catalogue PRB-005/006/011/019/020/022):
// a problem from one or many incidents, linking and unlinking incidents, merging duplicate problems into a master,
// sharing the workaround or the fix with every linked open incident (once per text), a known error from a problem,
// a task's findings copied to its problem, and the problem candidates: the rules' run, promoting a candidate to a
// problem or adding its incidents to an existing one. Every operation runs with the caller's context.
import type { Cond } from "@shared/model/conditions";
import { stateCategory } from "@shared/model/task";
import { candidateGroups, type CandidateGroup, type CandidateIncident } from "@shared/problem/logic";
import { createHash } from "node:crypto";
import type { Ctx } from "../../context";
import { lockKey, type Tx } from "../../db";
import { lockedRow } from "../incident/common";
import { addJournalIn, createIn, defFor, get, list, savepoint, transitionIn, updateIn } from "../../engine";
import { AppError, bad, conflict, forbidden, notFound } from "../../http/errors";
import { canWork, eqAll, faList, isUuid, liveRow, liveRows, problemConfig, problemAi, sysOf, type Row } from "../incident";

const OPEN_CATS = ["new", "active", "waiting"];
const actor = (ctx: Ctx) => (ctx.actor === "system" ? null : ctx.user.id);

export interface Outcome {
  done: string[];
  failed: { id: string; message: string }[];
}

/**
 * The problem locked for this transaction (404 when the caller may not read it): a merge, a link, a shared solution
 * of one problem at the same moment take turns, and each decides from the stored row (a link never lands on a problem
 * a merge is closing; a solution is shared once).
 */
async function lockProblem(tx: Tx, ctx: Ctx, id: string): Promise<{ def: Awaited<ReturnType<typeof defFor>>["def"]; row: Row }> {
  if (!isUuid(id)) throw notFound("مشکل پیدا نشد");
  const { def } = await defFor(ctx, "problem", tx);
  const row = await lockedRow(tx, ctx, "problem", id);
  if (!row) throw notFound("مشکل پیدا نشد");
  return { def, row };
}

async function note(tx: Tx, ctx: Ctx, table: string, row: Row, body: string, data: Record<string, unknown> | null = null): Promise<void> {
  const { def } = await defFor(sysOf(ctx), table, tx);
  await addJournalIn(tx, sysOf(ctx), def, row, { kind: "system", visibility: "internal", body, data }, { trusted: true, author: actor(ctx) });
}

/** Set `problem_id` of incidents the caller may change (each on its own; failures reported). */
async function linkIn(tx: Tx, ctx: Ctx, problem: Row, ids: string[], unlink = false): Promise<Outcome> {
  const out: Outcome = { done: [], failed: [] };
  for (const id of ids) {
    try {
      await savepoint(tx, async () => {
        const inc = await liveRow(tx, ctx, "incident", id);
        if (!inc) throw notFound("رخداد پیدا نشد");
        if (unlink) {
          if (inc.problem_id !== problem.id) throw conflict("این رخداد به این مشکل پیوند ندارد");
          await updateIn(tx, ctx, "incident", id, { problem_id: null });
        } else {
          if (inc.problem_id === problem.id) throw conflict("پیش‌تر پیوند داشت");
          await updateIn(tx, ctx, "incident", id, { problem_id: problem.id });
        }
        out.done.push(String(inc.number ?? id));
      });
    } catch (e) {
      out.failed.push({ id, message: e instanceof AppError ? e.message : "انجام نشد" });
    }
  }
  return out;
}

const uniqueIds = (ids: unknown[]): string[] => [...new Set(ids.filter(isUuid).map((x) => x.toLowerCase()))];

export interface FromIncidentsInput {
  short_description?: string | null;
  description?: string | null;
  source?: string | null;
  assignment_group_id?: string | null;
  assigned_to?: string | null;
}

/** A problem from one or many incidents (pre-filled from them), and the incidents linked to it. */
export async function createFromIncidents(ctx: Ctx, incidentIds: string[], input: FromIncidentsInput = {}): Promise<{ problem: Row } & Outcome> {
  const ids = uniqueIds(incidentIds);
  if (!ids.length) throw bad("دست‌کم یک رخداد انتخاب کنید");
  if (ids.length > 200) throw bad("در هر بار حداکثر ۲۰۰ رخداد");
  const read = await list(ctx, "incident", { ids, size: ids.length, total: false, fields: ["number", "short_description", "description", "category", "subcategory", "service_id", "ci_id", "impact", "urgency", "opened_at", "major_state", "assignment_group_id", "workspace_id", "problem_id"] });
  if (!read.rows.length) throw notFound("رخدادها پیدا نشدند");
  const rows = [...read.rows].sort((a, b) => Date.parse(a.opened_at ?? "") - Date.parse(b.opened_at ?? ""));
  const made = await ctx.write(async (tx) => {
    // the incidents locked (in id order) before the problem is made: an automatic problem of the same incident at
    // this moment (a resolved major incident, `autoProblemFor`) takes turns with this one and finds them linked
    for (const r of [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))) await lockedRow(tx, sysOf(ctx), "incident", r.id);
    return problemFromRowsIn(tx, ctx, rows, input);
  });
  // read after the commit: the incidents' counts are recounted just before it (problem/hooks.ts)
  return { ...made, problem: (await liveRow(ctx.db, sysOf(ctx), "problem", made.problem.id)) ?? made.problem };
}

/**
 * The problem of a resolved major incident (the settings' «مشکل خودکار»), made once: the incident is locked and read
 * again inside the write, and nothing is made when it is linked already — by a manager's «ثبت مشکل» at the same
 * moment, or an earlier run of this event.
 */
export async function autoProblemFor(ctx: Ctx, incidentId: string): Promise<Row | null> {
  return ctx.write(async (tx) => {
    const inc = await lockedRow(tx, sysOf(ctx), "incident", incidentId);
    if (!inc || inc.problem_id) return null;
    return (await problemFromRowsIn(tx, ctx, [inc], { source: "major_incident" })).problem;
  });
}

/** Make the problem of `rows` (incidents, oldest first) and link them (inside the caller's write). */
async function problemFromRowsIn(tx: Tx, ctx: Ctx, rows: Row[], input: FromIncidentsInput): Promise<{ problem: Row } & Outcome> {
  const first = rows[0];
  const most = <K extends string>(k: K) => {
    const n = new Map<string, number>();
    for (const r of rows) if (r[k]) n.set(String(r[k]), (n.get(String(r[k])) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const major = rows.some((r) => ["accepted", "resolved", "pir_done"].includes(String(r.major_state ?? "")));
  const lines = rows.slice(0, 30).map((r) => `- ${r.number}: ${String(r.short_description ?? "").slice(0, 160)}`);
  {
    const problem = await createIn(tx, ctx, "problem", {
      short_description: input.short_description?.trim() || String(first.short_description ?? "").slice(0, 200),
      description: input.description?.trim() || `رخدادهای مرتبط:\n${lines.join("\n")}${rows.length > 30 ? "\n- …" : ""}`,
      source: input.source || (major ? "major_incident" : "incident"),
      investigation_reason: rows.length > 1 ? "recurring" : major ? "high_impact" : null,
      category: most("category"),
      subcategory: most("subcategory"),
      service_id: most("service_id"),
      ci_id: most("ci_id"),
      impact: rows.map((r) => String(r.impact ?? "3")).sort()[0],
      urgency: rows.map((r) => String(r.urgency ?? "3")).sort()[0],
      first_incident_id: first.id,
      assignment_group_id: input.assignment_group_id ?? first.assignment_group_id ?? null,
      assigned_to: input.assigned_to ?? null,
      ...(first.workspace_id ? { workspace_id: first.workspace_id } : {}),
    });
    const linked = await linkIn(tx, ctx, problem, rows.filter((r) => r.problem_id !== problem.id).map((r) => r.id));
    await note(tx, ctx, "problem", problem, `از ${rows.length} رخداد ساخته شد${linked.done.length ? `؛ پیوند: ${faList(linked.done)}` : ""}.`);
    return { problem: (await liveRow(tx, sysOf(ctx), "problem", problem.id)) ?? problem, ...linked };
  }
}

/** Link (or unlink) incidents to a problem the caller may read. */
export async function linkIncidents(ctx: Ctx, problemId: string, incidentIds: string[], opts: { unlink?: boolean } = {}): Promise<Outcome> {
  const ids = uniqueIds(incidentIds);
  if (!ids.length) throw bad("رخدادها را انتخاب کنید");
  if (ids.length > 200) throw bad("در هر بار حداکثر ۲۰۰ رخداد");
  return ctx.write(async (tx) => {
    const { def, row } = await lockProblem(tx, ctx, problemId);
    const cat = stateCategory(def.states, row.state);
    if (!opts.unlink && (cat === "closed" || cat === "canceled")) throw conflict("به مشکل بسته رخداد پیوند نمی‌شود");
    const out = await linkIn(tx, ctx, row, ids, !!opts.unlink);
    if (out.done.length) await note(tx, ctx, "problem", row, `${opts.unlink ? "پیوند برداشته شد" : "رخداد پیوند شد"}: ${faList(out.done)}`);
    return out;
  });
}

/** Merge duplicate problems into a master: their incidents and known errors move, watchers are copied, they close as «تکراری». */
export async function mergeProblems(ctx: Ctx, masterId: string, ids: string[]): Promise<Outcome> {
  const dups = uniqueIds(ids).filter((x) => x !== masterId.toLowerCase());
  if (!dups.length) throw bad("مشکلات تکراری را انتخاب کنید");
  if (dups.length > 20) throw bad("در هر بار حداکثر ۲۰ مشکل");
  return ctx.write(async (tx) => {
    const { def, row: master } = await lockProblem(tx, ctx, masterId);
    if (!canWork(ctx, def, master)) throw forbidden("اجازهٔ کار روی مشکل اصلی را ندارید");
    if (!OPEN_CATS.includes(String(stateCategory(def.states, master.state)))) throw conflict("مشکل اصلی باید باز باشد");
    const sys = sysOf(ctx, actor(ctx));
    const out: Outcome = { done: [], failed: [] };
    const watch = new Set<string>(master.watch_list ?? []);
    for (const id of dups) {
      try {
        await savepoint(tx, async () => {
          const { row: d } = await lockProblem(tx, ctx, id);
          if (!canWork(ctx, def, d)) throw forbidden("اجازهٔ کار روی این مشکل را ندارید");
          if (!OPEN_CATS.includes(String(stateCategory(def.states, d.state)))) throw conflict("فقط مشکلات باز ادغام می‌شوند");
          for (const inc of await liveRows(tx, sys, "incident", eqAll({ problem_id: d.id }), { limit: 2000 })) await updateIn(tx, sys, "incident", inc.id, { problem_id: master.id }, { trusted: true, keepVersion: true, allowLocked: true });
          for (const ke of await liveRows(tx, sys, "known_error", eqAll({ problem_id: d.id }), { limit: 500 })) await updateIn(tx, sys, "known_error", ke.id, { problem_id: master.id }, { trusted: true, keepVersion: true, allowLocked: true });
          for (const u of [...(d.watch_list ?? []), d.assigned_to, d.caller_id]) if (isUuid(u)) watch.add(u);
          const closed = await transitionIn(tx, ctx, "problem", d.id, "canceled", { close_code: "duplicate", close_notes: `تکراری؛ در ${master.number} ادغام شد`, duplicate_of: master.id }, { trusted: true });
          await note(tx, ctx, "problem", closed, `در ${master.number} ادغام شد؛ رخدادها و خطاهای شناخته‌شده‌اش به آن منتقل شدند.`);
          out.done.push(String(d.number ?? id));
        });
      } catch (e) {
        out.failed.push({ id, message: e instanceof AppError ? e.message : "ادغام انجام نشد" });
      }
    }
    if (out.done.length) {
      const next = await updateIn(tx, ctx, "problem", master.id, { watch_list: [...watch] }, { trusted: true });
      await note(tx, ctx, "problem", next, `مشکلات تکراری در این مشکل ادغام شدند: ${faList(out.done)}`);
    }
    return out;
  });
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/**
 * Share the workaround (or the permanent fix) with every open incident linked to the problem — once per text: an
 * internal note for the agents, or a public reply to the requesters.
 */
export async function shareSolution(ctx: Ctx, problemId: string, input: { kind: "workaround" | "fix"; audience?: "agents" | "callers" }): Promise<{ incidents: number }> {
  return ctx.write(async (tx) => {
    const { def, row } = await lockProblem(tx, ctx, problemId);
    if (!canWork(ctx, def, row)) throw forbidden("اجازهٔ کار روی این مشکل را ندارید");
    const text = String((input.kind === "fix" ? row.fix_notes : row.workaround) ?? "").trim();
    if (!text) throw bad(input.kind === "fix" ? "راه‌حل دائمی این مشکل نوشته نشده است" : "راه‌حل موقت این مشکل نوشته نشده است");
    const shared = row.shared && typeof row.shared === "object" ? { ...(row.shared as Row) } : {};
    const h = hash(`${input.audience ?? "agents"}:${text}`);
    if (shared[input.kind] === h) throw conflict("همین متن پیش‌تر برای رخدادها فرستاده شده است");
    const sys = sysOf(ctx, actor(ctx));
    const { def: idef } = await defFor(sys, "incident", tx);
    const incidents = await liveRows(tx, sys, "incident", { and: [eqAll({ problem_id: row.id, active: true })] }, { limit: 2000 });
    const label = input.kind === "fix" ? "راه‌حل دائمی" : "راه‌حل موقت";
    for (const inc of incidents) {
      if (input.audience === "callers") {
        await addJournalIn(tx, ctx, idef, inc, { kind: "comment", body: `${label} مشکل مرتبط (${row.number}):\n\n${text}`, data: { problem: row.id, share: input.kind } }, { trusted: true, author: actor(ctx) });
      } else {
        await addJournalIn(tx, sys, idef, inc, { kind: "system", visibility: "internal", body: `${label} مشکل ${row.number}:\n\n${text}`, data: { problem: row.id, share: input.kind } }, { trusted: true, author: actor(ctx) });
      }
    }
    shared[input.kind] = h;
    await updateIn(tx, sysOf(ctx), "problem", row.id, { shared }, { trusted: true, keepVersion: true });
    await note(tx, ctx, "problem", row, `${label} برای ${incidents.length} رخداد باز فرستاده شد.`);
    return { incidents: incidents.length };
  });
}

/** A known error from a problem (draft, pre-filled: symptoms, cause, workaround, category, CI). */
export async function createKnownError(ctx: Ctx, problemId: string): Promise<Row> {
  const ai = problemAi().draftKnownError;
  const draft = ai ? await ai(ctx, problemId).catch(() => null) : null;
  return ctx.write(async (tx) => {
    const { def, row } = await lockProblem(tx, ctx, problemId);
    if (!canWork(ctx, def, row)) throw forbidden("اجازهٔ کار روی این مشکل را ندارید");
    const ke = await createIn(tx, ctx, "known_error", {
      short_description: draft?.short_description || row.short_description,
      problem_id: row.id,
      symptoms: draft?.symptoms || row.symptoms || row.description || null,
      root_cause: draft?.root_cause || row.cause_notes || null,
      workaround: draft?.workaround || row.workaround || null,
      category: row.category ?? null,
      subcategory: row.subcategory ?? null,
      service_id: row.service_id ?? null,
      ci_id: row.ci_id ?? null,
      affected_cis: row.affected_cis ?? [],
      assignment_group_id: row.assignment_group_id ?? null,
    });
    await note(tx, ctx, "problem", row, `خطای شناخته‌شدهٔ ${ke.number} ساخته شد.`);
    return ke;
  });
}

/** Copy a problem task's findings to its problem (a note, and the cause when the problem has none yet and it is an RCA task). */
export async function copyFindings(ctx: Ctx, taskId: string): Promise<Row> {
  const task = (await get(ctx, "problem_task", taskId)).row;
  const findings = String(task.findings ?? "").trim();
  if (!findings) throw bad("این کار یافته‌ای ندارد");
  return ctx.write(async (tx) => {
    const { def, row } = await lockProblem(tx, ctx, String(task.problem_id));
    if (!canWork(ctx, def, row)) throw forbidden("اجازهٔ کار روی این مشکل را ندارید");
    let next = row;
    if (task.task_type === "rca" && !String(row.cause_notes ?? "").trim()) next = await updateIn(tx, ctx, "problem", row.id, { cause_notes: findings });
    await note(tx, ctx, "problem", next, `یافته‌های ${task.number}:\n\n${findings}`, { task: task.id });
    return next;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Candidates

const CAND_FIELDS = ["number", "short_description", "opened_at", "priority", "category", "subcategory", "ci_id", "service_id", "reopen_count", "major_state", "problem_id"];

/** Run the candidate rules now (as the system): new groups become candidates, open ones are updated. */
export async function runCandidates(sys: Ctx, now = Date.now()): Promise<{ created: number; updated: number; skipped: number }> {
  const cfg = await problemConfig(sys.db, sys);
  const from = new Date(now - cfg.candidate_window_days * 86_400_000).toISOString();
  const incidents = (await liveRows(sys.db, sys, "incident", { and: [{ f: "opened_at", op: "gte", v: from }, { f: "problem_id", op: "empty" }, { f: "merged_into", op: "empty" }] }, { order: "t.opened_at", limit: 5000 })) as unknown as CandidateIncident[];
  let groups: CandidateGroup[] = candidateGroups(incidents, cfg, now);
  const ai = problemAi().cluster;
  if (ai) groups = [...groups, ...(await ai(sys, { windowDays: cfg.candidate_window_days }).catch(() => []))];
  const openProblems = await liveRows(sys.db, sys, "problem", { f: "active", op: "eq", v: true }, { limit: 5000 });
  const coveredCi = new Set(openProblems.flatMap((p) => [p.ci_id, ...(p.affected_cis ?? [])]).filter(Boolean));
  const coveredCat = new Set(openProblems.flatMap((p) => [p.subcategory, p.subcategory ? null : p.category]).filter(Boolean));
  const out = { created: 0, updated: 0, skipped: 0 };
  for (const g of groups) {
    if ((g.rule_kind === "recurring_ci" && g.ci_id && coveredCi.has(g.ci_id)) || (g.rule_kind === "recurring_category" && coveredCat.has(g.signature.slice(4)))) {
      out.skipped++;
      continue;
    }
    await sys.write(async (tx) => {
      // one candidate per pattern: the daily sweep and «اجرای قاعده‌ها» at the same moment take turns on its key
      await lockKey(tx, `problem.candidate:${sys.org.id}:${g.signature}`);
      const [c] = await liveRows(tx, sys, "problem_candidate", eqAll({ signature: g.signature }), { order: "t.created_at desc", limit: 1 });
      const values = {
        title: g.title, rule_kind: g.rule_kind, incidents: g.incidents, score: g.score, first_at: g.first_at, last_at: g.last_at,
        category: g.category, ci_id: g.ci_id, service_id: g.service_id,
      };
      if (!c || ((c.state === "dismissed" || c.state === "merged" || c.state === "promoted") && Date.parse(c.updated_at) < Date.parse(from))) {
        await createIn(tx, sys, "problem_candidate", { ...values, signature: g.signature }, { trusted: true });
        out.created++;
      } else if (c.state === "new" || c.state === "reviewing") {
        const same = JSON.stringify([...(c.incidents ?? [])].sort()) === JSON.stringify([...g.incidents].sort());
        if (same && Number(c.score) === g.score) return void out.skipped++;
        await updateIn(tx, sys, "problem_candidate", c.id, values, { trusted: true, keepVersion: true });
        out.updated++;
      } else out.skipped++;
    });
  }
  return out;
}

/** Turn a candidate into a problem with its incidents. */
export async function promoteCandidate(ctx: Ctx, candidateId: string, input: FromIncidentsInput = {}): Promise<{ problem: Row } & Outcome> {
  const c = (await get(ctx, "problem_candidate", candidateId)).row;
  if (!["new", "reviewing"].includes(String(c.state))) throw conflict("این نامزد پیش‌تر بررسی شده است");
  const made = await createFromIncidents(ctx, c.incidents ?? [], { short_description: input.short_description ?? c.title, source: "candidate", ...input });
  await ctx.write(async (tx) => {
    await transitionIn(tx, ctx, "problem_candidate", candidateId, "promoted", { problem_id: made.problem.id });
  });
  return made;
}

/** Add a candidate's incidents to an existing problem. */
export async function mergeCandidate(ctx: Ctx, candidateId: string, problemId: string): Promise<Outcome> {
  const c = (await get(ctx, "problem_candidate", candidateId)).row;
  if (!["new", "reviewing"].includes(String(c.state))) throw conflict("این نامزد پیش‌تر بررسی شده است");
  const linked = await linkIncidents(ctx, problemId, c.incidents ?? []);
  await ctx.write((tx) => transitionIn(tx, ctx, "problem_candidate", candidateId, "merged", { problem_id: problemId }));
  return linked;
}

export type { Cond };
