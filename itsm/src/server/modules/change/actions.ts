// Actions on changes behind the module's routes. Every one runs as the person who asked: reads through the engine with
// their context (what they may not read stays out), writes through the engine (their write access, the field locks and
// the lifecycle guard apply); only engine stamps that no person sets (origin, hold fields) are written as trusted code
// after the person's own access was checked.
//   · the risk view and the questionnaire answers (CHG-019, CHG-020, CHG-027)
//   · copy (and copies for several dates — recurring scheduled changes, CHG-048), child changes (CHG-047)
//   · hold / resume (CHG-006), backout (CHG-051)
//   · a change from another record with «آغازشده از» (CHG-002), the standard-change catalogue and ordering (CHG-011)
import { explainRisk, leadDaysFor, lockdownApplies, optionsOf } from "@shared/change/logic";
import { HOLD_REASONS } from "@shared/tables/change";
import type { Ctx } from "../../context";
import { access } from "../../access/provider";
import { addJournalIn, addLink, create, createIn, defFor, get, list, transition, update, updateIn } from "../../engine";
import { bad, conflict, forbidden } from "../../http/errors";
import { aiCapabilities } from "./ai";
import { changeConfig, hasTable, isUuid, liveRow, liveRows, msOf, sysOf, type Row } from "./common";
import { activeLockdowns, holdsOn, lockdownLike, riskFor, teamScoreOf } from "./schedule";

/** The risk of a change as its panel shows it: questions with options, answers, factors, explanation, notice. */
export async function riskView(ctx: Ctx, id: string): Promise<Row> {
  const { row } = await get(ctx, "change_request", id);
  const sys = sysOf(ctx);
  const cfg = await changeConfig(ctx.db, sys);
  const { result, questions } = await riskFor(ctx.db, sys, row, cfg);
  const manual = row.risk_source !== "calculated" ? { level: String(row.risk ?? result.level), reason: row.risk_override_reason ?? null } : null;
  return {
    id: row.id,
    version: row.version,
    risk: row.risk ?? null,
    risk_source: row.risk_source ?? "calculated",
    risk_override_reason: row.risk_override_reason ?? null,
    result,
    explanation: explainRisk(result, { manual }),
    questions: questions.map((q) => ({ id: q.id, question: q.question, kind: q.kind, weight: q.weight, mandatory: q.mandatory !== false, help: q.help ?? null, options: optionsOf(q) })),
    answers: row.risk_answers && typeof row.risk_answers === "object" ? row.risk_answers : {},
    bands: { moderate: cfg.risk_moderate_from, high: cfg.risk_high_from, very_high: cfg.risk_very_high_from, questionnaire_weight: cfg.questionnaire_weight },
    team_score: await teamScoreOf(ctx.db, sys, row.assignment_group_id),
    lead: { days: row.lead_days ?? null, required: leadDaysFor(row.risk, cfg), late: !!row.is_late },
    locked: !["new", "assess", "authorize", "scheduled"].includes(String(row.state)),
    ai: aiCapabilities().filter((k) => k === "change.riskNarrative" || k === "change.riskAnswers"),
  };
}

/** Save the questionnaire's answers (the risk follows in the same write). */
export async function saveAnswers(ctx: Ctx, id: string, answers: Record<string, unknown>, version?: number): Promise<Row> {
  await update(ctx, "change_request", id, { risk_answers: answers }, { version });
  return riskView(ctx, id);
}

/** Fields a copy takes, by section. */
const COPY_SECTIONS: Record<string, string[]> = {
  main: ["short_description", "description", "justification", "expected_outcome", "type", "model_id", "category", "subcategory", "impact", "urgency", "assignment_group_id", "change_manager_id", "stakeholders", "external_ref"],
  scope: ["service_id", "ci_id", "affected_cis", "affected_services", "location_id", "outage_expected", "outage_minutes"],
  plans: ["implementation_plan", "test_plan", "backout_plan", "communication_plan", "planned_effort", "planned_cost"],
  schedule: ["planned_start", "planned_end", "maintenance_window_id"],
};

const pick = (row: Row, names: string[]): Row => Object.fromEntries(names.filter((n) => row[n] !== undefined && row[n] !== null && !(Array.isArray(row[n]) && !row[n].length)).map((n) => [n, row[n]]));

