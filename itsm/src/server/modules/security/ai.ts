// The security module's AI skills (docs/spec/AI.md §11; catalogue SEC-004, SEC-010, SEC-023, SEC-035, SEC-039,
// SEC-046), each with a rule-based fallback so the screens never depend on a model:
//   security.incident_summary   a security incident summarised for the CISO (status, impact, times, indicators,
//                               actions, regulatory clocks, open questions, next steps) — facts computed in code
//   security.vuln_plan          a remediation plan draft for a remediation group or a vulnerable item (solution,
//                               order by risk and due date, change, verification by rescan, exceptions)
//   security.evidence_summary   a control's evidence and tests summarised for an auditor, with the gaps
//   security.policy_qa          a question answered from the published policies the caller reads (cited)
//   security.observable_verdict a verdict for an observable from its threat-indicator matches and sightings
//   security.reg_impact         the impact of a regulatory change on the requirements, controls and policies
//   security.risk_summary       a risk's summary for its owner
// Every skill reads with the caller's context (a security incident only inside the secure workspace, a record of
// another area only with that area's grant); records classified «سری» or above the organisation's AI ceiling never
// reach a model (the AI-channel rules in rag.ts). Numbers come from code; the model narrates.
import { z } from "zod";
import { tableDef } from "@shared/tables";
import { CONTAINMENT_ACTIONS, SEVERITIES, SIR_CATEGORIES, SIR_STATES } from "@shared/tables/security";
import { cvesIn } from "@shared/security/logic";
import type { Ctx } from "../../context";
import { get, list } from "../../engine";
import { access } from "../../access/provider";
import { forbidden } from "../../http/errors";
import { defineSkill, registerSkill } from "../ai/skills/registry";
import type { SkillDef, SkillRuntimeInput } from "../ai/skills/types";
import { ids, isUuid, liveRows, type Row } from "./common";
import { incidentFacts } from "./ops";
import { crosswalk } from "./grc";

const label = (opts: { value: string; label: string }[], v: unknown) => opts.find((o) => o.value === v)?.label ?? (v === null || v === undefined || v === "" ? "—" : String(v));
const hours = (s: unknown) => (s === null || s === undefined ? "—" : `${Math.round((Number(s) / 3600) * 10) / 10} ساعت`);
const rowOf = (input: SkillRuntimeInput): Row => (input.record?.row ?? {}) as Row;

// ---------------------------------------------------------------------------------------------------------------
// Facts (computed with the caller's access)

async function sirFacts(ctx: Ctx, id: string) {
  const f = await incidentFacts(ctx, id);
  const tasks = await liveRows(ctx.db, ctx, "sec_task", { f: "sec_incident_id", op: "eq", v: id }, { order: "t.sort_order, t.no", limit: 60 });
  return {
    times: { detect: hours(f.times.detect), contain: hours(f.times.contain), recover: hours(f.times.recover) },
    observables: f.observables.slice(0, 30).map((o) => ({ type: o.type, value: o.value, verdict: o.verdict, ioc: o.is_ioc, sightings: o.sightings })),
    clocks: f.clocks.map((c) => ({ number: c.number, state: c.state, next_stage: c.next_stage, next_due_at: c.next_due_at, overdue: c.overdue })),
    tasks: tasks.map((t) => ({ number: t.number, title: t.short_description, phase: t.phase, state: t.state, action: label(CONTAINMENT_ACTIONS, t.action), approval: t.approval })),
  };
}

function sirRuleSummary(input: SkillRuntimeInput, facts: Awaited<ReturnType<typeof sirFacts>>): string {
  const r = rowOf(input);
  const open = facts.tasks.filter((t) => !["closed_complete", "closed_incomplete", "canceled"].includes(String(t.state)));
  const malicious = facts.observables.filter((o) => o.verdict === "malicious" || o.ioc);
  const lines = [
    `## ${input.record?.number ?? ""} — ${r.short_description ?? ""}`,
    `- وضعیت: ${label(SIR_STATES.states, r.state)} · دسته: ${label(SIR_CATEGORIES, r.category)} · شدت: ${label(SEVERITIES, r.severity)} · امتیاز ریسک: ${r.risk_score ?? "—"}`,
    `- زمان تا کشف: ${facts.times.detect} · تا مهار: ${facts.times.contain} · تا بازیابی: ${facts.times.recover}`,
    `- نقض دادهٔ شخصی: ${r.personal_data_breach ? "بله" : "خیر"}${r.records_affected ? ` · رکوردهای متأثر: ${r.records_affected}` : ""}`,
    `- نشانگرها: ${facts.observables.length} مورد${malicious.length ? `، ${malicious.length} مخرب یا نشانگر تهدید` : ""}`,
  ];
  if (facts.clocks.length) lines.push(`- اطلاع‌رسانی الزامی: ${facts.clocks.map((c) => `${c.number} (${c.overdue ? "با دیرکرد" : c.next_stage ?? c.state})`).join("، ")}`);
  lines.push("", "### گام‌های بعد");
  lines.push(...(open.length ? open.slice(0, 8).map((t) => `- ${t.number} ${t.title}${t.approval === "requested" ? " (منتظر تأیید)" : ""}`) : ["- همهٔ کارهای پاسخ انجام شده است؛ بازبینی پس از رخداد و درس‌آموخته‌ها را کامل کنید."]));
  return lines.join("\n");
}

