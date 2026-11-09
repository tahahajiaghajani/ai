// Customer service operations the generic API cannot express (each with the caller's context unless it says so):
//   · customer 360 (CSM-006): one view of an account — contacts, cases, entitlements and their units, installed base,
//     contracts, escalations, reviews and the relationship's health — as the caller reads them
//   · proactive cases (CSM-018): an incident on a CI reaches, through the installed base, every affected account; one
//     proactive case each, told to the customer before they call (on a major incident when the setting says so)
//   · internal escalation with customer-safe sync (CSM-014): a case raises an incident (or problem) linked to it;
//     the internal record's states come back to the case as internal work notes only, and an awaited internal record
//     that is resolved moves the case back to work — nothing internal ever reaches the customer
//   · major cases (CSM-013): one public update to every child case (each customer told in their own channel)
//   · next case (CSM-026): the highest-priority unassigned case of the caller's groups, product skills first
//   · quarterly review packs (CSM-033), regulated notices with evidence (CSM-020), relationship health (CSM-034),
//     auto-close of resolved cases, the CSM dashboard (CSM-043)
import Decimal from "decimal.js";
import { healthOf, type HealthFacts } from "@shared/csm/logic";
import { CUSTOMER_CASE_STATES } from "@shared/tables/csm";
import { stateCategory } from "@shared/model/task";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { prepareSubject, subjectOf } from "../../access";
import { addJournalIn, addLinkIn, aggregate, createIn, get, isSystemCtx, list, transitionIn, updateIn, validationError } from "../../engine";
import { bad, forbidden, notFound } from "../../http/errors";
import { notifyPeople } from "../notify";
import { csmConfig, ids, isUuid, liveRow, liveRows, mayWriteRecord, msOf, sysOf, todayUtc, type Row } from "./common";

const safe = async <T>(f: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await f();
  } catch {
    return fallback;
  }
};

/** One view of an account (CSM-006), read as the caller. */
export async function customer360(ctx: Ctx, accountId: string): Promise<Row> {
  const { row: account, display } = await get(ctx, "customer_account", accountId);
  const by = { f: "account_id", op: "eq", v: accountId } as const;
  const [contacts, open, recent, ents, ibis, contracts, escalations, reviews, health] = await Promise.all([
    safe(() => list(ctx, "customer_contact", { filter: by, size: 100, sort: "name" }), null),
    safe(() => list(ctx, "customer_case", { filter: { and: [by, { f: "active", op: "eq", v: true }] }, sort: "priority,sla_due", size: 50, fields: ["number", "short_description", "state", "priority", "case_type", "assigned_to", "sla_due", "complaint", "escalated", "sentiment", "contact_id", "product_id"] }), null),
    safe(() => list(ctx, "customer_case", { filter: { and: [by, { f: "active", op: "eq", v: false }] }, sort: "-closed_at", size: 10, fields: ["number", "short_description", "state", "closed_at", "satisfaction", "resolution_accepted"] }), null),
    safe(() => list(ctx, "entitlement", { filter: by, size: 50, sort: "-ends_on" }), null),
    safe(() => list(ctx, "install_base_item", { filter: by, size: 100, sort: "name" }), null),
    safe(() => list(ctx, "customer_contract", { filter: by, size: 20, sort: "-ends_on" }), null),
    safe(() => list(ctx, "case_escalation", { filter: { and: [by, { f: "state", op: "in", v: ["requested", "active"] }] }, size: 20 }), null),
    safe(() => list(ctx, "account_review", { filter: by, size: 5, sort: "-period_to" }), null),
    safe(() => list(ctx, "account_health", { filter: by, size: 90, sort: "-day", fields: ["day", "score", "status"] }), null),
  ]);
  const csat = await safe(async () => {
    const a = await aggregate(ctx, "customer_case", { filter: { and: [by, { f: "satisfaction", op: "nempty" }] }, metrics: [{ fn: "avg", field: "satisfaction" }, { fn: "count" }] });
    return { avg: a.totals?.["avg:satisfaction"] ?? null, n: Number(a.totals?.count ?? 0) };
  }, { avg: null as unknown, n: 0 });
  const merged = { ...display };
  for (const r of [contacts, open, recent, ents, ibis, contracts, escalations, reviews]) if (r) Object.assign(merged, r.display);
  return {
    account, display: merged,
    contacts: contacts?.rows ?? [], open_cases: open?.rows ?? [], recent_cases: recent?.rows ?? [], entitlements: ents?.rows ?? [], install_base: ibis?.rows ?? [],
    contracts: contracts?.rows ?? [], escalations: escalations?.rows ?? [], reviews: reviews?.rows ?? [], health: (health?.rows ?? []).reverse(),
    csat: csat.avg === null || csat.avg === undefined ? null : Number(csat.avg), csat_n: csat.n,
  };
}