/**
 * Copy a change (catalogue «کپی تغییر»): the chosen sections and its tasks; with `dates`, one copy per date (recurring
 * scheduled changes). The copies are new drafts the caller owns. A copy of a standard change is a new order of its
 * template while that is still a published standard change (the template brings its tasks), else a normal change.
 */
export async function copyChange(ctx: Ctx, id: string, input: { sections?: string[]; tasks?: boolean; dates?: { start: string; end: string }[] }): Promise<Row[]> {
  const { row } = await get(ctx, "change_request", id);
  const sections = (input.sections?.length ? input.sections : ["main", "scope", "plans"]).filter((s) => COPY_SECTIONS[s]);
  const base = pick(row, sections.flatMap((s) => COPY_SECTIONS[s]));
  if (row.type === "latent") base.type = "normal";
  if (row.type === "standard") {
    const t = isUuid(row.template_id) ? await liveRow(ctx.db, sysOf(ctx), "change_template", row.template_id) : null;
    if (t && t.kind === "standard" && t.state === "published") base.template_id = row.template_id;
    else {
      base.type = "normal";
      delete base.model_id;
    }
  }
  const dates = (input.dates ?? []).slice(0, 20);
  for (const d of dates) if (!(msOf(d.start) !== null && msOf(d.end) !== null && msOf(d.end)! > msOf(d.start)!)) throw bad("بازه‌های زمانی معتبر نیستند");
  const tasks = input.tasks !== false && !base.template_id ? (await list(ctx, "change_task", { filter: { f: "change_id", op: "eq", v: id }, sort: "sort_order", size: 200, total: false })).rows : [];
  return ctx.write(async (tx) => {
    const out: Row[] = [];
    for (const d of dates.length ? dates : [null]) {
      const copy = await createIn(tx, ctx, "change_request", { ...base, ...(d ? { planned_start: d.start, planned_end: d.end } : {}) });
      const ids = new Map<string, string>();
      for (const t of tasks) {
        const created = await createIn(tx, ctx, "change_task", {
          change_id: copy.id, short_description: t.short_description, task_type: t.task_type, mandatory: t.mandatory, sort_order: t.sort_order,
          description: t.description ?? null, assignment_group_id: t.assignment_group_id ?? null, checklist: typeof t.checklist === "string" ? t.checklist.replace(/\[[xX]\]/g, "[ ]") : null,
        });
        ids.set(String(t.id), String(created.id));
      }
      // dependencies follow their copies
      for (const t of tasks) {
        const deps = (Array.isArray(t.depends_on) ? t.depends_on : []).map((x: string) => ids.get(String(x))).filter(Boolean);
        if (deps.length) await updateIn(tx, ctx, "change_task", ids.get(String(t.id))!, { depends_on: deps });
      }
      const { def } = await defFor(ctx, "change_request", tx);
      await addJournalIn(tx, sysOf(ctx, ctx.user.id), def, copy, { kind: "system", body: `کپی‌شده از ${row.number}.` }, { trusted: true, author: ctx.user.id });
      out.push(copy);
    }
    return out;
  });
}

/** Child changes of a scaled change: one per CI (or per title), inheriting the parent's plans and schedule. */
export async function createChildren(ctx: Ctx, parentId: string, input: { cis?: string[]; titles?: string[] }): Promise<Row[]> {
  const { row: parent } = await get(ctx, "change_request", parentId);
  const { def } = await defFor(ctx, "change_request");
  if (!access().canWrite(ctx, def, parent)) throw forbidden("اجازهٔ تغییر این درخواست تغییر را ندارید");
  if (["review", "closed", "canceled"].includes(String(parent.state))) throw conflict("برای تغییر اجراشده یا بسته تغییر فرزند ساخته نمی‌شود");
  const cis = (input.cis ?? []).filter(isUuid).slice(0, 50);
  const titles = (input.titles ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, 50);
  if (!cis.length && !titles.length) throw bad("پیکربندی‌ها یا عنوان تغییرهای فرزند را بدهید");
  const base = pick(parent, [...COPY_SECTIONS.main, ...COPY_SECTIONS.plans, ...COPY_SECTIONS.schedule, "service_id", "outage_expected", "outage_minutes"]);
  return ctx.write(async (tx) => {
    const out: Row[] = [];
    const items = cis.length ? cis.map((ci, i) => ({ ci, title: titles[i] ?? null })) : titles.map((t) => ({ ci: null as string | null, title: t }));
    for (const [i, it] of items.entries()) {
      out.push(await createIn(tx, ctx, "change_request", {
        ...base, parent_id: parentId,
        short_description: (it.title ?? `${parent.short_description} — بخش ${i + 1}`).slice(0, 200),
        ...(it.ci ? { ci_id: it.ci, affected_cis: [it.ci] } : {}),
      }));
    }
    return out;
  });
}

