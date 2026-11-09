// AI skills of release management (docs/spec/AI.md §11; catalogue REL-017, REL-037, DEV-024): every number and list
// comes from code read with the caller's access, the model only writes; each skill has a rule-based fallback, so the
// buttons answer without a model too («بدون مدل هوش مصنوعی و با قاعده ساخته شد»).
//   release.notes            release notes for an audience from the release's scope (changes, fixes, defects,
//                            accepted known errors, services) — the draft is stored as a release note by a person
//   release.deployment_risk  the risk narrative of a deployment over the computed risk facts
//   release.briefing         a briefing of a release with its blockers (failed or pending blocking checks, overdue
//                            mandatory tasks, open critical defects, unauthorized changes) and the next steps
// AI never decides go/no-go, waives a check or starts a deployment.
import { readinessOf, explainReleaseRisk } from "@shared/release/logic";
import { CHECK_STATUSES, NOTE_AUDIENCES, RELEASE_TASK_DONE } from "@shared/tables/release";
import type { Ctx } from "../../context";
import { get, list } from "../../engine";
import { defineSkill, registerSkill } from "../ai/skills/registry";
import { isAiUnavailable, runSkill } from "../ai/skills/runtime";
import { AppError } from "../../http/errors";
import type { SkillDef } from "../ai/skills/types";
import { deploymentRiskFacts } from "./risk";
import { noteFacts, ruleNotes, type Audience } from "./notes";
import { msOf, type Row } from "./common";

const AUDIENCES = NOTE_AUDIENCES.map((o) => ({ value: o.value, label: o.label }));
const audienceOf = (v: unknown): Audience => (["end_users", "operations", "management"].includes(String(v)) ? (v as Audience) : "end_users");
const statusLabel = (v: string) => CHECK_STATUSES.find((o) => o.value === v)?.label ?? v;

/** Blockers and status facts of a release (as the caller). */
export async function briefingFacts(ctx: Ctx, id: string): Promise<{ facts: Row; text: string }> {
  const { row: r } = await get(ctx, "release", id);
  const checks = (await list(ctx, "release_check_result", { filter: { f: "release_id", op: "eq", v: id }, fields: ["name", "status", "blocking", "message"], size: 200, total: false }).catch(() => ({ rows: [] as Row[] }))).rows;
  const readiness = readinessOf(checks as never);
  const now = Date.now();
  const tasks = (await list(ctx, "release_task", { filter: { f: "release_id", op: "eq", v: id }, fields: ["number", "short_description", "state", "mandatory", "due_at"], size: 300, total: false }).catch(() => ({ rows: [] as Row[] }))).rows;
  const overdue = tasks.filter((t) => !RELEASE_TASK_DONE.includes(String(t.state)) && (msOf(t.due_at) ?? Infinity) < now);
  const defects = (await list(ctx, "defect", { filter: { and: [{ f: "release_id", op: "eq", v: id }, { f: "severity", op: "in", v: ["critical", "high"] }, { f: "state", op: "in", v: ["new", "triaged", "in_progress"] }] }, fields: ["number", "short_description", "severity"], size: 50, total: false }).catch(() => ({ rows: [] as Row[] }))).rows;
  const failing = checks.filter((c) => c.blocking !== false && (c.status === "fail" || c.status === "pending"));
  const factors = Array.isArray(r.risk_factors) ? (r.risk_factors as Row[]) : [];
  const facts = {
    وضعیت: r.state,
    تصمیم_اجرا: r.go_no_go,
    آمادگی_درصد: readiness.pct,
    بررسی‌های_بازدارنده_باز: failing.map((c) => ({ نام: c.name, نتیجه: statusLabel(String(c.status)), پیام: c.message ?? null })),
    کارهای_دیرکرد: overdue.map((t) => ({ شماره: t.number, عنوان: t.short_description, الزامی: t.mandatory !== false })),
    نقص‌های_باز_مهم: defects.map((d) => ({ شماره: d.number, عنوان: d.short_description, شدت: d.severity })),
    ریسک: { امتیاز: r.risk_score ?? null, رده: r.risk_band ?? null, عامل‌ها: factors.map((f) => ({ عامل: f.label, امتیاز: f.points, شرح: f.detail ?? null })) },
  };
  // the rule-based briefing
  const lines: string[] = [`**${r.number ?? ""} ${r.short_description ?? ""}** — آمادگی ${readiness.pct.toLocaleString("fa-IR")}٪${r.risk_band ? `، ریسک ${({ low: "کم", medium: "متوسط", high: "زیاد", very_high: "بسیار زیاد" } as Row)[String(r.risk_band)] ?? r.risk_band}` : ""}.`];
  if (!failing.length && !overdue.length && !defects.length) lines.push("مانعی دیده نشد؛ انتشار برای تصمیم اجرا آماده است.");
  else {
    lines.push("**مانع‌ها:**");
    for (const c of failing) lines.push(`- بررسی «${c.name}»: ${statusLabel(String(c.status))}${c.message ? ` — ${c.message}` : ""}`);
    for (const t of overdue) lines.push(`- کار ${t.number} «${t.short_description}» از موعد گذشته است${t.mandatory !== false ? " (الزامی)" : ""}`);
    for (const d of defects) lines.push(`- نقص ${d.number} «${d.short_description}» با شدت ${d.severity} باز است`);
    lines.push("", "**گام بعد:** مانع‌های بازدارنده را رفع کنید یا مدیر انتشار با دلیل از آن‌ها چشم‌پوشی کند؛ سپس تصمیم اجرا را ثبت کنید.");
  }
  return { facts, text: lines.join("\n") };
}

