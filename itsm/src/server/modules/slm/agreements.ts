// Agreement services of service level management: the agreement 360 (live compliance of every target in the current
// review period, its trend, breaches, experience and the watermelon flag, the multi-level tree, reviews, credits and
// improvements), the SLM overview, the agreement document and the customer's acceptance (SLM-055), agreements from
// templates (SLM-003), targets from the offerings' commitments (the portfolio's generated definitions, never
// duplicated), manual period values (SLM-007) and the target recommendation with its what-if replay (SLM-052).
import type { Agreement360, Recommendation, SlmOverview, TargetLive } from "@shared/slm/api";
import { AGREEMENT_IN_FORCE, CUSTOMER_KINDS } from "@shared/tables/slm";
import { agreementDocument, compliancePct, inForce, num, PRIORITY_KEYS, recommendHours, simulateBreaches, periodOf, type ComplianceStatus } from "@shared/slm/logic";
import { diffDays, formatJalali, addDays } from "@shared/jalali";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { pgArray } from "../../db";
import { access } from "../../access/provider";
import { condEnv, createIn, defFor, get, list, orgSchema, readable, transitionIn, updateIn, addJournalIn } from "../../engine";
import { forbidden, conflict, notFound } from "../../http/errors";
import { countRows, isUuid, liveRow, liveRows, managesSlm, readsSlm, slmConfig, sysOf, todayOf, type Row } from "./common";
import { definitionsOf, durationsOf } from "./definitions";
import { agreementPeriod, measureAgreementIn, storeMeasures, windowOf } from "./measure";
import { breachBreakdown } from "./review";

const A = "service_agreement";