/** Put a change on hold (a reason from the list; the guard keeps it from moving forward). */
export async function holdChange(ctx: Ctx, id: string, input: { reason: string; note?: string | null }): Promise<Row> {
  const { row } = await get(ctx, "change_request", id);
  const { def } = await defFor(ctx, "change_request");
  if (!access().canWrite(ctx, def, row)) throw forbidden("اجازهٔ تغییر این درخواست تغییر را ندارید");
  if (!HOLD_REASONS.some((o) => o.value === input.reason) || input.reason === "lockdown") throw bad("دلیل توقف معتبر نیست");
  if (["review", "closed", "canceled"].includes(String(row.state))) throw conflict("تغییر اجراشده یا بسته متوقف نمی‌شود");
  if (row.on_hold) throw conflict("این تغییر هم‌اکنون متوقف است");
  return ctx.write(async (tx) => {
    const stored = await updateIn(tx, sysOf(ctx, ctx.user.id), "change_request", id, { on_hold: true, on_hold_reason: input.reason }, { trusted: true });
    const label = HOLD_REASONS.find((o) => o.value === input.reason)?.label ?? input.reason;
    await addJournalIn(tx, sysOf(ctx, ctx.user.id), def, stored, { kind: "work_note", body: `تغییر متوقف شد (${label})${input.note ? `: ${input.note}` : "."}` }, { trusted: true, author: ctx.user.id });
    return stored;
  });
}

/** Take a change off hold (not while a lockdown that holds it is active). */
export async function resumeChange(ctx: Ctx, id: string, input: { note?: string | null }): Promise<Row> {
  const { row } = await get(ctx, "change_request", id);
  const { def } = await defFor(ctx, "change_request");
  if (!access().canWrite(ctx, def, row)) throw forbidden("اجازهٔ تغییر این درخواست تغییر را ندارید");
  if (!row.on_hold) throw conflict("این تغییر متوقف نیست");
  if (row.on_hold_reason === "lockdown") {
    const holds = await holdsOn(ctx.db, ctx, row);
    const still = (await activeLockdowns(ctx.db, ctx)).find((l) => lockdownApplies(lockdownLike(l), row, holds));
    if (still) throw conflict(`قرنطینهٔ تغییرات «${still.title}» هنوز برقرار است`);
  }
  return ctx.write(async (tx) => {
    const stored = await updateIn(tx, sysOf(ctx, ctx.user.id), "change_request", id, { on_hold: false, on_hold_reason: null, lockdown_id: null }, { trusted: true });
    await addJournalIn(tx, sysOf(ctx, ctx.user.id), def, stored, { kind: "system", body: `توقف تغییر برداشته شد${input.note ? `: ${input.note}` : "."}` }, { trusted: true, author: ctx.user.id });
    return stored;
  });
}

/** Start the backout of a change being implemented: the reason «در حال بازگشت», a note, and a backout task. */
export async function startBackout(ctx: Ctx, id: string, input: { note: string }): Promise<Row> {
  const { row, meta } = await get(ctx, "change_request", id);
  if (row.state !== "implement") throw conflict("بازگشت فقط هنگام اجرای تغییر آغاز می‌شود");
  if (!meta.canWrite) throw forbidden("اجازهٔ تغییر این درخواست تغییر را ندارید");
  const { def } = await defFor(ctx, "change_request");
  return ctx.write(async (tx) => {
    const stored = await updateIn(tx, ctx, "change_request", id, { status_reason: "in_rollback" }, { version: row.version });
    await addJournalIn(tx, sysOf(ctx, ctx.user.id), def, stored, { kind: "work_note", body: `بازگشت تغییر آغاز شد: ${input.note}` }, { trusted: true, author: ctx.user.id });
    const open = await liveRows(tx, sysOf(ctx), "change_task", { and: [{ f: "change_id", op: "eq", v: id }, { f: "task_type", op: "eq", v: "backout" }, { f: "state", op: "in", v: ["pending", "open", "in_progress"] }] }, { limit: 1 });
    if (!open.length) {
      await createIn(tx, ctx, "change_task", { change_id: id, short_description: "اجرای برنامهٔ بازگشت", task_type: "backout", mandatory: true, sort_order: 900, description: String(row.backout_plan ?? ""), assigned_to: row.assigned_to ?? null });
    }
    return stored;
  });
}