async function planFacts(ctx: Ctx, input: SkillRuntimeInput) {
  const r = rowOf(input);
  const isGroup = input.table === "sec_vuln_remediation";
  const items = isGroup
    ? await liveRows(ctx.db, ctx, "sec_vuln_item", { f: "remediation_id", op: "eq", v: input.id }, { order: "t.risk_score desc nulls last, t.due_at", limit: 100 })
    : [r];
  const vulnId = isGroup ? r.vulnerability_id : r.vulnerability_id;
  const v = isUuid(vulnId) ? ((await get(ctx, "sec_vulnerability", String(vulnId)).catch(() => null))?.row as Row | undefined) : undefined;
  const display = input.record?.display ?? {};
  return {
    vulnerability: v ? { id: v.cve_id, title: v.title, cvss: v.cvss_score, epss: v.epss, kev: v.kev, kev_due: v.kev_due, exploit: v.exploit_maturity, fixed_versions: v.fixed_versions, solution: typeof v.solution === "string" ? v.solution.slice(0, 4000) : null } : null,
    items: items.slice(0, 60).map((i) => ({ number: i.number, ci: display[String(i.ci_id)] ?? i.host ?? null, host: i.host ?? null, rating: i.risk_rating, score: i.risk_score, due_at: i.due_at, state: i.state, kev: !!i.kev })),
  };
}

function planRule(f: Awaited<ReturnType<typeof planFacts>>): string {
  const v = f.vulnerability;
  const open = f.items.filter((i) => i.state === "open" || i.state === "in_remediation");
  const lines = [
    `## برنامهٔ رفع ${v?.id ?? ""}`,
    v ? `- ${v.title ?? ""} — CVSS ${v.cvss ?? "—"}${v.kev ? ` · در فهرست KEV (موعد ${v.kev_due ?? "—"})` : ""}${v.epss ? ` · EPSS ${v.epss}` : ""}` : "",
    "",
    "### گام‌ها",
    "1. نسخه‌ها و دامنهٔ اثر را روی هر دارایی بررسی کنید" + (v?.fixed_versions ? ` (نسخه‌های رفع‌شده: ${v.fixed_versions})` : "") + ".",
    `2. راه‌حل: ${v?.solution ? String(v.solution).split("\n")[0].slice(0, 300) : "وصله یا پیکربندی پیشنهادی سازنده را به کار ببرید"}.`,
    "3. دارایی‌ها را به ترتیب ریسک و موعد رفع کنید:",
    ...open.slice(0, 15).map((i) => `   - ${i.number} ${i.ci ?? i.host ?? ""} — ${i.rating ?? ""} (${i.score ?? "—"})، موعد ${i.due_at ? String(i.due_at).slice(0, 10) : "—"}`),
    "4. برای دارایی‌های عملیاتی یک «تغییر» با پنجرهٔ نگهداری ثبت کنید و برنامهٔ بازگشت داشته باشید.",
    "5. پس از اجرا پویش دوباره بگیرید؛ موردهایی که دیده نشوند خودکار رفع‌شده و سپس تأییدشده می‌شوند.",
    "6. اگر رفع پیش از موعد ممکن نیست، «استثنا» با کنترل جبرانی و تاریخ انقضا درخواست کنید.",
  ];
  return lines.filter((l) => l !== "").join("\n");
}