export const releaseSkills: SkillDef[] = [
  defineSkill({
    key: "release.notes",
    name: "پیش‌نویس یادداشت انتشار",
    description: "یادداشت انتشار برای کاربران، عملیات یا مدیران از تغییرها، رفع مشکل‌ها و نقص‌های رفع‌شدهٔ انتشار",
    module: "release",
    catalog: ["REL-037", "REL-033"],
    target: "record",
    tables: ["release"],
    output: "text",
    tier: "standard",
    inputs: { fields: ["number", "short_description", "version_name", "type", "service_id", "planned_end", "deployed_at"], journal: "none", links: false },
    params: [{ name: "audience", label: "مخاطب", type: "choice", choices: AUDIENCES, default: "end_users" }],
    surfaces: ["panel", "module"],
    order: 10,
    system: "کار تو: نوشتن یادداشت انتشار به فارسی روان برای مخاطب داده‌شده. فقط از موردهای بلوک scope استفاده کن (تغییرها، رفع مشکل‌ها، نقص‌ها، خطاهای شناخته‌شدهٔ پذیرفته‌شده، خدمت‌ها)؛ چیزی نساز. برای کاربران نهایی زبان ساده و بی‌اصطلاح فنی و بدون شماره‌های داخلی؛ برای عملیات شماره‌ها، اثر و برنامهٔ بازگشت؛ برای مدیران یک بند خلاصه. بخش‌ها با عنوان Markdown.",
    template: "انتشار:\n{{record}}\n\nمخاطب: {{params.audience}}\n\nدامنهٔ انتشار:\n{{scope}}",
    factKeys: ["scope"],
    facts: async (ctx, input) => (input.id ? { scope: (await noteFacts(ctx, input.id)).facts } : {}),
    fallback: async (ctx, input) => (input.id ? { text: ruleNotes((await noteFacts(ctx, input.id)).facts, audienceOf(input.params.audience)).body } : { text: "" }),
  }),
  defineSkill({
    key: "release.deployment_risk",
    name: "روایت ریسک استقرار",
    description: "چرا این استقرار این ریسک را دارد و چه چیزی آن را کم می‌کند — از عامل‌هایی که کد محاسبه کرده است",
    module: "release",
    catalog: ["DEV-024", "REL-015"],
    target: "record",
    tables: ["deployment"],
    output: "text",
    tier: "standard",
    inputs: { fields: ["number", "short_description", "environment_id", "artifact_version", "approach", "planned_start", "rollback_plan", "state"], journal: "none", links: false },
    surfaces: ["panel", "module"],
    order: 20,
    system: "کار تو: روایت کوتاه ریسک یک استقرار برای مجری و مدیر انتشار. فقط عامل‌های بلوک risk را به کار ببر؛ عدد یا عامل تازه نساز. بگو کدام عامل‌ها ریسک را بالا برده‌اند و دو یا سه اقدام مشخص برای کم کردن آن پیشنهاد کن (مثلاً عرضهٔ مرحله‌ای، آزمودن برنامهٔ بازگشت، پیوند تغییر مجاز).",
    template: "استقرار:\n{{record}}\n\nعامل‌های ریسک:\n{{risk}}\n\nتوضیح قاعده‌محور:\n{{explanation}}",
    factKeys: ["risk", "explanation"],
    facts: async (ctx, input) => {
      if (!input.id) return {};
      const { row } = await get(ctx, "deployment", input.id);
      const f = await deploymentRiskFacts(ctx.db, ctx, row);
      return { risk: f.facts, explanation: f.text };
    },
    fallback: async (ctx, input) => {
      if (!input.id) return { text: "" };
      const { row } = await get(ctx, "deployment", input.id);
      return { text: (await deploymentRiskFacts(ctx.db, ctx, row)).text };
    },
  }),
  defineSkill({
    key: "release.briefing",
    name: "گزارش آمادگی و مانع‌های انتشار",
    description: "خلاصهٔ وضعیت انتشار با مانع‌های تصمیم اجرا (بررسی‌های بازدارنده، کارهای دیرکرد، نقص‌های مهم) و گام بعد",
    module: "release",
    catalog: ["REL-017"],
    target: "record",
    tables: ["release"],
    output: "text",
    tier: "standard",
    inputs: { fields: ["number", "short_description", "version_name", "type", "state", "planned_end", "go_no_go", "readiness_pct", "risk_band"], journal: "all", journalLimit: 20, links: true },
    surfaces: ["panel", "module"],
    order: 30,
    system: "کار تو: گزارش کوتاه آمادگی یک انتشار برای جلسهٔ تصمیم اجرا. بخش‌ها: «وضعیت»، «مانع‌ها» (فقط از بلوک status)، «ریسک»، «گام بعد». تصمیم اجرا یا توقف نگیر؛ فقط مانع‌ها و پیامدشان را روشن کن.",
    template: "انتشار:\n{{record}}\n\nوضعیت آمادگی و مانع‌ها:\n{{status}}\n\nیادداشت‌ها:\n{{journal}}\n\nپیوندها:\n{{links}}",
    factKeys: ["status"],
    facts: async (ctx, input) => (input.id ? { status: (await briefingFacts(ctx, input.id)).facts } : {}),
    fallback: async (ctx, input) => ({ text: input.id ? (await briefingFacts(ctx, input.id)).text : "" }),
  }),
];