/** The accounts an incident affects through the installed base (its CI). */
export async function affectedAccounts(tx: Tx, ctx: Ctx, incident: Row): Promise<Row[]> {
  const sys = sysOf(ctx);
  const cis = ids([incident.ci_id]);
  if (!cis.length) return [];
  const ibis = await liveRows(tx, sys, "install_base_item", { and: [{ f: "ci_id", op: "in", v: cis }, { f: "status", op: "eq", v: "active" }] }, { limit: 2000 });
  const accountIds = ids(ibis.map((i) => i.account_id));
  return accountIds.length ? liveRows(tx, sys, "customer_account", { and: [{ f: "id", op: "in", v: accountIds }, { f: "active", op: "eq", v: true }] }, { limit: 2000 }) : [];
}

/** Proactive cases for the accounts an incident affects (one per account, never twice). */
export async function proactiveCasesIn(tx: Tx, ctx: Ctx, incidentId: string): Promise<{ created: number; accounts: number }> {
  const sys = sysOf(ctx);
  const incident = await liveRow(tx, sys, "incident", incidentId);
  if (!incident) throw notFound("رخداد پیدا نشد");
  const accounts = await affectedAccounts(tx, ctx, incident);
  const done = new Set(
    (await tx.query<{ from_id: string }>(`select from_id from sm_links where org_id = $1 and kind = 'caused_by' and from_table = 'customer_case' and to_table = 'incident' and to_id = $2 and deleted_at is null`, [ctx.org.id, incidentId])).map((r) => r.from_id),
  );
  const covered = new Set<string>();
  for (const id of done) {
    const c = await liveRow(tx, sys, "customer_case", id);
    if (c?.account_id) covered.add(String(c.account_id));
  }
  let created = 0;
  for (const acc of accounts) {
    if (covered.has(String(acc.id))) continue;
    const [contact] = await liveRows(tx, sys, "customer_contact", { and: [{ f: "account_id", op: "eq", v: acc.id }, { f: "active", op: "eq", v: true }, { f: "user_id", op: "nempty" }] }, { order: "t.is_primary desc, t.created_at", limit: 1 });
    const c = await createIn(tx, sys, "customer_case", {
      short_description: `اختلال در خدمت: ${String(incident.short_description ?? "").slice(0, 150)}`, case_type: "problem", account_id: acc.id, contact_id: contact?.id ?? null,
      requested_for: contact?.user_id ?? null, caller_id: contact?.user_id ?? null, channel: "monitoring", proactive: true, priority: incident.priority ?? "3",
      description: "این پرونده را پیش از تماس شما باز کردیم: اختلالی که بر خدمت شما اثر دارد شناسایی شده و در حال رفع آن هستیم.",
    }, { trusted: true });
    await addLinkIn(tx, sys, "customer_case", String(c.id), { kind: "caused_by", table: "incident", id: incidentId });
    if (contact?.user_id) await addJournalIn(tx, sys, tableDef("customer_case")!, c, { kind: "comment", body: "مشتری گرامی، اختلالی که بر خدمت شما اثر دارد شناسایی شده و کارشناسان ما در حال رفع آن هستند. پیشرفت کار را همین‌جا به شما اطلاع می‌دهیم." }, { trusted: true });
    created++;
  }
  return { created, accounts: accounts.length };
}