async function evidenceFacts(ctx: Ctx, id: string) {
  const ctl = (await get(ctx, "grc_control", id)).row as Row;
  const tests = await liveRows(ctx.db, ctx, "grc_control_test", { f: "control_id", op: "eq", v: id }, { order: "t.planned_for desc nulls last", limit: 5 });
  const evidence = await liveRows(ctx.db, ctx, "grc_evidence", { f: "control_id", op: "eq", v: id }, { order: "t.created_at desc", limit: 20 });
  const xwalk = await crosswalk(ctx, id).catch(() => []);
  return {
    control: { name: ctl.name, code: ctl.code, frequency: ctl.frequency, effectiveness: ctl.effectiveness, indicator: ctl.indicator, indicator_value: ctl.indicator_value, indicator_status: ctl.indicator_status, last_tested_at: ctl.last_tested_at, next_test_due: ctl.next_test_due },
    tests: tests.map((t) => ({ number: t.number, kind: t.kind, state: t.state, conclusion: t.conclusion, population: t.population, sample: t.sample_size, exceptions: t.exceptions, evidence_hash: !!t.evidence_hash })),
    evidence: evidence.map((e) => ({ number: e.number, title: e.title, kind: e.kind, state: e.state, period_end: e.period_end, hashed: !!e.sha256 })),
    requirements: xwalk.map((f) => ({ framework: f.framework, codes: f.requirements.map((r) => r.code) })),
  };
}

function evidenceRule(f: Awaited<ReturnType<typeof evidenceFacts>>): string {
  const gaps: string[] = [];
  const accepted = f.evidence.filter((e) => e.state === "accepted");
  if (!accepted.length) gaps.push("هیچ شاهد پذیرفته‌شده‌ای ثبت نشده است");
  if (f.evidence.some((e) => e.state === "rejected")) gaps.push("شاهد ناکافی دارد که باید جایگزین شود");
  if (!f.tests.some((t) => t.state === "completed")) gaps.push("آزمون انجام‌شده‌ای ندارد");
  if (f.tests.some((t) => t.conclusion === "ineffective")) gaps.push("آخرین آزمون‌ها ناکارآمدی نشان داده‌اند");
  if (f.control.indicator_status === "fail") gaps.push("پایش خودکار آن نقض شده است");
  if (f.control.next_test_due && String(f.control.next_test_due) < new Date().toISOString().slice(0, 10)) gaps.push("موعد آزمون بعدی گذشته است");
  return [
    `## شواهد کنترل «${f.control.name}»${f.control.code ? ` (${f.control.code})` : ""}`,
    `- اثربخشی: ${f.control.effectiveness ?? "—"} · پایش خودکار: ${f.control.indicator_status ?? "—"}${f.control.indicator_value ? ` (${f.control.indicator_value})` : ""}`,
    `- الزام‌ها: ${f.requirements.map((r) => `${r.framework}: ${r.codes.join("، ")}`).join(" · ") || "—"}`,
    `- آزمون‌ها: ${f.tests.map((t) => `${t.number} ${t.conclusion ?? t.state}${t.sample ? ` (نمونه ${t.sample}، استثنا ${t.exceptions ?? 0})` : ""}`).join("، ") || "—"}`,
    `- شواهد: ${f.evidence.map((e) => `${e.number} ${e.title} (${e.state}${e.hashed ? "، با هش" : ""})`).join("، ") || "—"}`,
    "",
    gaps.length ? `### کمبودها\n${gaps.map((g) => `- ${g}`).join("\n")}` : "### کمبودها\n- کمبودی دیده نشد.",
  ].join("\n");
}

async function needPolicies(ctx: Ctx) {
  const def = tableDef("grc_policy")!;
  if (ctx.actor !== "system" && !access().canReadTable(ctx, def)) throw forbidden("به خط‌مشی‌ها دسترسی ندارید");
}

function policyRule(input: SkillRuntimeInput): string {
  const q = String(input.text ?? "").trim();
  if (!input.passages.length) return `در خط‌مشی‌های منتشرشده‌ای که می‌بینید پاسخی برای «${q.slice(0, 120)}» پیدا نشد. با مالک خط‌مشی یا تیم امنیت تماس بگیرید.`;
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  const lines = [`آنچه خط‌مشی‌ها دربارهٔ «${q.slice(0, 120)}» می‌گویند:`];
  for (const p of input.passages.slice(0, 5)) {
    const sentences = String(p.text ?? "").split(/(?<=[.!؟?])\s+|\n+/).filter((s) => words.some((w) => s.includes(w))).slice(0, 2);
    lines.push(`- ${(sentences.length ? sentences.join(" ") : String(p.text ?? "").slice(0, 240)).trim()} [${p.n}]`);
  }
  return lines.join("\n");
}