/** «No AI» for a module button: no model, a provider failure, the skill switched off or not for this person. */
export const noAi = (e: unknown): boolean => isAiUnavailable(e) || (e instanceof AppError && (e.status === 403 || e.status === 404));

let installed = false;
export function installReleaseSkills(): (() => void)[] {
  if (installed) return [];
  installed = true;
  return releaseSkills.map((s) => registerSkill(s));
}

/**
 * A release note drafted for an audience: the skill when a model can answer (`ai: true`), else the rule-based draft —
 * a person who may not use the skill, no model or a provider failure all mean «no AI» here.
 */
export async function draftNotes(ctx: Ctx, releaseId: string, audience: Audience): Promise<{ title: string; body: string; sources: Row[]; ai: boolean }> {
  const { facts, sources } = await noteFacts(ctx, releaseId);
  const rule = ruleNotes(facts, audience);
  try {
    const r = await runSkill(ctx, "release.notes", { table: "release", id: releaseId, params: { audience } }, { noFallback: true });
    const body = (r.text ?? "").trim();
    if (body) return { title: rule.title, body, sources, ai: true };
  } catch (e) {
    if (!noAi(e)) throw e;
  }
  return { ...rule, sources, ai: false };
}

/** The deployment risk narrative: the skill when it can answer, else the deterministic text. */
export async function deploymentNarrative(ctx: Ctx, depId: string): Promise<{ text: string; band: string; ai: boolean }> {
  const { row } = await get(ctx, "deployment", depId);
  const f = await deploymentRiskFacts(ctx.db, ctx, row);
  try {
    const r = await runSkill(ctx, "release.deployment_risk", { table: "deployment", id: depId }, { noFallback: true });
    if ((r.text ?? "").trim()) return { text: r.text!, band: f.band, ai: true };
  } catch (e) {
    if (!noAi(e)) throw e;
  }
  return { text: f.text, band: f.band, ai: false };
}

/** The deterministic explanation of a release's stored risk. */
export function releaseRiskExplanation(r: Row): string {
  const factors = Array.isArray(r.risk_factors) ? (r.risk_factors as Row[]) : [];
  const points = factors.reduce((s, f) => s + Number(f.points ?? 0), 0);
  return explainReleaseRisk({
    score: Number(r.risk_score ?? 0), band: (["low", "medium", "high", "very_high"].includes(String(r.risk_band)) ? r.risk_band : "low") as "low", points, elapsed: 0, change_failure: 0,
    factors: factors.map((f) => ({ key: String(f.key), label: String(f.label), points: Number(f.points ?? 0), detail: String(f.detail ?? "") })),
  });
}