/** Raise an incident (or a problem) from a customer case (CSM-014): linked, the case waits for the internal team. */
export async function raiseInternal(ctx: Ctx, caseId: string, input: { table?: string; short_description?: string | null }): Promise<Row> {
  const table = input.table === "problem" ? "problem" : "incident";
  if (!tableDef(table)) throw bad("این نوع رکورد داخلی در سامانه نیست");
  return ctx.write(async (tx) => {
    if (!(await mayWriteRecord(tx, ctx, "customer_case", caseId))) throw forbidden("پرونده را کسی ارجاع می‌دهد که روی آن کار می‌کند");
    const sys = sysOf(ctx);
    const c = await liveRow(tx, sys, "customer_case", caseId);
    if (!c) throw notFound("پرونده پیدا نشد");
    // the internal record is created with the caller's own access (they must be allowed to file it)
    const rec = await createIn(tx, ctx, table, {
      short_description: (input.short_description || `پروندهٔ مشتری ${c.number}: ${c.short_description}`).slice(0, 200),
      description: `برخاسته از پروندهٔ مشتری ${c.number}.\n\n${c.description ?? ""}`.slice(0, 20_000),
      ...(table === "incident" ? { caller_id: ctx.user.id, priority: c.priority ?? "3" } : {}),
    });
    await addLinkIn(tx, sys, "customer_case", caseId, { kind: "related", table, id: String(rec.id), note: "ارجاع داخلی" });
    if (["new", "open"].includes(String(c.state))) await transitionIn(tx, sys, "customer_case", caseId, "awaiting_internal", {}, { trusted: true });
    await addJournalIn(tx, sys, tableDef("customer_case")!, c, { kind: "work_note", body: `ارجاع داخلی: ${rec.number ?? ""} ساخته شد` }, { trusted: true });
    return { table, id: String(rec.id), number: (rec.number as string) ?? null };
  });
}

/** An internal record linked to customer cases changed state: internal notes on the cases, waiting ones move on. */
export async function syncInternalIn(tx: Tx, ctx: Ctx, table: string, id: string): Promise<number> {
  const sys = sysOf(ctx);
  const rec = await liveRow(tx, sys, table, id);
  if (!rec) return 0;
  const links = await tx.query<{ from_table: string; from_id: string; to_table: string; to_id: string }>(
    `select from_table, from_id, to_table, to_id from sm_links where org_id = $1 and deleted_at is null and kind = 'related' and ((from_table = 'customer_case' and to_table = $2 and to_id = $3) or (to_table = 'customer_case' and from_table = $2 and from_id = $3))`,
    [ctx.org.id, table, id],
  );
  const def = tableDef(table);
  const label = def?.states?.states.find((s) => s.value === rec.state)?.label ?? String(rec.state);
  const cat = stateCategory(def?.states, rec.state);
  let n = 0;
  for (const l of links) {
    const caseId = l.from_table === "customer_case" ? l.from_id : l.to_id;
    const c = await liveRow(tx, sys, "customer_case", caseId);
    if (!c || !c.active) continue;
    await addJournalIn(tx, sys, tableDef("customer_case")!, c, { kind: "work_note", body: `کار داخلی ${rec.number ?? ""}: ${label}` }, { trusted: true });
    if ((cat === "resolved" || cat === "closed") && c.state === "awaiting_internal") await transitionIn(tx, sys, "customer_case", caseId, "open", {}, { trusted: true });
    n++;
  }
  return n;
}