async function observableFacts(ctx: Ctx, input: SkillRuntimeInput) {
  const o = rowOf(input);
  const iocs = await liveRows(ctx.db, ctx, "sec_observable", { and: [{ f: "normalized", op: "eq", v: o.normalized }, { f: "is_ioc", op: "eq", v: true }] }, { limit: 20 });
  return {
    sightings: Number(o.sightings ?? 0),
    incidents: ids(o.incidents).length,
    ioc_matches: iocs.filter((x) => !x.expires_at || Date.parse(String(x.expires_at)) > Date.now()).map((x) => ({ verdict: x.verdict, confidence: x.confidence, source: x.source, tlp: x.tlp })),
    enrichment: o.enrichment ?? null,
  };
}

function observableRule(f: Awaited<ReturnType<typeof observableFacts>>) {
  const bad = f.ioc_matches.find((m) => m.verdict === "malicious");
  const sus = f.ioc_matches.find((m) => m.verdict === "suspicious");
  const verdict = bad ? "malicious" : sus || f.incidents >= 2 ? "suspicious" : "unknown";
  const confidence = bad ? Math.max(70, Number(bad.confidence ?? 70)) : sus ? 55 : f.incidents >= 2 ? 45 : 20;
  const evidence = [bad ? `منطبق با نشانگر تهدید مخرب (${bad.source})` : sus ? `منطبق با نشانگر تهدید مشکوک (${sus.source})` : "منطبق با نشانگر تهدید شناخته‌شده‌ای نیست", `در ${f.incidents} رخداد امنیتی دیده شده است`];
  return { verdict, confidence, evidence };
}

async function regFacts(ctx: Ctx, input: SkillRuntimeInput) {
  const r = rowOf(input);
  const words = `${r.title ?? ""} ${r.summary ?? ""}`.split(/[\s،,.]+/).filter((w) => w.length > 3).slice(0, 6);
  const seen = new Map<string, Row>();
  for (const w of words) {
    const res = await list(ctx, "grc_requirement", { q: w, size: 10, fields: ["code", "title", "framework_id"], total: false }).catch(() => null);
    for (const x of res?.rows ?? []) seen.set(String(x.id), x as Row);
  }
  const cves = cvesIn(r.summary);
  return { candidates: [...seen.values()].slice(0, 30).map((x) => ({ code: x.code, title: x.title })), mapped: ids(r.requirements).length, cves };
}

function regRule(f: Awaited<ReturnType<typeof regFacts>>) {
  const n = f.candidates.length;
  return { impact: n === 0 ? "none" : n > 5 ? "material" : "minor", rationale: n ? `${n} الزام با واژه‌های مشترک پیدا شد؛ ارزیابی کارشناس لازم است` : "الزام مرتبطی پیدا نشد", requirements: f.candidates.slice(0, 10).map((c) => String(c.code)) };
}

// ---------------------------------------------------------------------------------------------------------------

