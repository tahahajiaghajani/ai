// Security operations services (SEC-001 … SEC-013): playbooks into response tasks, promotion of an IT incident to a
// security incident (by hand or by the settings' auto-promotion), phishing reports from any member grouped by sender
// and links (the reporter gets a receipt and a redacted status, never the record), observables and threat indicators,
// chain-of-custody transfers, regulatory clocks and their submissions, the SOC workspace and the shift handover.
// Every service works with the caller's context; the engine and the access provider decide what they may read and
// change. Writes the module does on someone's behalf use the system and keep the person as author.
import { extractObservables, normalizeObservable, detectObservableType, percent, sirTimes, type Deadline } from "@shared/security/logic";
import { SIR_STATES } from "@shared/tables/security";
import { stateCategory } from "@shared/model/task";
import { tableDef } from "@shared/tables";
import type { MyReport, SocWorkspace } from "@shared/security/api";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { addJournalIn, addLinkIn, createIn, defFor, get, list, resolveDisplay, RefSet, condEnv, orgSchema, savepoint, transitionIn, updateIn } from "../../engine";
import { lockKey } from "../../db";
import { access } from "../../access/provider";
import { bad, forbidden, notFound } from "../../http/errors";
import { countRows, eqAll, ids, isUuid, liveRow, liveRows, lockedRow, readsTable, secureWorkspace, securityConfig, sysOf, type Row } from "./common";

const OPEN_STATES = SIR_STATES.states.filter((s) => ["new", "active", "waiting"].includes(s.category)).map((s) => s.value);
const stateLabel = (v: unknown) => SIR_STATES.states.find((s) => s.value === v)?.label ?? String(v ?? "");

// ---------------------------------------------------------------------------------------------------------------
// Playbooks (SEC-002)

/** The playbook's steps as response tasks of the incident (steps whose title is already a task are skipped). */
export async function applyPlaybookIn(tx: Tx, ctx: Ctx, sir: Row, playbookId: string): Promise<number> {
  const sys = sysOf(ctx);
  const pb = await liveRow(tx, sys, "sec_playbook", playbookId);
  if (!pb || pb.active === false) return 0;
  const steps = Array.isArray(pb.steps) ? (pb.steps as Row[]) : [];
  const existing = await liveRows(tx, sys, "sec_task", eqAll({ sec_incident_id: sir.id }), { limit: 500 });
  const have = new Set(existing.map((t) => String(t.short_description).trim()));
  let made = 0;
  for (const [i, s] of steps.entries()) {
    const title = String(s.title ?? "").trim();
    if (!title || have.has(title)) continue;
    await createIn(tx, sys, "sec_task", {
      sec_incident_id: sir.id, short_description: title.slice(0, 200), phase: s.phase ?? "analysis", mandatory: s.mandatory !== false,
      action: s.action ?? "none", requires_approval: !!s.approval || (!!s.action && s.action !== "none"), sort_order: (i + 1) * 10,
      assignment_group_id: sir.assignment_group_id ?? null, caller_id: null, opened_by: null,
    }, { trusted: true });
    made++;
  }
  if (made) await addJournalIn(tx, sys, tableDef("sec_incident")!, sir, { kind: "work_note", body: `دستورالعمل «${pb.name}» (ویرایش ${pb.revision ?? 1}) افزوده شد: ${made.toLocaleString("fa-IR")} کار پاسخ.` }, { trusted: true });
  return made;
}