/** One public update to every child of a major case (each customer told by their own preferences). */
export async function broadcast(ctx: Ctx, caseId: string, body: string): Promise<{ sent: number }> {
  const text = String(body ?? "").trim().slice(0, 20_000);
  if (!text) throw validationError({ body: "متن به‌روزرسانی را بنویسید" });
  return ctx.write(async (tx) => {
    if (!(await mayWriteRecord(tx, ctx, "customer_case", caseId))) throw forbidden("به‌روزرسانی گروهی با کسی است که روی پروندهٔ عمده کار می‌کند");
    const sys = sysOf(ctx);
    const major = await liveRow(tx, sys, "customer_case", caseId);
    if (!major?.is_major) throw bad("این پرونده عمده نیست");
    const actor = sysOf(ctx, ctx.user.id);
    const def = tableDef("customer_case")!;
    await addJournalIn(tx, actor, def, major, { kind: "comment", body: text }, { trusted: true, author: ctx.user.id });
    const children = await liveRows(tx, sys, "customer_case", { and: [{ f: "major_case_id", op: "eq", v: caseId }, { f: "active", op: "eq", v: true }] }, { limit: 2000 });
    for (const ch of children) await addJournalIn(tx, actor, def, ch, { kind: "comment", body: text }, { trusted: true, author: ctx.user.id });
    return { sent: children.length };
  });
}

/** The next case for the caller (CSM-026): unassigned, in their groups, highest priority and nearest deadline first; product skills that match theirs first. */
export async function nextCase(ctx: Ctx): Promise<Row | null> {
  if (isSystemCtx(ctx)) return null;
  await prepareSubject(ctx);
  const s = subjectOf(ctx);
  if (!s.writeGroups.length) return null;
  const rows = await list(ctx, "customer_case", { filter: { and: [{ f: "assignment_group_id", op: "in", v: s.writeGroups }, { f: "assigned_to", op: "empty" }, { f: "active", op: "eq", v: true }] }, sort: "priority,sla_due,opened_at", size: 30, fields: ["number", "short_description", "priority", "sla_due", "product_id"] });
  if (!rows.rows.length) return null;
  const sys = sysOf(ctx);
  const [profile] = await liveRows(ctx.db, sys, "member_profile", { f: "user_id", op: "eq", v: ctx.user.id }, { limit: 1 });
  const mine = new Set(((profile?.skills as string[]) ?? []).map((x) => x.toLowerCase()));
  let pick = rows.rows[0];
  if (mine.size) {
    for (const r of rows.rows.slice(0, 10)) {
      const p = isUuid(r.product_id) ? await liveRow(ctx.db, sys, "customer_product", r.product_id) : null;
      if (((p?.skills as string[]) ?? []).some((k) => mine.has(k.toLowerCase())) && r.priority === rows.rows[0].priority) {
        pick = r;
        break;
      }
    }
  }
  return ctx.write(async (tx) => {
    const { updateIn: upd } = await import("../../engine");
    return upd(tx, ctx, "customer_case", String(pick.id), { assigned_to: ctx.user.id }, { version: Number(pick.version) });
  });
}