export const securitySkills: SkillDef[] = [
  defineSkill({
    key: "security.incident_summary",
    name: "خلاصهٔ رخداد امنیتی برای مدیر امنیت",
    description: "وضعیت، اثر، زمان‌های کشف و مهار، نشانگرها، اقدام‌ها، ساعت‌های الزامی، پرسش‌های باز و گام‌های بعد — برای CISO",
    module: "security",
    catalog: ["SEC-010", "AI-023"],
    target: "record",
    tables: ["sec_incident"],
    output: "text",
    tier: "standard",
    inputs: { journal: "all", journalLimit: 40, links: true },
    fieldGroups: ["internal", "security"],
    surfaces: ["panel"],
    order: 1,
    system: "کار تو: خلاصهٔ یک رخداد امنیت اطلاعات برای مدیر ارشد امنیت (CISO)، کوتاه و مدیریتی، با بخش‌های: وضعیت کنونی، اثر و دامنه، خط زمانی (رویدادهای تازه‌تر وزن بیشتری دارند)، نشانگرها، اقدام‌های انجام‌شده، اطلاع‌رسانی‌های الزامی، پرسش‌های باز و گام‌های بعد. عددها و زمان‌ها فقط از بلوک facts. داده‌های شخصی را تکرار نکن.",
    template: "رخداد:\n{{record}}\n\nیادداشت‌ها:\n{{journal}}\n\nداده‌های محاسبه‌شده:\n{{facts}}",
    factKeys: ["facts_sir"],
    facts: async (ctx, input) => (input.id ? { facts_sir: await sirFacts(ctx, input.id) } : {}),
    fallback: async (ctx, input) => ({ text: sirRuleSummary(input, await sirFacts(ctx, String(input.id))) }),
  }),
  defineSkill({
    key: "security.vuln_plan",
    name: "پیش‌نویس برنامهٔ رفع آسیب‌پذیری",
    description: "گام‌های رفع با راه‌حل سازنده، ترتیب دارایی‌ها بر پایهٔ ریسک و موعد، تغییر، پویش دوباره و استثناها",
    module: "security",
    catalog: ["SEC-023", "SEC-017"],
    target: "record",
    tables: ["sec_vuln_remediation", "sec_vuln_item"],
    output: "text",
    tier: "standard",
    inputs: { journal: "none", links: false },
    surfaces: ["panel"],
    order: 2,
    system: "کار تو: پیش‌نویس برنامهٔ رفع یک آسیب‌پذیری برای گروه پشتیبانی: بررسی نسخه‌ها، راه‌حل ترجیحی سازنده (از بلوک facts، با ذکر نسخهٔ رفع‌شده)، ترتیب دارایی‌ها بر پایهٔ ریسک و موعد، تغییر و پنجرهٔ نگهداری، برنامهٔ بازگشت، تأیید با پویش دوباره و استثنا برای آنچه پیش از موعد رفع نمی‌شود. چیزی را که در داده نیست نساز.",
    template: "رکورد:\n{{record}}\n\nآسیب‌پذیری و دارایی‌ها:\n{{plan}}",
    factKeys: ["plan"],
    facts: async (ctx, input) => ({ plan: await planFacts(ctx, input) }),
    fallback: async (ctx, input) => ({ text: planRule(await planFacts(ctx, input)) }),
  }),
  defineSkill({
    key: "security.evidence_summary",
    name: "خلاصهٔ شواهد کنترل",
    description: "آزمون‌ها، شواهد، پایش خودکار و الزام‌های نگاشتهٔ یک کنترل با کمبودها — برای ممیز و مالک کنترل",
    module: "security",
    catalog: ["SEC-039", "SEC-048"],
    target: "record",
    tables: ["grc_control"],
    output: "text",
    tier: "standard",
    inputs: { journal: "none", links: false },
    surfaces: ["panel"],
    order: 3,
    system: "کار تو: خلاصهٔ شواهد یک کنترل برای ممیز: هدف کنترل، الزام‌های پوشش‌داده، آزمون‌های اخیر (جامعه، نمونه، استثناها، نتیجه)، شواهد و وضعیت آن‌ها، پایش خودکار، و در پایان کمبودهای کفایت شواهد به صورت فهرست. فقط از بلوک facts.",
    template: "کنترل:\n{{record}}\n\nداده‌ها:\n{{evidence}}",
    factKeys: ["evidence"],
    facts: async (ctx, input) => (input.id ? { evidence: await evidenceFacts(ctx, input.id) } : {}),
    fallback: async (ctx, input) => ({ text: evidenceRule(await evidenceFacts(ctx, String(input.id))) }),
  }),
  defineSkill({
    key: "security.policy_qa",
    name: "پرسش از خط‌مشی‌ها",
    description: "پاسخ به پرسش دربارهٔ خط‌مشی‌ها و استانداردهای منتشرشده با ارجاع به متن آن‌ها",
    module: "security",
    catalog: ["SEC-032", "SEC-067"],
    target: "text",
    tables: ["grc_policy"],
    output: "text",
    tier: "standard",
    grounding: { kind: "similar", k: 6 },
    surfaces: ["module"],
    order: 4,
    system: "کار تو: پاسخ کوتاه و دقیق به پرسش کارکنان دربارهٔ خط‌مشی‌ها و استانداردهای امنیت اطلاعات، فقط از منبع‌های شماره‌دار. اگر منبع‌ها پاسخ نمی‌دهند بگو در خط‌مشی‌ها نیامده است و حدس نزن.",
    template: "پرسش:\n{{text}}",
    facts: async (ctx) => {
      await needPolicies(ctx);
      return {};
    },
    fallback: async (_ctx, input) => ({ text: policyRule(input) }),
  }),
  defineSkill({
    key: "security.observable_verdict",
    name: "رأی دربارهٔ نشانگر",
    description: "مخرب، مشکوک، بی‌خطر یا نامعلوم با درجهٔ اطمینان و شاهد، از انطباق با نشانگرهای تهدید و رخدادها",
    module: "security",
    catalog: ["SEC-004"],
    target: "record",
    tables: ["sec_observable"],
    output: "json",
    schema: z.object({ verdict: z.enum(["malicious", "suspicious", "benign", "unknown"]), confidence: z.number().min(0).max(100), evidence: z.array(z.string().max(300)).max(8) }),
    tier: "fast",
    inputs: { journal: "none", links: false },
    surfaces: ["panel"],
    order: 5,
    system: "کار تو: رأی دربارهٔ یک نشانگر امنیتی (مخرب، مشکوک، بی‌خطر یا نامعلوم) با اطمینان ۰ تا ۱۰۰ و شاهدها، فقط از داده‌های داده‌شده؛ بی‌شاهد «نامعلوم» بگو.",
    template: "نشانگر:\n{{record}}\n\nانطباق‌ها و رخدادها:\n{{matches}}",
    factKeys: ["matches"],
    facts: async (ctx, input) => ({ matches: await observableFacts(ctx, input) }),
    fallback: async (ctx, input) => ({ json: observableRule(await observableFacts(ctx, input)) }),
  }),
  defineSkill({
    key: "security.reg_impact",
    name: "تحلیل اثر تغییر مقررات",
    description: "ردهٔ اثر (بی‌اثر، جزئی، اساسی) با دلیل و الزام‌های متأثر برای تأیید مسئول انطباق",
    module: "security",
    catalog: ["SEC-035"],
    target: "record",
    tables: ["grc_reg_alert"],
    output: "json",
    schema: z.object({ impact: z.enum(["none", "minor", "material"]), rationale: z.string().max(2000), requirements: z.array(z.string().max(40)).max(20) }),
    tier: "standard",
    inputs: { journal: "none", links: false },
    surfaces: ["panel"],
    order: 6,
    system: "کار تو: تحلیل اثر یک تغییر مقررات بر الزام‌های سازمان: ردهٔ اثر none یا minor یا material، دلیل کوتاه و کد الزام‌های متأثر فقط از میان نامزدها.",
    template: "تغییر مقررات:\n{{record}}\n\nالزام‌های نامزد:\n{{candidates}}",
    factKeys: ["candidates"],
    facts: async (ctx, input) => ({ candidates: await regFacts(ctx, input) }),
    fallback: async (ctx, input) => ({ json: regRule(await regFacts(ctx, input)) }),
  }),
  defineSkill({
    key: "security.risk_summary",
    name: "خلاصهٔ ریسک",
    description: "علت، رویداد و پیامد، ریسک ذاتی و باقی‌مانده، مقایسه با اشتها، درمان و گام‌های بعد — برای مالک ریسک",
    module: "security",
    catalog: ["SEC-046"],
    target: "record",
    tables: ["grc_risk"],
    output: "text",
    tier: "fast",
    inputs: { journal: "public", links: true },
    surfaces: ["panel"],
    order: 7,
    system: "کار تو: خلاصهٔ یک ریسک برای مالک آن: سناریو (علت، رویداد، پیامد)، ریسک ذاتی و باقی‌مانده، جایگاه نسبت به اشتهای ریسک، گزینهٔ درمان و برنامهٔ آن، و گام بعدی. عددها فقط از رکورد.",
    template: "ریسک:\n{{record}}\n\nپیوندها:\n{{links}}",
    fallback: async (_ctx, input) => {
      const r = rowOf(input);
      return { text: [`## ${input.record?.number ?? ""} — ${r.title ?? ""}`, `- علت: ${r.cause ?? "—"}`, `- رویداد: ${r.event ?? "—"}`, `- پیامد: ${r.consequence ?? "—"}`, `- ریسک ذاتی: ${r.inherent_score ?? "—"} · باقی‌مانده: ${r.residual_score ?? "—"} (اشتها: ${r.appetite_score ?? "—"})${r.above_appetite ? " — بالاتر از اشتها" : ""}`, `- درمان: ${r.treatment ?? "تعیین نشده"} · بازنگری بعدی: ${r.review_due ?? "—"}`].join("\n") };
    },
  }),
];

let installed = false;
export function installSecuritySkills(): void {
  if (installed) return;
  installed = true;
  for (const s of securitySkills) registerSkill(s);
}

export const securityAiCapabilities = () => securitySkills.map((s) => s.key);
