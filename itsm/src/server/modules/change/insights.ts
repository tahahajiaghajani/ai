// Read-side insights of change enablement — deterministic first, with the AI layer's skills on top when registered
// (ai.ts). All reads go through the engine with the caller's context, so nothing the caller may not read is used.
//   · readiness for authorization (CHG-070) and impact (CHG-017)
//   · similar changes and their outcomes (CHG-071), the suspect-change finder for incidents (CHG-055)
//   · detected configuration changes without an authorized change → a retrospective change (CHG-056)
//   · the change timeline of a CI (CHG-054), the evidence pack of a change (CHG-058), the CAB pack (CHG-039)
import { readiness, riskLabel, scopeOf, stateLabel, applicableQuestions, answerOption, humanSpan } from "@shared/change/logic";
import { formatJalaliDateTime } from "@shared/jalali";
import { CHANGE_CLOSE_CODES, CONFLICT_KINDS } from "@shared/tables/change";
import type { Ctx } from "../../context";
import { create, get, list, listHistory, orgTz } from "../../engine";
import { bad, forbidden } from "../../http/errors";
import { recordApprovals } from "../sla";
import { changeAi } from "./ai";
import { cycleApprovals, tally } from "./authorize";
import { workbench } from "./cab";
import { hasTable, isUuid, msOf, riskQuestions, sysOf, type Row } from "./common";
import { impactProvider } from "./impact";
import { holdsOn } from "./schedule";

const codeLabel = (v: unknown) => CHANGE_CLOSE_CODES.find((o) => o.value === v)?.label ?? "—";
const words = (s: unknown) => new Set(String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2));

/** Readiness of a change for authorization: the deterministic checks, plus the AI rubric when registered. */
export async function readinessView(ctx: Ctx, id: string): Promise<Row> {
  const { row } = await get(ctx, "change_request", id);
  const sys = sysOf(ctx);
  const holds = await holdsOn(ctx.db, sys, row);
  const questions = applicableQuestions(await riskQuestions(ctx.db, sys), row, holds);
  const answers = row.risk_answers && typeof row.risk_answers === "object" ? row.risk_answers : {};
  const unanswered = questions.filter((q) => q.mandatory !== false && !answerOption(q, answers[q.id])).length;
  const r = readiness(row, { unansweredQuestions: unanswered });
  const ai = changeAi().validate ? await changeAi().validate!(ctx, id) : null;
  return { ...r, unanswered, ai };
}

/** What a change touches: its CIs and services, the services impacted through the CMDB, whether a CMDB is connected. */
export async function impactView(ctx: Ctx, id: string): Promise<Row> {
  const { row, display } = await get(ctx, "change_request", id);
  const s = scopeOf(row);
  return {
    cis: s.cis, services: Array.isArray(row.affected_services) ? row.affected_services : [], impacted: Array.isArray(row.impacted_services) ? row.impacted_services : [],
    primary: { ci: row.ci_id ?? null, service: row.service_id ?? null }, provider: !!impactProvider().impactedServices, display,
  };
}

const SIMILAR_FIELDS = ["number", "short_description", "type", "state", "category", "subcategory", "template_id", "ci_id", "service_id", "affected_cis", "affected_services", "close_code", "risk", "actual_end", "incidents_caused"];