/** The pack of a quarterly review (CSM-033): figures of the account's period, computed as the system for the reviewers. */
export async function reviewPack(ctx: Ctx, reviewId: string): Promise<Row> {
  return ctx.write(async (tx) => {
    if (!(await mayWriteRecord(tx, ctx, "account_review", reviewId))) throw forbidden("بستهٔ بازبینی را مسئول بازبینی می‌سازد");
    const sys = sysOf(ctx);
    const rev = await liveRow(tx, sys, "account_review", reviewId);
    if (!rev) throw notFound("بازبینی پیدا نشد");
    const from = `${rev.period_from}T00:00:00Z`;
    const to = `${rev.period_to}T23:59:59Z`;
    const cases = await liveRows(tx, sys, "customer_case", { and: [{ f: "account_id", op: "eq", v: rev.account_id }, { f: "opened_at", op: "between", v: [from, to] }] }, { limit: 10_000 });
    const resolved = cases.filter((c) => c.resolved_at);
    const rated = cases.filter((c) => c.satisfaction);
    const timers = cases.length ? await liveRows(tx, sys, "task_sla", { and: [{ f: "table_key", op: "eq", v: "customer_case" }, { f: "record_id", op: "in", v: cases.map((c) => String(c.id)) }, { f: "stage", op: "in", v: ["achieved", "breached"] }] }, { limit: 50_000 }) : [];
    const met = timers.filter((t) => t.stage === "achieved").length;
    const escalations = await liveRows(tx, sys, "case_escalation", { and: [{ f: "account_id", op: "eq", v: rev.account_id }, { f: "created_at", op: "between", v: [from, to] }] }, { limit: 1000 });
    const byType: Record<string, number> = {};
    for (const c of cases) byType[String(c.case_type ?? "question")] = (byType[String(c.case_type ?? "question")] ?? 0) + 1;
    const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
    const pack = {
      period: { from: rev.period_from, to: rev.period_to },
      cases: cases.length, resolved: resolved.length, by_type: byType, complaints: cases.filter((c) => c.complaint).length,
      sla: { met, breached: timers.length - met, attainment: timers.length ? Math.round((met / timers.length) * 1000) / 10 : null },
      csat: mean(rated.map((c) => Number(c.satisfaction))), csat_n: rated.length,
      acceptance: resolved.length ? Math.round((resolved.filter((c) => c.resolution_accepted === true).length / resolved.length) * 1000) / 10 : null,
      escalations: escalations.length,
      mean_resolution_hours: mean(resolved.map((c) => ((msOf(c.resolved_at) ?? 0) - (msOf(c.opened_at) ?? 0)) / 3_600_000).filter((x) => x >= 0)),
    };
    const narrative = [
      `در این دوره ${pack.cases} پرونده ثبت شد و ${pack.resolved} پرونده حل شد.`,
      pack.sla.attainment === null ? "" : `تحقق توافق سطح خدمت ${pack.sla.attainment}٪ بود (${pack.sla.breached} نقض).`,
      pack.csat === null ? "" : `میانگین رضایت ${pack.csat} از ۵ از ${pack.csat_n} نظر.`,
      pack.complaints ? `${pack.complaints} شکایت ثبت شد.` : "شکایتی ثبت نشد.",
      pack.escalations ? `${pack.escalations} تشدید در دوره رخ داد.` : "",
    ].filter(Boolean).join(" ");
    await updateIn(tx, sys, "account_review", reviewId, { pack, pack_at: new Date().toISOString(), ...(rev.narrative ? {} : { narrative }) }, { trusted: true });
    return { pack, narrative };
  });
}

/** Send an approved notice to the active contacts of its accounts (CSM-020), with evidence of what was sent. */
export async function sendNotice(ctx: Ctx, noticeId: string): Promise<Row> {
  return ctx.write(async (tx) => {
    if (!(await mayWriteRecord(tx, ctx, "customer_notice", noticeId))) throw forbidden("ارسال اطلاع‌رسانی با مسئول آن است");
    const sys = sysOf(ctx);
    const n = await liveRow(tx, sys, "customer_notice", noticeId);
    if (!n) throw notFound("اطلاع‌رسانی پیدا نشد");
    if (n.state !== "approved") throw bad("فقط متن تأییدشده فرستاده می‌شود");
    const contacts = await liveRows(tx, sys, "customer_contact", { and: [{ f: "account_id", op: "in", v: ids(n.accounts) }, { f: "active", op: "eq", v: true }, { f: "user_id", op: "nempty" }] }, { limit: 5000 });
    const users = ids(contacts.map((c) => c.user_id));
    if (!users.length) throw bad("حساب‌های انتخاب‌شده مخاطب فعالی با حساب کاربری ندارند");
    await updateIn(tx, sys, "customer_notice", noticeId, { recipients: users }, { trusted: true, keepVersion: true });
    const channels = ((n.channels as string[]) ?? ["in_app", "email"]).filter((c) => ["in_app", "email", "sms"].includes(c)) as ("in_app" | "email" | "sms")[];
    const sent = await notifyPeople(tx, ctx.org.id, { table: "customer_notice", id: noticeId, users, label: String(n.title), subject: String(n.title), body: String(n.body), channels, mandatory: true, actor: ctx.user.id, source: "اطلاع‌رسانی به مشتریان" });
    const evidence = { sent_at: new Date().toISOString(), recipients: sent, accounts: ids(n.accounts).length, channels, by: ctx.user.id };
    await transitionIn(tx, sysOf(ctx, ctx.user.id), "customer_notice", noticeId, "sent", { recipient_count: sent, sent_at: evidence.sent_at, evidence }, { trusted: true });
    return { sent, evidence };
  });
}