/** The 360 view of an agreement (the caller must read it; targets need the `sla` area). */
export async function agreement360(ctx: Ctx, id: string): Promise<Agreement360> {
  const r = await get(ctx, A, id);
  const sys = sysOf(ctx);
  const raw = await liveRow(ctx.db, sys, A, id);
  if (!raw) throw notFound();
  const reads = await readsSlm(ctx);
  const cfg = await slmConfig(ctx.db, sys);
  const today = todayOf(ctx);
  const period = agreementPeriod(raw, today);
  let targets: TargetLive[] | null = null;
  let overall: Agreement360["overall"] = { value: null, status: "no_data" };
  let experience: Agreement360["experience"] = null;
  let melon: Agreement360["watermelon"] = { gap: null, flagged: false };
  let breaches: Agreement360["breaches"] = [];
  if (reads) {
    const m = await measureAgreementIn(ctx.db, ctx, raw, period);
    const stored = await liveRows(ctx.db, sys, "slm_compliance", { f: "agreement_id", op: "eq", v: id }, { order: "t.period_key desc", limit: 200 });
    targets = m.targets.map(({ target: t, measure: x }) => ({
      id: String(t.id), name: String(t.name), kind: String(t.kind), metric_category: String(t.metric_category ?? "warranty"), customer_facing: t.customer_facing !== false,
      definition_id: isUuid(t.definition_id) ? String(t.definition_id) : null, goal: x.goal, at_risk: x.at_risk, value: x.value, status: x.status,
      total: x.total, met: x.met, breached: x.breached, excluded: x.excluded, over_limit: x.over_limit,
      trend: stored.filter((s) => s.target_id === t.id && s.period_key !== period.key).slice(0, 5).reverse()
        .map((s) => ({ key: String(s.period_key), label: String(s.period_label ?? s.period_key), value: num(s.value), status: (s.status ?? "no_data") as ComplianceStatus, final: !!s.final }))
        .concat([{ key: period.key, label: period.label, value: x.value, status: x.status, final: false }]),
    }));
    overall = { value: m.overall, status: m.status };
    experience = m.experience;
    melon = m.watermelon;
    breaches = await breachBreakdown(ctx.db, ctx, (await definitionsOf(ctx.db, sys, id)).map((d) => d.definition_id), windowOf(ctx, period));
  }
  const safeList = async (table: string, filter: Row, fields: string[], sort: string, size = 20): Promise<Row[]> => {
    try {
      return (await list(ctx, table, { filter: filter as never, fields, sort, size, total: false })).rows;
    } catch {
      return [];
    }
  };
  const children = await safeList(A, { f: "parent_agreement_id", op: "eq", v: id }, ["number", "name", "kind", "state", "compliance_status"], "name", 50);
  const reviews = await safeList("slm_review", { f: "agreement_id", op: "eq", v: id }, ["number", "title", "state", "scheduled_at"], "-scheduled_at", 10);
  const credits = await safeList("slm_credit", { f: "agreement_id", op: "eq", v: id }, ["number", "period_label", "credit_pct", "amount", "state"], "-period_key", 12);
  const nowIso = new Date().toISOString();
  const openImp = reads ? await countRows(ctx.db, ctx, "slm_improvement", { and: [{ f: "agreement_id", op: "eq", v: id }, { f: "state", op: "in", v: ["proposed", "approved", "in_progress"] }] }) : 0;
  const overdueImp = reads ? await countRows(ctx.db, ctx, "slm_improvement", { and: [{ f: "agreement_id", op: "eq", v: id }, { f: "state", op: "in", v: ["proposed", "approved", "in_progress"] }, { f: "due_at", op: "lt", v: nowIso }] }) : 0;
  const force = inForce(raw.state);
  const daysLeft = raw.valid_to ? diffDays(String(raw.valid_to).slice(0, 10), today) : null;
  const me = ctx.user.id;
  const canWrite = !!r.meta.canWrite;
  const hasExperience = (targets ?? []).some((t) => t.kind === "experience" || t.kind === "satisfaction");
  return {
    agreement: r.row,
    display: r.display,
    period: { key: period.key, label: period.label, start: period.start, end: period.end },
    targets,
    overall,
    experience,
    watermelon: melon,
    breaches,
    children: children.map((c) => ({ id: String(c.id), number: c.number ?? null, name: String(c.name ?? ""), kind: String(c.kind ?? ""), state: String(c.state ?? ""), compliance_status: c.compliance_status ?? null })),
    reviews: reviews.map((x) => ({ id: String(x.id), number: x.number ?? null, title: String(x.title ?? ""), state: String(x.state ?? ""), scheduled_at: x.scheduled_at ?? null })),
    credits: credits.map((x) => ({ id: String(x.id), number: x.number ?? null, period_label: x.period_label ?? null, credit_pct: x.credit_pct ?? null, amount: x.amount ?? null, state: String(x.state ?? "") })),
    improvements: { open: openImp, overdue: overdueImp },
    flags: {
      review_overdue: force && !!raw.next_review_at && String(raw.next_review_at) < today,
      expiring_days: force && daysLeft !== null && daysLeft <= cfg.expiry_reminder_days ? daysLeft : null,
      in_force: force,
      no_experience_target: reads && CUSTOMER_KINDS.includes(String(raw.kind)) && !hasExperience,
    },
    can: {
      write: canWrite,
      manage: await managesSlm(ctx.db, ctx),
      accept: !raw.accepted_at && (raw.customer_contact_id === me || canWrite) && ["enablement", ...AGREEMENT_IN_FORCE].includes(String(raw.state)),
      transitions: (r.meta.transitions ?? []).map((t: { to: string; label: string }) => ({ to: t.to, label: t.label })),
    },
  };
}

/** Measure an agreement now (the caller must be able to change it, or manage service levels). */
export async function measureNow(ctx: Ctx, id: string) {
  const r = await get(ctx, A, id);
  if (!r.meta.canWrite && !(await managesSlm(ctx.db, ctx))) throw forbidden("سنجش دوباره با مالک توافق یا مدیر سطح خدمت است");
  const sys = sysOf(ctx);
  const m = await sys.write((tx) => storeMeasures(tx, sys, id));
  return { overall: m?.overall ?? null, status: m?.status ?? "no_data", period: m?.period.label ?? null };
}