const ORIGIN_TABLES = ["incident", "problem", "known_error", "request", "request_item", "release", "todo", "change_request"];

/**
 * A change from another record: its context copied, «آغازشده از» linked (problems also «رفع می‌کند»). A change from a
 * confidential record (a security incident) carries its title and description, so it is confidential too and keeps
 * the record's access list: the group it is assigned to and the people on it read it, not every reader of changes.
 */
export async function changeFrom(ctx: Ctx, table: string, sourceId: string, input: Row): Promise<Row> {
  if (!ORIGIN_TABLES.includes(table) || !hasTable(table)) throw bad("از این نوع رکورد نمی‌توان تغییر ساخت");
  const { row: src, display } = await get(ctx, table, sourceId);
  const { def: sdef } = await defFor(ctx, table);
  const title = String(src[sdef.display] ?? src.short_description ?? src.title ?? "").slice(0, 180);
  const number = src.number ?? display[sourceId] ?? "";
  const values: Row = {
    type: "normal",
    short_description: title ? `تغییر برای ${title}` : "تغییر تازه",
    description: [`ثبت‌شده از ${number}.`, typeof src.description === "string" ? src.description : ""].filter(Boolean).join("\n\n"),
    ...(isUuid(src.service_id) ? { service_id: src.service_id } : {}),
    ...(isUuid(src.ci_id) ? { ci_id: src.ci_id } : {}),
    ...(isUuid(src.assignment_group_id) ? { assignment_group_id: src.assignment_group_id } : {}),
    ...(src.confidential === true ? { confidential: true, ...(Array.isArray(src.access_list) && src.access_list.length ? { access_list: src.access_list } : {}) } : {}),
  };
  for (const [k, v] of Object.entries(input)) if (v !== undefined) values[k] = v;
  const created = await ctx.write(async (tx) => {
    const row = await createIn(tx, ctx, "change_request", values);
    return updateIn(tx, sysOf(ctx), "change_request", String(row.id), { origin_table: table, origin_id: sourceId }, { trusted: true, keepVersion: true });
  });
  await addLink(ctx, "change_request", String(created.id), { kind: "initiated_by", table, id: sourceId });
  if (table === "problem" || table === "known_error") await addLink(ctx, "change_request", String(created.id), { kind: "fixes", table, id: sourceId }).catch(() => undefined);
  return (await get(ctx, "change_request", String(created.id))).row;
}

/** The published standard changes the caller may read, with their track record. */
export async function catalogue(ctx: Ctx, input: { q?: string; category?: string }): Promise<Row> {
  const filter = { and: [{ f: "kind", op: "eq", v: "standard" }, { f: "state", op: "eq", v: "published" }, ...(input.category ? [{ f: "category", op: "eq", v: input.category }] : [])] };
  const r = await list(ctx, "change_template", {
    filter: filter as never, q: input.q, sort: "-usage_count,name", size: 200, total: false,
    fields: ["number", "name", "category", "risk", "short_description", "description", "max_duration", "usage_count", "success_count", "failure_count", "last_used_at", "assignment_group_id", "owner_id", "review_date", "revision"],
  });
  return {
    items: r.rows.map((t) => {
      const done = Number(t.success_count ?? 0) + Number(t.failure_count ?? 0);
      return { ...t, success_rate: done ? Math.round((100 * Number(t.success_count ?? 0)) / done) : null };
    }),
    display: r.display,
  };
}

/** Order a standard change: a change from the template (pre-authorized), scheduled at once when asked and allowed. */
export async function orderStandard(ctx: Ctx, templateId: string, input: Row & { submit?: boolean }): Promise<{ change: Row; warning: string | null }> {
  const { row: t } = await get(ctx, "change_template", templateId);
  if (t.kind !== "standard" || t.state !== "published") throw conflict("این الگو تغییر استاندارد منتشرشده نیست");
  const { submit, ...rest } = input;
  const created = await create(ctx, "change_request", { ...rest, template_id: templateId, type: "standard" });
  let warning: string | null = null;
  if (submit) {
    try {
      await transition(ctx, "change_request", String(created.row.id), "scheduled", {});
    } catch (e) {
      warning = e instanceof Error ? e.message : String(e);
    }
  }
  return { change: (await get(ctx, "change_request", String(created.row.id))).row, warning };
}