/** Changes like this one (same CIs, services, template, category, words), with their outcomes. */
export async function similarChanges(ctx: Ctx, id: string, limit = 8): Promise<Row> {
  const { row } = await get(ctx, "change_request", id);
  const mine = scopeOf(row);
  const ors: Row[] = [];
  if (row.category) ors.push({ f: "category", op: "eq", v: row.category });
  if (row.template_id) ors.push({ f: "template_id", op: "eq", v: row.template_id });
  for (const ci of mine.cis.slice(0, 20)) ors.push({ f: "affected_cis", op: "contains", v: ci }, { f: "ci_id", op: "eq", v: ci });
  for (const sv of mine.services.slice(0, 20)) ors.push({ f: "affected_services", op: "contains", v: sv }, { f: "service_id", op: "eq", v: sv });
  const candidates = ors.length
    ? (await list(ctx, "change_request", { filter: { and: [{ or: ors }, { f: "state", op: "in", v: ["review", "closed"] }] } as never, sort: "-actual_end", size: 300, fields: SIMILAR_FIELDS, total: false })).rows
    : [];
  const myWords = words(row.short_description);
  const scored = candidates
    .filter((c) => c.id !== row.id)
    .map((c): Row => {
      const theirs = scopeOf(c);
      const tw = words(c.short_description);
      const overlap = [...myWords].filter((w) => tw.has(w)).length;
      const jaccard = myWords.size + tw.size ? overlap / (myWords.size + tw.size - overlap) : 0;
      const score = 3 * mine.cis.filter((x) => theirs.cis.includes(x)).length + 2 * mine.services.filter((x) => theirs.services.includes(x)).length
        + (row.template_id && c.template_id === row.template_id ? 3 : 0) + (row.subcategory && c.subcategory === row.subcategory ? 2 : 0) + (row.category && c.category === row.category ? 1 : 0) + 3 * jaccard;
      return { ...c, score: Math.round(score * 100) / 100 };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(30, limit)));
  const done = scored.filter((c) => c.close_code);
  const failed = done.filter((c) => c.close_code === "unsuccessful" || c.close_code === "backed_out").length;
  return {
    items: scored.map((c) => ({ ...c, outcome: codeLabel(c.close_code) })),
    summary: done.length ? { total: done.length, failed, failure_rate: Math.round((100 * failed) / done.length) } : null,
  };
}

/**
 * Changes that may have caused an incident (CHG-055): implemented (or being implemented) in the hours before it, on
 * its CI or service; scored by what they share and how close in time they were.
 */