/** «افزودن دستورالعمل» from the record page (the caller must be able to change the incident). */
export async function applyPlaybook(ctx: Ctx, sirId: string, playbookId: string): Promise<{ tasks: number }> {
  const r = await get(ctx, "sec_incident", sirId);
  if (!r.meta.canWrite) throw forbidden("اجازهٔ تغییر این رخداد امنیتی را ندارید");
  const sys = sysOf(ctx, ctx.user.id);
  return ctx.write(async (tx) => {
    // the incident locked first and decided from its stored row: two «افزودن دستورالعمل» at once take turns, and the
    // second finds the first one's tasks (no step twice)
    const sir = (await lockedRow(tx, sysOf(ctx), "sec_incident", sirId)) ?? (r.row as Row);
    if (sir.playbook_id !== playbookId) await updateIn(tx, ctx, "sec_incident", sirId, { playbook_id: playbookId });
    else return { tasks: await applyPlaybookIn(tx, sys, sir, playbookId) };
    return { tasks: (await liveRows(tx, sys, "sec_task", eqAll({ sec_incident_id: sirId }), { limit: 500 })).length };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Promotion from IT incidents (security vs IT incident)

const CATEGORY_OF: Record<string, string> = { "security.phishing": "phishing", "security.malware": "malware", "security.data_leak": "data_breach" };

function fromIncident(inc: Row): Row {
  return {
    short_description: String(inc.short_description ?? "رخداد امنیتی").slice(0, 200),
    description: inc.description ?? null,
    category: CATEGORY_OF[String(inc.subcategory ?? "")] ?? "other",
    severity: inc.priority === "1" ? "1" : inc.priority === "2" ? "2" : "3",
    business_impact: inc.impact === "1" ? "1" : inc.impact === "2" ? "2" : "3",
    caller_id: inc.caller_id ?? null,
    detected_at: inc.detected_at ?? inc.opened_at ?? null,
    ci_id: inc.ci_id ?? null,
    service_id: inc.service_id ?? null,
    affected_cis: ids(inc.affected_cis),
    affected_services: ids(inc.affected_services),
    it_incident_id: inc.id,
    source: "promoted",
  };
}

/** The security incident made from an IT incident, if any (read as the system). */
export async function promotedFrom(tx: Tx | Ctx["db"], ctx: Ctx, incidentId: string): Promise<Row | null> {
  const [sir] = await liveRows(tx, sysOf(ctx), "sec_incident", eqAll({ it_incident_id: incidentId }), { limit: 1 });
  return sir ?? null;
}

/**
 * «ارتقا به رخداد امنیتی»: a member of the secure workspace with the right to create security incidents makes one from
 * an IT incident they can read; both are linked and the IT incident gets a note (its desk sees the number only).
 */
export async function promoteIncident(ctx: Ctx, incidentId: string): Promise<{ id: string; number: string | null; created: boolean }> {
  const inc = (await get(ctx, "incident", incidentId)).row as Row; // 404 unless readable
  const { def } = await defFor(ctx, "sec_incident");
  if (!access().canCreate(ctx, def, null)) throw forbidden("ثبت رخداد امنیتی با تیم امنیت است");
  const prior = await promotedFrom(ctx.db, ctx, incidentId);
  if (prior) return { id: prior.id, number: prior.number ?? null, created: false };
  return ctx.write(async (tx) => {
    // the IT incident locked and the promotion looked for again: an automatic promotion (or another analyst) at the
    // same moment takes turns with this one, so one IT incident gets one security incident
    await lockedRow(tx, sysOf(ctx), "incident", incidentId);
    const again = await promotedFrom(tx, ctx, incidentId);
    if (again) return { id: again.id, number: again.number ?? null, created: false };
    const sir = await createIn(tx, ctx, "sec_incident", fromIncident(inc));
    await linkPromotion(tx, ctx, incidentId, sir);
    return { id: sir.id, number: (sir.number as string) ?? null, created: true };
  });
}

async function linkPromotion(tx: Tx, ctx: Ctx, incidentId: string, sir: Row): Promise<void> {
  const sys = sysOf(ctx, ctx.actor === "system" ? null : ctx.user.id);
  await addLinkIn(tx, sys, "incident", incidentId, { kind: "promoted_to", table: "sec_incident", id: sir.id });
  const inc = await liveRow(tx, sysOf(ctx), "incident", incidentId);
  if (inc) await addJournalIn(tx, sysOf(ctx), tableDef("incident")!, inc, { kind: "work_note", body: `این رخداد به رخداد امنیتی ${sir.number ?? ""} ارتقا یافت و تیم امنیت آن را پیگیری می‌کند.` }, { trusted: true });
}

/** The settings' auto-promotion: an IT incident flagged «رخداد امنیتی» gets its security incident (as the system). */
export async function autoPromote(sys: Ctx, incidentId: string): Promise<Row | null> {
  const cfg = await securityConfig(sys.db, sys);
  if (!cfg.auto_promote) return null;
  const inc = await liveRow(sys.db, sys, "incident", incidentId);
  if (!inc || inc.security_incident !== true) return null;
  if (await promotedFrom(sys.db, sys, incidentId)) return null;
  return sys.write(async (tx) => {
    // the IT incident locked before looking again (its created and updated events are two jobs, and an analyst may
    // promote it by hand at the same moment): one security incident per IT incident
    await lockedRow(tx, sys, "incident", incidentId);
    if (await promotedFrom(tx, sys, incidentId)) return null;
    await secureWorkspace(tx, sys);
    const sir = await createIn(tx, sys, "sec_incident", fromIncident(inc), { trusted: true });
    await linkPromotion(tx, sys, incidentId, sir);
    return sir;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Phishing reports (SEC-006)

export interface PhishingReport {
  subject: string;
  sender?: string | null;
  body?: string | null;
  headers?: string | null;
  note?: string | null;
}

/** The sender's address of a mail ("Name <a@b.c>" or "a@b.c"), normalised; null when there is none. */
export function senderAddress(sender: unknown): string | null {
  const raw = String(sender ?? "");
  const v = (/<([^<>]+)>/.exec(raw)?.[1] ?? raw).trim();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v) ? normalizeObservable("email", v) : null;
}

/**
 * «گزارش رایانامهٔ مشکوک»: any member reports a suspected phishing mail. Indicators are extracted; a report of the
 * same sender address or the same link within seven days joins the open incident (grouping — never on a domain: two
 * strangers' mails from one free-mail domain are not one incident), otherwise a new security incident starts.
 * The reporter gets only a receipt number of their own report and later a redacted status (`myReports`); a report
 * that joins another reporter's incident gets no number (that number is the first reporter's).
 */
export async function reportPhishing(ctx: Ctx, input: PhishingReport): Promise<{ receipt: string | null; grouped: boolean }> {
  if (ctx.actor === "system") throw bad("گزارش فیشینگ با خود عضو است");
  const subject = String(input.subject ?? "").trim().slice(0, 180);
  if (!subject) throw bad("موضوع رایانامه را بنویسید");
  const text = [input.sender ? `فرستنده: ${input.sender}` : "", input.headers ? `سرآیندها:\n${input.headers}` : "", input.body ?? ""].filter(Boolean).join("\n\n").slice(0, 50_000);
  const found = extractObservables(`${input.sender ?? ""}\n${input.body ?? ""}\n${input.headers ?? ""}`, 50);
  const senderDomain = String(input.sender ?? "").split("@")[1]?.toLowerCase().replace(/[>\s].*$/, "") || null;
  const sender = senderAddress(input.sender);
  // grouping keys: the full sender address and full links of the mail (a domain is shared by unrelated senders)
  const urls = found.filter((o) => o.type === "url").map((o) => o.value);
  const keys = new Set([...urls, ...(sender ? [sender] : [])]);
  const sys = sysOf(ctx, ctx.user.id);
  return sys.write(async (tx) => {
    await secureWorkspace(tx, sys);
    // reports of one campaign at the same moment take turns on their grouping keys (sorted: no two wait for each other
    // in opposite orders), so the second one finds the first one's incident instead of opening another
    for (const key of [...keys].sort().slice(0, 100)) await lockKey(tx, `security.phish:${sys.org.id}:${key}`);
    // grouping: an open phishing incident of the last week sharing the sender's address or a link
    let target: Row | null = null;
    if (keys.size) {
      const obs = await liveRows(tx, sys, "sec_observable", { and: [{ f: "type", op: "in", v: ["url", "email"] }, { f: "normalized", op: "in", v: [...keys].slice(0, 100) }] }, { limit: 100 });
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const sirIds = [...new Set(obs.flatMap((o) => ids(o.incidents)))];
      if (sirIds.length) {
        [target] = await liveRows(tx, sys, "sec_incident", { and: [{ f: "id", op: "in", v: sirIds.slice(0, 200) }, { f: "source", op: "eq", v: "phishing_report" }, { f: "state", op: "in", v: OPEN_STATES }, { f: "opened_at", op: "gte", v: since }] }, { order: "t.created_at desc", limit: 1 });
      }
    }
    let sir: Row;
    if (target) {
      const users = [...new Set([...ids(target.affected_users), ctx.user.id])];
      sir = await updateIn(tx, sys, "sec_incident", target.id, { affected_users: users }, { trusted: true });
      await addJournalIn(tx, sys, tableDef("sec_incident")!, sir, { kind: "work_note", body: `گزارش دیگری از همین رایانامه (موضوع: «${subject}»).\n\n${text}`.slice(0, 90_000) }, { trusted: true });
    } else {
      sir = await createIn(tx, sys, "sec_incident", {
        short_description: `گزارش فیشینگ: ${subject}`.slice(0, 200), description: text || null, category: "phishing", severity: "3", business_impact: "4", classification: "internal",
        source: "phishing_report", attack_vector: "email", caller_id: ctx.user.id, affected_users: [ctx.user.id],
      }, { trusted: true });
    }
    for (const o of found) await upsertObservable(tx, sys, sir.id, o.type, o.value, { source: "phishing" });
    if (senderDomain) await upsertObservable(tx, sys, sir.id, "domain", senderDomain, { source: "phishing" });
    if (sender) await upsertObservable(tx, sys, sir.id, "email", sender, { source: "phishing" });
    // a report joined to another reporter's incident gets no number: that number is the first reporter's receipt
    return { receipt: target ? null : ((sir.number as string) ?? null), grouped: !!target };
  });
}

const PUBLIC_STATUS: Record<string, string> = { new: "دریافت شد", active: "در حال بررسی تیم امنیت", waiting: "در حال بررسی تیم امنیت", resolved: "بررسی شد", closed: "بررسی شد", canceled: "بررسی شد" };
const PUBLIC_OUTCOME: Record<string, string> = { true_positive: "تهدید تأیید و مهار شد؛ از گزارش شما سپاسگزاریم", false_positive: "تهدیدی یافت نشد", benign: "رایانامه بی‌خطر بود", duplicate: "پیش‌تر گزارش شده بود", inconclusive: "بررسی به نتیجهٔ قطعی نرسید" };

/** The caller's own reports, redacted: receipt, date, a public status and outcome — never the record or its notes. */
export async function myReports(ctx: Ctx): Promise<MyReport[]> {
  if (ctx.actor === "system") return [];
  const rows = await liveRows(ctx.db, sysOf(ctx), "sec_incident", { or: [{ f: "caller_id", op: "eq", v: ctx.user.id }, { and: [{ f: "affected_users", op: "eq", v: ctx.user.id }, { f: "source", op: "eq", v: "phishing_report" }] }] }, { order: "t.created_at desc", limit: 50 });
  return rows.map((r) => {
    const cat = stateCategory(SIR_STATES, r.state) ?? "new";
    const done = cat === "resolved" || cat === "closed" || cat === "canceled";
    return { number: r.caller_id === ctx.user.id ? (r.number ?? null) : null, reported_at: r.opened_at ?? r.created_at ?? null, status: PUBLIC_STATUS[cat] ?? "در حال بررسی", outcome: done ? (PUBLIC_OUTCOME[String(r.close_code ?? "")] ?? null) : null };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Observables and threat indicators (SEC-003, SEC-004, SEC-026)

/** Add an incident to the observable (type, value), creating it when new; returns the stored row. */
export async function upsertObservable(tx: Tx, ctx: Ctx, sirId: string | null, type: string, value: string, extra: Row = {}): Promise<Row> {
  const sys = sysOf(ctx);
  const t = type || detectObservableType(value);
  const normalized = normalizeObservable(t, value);
  const now = new Date().toISOString();
  // the stored observable locked and read again before its incidents are added to: two incidents adding the same
  // indicator at once both stay on it (each appends to what the other committed)
  const append = async (found: Row): Promise<Row> => {
    const have = (await lockedRow(tx, sys, "sec_observable", found.id)) ?? found;
    const incidents = sirId ? [...new Set([...ids(have.incidents), sirId])] : ids(have.incidents);
    if (incidents.length === ids(have.incidents).length && !extra.verdict && !extra.is_ioc) return have;
    return updateIn(tx, sys, "sec_observable", have.id, { incidents, last_seen: now, ...(extra.verdict ? { verdict: extra.verdict } : {}), ...(extra.is_ioc ? { is_ioc: true } : {}) }, { trusted: true });
  };
  const [have] = await liveRows(tx, sys, "sec_observable", eqAll({ type: t, normalized }), { limit: 1 });
  if (have) return append(have);
  try {
    // a new indicator: another transaction may make the same one at the same moment (the unique key per type and
    // value refuses the second insert) — then this one appends to that one instead of failing the whole report
    return await savepoint(tx, () => createIn(tx, sys, "sec_observable", { type: t, value, incidents: sirId ? [sirId] : [], first_seen: now, last_seen: now, ...extra }, { trusted: true }));
  } catch (e) {
    const code = (e as { code?: string; status?: number })?.code;
    if (code !== "23505" && code !== "duplicate") throw e;
    const [other] = await liveRows(tx, sys, "sec_observable", eqAll({ type: t, normalized }), { limit: 1 });
    if (!other) throw e;
    return append(other);
  }
}

/** «افزودن نشانگرها» on an incident: values pasted by an analyst (refanged, typed, de-duplicated). */
export async function addObservables(ctx: Ctx, sirId: string, values: string[], opts: { is_ioc?: boolean; verdict?: string } = {}): Promise<{ added: number; observables: Row[] }> {
  const r = await get(ctx, "sec_incident", sirId);
  if (!r.meta.canWrite) throw forbidden("اجازهٔ تغییر این رخداد امنیتی را ندارید");
  const { def } = await defFor(ctx, "sec_observable");
  if (!access().canCreate(ctx, def, null)) throw forbidden("ثبت نشانگر برای شما مجاز نیست");
  const clean = [...new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean))].slice(0, 100);
  if (!clean.length) throw bad("نشانگری وارد نشده است");
  const sys = sysOf(ctx, ctx.user.id);
  return ctx.write(async (tx) => {
    const out: Row[] = [];
    for (const v of clean) out.push(await upsertObservable(tx, sys, sirId, "", v, { source: "manual", ...(opts.is_ioc ? { is_ioc: true } : {}), ...(opts.verdict ? { verdict: opts.verdict } : {}) }));
    return { added: out.length, observables: out };
  });
}

/** Indicators in the incident's own text (description and the caller-visible notes are not needed: fields only). */
export async function extractIncidentObservables(ctx: Ctx, sirId: string): Promise<{ added: number; observables: Row[] }> {
  const r = await get(ctx, "sec_incident", sirId);
  const text = [r.row.short_description, r.row.description].filter(Boolean).join("\n");
  const found = extractObservables(String(text), 100).map((o) => o.value);
  if (!found.length) return { added: 0, observables: [] };
  return addObservables(ctx, sirId, found);
}

/**
 * The local enrichment of an observable (cached with its time): sightings across incidents, a matching threat
 * indicator's verdict, the open incidents it appears in. External reputation lookups need a connector (not built).
 */
export async function enrichObservable(ctx: Ctx, id: string): Promise<Row> {
  const r = await get(ctx, "sec_observable", id);
  if (!r.meta.canWrite) throw forbidden("اجازهٔ تغییر این نشانگر را ندارید");
  const o = r.row as Row;
  const sys = sysOf(ctx);
  const iocs = await liveRows(ctx.db, sys, "sec_observable", { and: [{ f: "normalized", op: "eq", v: o.normalized }, { f: "is_ioc", op: "eq", v: true }] }, { limit: 20 });
  const live = iocs.filter((x) => !x.expires_at || Date.parse(String(x.expires_at)) > Date.now());
  const open = ids(o.incidents).length ? await countRows(ctx.db, sys, "sec_incident", { and: [{ f: "id", op: "in", v: ids(o.incidents) }, { f: "state", op: "in", v: OPEN_STATES }] }) : 0;
  const worst = live.some((x) => x.verdict === "malicious") ? "malicious" : live.some((x) => x.verdict === "suspicious") ? "suspicious" : null;
  const enrichment = { ioc_match: live.length > 0, ioc_verdict: worst, incidents: ids(o.incidents).length, open_incidents: open, sources: [...new Set(live.map((x) => x.source))], at: new Date().toISOString() };
  const patch: Row = { enrichment, enriched_at: enrichment.at };
  if (worst && (o.verdict === "unknown" || !o.verdict)) patch.verdict = worst;
  const sysAs = sysOf(ctx, ctx.user.id);
  await ctx.write((tx) => updateIn(tx, sysAs, "sec_observable", id, patch, { trusted: true }));
  return { ...o, ...patch };
}

// ---------------------------------------------------------------------------------------------------------------
// Evidence custody (SEC-009)

export async function transferCustody(ctx: Ctx, evidenceId: string, input: { to: string; location?: string | null; note?: string | null }): Promise<Row> {
  if (!isUuid(input.to)) throw bad("نگه‌دارندهٔ تازه را انتخاب کنید");
  const r = await get(ctx, "sec_evidence", evidenceId);
  if (!r.meta.canWrite) throw forbidden("اجازهٔ تحویل این شاهد را ندارید");
  return ctx.write(async (tx) => {
    const row = await updateIn(tx, ctx, "sec_evidence", evidenceId, { custodian_id: input.to, ...(input.location ? { location: input.location } : {}) }, { version: r.row.version as number });
    if (input.note) await addJournalIn(tx, ctx, tableDef("sec_evidence")!, row, { kind: "work_note", body: `تحویل شاهد: ${String(input.note).slice(0, 2000)}` });
    return row;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Regulatory clocks (SEC-008)

/** Start a regulatory clock on an incident (calendar time from awareness). */
export async function startClock(ctx: Ctx, sirId: string, regimeId: string, awareAt?: string | null): Promise<Row> {
  const r = await get(ctx, "sec_incident", sirId);
  if (!r.meta.canWrite) throw forbidden("اجازهٔ تغییر این رخداد امنیتی را ندارید");
  const [dup] = await liveRows(ctx.db, sysOf(ctx), "sec_reg_clock", { and: [{ f: "sec_incident_id", op: "eq", v: sirId }, { f: "regime_id", op: "eq", v: regimeId }, { f: "state", op: "ne", v: "not_required" }] }, { limit: 1 });
  if (dup) throw bad(`این ساعت پیش‌تر برای این رخداد شروع شده است (${dup.number ?? ""})`);
  return ctx.write((tx) => createIn(tx, ctx, "sec_reg_clock", { sec_incident_id: sirId, regime_id: regimeId, aware_at: awareAt || r.row.detected_at || new Date().toISOString() }));
}

/** Record a stage's submission to the authority; when every stage is in, the clock is «فرستاده شد». */
export async function submitStage(ctx: Ctx, clockId: string, stage: string, reference?: string | null): Promise<Row> {
  const r = await get(ctx, "sec_reg_clock", clockId);
  if (!r.meta.canWrite) throw forbidden("اجازهٔ تغییر این ساعت الزامی را ندارید");
  if ((r.row as Row).state !== "running") throw bad("این ساعت در جریان نیست");
  const sys = sysOf(ctx, ctx.user.id);
  return ctx.write(async (tx) => {
    // decided from the clock locked and read again: another stage's submission (or the sweep's warning marks) recorded
    // since this request read it stays — only this stage's submission is added to the stored deadlines
    const clock = await lockedRow(tx, sysOf(ctx), "sec_reg_clock", clockId);
    if (!clock || clock.state !== "running") throw bad("این ساعت در جریان نیست");
    const deadlines = ((clock.deadlines as Deadline[]) ?? []).map((d) => ({ ...d }));
    const d = deadlines.find((x) => x.stage === stage);
    if (!d) throw bad("این مرحله در مقررات نیست");
    if (d.submitted_at) throw bad("این مرحله پیش‌تر فرستاده شده است");
    const now = new Date().toISOString();
    d.submitted_at = now;
    let row = await updateIn(tx, sys, "sec_reg_clock", clockId, { deadlines, submitted_at: now, ...(reference ? { reference: String(reference).slice(0, 120) } : {}) }, { trusted: true });
    await addJournalIn(tx, sys, tableDef("sec_reg_clock")!, row, { kind: "work_note", body: `«${d.label}» ${Date.parse(now) <= Date.parse(d.due_at) ? "در موعد" : "پس از موعد"} فرستاده شد${reference ? ` (شمارهٔ پیگیری ${reference})` : ""}.` }, { trusted: true, author: ctx.user.id });
    if (deadlines.every((x) => x.submitted_at)) row = await transitionIn(tx, ctx, "sec_reg_clock", clockId, "submitted");
    return row;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// SOC workspace and shift handover (SEC-010, SEC-013)

const SEVERITY_LABEL: Record<string, string> = { "1": "بحرانی", "2": "بالا", "3": "متوسط", "4": "کم" };

/** The SOC page: tiles, the analysts' workload, the riskiest open incidents, MTTD / MTTC / MTTR and a handover. */
export async function socWorkspace(ctx: Ctx): Promise<SocWorkspace> {
  if (!(await readsTable(ctx, "sec_incident"))) throw forbidden("به رخدادهای امنیتی دسترسی ندارید");
  const q = ctx.db;
  const open = await liveRows(q, ctx, "sec_incident", { f: "state", op: "in", v: OPEN_STATES }, { order: "t.risk_score desc nulls last, t.created_at", limit: 2000 });
  const now = Date.now();
  const since = new Date(now - 90 * 86_400_000).toISOString();
  const closed = await liveRows(q, ctx, "sec_incident", { and: [{ f: "state", op: "in", v: ["review", "closed", "canceled"] }, { f: "updated_at", op: "gte", v: since }] }, { limit: 5000 });
  const clocks = (await readsTable(ctx, "sec_reg_clock")) ? await liveRows(q, ctx, "sec_reg_clock", { f: "state", op: "eq", v: "running" }, { limit: 500 }) : [];
  const approvals = (await readsTable(ctx, "sec_task")) ? await countRows(q, ctx, "sec_task", { and: [{ f: "approval", op: "eq", v: "requested" }, { f: "state", op: "in", v: ["new", "in_progress", "pending"] }] }) : 0;
  const mine = open.filter((r) => r.assigned_to === ctx.user.id || r.lead_id === ctx.user.id).length;
  const day = now + 86_400_000;
  const tiles: SocWorkspace["tiles"] = [
    { key: "open", label: "رخدادهای باز", value: open.length, path: "security/incidents" },
    { key: "mine", label: "رخدادهای من", value: mine, path: "security/queue/mine" },
    { key: "unassigned", label: "بی‌تحلیل‌گر", value: open.filter((r) => !r.assigned_to).length, tone: open.some((r) => !r.assigned_to) ? "warning" : null, path: "security/queue/unassigned" },
    { key: "critical", label: "بحرانی و بالا", value: open.filter((r) => r.severity === "1" || r.severity === "2").length, tone: open.some((r) => r.severity === "1") ? "danger" : null, path: "security/queue/critical" },
    { key: "contain", label: "در مرحلهٔ مهار", value: open.filter((r) => r.state === "contain").length, path: "security/queue/contain" },
    { key: "approvals", label: "اقدام‌های مهار منتظر تأیید", value: approvals, tone: approvals ? "warning" : null, path: "security/tasks" },
    { key: "reg_due", label: "اطلاع‌رسانی الزامی تا ۲۴ ساعت", value: clocks.filter((c) => c.next_due_at && Date.parse(c.next_due_at) <= day && !c.overdue).length, tone: "warning", path: "security/clocks" },
    { key: "reg_overdue", label: "اطلاع‌رسانی الزامی با دیرکرد", value: clocks.filter((c) => c.overdue).length, tone: clocks.some((c) => c.overdue) ? "danger" : null, path: "security/clocks" },
  ];
  const work = new Map<string, { open: number; critical: number }>();
  for (const r of open) {
    if (!isUuid(r.assigned_to)) continue;
    const w = work.get(r.assigned_to) ?? { open: 0, critical: 0 };
    w.open++;
    if (r.severity === "1" || r.severity === "2") w.critical++;
    work.set(r.assigned_to, w);
  }
  const refs = new RefSet();
  for (const r of open.slice(0, 15)) if (isUuid(r.assigned_to)) refs.add("user", r.assigned_to);
  for (const u of work.keys()) refs.add("user", u);
  const display = await resolveDisplay(q, ctx, await condEnv(ctx), await orgSchema(ctx), refs);
  const fp = closed.filter((r) => r.close_code === "false_positive" || r.close_code === "benign").length;
  const decided = closed.filter((r) => r.close_code).length;
  return {
    tiles,
    workload: [...work.entries()].map(([user_id, w]) => ({ user_id, name: display[user_id] ?? "", ...w })).sort((a, b) => b.open - a.open),
    top: open.slice(0, 10).map((r) => ({ id: r.id, number: r.number ?? null, title: r.short_description, state: r.state, state_label: stateLabel(r.state), severity: r.severity ?? null, risk_score: r.risk_score ?? null, assigned_to: r.assigned_to ?? null, sla_due: r.sla_due ?? null })),
    times: { ...sirTimes(closed), closed: closed.length, false_positive_rate: percent(fp, decided) },
    handover: await handoverText(ctx, open, clocks),
    display,
  };
}

/** A rule-based shift handover: what changed in the last hours, what is open and due, the next steps (SEC-010). */
export async function handoverText(ctx: Ctx, openRows?: Row[], clocks?: Row[], hours = 12): Promise<string> {
  const q = ctx.db;
  const open = openRows ?? (await liveRows(q, ctx, "sec_incident", { f: "state", op: "in", v: OPEN_STATES }, { order: "t.risk_score desc nulls last", limit: 500 }));
  const since = Date.now() - hours * 3_600_000;
  const recent = open.filter((r) => Date.parse(String(r.updated_at)) >= since);
  const lines: string[] = [`تحویل شیفت — ${open.length.toLocaleString("fa-IR")} رخداد امنیتی باز؛ ${recent.length.toLocaleString("fa-IR")} مورد در ${hours.toLocaleString("fa-IR")} ساعت گذشته تغییر کرده است.`];
  for (const r of open.slice(0, 10)) {
    const tasks = (await readsTable(ctx, "sec_task")) ? await liveRows(q, ctx, "sec_task", { and: [{ f: "sec_incident_id", op: "eq", v: r.id }, { f: "state", op: "in", v: ["new", "in_progress", "pending"] }] }, { order: "t.sort_order", limit: 2 }) : [];
    const next = tasks.map((t) => t.short_description).join("؛ ");
    lines.push(`- ${r.number ?? ""} «${String(r.short_description).slice(0, 80)}» — ${stateLabel(r.state)}، شدت ${SEVERITY_LABEL[String(r.severity)] ?? "—"}${r.regulatory_overdue ? "، اطلاع‌رسانی الزامی با دیرکرد" : ""}${next ? `. گام بعد: ${next}` : ""}`);
  }
  const due = (clocks ?? []).filter((c) => c.next_due_at && Date.parse(c.next_due_at) <= Date.now() + 86_400_000);
  if (due.length) lines.push(`ساعت‌های الزامی تا ۲۴ ساعت آینده: ${due.map((c) => `${c.number ?? ""} (${c.next_stage ?? ""})`).join("، ")}`);
  return lines.join("\n");
}

/** The SIR record page's facts (KPIs of this incident, linked IT incident, counts) for its side panel. */
export async function incidentFacts(ctx: Ctx, sirId: string) {
  const r = await get(ctx, "sec_incident", sirId);
  const row = r.row as Row;
  const sys = sysOf(ctx);
  const observables = (await readsTable(ctx, "sec_observable")) ? await liveRows(ctx.db, ctx, "sec_observable", { f: "incidents", op: "eq", v: sirId }, { order: "t.last_seen desc", limit: 50 }) : [];
  const clocks = (await readsTable(ctx, "sec_reg_clock")) ? await liveRows(ctx.db, ctx, "sec_reg_clock", eqAll({ sec_incident_id: sirId }), { limit: 20 }) : [];
  const tasks = await countRows(ctx.db, sys, "sec_task", { and: [{ f: "sec_incident_id", op: "eq", v: sirId }, { f: "state", op: "in", v: ["new", "in_progress", "pending"] }] });
  return {
    times: { detect: row.time_to_detect ?? null, contain: row.time_to_contain ?? null, recover: row.time_to_recover ?? null },
    open_tasks: tasks,
    observables: observables.map((o) => ({ id: o.id, type: o.type, value: o.value, verdict: o.verdict, is_ioc: !!o.is_ioc, sightings: o.sightings ?? 0 })),
    clocks: clocks.map((c) => ({ id: c.id, number: c.number ?? null, state: c.state, next_stage: c.next_stage ?? null, next_due_at: c.next_due_at ?? null, overdue: !!c.overdue, deadlines: c.deadlines ?? [] })),
  };
}

/** Readable regimes for the «شروع ساعت الزامی» picker, personal-data ones first when the incident is a breach. */
export async function regimesFor(ctx: Ctx, sirId: string) {
  const r = await get(ctx, "sec_incident", sirId);
  const all = await list(ctx, "sec_reg_regime", { filter: { f: "active", op: "eq", v: true }, size: 50, total: false, fields: ["key", "name", "authority", "personal_data", "placeholder", "stages"] });
  const rows = all.rows as Row[];
  if (r.row.personal_data_breach) rows.sort((a, b) => Number(!!b.personal_data) - Number(!!a.personal_data));
  return rows.map((x) => ({ id: x.id, name: x.name, authority: x.authority ?? null, personal_data: !!x.personal_data, placeholder: !!x.placeholder, stages: x.stages ?? [] }));
}

export { notFound };