/** The SLM overview of the agreements the caller reads. */
export async function slmOverview(ctx: Ctx): Promise<SlmOverview> {
  const rows = (await list(ctx, A, { fields: ["number", "name", "kind", "state", "compliance_status", "watermelon", "next_review_at", "valid_to", "review_overdue"], size: 500, total: false })).rows;
  const cfg = await slmConfig(ctx.db, sysOf(ctx));
  const today = todayOf(ctx);
  const byKind: Record<string, number> = {};
  const byStatus: Record<ComplianceStatus, number> = { met: 0, at_risk: 0, missed: 0, no_data: 0 };
  const attention: SlmOverview["attention"] = [];
  let inForceN = 0;
  for (const a of rows) {
    byKind[a.kind ?? "sla"] = (byKind[a.kind ?? "sla"] ?? 0) + 1;
    if (!inForce(a.state)) continue;
    inForceN++;
    const st = (a.compliance_status ?? "no_data") as ComplianceStatus;
    byStatus[st] = (byStatus[st] ?? 0) + 1;
    const base = { id: String(a.id), number: a.number ?? null, name: String(a.name ?? ""), kind: String(a.kind ?? "sla") };
    if (st === "missed") attention.push({ ...base, reason: "هدف انطباق دورهٔ جاری برآورده نشده است", tone: "danger" });
    else if (st === "at_risk") attention.push({ ...base, reason: "انطباق دورهٔ جاری در خطر است", tone: "warning" });
    if (a.watermelon) attention.push({ ...base, reason: "توافق سبز است اما تجربهٔ کاربران پایین است", tone: "warning" });
    if (a.next_review_at && String(a.next_review_at) < today) attention.push({ ...base, reason: `بازبینی از ${formatJalali(String(a.next_review_at))} عقب افتاده است`, tone: "info" });
    const left = a.valid_to ? diffDays(String(a.valid_to).slice(0, 10), today) : null;
    if (left !== null && left <= cfg.expiry_reminder_days) attention.push({ ...base, reason: left < 0 ? "اعتبار توافق گذشته است" : `${left === 0 ? "امروز" : `${left} روز دیگر`} اعتبار توافق تمام می‌شود`, tone: "warning" });
  }
  const tone = { danger: 0, warning: 1, info: 2 } as const;
  attention.sort((a, b) => tone[a.tone] - tone[b.tone]);
  const safe = async <T>(fn: () => Promise<T>, d: T): Promise<T> => {
    try {
      return await fn();
    } catch {
      return d;
    }
  };
  const reviewsDue = await safe(async () => (await list(ctx, "slm_review", { filter: { f: "state", op: "in", v: ["scheduled", "prepared", "held", "actions_open"] }, fields: ["number", "title", "scheduled_at", "state"], sort: "scheduled_at", size: 10, total: false })).rows, [] as Row[]);
  const nowIso = new Date().toISOString();
  const month = periodOf(today, "month");
  const w = windowOf(ctx, month);
  const reads = await readsSlm(ctx);
  const openImp = reads ? await countRows(ctx.db, ctx, "slm_improvement", { f: "state", op: "in", v: ["proposed", "approved", "in_progress"] }) : 0;
  const overdueImp = reads ? await countRows(ctx.db, ctx, "slm_improvement", { and: [{ f: "state", op: "in", v: ["proposed", "approved", "in_progress"] }, { f: "due_at", op: "lt", v: nowIso }] }) : 0;
  const doneImp = reads ? await countRows(ctx.db, ctx, "slm_improvement", { and: [{ f: "state", op: "in", v: ["done", "closed"] }, { f: "updated_at", op: "gte", v: w.from }] }) : 0;
  const met = reads ? await countRows(ctx.db, ctx, "task_sla", { and: [{ f: "stage", op: "eq", v: "achieved" }, { f: "stop_at", op: "gte", v: w.from }, { f: "stop_at", op: "lt", v: w.to }] }) : 0;
  const breached = reads ? await countRows(ctx.db, ctx, "task_sla", { and: [{ f: "breached", op: "eq", v: true }, { f: "breached_at", op: "gte", v: w.from }, { f: "breached_at", op: "lt", v: w.to }] }) : 0;
  const finishedBreached = reads ? await countRows(ctx.db, ctx, "task_sla", { and: [{ f: "stage", op: "eq", v: "breached" }, { f: "stop_at", op: "gte", v: w.from }, { f: "stop_at", op: "lt", v: w.to }] }) : 0;
  return {
    agreements: { total: rows.length, in_force: inForceN, by_kind: byKind, by_status: byStatus },
    attention: attention.slice(0, 20),
    reviews_due: reviewsDue.map((x) => ({ id: String(x.id), number: x.number ?? null, title: String(x.title ?? ""), scheduled_at: x.scheduled_at ?? null, state: String(x.state ?? "") })),
    improvements: { open: openImp, overdue: overdueImp, done_month: doneImp },
    breaches_month: breached,
    attainment_month: compliancePct(met, finishedBreached),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The document and the customer's acceptance

export async function documentOf(ctx: Ctx, id: string, opts: { customer?: boolean } = {}): Promise<{ markdown: string; customer_view: boolean }> {
  const r = await get(ctx, A, id);
  const sys = sysOf(ctx);
  const raw = (await liveRow(ctx.db, sys, A, id))!;
  const reads = await readsSlm(ctx);
  const customerView = !!opts.customer || !reads;
  const targets = await liveRows(ctx.db, sys, "slm_target", { f: "agreement_id", op: "eq", v: id }, { order: "t.sort_order, t.name" });
  const d = r.display;
  const name = (v: unknown) => (isUuid(v) ? d[String(v)] ?? null : null);
  // financial and internal fields stay with those who see them: the document is built from the row the caller reads
  const visible = { ...raw, ...r.row, terms: r.row.terms ?? null };
  const calendar = isUuid(raw.calendar_id) ? String((await liveRow(ctx.db, sys, "calendar", raw.calendar_id))?.name ?? "") || null : null;
  return {
    markdown: agreementDocument({
      agreement: visible,
      targets: customerView && !CUSTOMER_KINDS.includes(String(raw.kind)) ? [] : targets,
      names: { service: name(raw.service_id), customer: name(raw.customer_unit_id), provider: name(raw.provider_group_id), owner: name(raw.manager_id), calendar, parent: name(raw.parent_agreement_id) },
      customerView,
    }),
    customer_view: customerView,
  };
}

/** The customer's representative (or whoever may change the agreement) records the customer's acceptance. */
export async function acceptAgreement(ctx: Ctx, id: string, note?: string | null): Promise<Row> {
  const r = await get(ctx, A, id);
  const sys = sysOf(ctx);
  const raw = (await liveRow(ctx.db, sys, A, id))!;
  if (raw.customer_contact_id !== ctx.user.id && !r.meta.canWrite) throw forbidden("پذیرش توافق با نمایندهٔ مشتری یا مالک توافق است");
  if (raw.accepted_at) throw conflict("پذیرش این توافق پیش‌تر ثبت شده است");
  if (!["enablement", ...AGREEMENT_IN_FORCE].includes(String(raw.state))) throw conflict("پذیرش پس از تأیید توافق ثبت می‌شود");
  const actor = sysOf(ctx, ctx.user.id);
  return actor.write(async (tx) => {
    const row = await updateIn(tx, actor, A, id, { accepted_at: new Date().toISOString(), accepted_by: ctx.user.id }, { trusted: true, allowLocked: true });
    await addJournalIn(tx, actor, (await defFor(actor, A, tx)).def, row, { kind: "work_note", body: `پذیرش توافق از سوی مشتری ثبت شد${note ? `: ${note}` : "."}` }, { trusted: true });
    return row;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Templates and commitments

export interface FromTemplateInput {
  template_id: string;
  name: string;
  service_id: string;
  customer_unit_id: string;
  valid_from?: string | null;
  valid_to?: string | null;
  manager_id?: string | null;
  provider_group_id?: string | null;
  supplier_name?: string | null;
  offerings?: string[];
}

/** A new agreement (requirements) with the template's document and targets, created as the caller. */
export async function fromTemplate(ctx: Ctx, input: FromTemplateInput): Promise<Row> {
  const sys = sysOf(ctx);
  const tpl = await liveRow(ctx.db, ctx, "slm_template", input.template_id);
  if (!tpl) throw notFound("الگو پیدا نشد");
  const lines = await liveRows(ctx.db, sys, "slm_template_target", { f: "template_id", op: "eq", v: tpl.id }, { order: "t.sort_order, t.name" });
  const { def: tdef } = await defFor(ctx, "slm_target");
  if (lines.length && !access().canCreate(ctx, tdef, null)) throw forbidden("ساختن اهداف توافق به دسترسی ایجاد در «توافق سطح خدمت» نیاز دارد");
  return ctx.write(async (tx) => {
    const a = await createIn(tx, ctx, A, {
      name: input.name, service_id: input.service_id, customer_unit_id: input.customer_unit_id, offerings: input.offerings ?? [],
      valid_from: input.valid_from ?? todayOf(ctx), valid_to: input.valid_to ?? null, manager_id: input.manager_id ?? ctx.user.id,
      kind: tpl.kind, provider_group_id: input.provider_group_id ?? null, supplier_name: input.supplier_name ?? null,
      compliance_target: tpl.compliance_target, at_risk_target: tpl.at_risk_target, review_period: tpl.review_period, review_months: tpl.review_months,
      terms: tpl.terms, service_hours: tpl.service_hours, responsibilities: tpl.responsibilities, escalation: tpl.escalation, exclusions: tpl.exclusions,
    });
    await updateIn(tx, sys, A, String(a.id), { template_id: tpl.id }, { trusted: true, keepVersion: true });
    for (const l of lines) {
      const hours: Row = {};
      for (const p of PRIORITY_KEYS) hours[`p${p}_hours`] = l[`p${p}_hours`] ?? null;
      await createIn(tx, ctx, "slm_target", {
        agreement_id: a.id, name: l.name, kind: l.kind, metric_category: l.metric_category, goal: l.goal, at_risk: l.at_risk, customer_facing: l.customer_facing,
        xla_clause: l.xla_clause, sort_order: l.sort_order, table_key: l.table_key, timer_target: l.timer_target, credit_tiers: l.credit_tiers ?? null, credit_cap_pct: l.credit_cap_pct ?? null, ...hours,
      });
    }
    return a;
  });
}

/** Link the timers the offerings' commitments generated as targets of the agreement (never duplicated). */
export async function linkCommitments(ctx: Ctx, id: string): Promise<{ added: number }> {
  const r = await get(ctx, A, id);
  if (!r.meta.canWrite && !(await managesSlm(ctx.db, ctx))) throw forbidden("افزودن اهداف با مالک توافق یا مدیر سطح خدمت است");
  const sys = sysOf(ctx);
  const raw = (await liveRow(ctx.db, sys, A, id))!;
  const offerings = Array.isArray(raw.offerings) && raw.offerings.length
    ? raw.offerings.filter(isUuid)
    : (await liveRows(ctx.db, sys, "service_offering", { f: "service_id", op: "eq", v: raw.service_id })).map((o) => String(o.id));
  if (!offerings.length) return { added: 0 };
  const commitments = (await liveRows(ctx.db, sys, "service_commitment", { and: [{ f: "offering_id", op: "in", v: offerings }, { f: "active", op: "eq", v: true }] })).filter((c) => isUuid(c.sla_definition_id));
  const existing = new Set((await liveRows(ctx.db, sys, "slm_target", { f: "agreement_id", op: "eq", v: id })).map((t) => String(t.definition_id ?? "")));
  let added = 0;
  await ctx.write(async (tx) => {
    for (const c of commitments) {
      if (existing.has(String(c.sla_definition_id))) continue;
      await createIn(tx, ctx, "slm_target", { agreement_id: id, name: String(c.label ?? "تعهد").slice(0, 160), kind: "timer", metric_category: "warranty", definition_id: c.sla_definition_id, sort_order: 50 + added });
      added++;
    }
  });
  return { added };
}

/** A manual value of a target for a period (SLM-007: compliance computed elsewhere). */
export async function setManualValue(ctx: Ctx, targetId: string, value: number): Promise<void> {
  const { def } = await defFor(ctx, "slm_target");
  const t = await liveRow(ctx.db, ctx, "slm_target", targetId);
  if (!t) throw notFound("هدف پیدا نشد");
  if (!access().canWrite(ctx, def, t)) throw forbidden("ثبت مقدار با کسانی است که اهداف توافق را تغییر می‌دهند");
  if (t.kind !== "manual") throw conflict("فقط هدف «ثبت دستی» مقدار دستی می‌گیرد");
  const sys = sysOf(ctx);
  const a = (await liveRow(ctx.db, sys, A, t.agreement_id))!;
  const p = agreementPeriod(a, todayOf(ctx));
  await sys.write(async (tx) => {
    const [row] = await liveRows(tx, sys, "slm_compliance", { and: [{ f: "target_id", op: "eq", v: targetId }, { f: "period_key", op: "eq", v: p.key }] }, { limit: 1 });
    const values = { agreement_id: a.id, target_id: targetId, period_key: p.key, period_label: p.label, period_start: p.start, period_end: p.end, total: 1, value, goal: num(t.goal), computed_at: new Date().toISOString() };
    if (row) await updateIn(tx, sys, "slm_compliance", row.id, values, { trusted: true });
    else await createIn(tx, sys, "slm_compliance", values, { trusted: true });
    await storeMeasures(tx, sys, String(a.id));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Target recommendation and what-if (SLM-052)

/** Business seconds of finished timers per priority of the record (system read; counts and durations only). */
async function samplesOf(q: Queryable, ctx: Ctx, table: string, where: { definition?: string; target?: string }, from: string): Promise<Record<string, number[]>> {
  const tdef = tableDef(table);
  const out: Record<string, number[]> = {};
  if (!tdef || tdef.virtual || !tdef.fields.some((f) => f.name === "priority")) return out;
  const sys = sysOf(ctx);
  const schema = await orgSchema(sys, q);
  const sdef = schema.def("task_sla")!;
  const params: unknown[] = [];
  const env = await condEnv(sys);
  const w1 = readable(sys, sdef, "s", params, env);
  const w2 = readable(sys, tdef, "r", params, env);
  params.push(table);
  const iTable = params.length;
  params.push(from);
  const iFrom = params.length;
  let extra = "";
  if (where.definition) {
    params.push(where.definition);
    extra = ` and s.definition_id = $${params.length}::uuid`;
  } else if (where.target) {
    params.push(where.target);
    extra = ` and s.target = $${params.length}`;
  }
  const rows = await q.query<{ priority: string | null; elapsed: string | number | null }>(
    `select r.priority as priority, s.business_elapsed as elapsed from ${sdef.table} s join ${tdef.table} r on r.id::text = s.record_id and r.org_id = s.org_id
      where ${w1} and ${w2} and s.deleted_at is null and r.deleted_at is null and s.table_key = $${iTable} and s.stage in ('achieved','breached')
        and s.stop_at >= $${iFrom}::timestamptz${extra} limit 20000`,
    params,
  );
  for (const r of rows) {
    const p = String(r.priority ?? "");
    const v = Number(r.elapsed);
    if (!p || !Number.isFinite(v)) continue;
    (out[p] ??= []).push(v);
  }
  return out;
}

export async function recommend(ctx: Ctx, targetId: string, opts: { percentile?: number; proposed?: Record<string, number | null> } = {}): Promise<Recommendation> {
  const t = await liveRow(ctx.db, ctx, "slm_target", targetId);
  if (!t) throw notFound("هدف پیدا نشد");
  if (t.kind !== "timer") throw conflict("پیشنهاد هدف فقط برای زمان‌سنج‌ها است");
  const sys = sysOf(ctx);
  const d = isUuid(t.definition_id) ? await liveRow(ctx.db, sys, "sla_definition", t.definition_id) : null;
  const table = String(d?.table_key ?? t.table_key ?? "incident");
  const target = String(d?.target ?? t.timer_target ?? "resolution");
  const today = todayOf(ctx);
  const fromDate = addDays(today, -90);
  const from = windowOf(ctx, { start: fromDate, end: today }).from;
  let samples = d ? await samplesOf(ctx.db, ctx, table, { definition: String(d.id) }, from) : {};
  const n = Object.values(samples).reduce((a, xs) => a + xs.length, 0);
  if (n < 20) samples = await samplesOf(ctx.db, ctx, table, { target }, from);
  const p = Math.min(99, Math.max(50, opts.percentile ?? 85));
  const recommended = recommendHours(samples, p);
  const durations = t.generated || !d ? durationsOf(t) : ((d.durations ?? {}) as Record<string, number>);
  const current: Record<string, number | null> = {};
  for (const k of PRIORITY_KEYS) current[k] = durations[k] ? Math.round((Number(durations[k]) / 3600) * 100) / 100 : null;
  const recHours: Record<string, number | null> = {};
  for (const k of PRIORITY_KEYS) recHours[k] = recommended[k].hours;
  return {
    table,
    target,
    window: { from: fromDate, to: today, label: `${formatJalali(fromDate)} تا ${formatJalali(today)}` },
    percentile: p,
    current,
    recommended,
    simulation: {
      current: simulateBreaches(samples, current),
      recommended: simulateBreaches(samples, recHours),
      ...(opts.proposed ? { proposed: simulateBreaches(samples, opts.proposed) } : {}),
    },
  };
}

/** Move an agreement on its lifecycle for a person (the engine checks the transition, roles and guards). */
export async function moveAgreement(ctx: Ctx, id: string, to: string, data: Row = {}): Promise<Row> {
  return ctx.write((tx) => transitionIn(tx, ctx, A, id, to, data));
}

export { pgArray };