export async function suspects(ctx: Ctx, input: { incident?: string; ci?: string; service?: string; at?: string; hours?: number }): Promise<Row> {
  let ci = isUuid(input.ci) ? input.ci : null;
  let service = isUuid(input.service) ? input.service : null;
  let at = msOf(input.at) ?? Date.now();
  if (input.incident) {
    if (!hasTable("incident")) throw bad("ماژول رخداد نصب نیست");
    const { row } = await get(ctx, "incident", input.incident);
    ci = ci ?? (isUuid(row.ci_id) ? row.ci_id : null);
    service = service ?? (isUuid(row.service_id) ? row.service_id : null);
    at = msOf(input.at) ?? msOf(row.opened_at) ?? at;
  }
  const hours = Math.max(1, Math.min(24 * 14, input.hours ?? 72));
  const since = at - hours * 3_600_000;
  const touches: Row[] = [];
  if (ci) touches.push({ f: "ci_id", op: "eq", v: ci }, { f: "affected_cis", op: "contains", v: ci });
  if (service) touches.push({ f: "service_id", op: "eq", v: service }, { f: "affected_services", op: "contains", v: service }, { f: "impacted_services", op: "contains", v: service });
  const when = { or: [{ f: "state", op: "eq", v: "implement" }, { and: [{ f: "actual_end", op: "gte", v: new Date(since).toISOString() }, { f: "actual_start", op: "lte", v: new Date(at).toISOString() }] }] };
  const filter = touches.length ? { and: [{ or: touches }, when] } : when;
  const rows = (await list(ctx, "change_request", { filter: filter as never, sort: "-actual_start", size: 100, fields: [...SIMILAR_FIELDS, "actual_start", "assigned_to", "assignment_group_id"], total: false })).rows;
  const items = rows
    .map((c) => {
      const s = scopeOf(c);
      const sameCi = !!ci && s.cis.includes(ci);
      const sameService = !!service && s.services.includes(service);
      const end = msOf(c.actual_end) ?? Date.now();
      const gap = Math.max(0, at - end);
      const recency = gap <= 3_600_000 ? 3 : gap <= 6 * 3_600_000 ? 2 : gap <= 24 * 3_600_000 ? 1 : 0.5;
      const score = (sameCi ? 4 : 0) + (sameService ? 2 : 0) + recency + (c.close_code === "successful_issues" || c.close_code === "unsuccessful" || c.close_code === "backed_out" ? 1 : 0);
      const why = [sameCi ? "همان پیکربندی" : null, sameService ? "همان خدمت" : null, c.state === "implement" ? "در حال اجرا" : `${humanSpan(gap)} پیش از رخداد تمام شد`].filter(Boolean).join("، ");
      return { ...c, score, why };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  return { items, window: { from: new Date(since).toISOString(), to: new Date(at).toISOString() } };
}

/**
 * A configuration change found by discovery or an audit (CHG-056): authorized when a change on that CI was being
 * implemented or implemented around that time; otherwise a retrospective change is registered for review.
 */
export async function detectedChange(ctx: Ctx, input: { ci_id: string; at?: string; summary: string; source?: "drift" | "audit" | "monitoring" | "manual"; description?: string }): Promise<Row> {
  const at = msOf(input.at) ?? Date.now();
  const slack = 2 * 3_600_000;
  const touches = { or: [{ f: "ci_id", op: "eq", v: input.ci_id }, { f: "affected_cis", op: "contains", v: input.ci_id }] };
  const covering = (await list(ctx, "change_request", {
    filter: { and: [touches, { f: "state", op: "in", v: ["implement", "review", "closed"] }, { f: "actual_start", op: "lte", v: new Date(at + slack).toISOString() }, { or: [{ f: "actual_end", op: "empty" }, { f: "actual_end", op: "gte", v: new Date(at - slack).toISOString() }] }] } as never,
    size: 10, fields: ["number", "short_description", "state", "actual_start", "actual_end"], total: false,
  })).rows;
  if (covering.length) return { authorized: true, changes: covering, change: null };
  const when = new Date(at).toISOString();
  const created = await create(ctx, "change_request", {
    type: "latent", short_description: input.summary.slice(0, 200), description: input.description ?? `تغییر پیکربندی بدون درخواست تغییرِ مجاز شناسایی شد (${when}).`,
    ci_id: input.ci_id, affected_cis: [input.ci_id], discovered_by: input.source ?? "drift", retrospective: true, actual_start: when, actual_end: when,
  });
  return { authorized: false, changes: [], change: created.row };
}

/** The changes of a CI, newest first (CHG-054). */
export async function ciTimeline(ctx: Ctx, ciId: string): Promise<Row> {
  const r = await list(ctx, "change_request", {
    filter: { or: [{ f: "ci_id", op: "eq", v: ciId }, { f: "affected_cis", op: "contains", v: ciId }] } as never, sort: "-planned_start", size: 200, total: false,
    fields: ["number", "short_description", "type", "state", "risk", "planned_start", "planned_end", "actual_start", "actual_end", "close_code", "incidents_caused"],
  });
  return { items: r.rows, display: r.display };
}

/** The evidence of a change for auditors (CHG-058): who asked, who approved, what was done and how it went (Markdown). */
export async function evidencePack(ctx: Ctx, id: string): Promise<{ markdown: string }> {
  const { row: c, display } = await get(ctx, "change_request", id);
  const tz = orgTz(ctx);
  const at = (v: unknown) => (v ? formatJalaliDateTime(String(v), tz) : "—");
  const name = (v: unknown) => (v ? (display[String(v)] ?? "—") : "—");
  const approvals = await recordApprovals(ctx, "change_request", id);
  const tasks = await list(ctx, "change_task", { filter: { f: "change_id", op: "eq", v: id } as never, sort: "sort_order", size: 200, fields: ["number", "short_description", "state", "assigned_to", "actual_start", "actual_end"], total: false });
  const conflicts = await list(ctx, "change_conflict", { filter: { f: "change_id", op: "eq", v: id } as never, size: 200, fields: ["summary", "kind", "status", "justification", "active"], total: false });
  const history = await listHistory(ctx, "change_request", id, { limit: 200 });
  const d = { ...display, ...approvals.display, ...tasks.display };
  const lines = [
    `# پروندهٔ شواهد ${c.number} — ${c.short_description}`,
    "",
    `- نوع: ${c.type} · وضعیت: ${stateLabel(c.state)} · ریسک: ${riskLabel(c.risk)} (امتیاز ${c.risk_score ?? "—"}، ${c.risk_source === "manual" ? `دستی: ${c.risk_override_reason ?? ""}` : "محاسبه‌شده"})`,
    `- درخواست‌دهنده: ${name(c.caller_id)} · هماهنگ‌کننده: ${name(c.change_owner_id)} · مجری: ${name(c.assigned_to)}`,
    `- ثبت: ${at(c.opened_at)} · ارسال: ${at(c.submitted_at)} · تأیید: ${at(c.authorized_at)}`,
    `- برنامه: ${at(c.planned_start)} تا ${at(c.planned_end)} · اجرا: ${at(c.actual_start)} تا ${at(c.actual_end)}`,
    `- نتیجه: ${codeLabel(c.close_code)}${c.close_notes ? ` — ${c.close_notes}` : ""}`,
    ...(c.blackout_override_reason ? [`- اجرا در دورهٔ ممنوعیت: ${c.blackout_override_reason}`] : []),
    "",
    "## تأییدها",
    "",
    ...(approvals.approvals.length
      ? approvals.approvals.map((a) => `- دور ${a.round}، سطح ${a.level} (${a.level_name ?? a.rule_name ?? ""}): ${d[String(a.approver_id)] ?? "—"} — ${a.state}${a.decided_at ? ` در ${at(a.decided_at)}` : ""}${a.comments ? ` — ${a.comments}` : ""}`)
      : ["تأییدی ثبت نشده است."]),
    "",
    "## کارها",
    "",
    ...(tasks.rows.length ? tasks.rows.map((t) => `- ${t.number}: ${t.short_description} — ${t.state} (${d[String(t.assigned_to)] ?? "—"})`) : ["کاری ثبت نشده است."]),
    "",
    "## تداخل‌ها",
    "",
    ...(conflicts.rows.length ? conflicts.rows.map((x) => `- ${CONFLICT_KINDS.find((o) => o.value === x.kind)?.label ?? x.kind}: ${x.summary} — ${x.status}${x.justification ? ` (${x.justification})` : ""}${x.active ? "" : " (برطرف‌شده)"}`) : ["تداخلی ثبت نشده است."]),
    "",
    `## تاریخچه`,
    "",
    `${history.entries.length} تغییر فیلد ثبت شده است (آخرین: ${history.entries[0] ? at(history.entries[0].at) : "—"}).`,
  ];
  return { markdown: lines.join("\n") };
}

/** The CAB pack of a meeting: one section per change on its agenda (CHG-039; the AI pack when registered). */
export async function cabPack(ctx: Ctx, meetingId: string): Promise<{ markdown: string; ai: boolean }> {
  const ai = changeAi().cabPack;
  if (ai) {
    await get(ctx, "cab_meeting", meetingId);
    return { markdown: (await ai(ctx, meetingId)).text, ai: true };
  }
  const w = await workbench(ctx, meetingId);
  const m = w.meeting as Row | null;
  if (!m) throw forbidden("این جلسه را نمی‌بینید");
  const tz = orgTz(ctx);
  const at = (v: unknown) => (v ? formatJalaliDateTime(String(v), tz) : "—");
  const byId = new Map((w.changes as Row[]).map((c) => [String(c.id), c]));
  const lines = [`# بستهٔ جلسهٔ ${m.title}`, "", `زمان جلسه: ${at(m.starts_at)}`, ""];
  for (const [i, it] of (w.items as Row[]).entries()) {
    const c = byId.get(String(it.change_id));
    if (!c) {
      lines.push(`## ${i + 1}. (تغییری که دسترسی دیدنش را ندارید)`, "");
      continue;
    }
    const r = readiness(c);
    const v = (w.votes as Record<string, Row>)[String(c.id)];
    lines.push(
      `## ${i + 1}. ${c.number} — ${c.short_description}`,
      "",
      `- ریسک: ${riskLabel(c.risk)} (امتیاز ${c.risk_score ?? "—"}) · زمان: ${at(c.planned_start)} تا ${at(c.planned_end)}`,
      `- تداخل‌های باز: ${c.conflict_count ?? 0}${c.in_blackout ? " · در دورهٔ ممنوعیت" : ""}${c.outside_window ? " · بیرون از پنجرهٔ نگهداری" : ""}${c.is_late ? " · دیرهنگام" : ""}`,
      `- آمادگی مستندات: ${r.score}٪${c.backout_tested ? " · برنامهٔ بازگشت آزموده شده" : " · برنامهٔ بازگشت آزموده نشده"}${c.outage_expected ? " · قطعی پیش‌بینی می‌شود" : ""}`,
      ...(v && v.total ? [`- رأی‌ها: ${v.approved} موافق، ${v.rejected} مخالف از ${v.total}`] : []),
      "",
    );
  }
  if (!(w.items as Row[]).length) lines.push("موردی در دستور جلسه نیست.");
  return { markdown: lines.join("\n"), ai: false };
}

/** The votes of a change's current authorization cycle (for its record page). */
export async function cycleVotes(ctx: Ctx, id: string): Promise<Row> {
  const { row } = await get(ctx, "change_request", id);
  return tally(row.state === "authorize" ? await cycleApprovals(ctx.db, sysOf(ctx), row) : []);
}