/** Relationship health of every active account (CSM-034): a daily snapshot and the account's score. */
export async function healthSweepIn(tx: Tx, ctx: Ctx, deadline = Date.now() + 30_000): Promise<number> {
  const sys = sysOf(ctx);
  const cfg = await csmConfig(tx, ctx);
  const day = todayUtc();
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const accounts = await liveRows(tx, sys, "customer_account", { f: "active", op: "eq", v: true }, { limit: 5000 });
  let n = 0;
  for (const acc of accounts) {
    if (Date.now() > deadline) break;
    const by = { f: "account_id", op: "eq", v: acc.id } as const;
    const cases = await liveRows(tx, sys, "customer_case", { and: [by, { f: "opened_at", op: "gte", v: since }] }, { limit: 5000 });
    const open = await liveRows(tx, sys, "customer_case", { and: [by, { f: "active", op: "eq", v: true }] }, { limit: 5000 });
    const rated = cases.filter((c) => c.satisfaction);
    const timers = cases.length ? await liveRows(tx, sys, "task_sla", { and: [{ f: "table_key", op: "eq", v: "customer_case" }, { f: "record_id", op: "in", v: cases.map((c) => String(c.id)).slice(0, 500) }, { f: "stage", op: "in", v: ["achieved", "breached"] }] }, { limit: 10_000 }) : [];
    const escalations = await liveRows(tx, sys, "case_escalation", { and: [by, { f: "created_at", op: "gte", v: since }] }, { limit: 1000 });
    const last = [...cases].sort((a, b) => String(b.opened_at).localeCompare(String(a.opened_at)))[0];
    const facts: HealthFacts = {
      csat: rated.length ? rated.reduce((s, c) => s + Number(c.satisfaction), 0) / rated.length : null,
      sla_attainment: timers.length ? (timers.filter((t) => t.stage === "achieved").length / timers.length) * 100 : null,
      escalations: escalations.length,
      complaints: cases.filter((c) => c.complaint).length,
      open_cases: open.length,
      aged_cases: open.filter((c) => (msOf(c.opened_at) ?? Date.now()) < Date.now() - 14 * 86_400_000).length,
      days_since_contact: last ? Math.floor((Date.now() - (msOf(last.opened_at) ?? Date.now())) / 86_400_000) : null,
    };
    const h = healthOf(facts, { green: cfg.health_green, amber: cfg.health_amber });
    await updateIn(tx, sys, "customer_account", String(acc.id), { health_score: h.score, health_status: h.status, churn_risk: h.churn, health_factors: h.factors, health_at: new Date().toISOString(), open_cases: open.length }, { trusted: true, keepVersion: true });
    const [snap] = await liveRows(tx, sys, "account_health", { and: [by, { f: "day", op: "eq", v: day }] }, { limit: 1 });
    const values = { score: h.score, status: h.status, csat: facts.csat === null ? null : new Decimal(facts.csat).toDecimalPlaces(2).toString(), sla_attainment: facts.sla_attainment === null ? null : new Decimal(facts.sla_attainment).toDecimalPlaces(1).toString(), open_cases: open.length, escalations: escalations.length, complaints: facts.complaints, factors: h.factors };
    if (snap) await updateIn(tx, sys, "account_health", String(snap.id), values, { trusted: true });
    else await createIn(tx, sys, "account_health", { account_id: acc.id, day, ...values }, { trusted: true });
    n++;
  }
  return n;
}

/** Resolved cases nobody confirmed close after the configured days. */
export async function autoCloseIn(tx: Tx, ctx: Ctx): Promise<number> {
  const sys = sysOf(ctx);
  const cfg = await csmConfig(tx, ctx);
  const before = new Date(Date.now() - Math.max(1, cfg.auto_close_days) * 86_400_000).toISOString();
  const rows = await liveRows(tx, sys, "customer_case", { and: [{ f: "state", op: "eq", v: "resolved" }, { f: "resolved_at", op: "lt", v: before }] }, { limit: 500 });
  for (const r of rows) {
    await transitionIn(tx, sys, "customer_case", String(r.id), "closed", {}, { trusted: true });
    await addJournalIn(tx, sys, tableDef("customer_case")!, r, { kind: "system", body: `پس از ${cfg.auto_close_days} روز بی‌پاسخ مشتری، پرونده بسته شد` }, { trusted: true });
  }
  return rows.length;
}

/** The CSM dashboard (CSM-043): volumes, backlog and quality, as the caller reads cases. */
export async function csmDashboard(ctx: Ctx): Promise<Row> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const by = async (field: string, filter: Row | null = null) =>
    safe(async () => (await aggregate(ctx, "customer_case", { filter: (filter ?? { f: "opened_at", op: "gte", v: since }) as never, groupBy: [field], metrics: [{ fn: "count" }] })).rows.map((r) => ({ key: r.keys[0], label: r.labels[0], count: Number(r.values.count ?? 0) })), []);
  const open = await by("state", { f: "active", op: "eq", v: true });
  const states = CUSTOMER_CASE_STATES.states;
  const count = async (filter: Row) => safe(async () => (await list(ctx, "customer_case", { filter: filter as never, size: 1, fields: ["number"] })).total ?? 0, 0);
  const [created, resolved, accepted, complaints, breached, csat] = await Promise.all([
    count({ f: "opened_at", op: "gte", v: since }),
    count({ f: "resolved_at", op: "gte", v: since }),
    count({ and: [{ f: "resolved_at", op: "gte", v: since }, { f: "resolution_accepted", op: "eq", v: true }] }),
    count({ and: [{ f: "opened_at", op: "gte", v: since }, { f: "complaint", op: "eq", v: true }] }),
    count({ and: [{ f: "active", op: "eq", v: true }, { f: "sla_due", op: "lt", v: new Date().toISOString() }] }),
    safe(async () => {
      const a = await aggregate(ctx, "customer_case", { filter: { and: [{ f: "resolved_at", op: "gte", v: since }, { f: "satisfaction", op: "nempty" }] }, metrics: [{ fn: "avg", field: "satisfaction" }] });
      return a.totals?.["avg:satisfaction"] ?? null;
    }, null as unknown),
  ]);
  return {
    open: open.map((x) => ({ ...x, label: states.find((s) => s.value === x.key)?.label ?? x.label })),
    by_type: await by("case_type"), by_channel: await by("channel"), by_product: await by("product_id"), by_account: await by("account_id"),
    created_30d: created, resolved_30d: resolved, acceptance: resolved ? Math.round((accepted / resolved) * 1000) / 10 : null, complaints_30d: complaints, breached_open: breached,
    csat: csat === null || csat === undefined ? null : Number(csat),
  };
}
