// Insights (catalogue AI-113, ANA-025/029; docs/spec/AI.md §16): what changed yesterday and last week, computed by code
// for the whole organisation (./compute.ts), shown to each member only under the visibility rule (./views.ts), phrased
// by a model only from the card's numbers, and sent as digests to members of chosen roles — each digest built from the
// cards that member may see.
//   · `ai.insights.tick` every hour per organisation: after the configured hour, yesterday's cards (and on Saturday last
//     week's) once; digests and anomaly notifications by the runtime that acts for the organisation (a Windows app
//     linked to the web version leaves them to the web version).
//   · `ai.insights.digest` one period's digests, recipient by recipient (progress saved).
import { z } from "zod";
import { todayISO } from "@shared/jalali";
import { faDigits } from "@shared/format";
import { SEVERITY_LABELS, type InsightView } from "@shared/ai/insights";
import { AI_DIGEST } from "@shared/tables/ai-governance";
import type { Ctx, ServerConfig } from "../../../context";
import type { Queryable } from "../../../db";
import { createIn, orgTz, systemCtx } from "../../../engine";
import { enqueue, registerJobHandler } from "../../../jobs";
import { memberCtx } from "../../../access/service";
import { actsHere } from "../../notify/common";
import { notifyPeople } from "../../notify/deliver";
import { roleHolders } from "../../analytics/sharing";
import { hourIn } from "../../analytics/jobs";
import { loadSettings } from "../settings";
import { principalCtx } from "../skills/principal";
import { defineSkill, registerSkill } from "../skills/registry";
import { isAiUnavailable, runForModule } from "../skills/runtime";
import { computeInsights, periodOf, type Period } from "./compute";
import { canSee, computed, insightRows, saveInsights, storeNarrative, viewOf, visibleInsights, VisibilityCache, type InsightRow } from "./views";

export { periodOf, computeInsights, type Period } from "./compute";
export { canSee, insightRows, visibleInsights, viewOf, saveInsights } from "./views";

export const INSIGHTS_TICK_EVERY = 60 * 60_000;

/** Make sure the organisation's insights tick is queued. */
export async function ensureInsightsTick(q: Queryable, orgId: string): Promise<void> {
  await enqueue(q, { kind: "ai.insights.tick", orgId, dedupeKey: "ai.insights.tick", maxAttempts: 100 });
}

const NARRATE = defineSkill({
  key: "insights.narrate",
  name: "شرح بینش",
  description: "یک بینش (عددهای محاسبه‌شده با کد) را در دو یا سه جملهٔ کوتاه برای مدیر شرح می‌دهد؛ هیچ عددی نمی‌سازد",
  module: "ai",
  catalog: ["AI-113", "ANA-029"],
  target: "none",
  tables: [],
  output: "text",
  tier: "fast",
  roles: [],
  surfaces: ["module"],
  system:
    "کار تو: شرح کوتاه (دو یا سه جمله) یک بینش برای مدیر خدمات فناوری اطلاعات. فقط عددها و نام‌های بلوک facts را به کار ببر و هیچ عددی نساز یا حدس نزن؛ عددها را همان‌طور که آمده‌اند بیاور. اگر نکته‌ای برای پیگیری روشن است، یک پیشنهاد کوتاه بده.",
  template: "بینش و عددهای محاسبه‌شده:\n{{facts}}",
  fallback: async (_ctx, input) => ({ text: String((input.params as { narrative?: unknown }).narrative ?? "") }),
});

/** The facts a narrative may use: the card's title, period, numbers and drivers (labels and counts). */
function factsOf(v: InsightView): Record<string, unknown> {
  return { title: v.title, period: v.period_label, kind: v.kind_label, table: v.table_label, severity: SEVERITY_LABELS[v.severity], numbers: v.numbers, drivers: v.drivers.map((d) => ({ label: d.label, current: d.current, previous: d.previous, change: d.delta })), rule_text: v.narrative };
}

/** A model's narrative of a card, as `ctx` (the AI principal in jobs, the viewer on request), under the table's policy. */
export async function narrateInsight(ctx: Ctx, v: InsightView, table: string): Promise<string | null> {
  try {
    const r = await runForModule(ctx, NARRATE.key, { params: {} }, { ephemeral: true, facts: { facts: factsOf(v) }, dataTables: [table] });
    const text = String(r.text ?? "").trim();
    return text || null;
  } catch (e) {
    if (isAiUnavailable(e)) return null;
    throw e;
  }
}

/** Compute a period now (as the system), store it, and let the AI principal phrase the top cards when it can. */
export async function runPeriod(cfg: ServerConfig, orgId: string, p: Period): Promise<number> {
  const sys = await systemCtx(cfg, orgId);
  const drafts = await computeInsights(sys, p);
  const n = await saveInsights(sys, p, drafts);
  // narratives by the organisation's AI service member (its roles decide what it reads; nothing when not set up)
  const pctx = await principalCtx(cfg, orgId).catch(() => null);
  if (pctx) {
    const rows = (await insightRows(sys, { period: p.kind, key: p.key, limit: 12 })).filter((r) => !r.narrative_ai);
    const cache = new VisibilityCache(pctx);
    for (const r of rows.slice(0, 8)) {
      if (!(await canSee(pctx, r, cache))) continue;
      const text = await narrateInsight(pctx, await viewOf(sys, r), r.scope?.table || r.table_key);
      if (text) await storeNarrative(sys, r.id, text);
    }
  }
  return n;
}

function digestBody(views: InsightView[], periodLabel: string): string {
  const lines = [`**بینش‌های ${periodLabel}**`, ""];
  for (const v of views.slice(0, 12)) {
    lines.push(`- ${v.severity === "critical" || v.severity === "warning" ? "⚠ " : ""}**${v.title}** — ${v.kind_label}`);
    if (v.narrative) lines.push(`  ${v.narrative}`);
  }
  if (views.length > 12) lines.push("", `و ${faDigits(views.length - 12)} بینش دیگر در صفحهٔ «بینش‌ها».`);
  return lines.join("\n");
}

/** Members of the configured roles (active, deduplicated). */
async function recipients(q: Queryable, orgId: string, roles: readonly string[]): Promise<string[]> {
  const holders = await roleHolders(q, orgId);
  return [...new Set(roles.flatMap((r) => holders.get(r) ?? []))].sort();
}

/**
 * One digest per recipient: the period's cards that recipient may see (memberCtx), stored as their own digest record
 * and announced through the notification service (which checks the recipient reads it). Nothing for a recipient who
 * may see none.
 */
export async function sendDigests(cfg: ServerConfig, orgId: string, p: Pick<Period, "kind" | "key">, opts: { done?: Set<string>; deadline?: number; only?: string[] } = {}): Promise<{ sent: number; more: boolean; done: Set<string> }> {
  const sys = await systemCtx(cfg, orgId);
  const settings = (await loadSettings(cfg.db, orgId)).insights;
  const rows = await insightRows(sys, { period: p.kind, key: p.key, limit: 200 });
  const done = opts.done ?? new Set<string>();
  let sent = 0;
  if (!rows.length) return { sent, more: false, done };
  const label = rows[0].scope?.label ?? p.key;
  for (const u of opts.only ?? (await recipients(cfg.db, orgId, settings.roles))) {
    if (done.has(u)) continue;
    if (sent > 0 && opts.deadline && Date.now() > opts.deadline) return { sent, more: true, done };
    done.add(u);
    const mctx = await memberCtx(cfg, orgId, u).catch(() => null);
    if (!mctx) continue;
    const { views } = await visibleInsights(mctx, rows);
    if (!views.length) continue;
    const title = `بینش‌های ${label}`;
    const id = await sys.write(async (tx) => {
      const exists = await tx.one<{ id: string }>(`select id from sm_ai_digests where org_id = $1 and recipient_id = $2 and period = $3 and period_key = $4 and deleted_at is null`, [orgId, u, p.kind, p.key]);
      if (exists) return null;
      const row = await createIn(tx, sys, AI_DIGEST, { title, recipient_id: u, period: p.kind, period_key: p.key, insights: views.length, body: digestBody(views, label), delivered_at: new Date().toISOString() }, { trusted: true });
      await notifyPeople(tx, orgId, { table: AI_DIGEST, id: String(row.id), users: [u], subject: title, body: digestBody(views, label), short_text: `${faDigits(views.length)} بینش تازه`, source: "بینش‌های هوش مصنوعی" });
      return String(row.id);
    });
    if (id) sent++;
  }
  return { sent, more: false, done };
}

/** Critical anomalies not announced yet: to the digest roles' members who may see each, at once. */
async function announceAnomalies(cfg: ServerConfig, orgId: string): Promise<number> {
  const sys = await systemCtx(cfg, orgId);
  const settings = (await loadSettings(cfg.db, orgId)).insights;
  if (!settings.notify_anomalies) return 0;
  const rows = (await sys.db.query<InsightRow>(
    `select id, period, period_key, kind, table_key, subject, scope, fields, refs, severity, score::float8 as score, title, numbers, drivers, narrative, narrative_ai, notified_at, created_at
     from sm_ai_insights where org_id = $1 and severity = 'critical' and notified_at is null and created_at > now() - interval '2 days' order by created_at limit 20`,
    [orgId],
  )) as InsightRow[];
  let n = 0;
  const users = await recipients(cfg.db, orgId, settings.roles);
  for (const r of rows) {
    for (const u of users) {
      const mctx = await memberCtx(cfg, orgId, u).catch(() => null);
      if (!mctx || !(await canSee(mctx, r))) continue;
      const v = await viewOf(sys, r);
      await sys.write(async (tx) => {
        const key = `a-${r.id.replace(/-/g, "").slice(-16)}`;
        const exists = await tx.one(`select 1 from sm_ai_digests where org_id = $1 and recipient_id = $2 and period = 'daily' and period_key = $3`, [orgId, u, key]);
        if (exists) return;
        const row = await createIn(tx, sys, AI_DIGEST, { title: `ناهنجاری: ${v.title}`, recipient_id: u, period: "daily", period_key: key, insights: 1, body: `**${v.title}**\n\n${v.narrative ?? ""}`, delivered_at: new Date().toISOString() }, { trusted: true });
        await notifyPeople(tx, orgId, { table: AI_DIGEST, id: String(row.id), users: [u], subject: `ناهنجاری: ${v.title}`, body: v.narrative ?? v.title, short_text: v.title, source: "بینش‌های هوش مصنوعی", mandatory: true });
      });
      n++;
    }
    await sys.write((tx) => tx.query(`update sm_ai_insights set notified_at = now() where org_id = $1 and id = $2`, [orgId, r.id]), { internal: true });
  }
  return n;
}

let installed = false;

export function installInsights(): void {
  if (installed) return;
  installed = true;
  registerSkill(NARRATE);
  registerJobHandler("ai.insights.tick", async (job, jctx) => {
    const orgId = job.org_id;
    if (!orgId) return;
    if (!(await jctx.db.one(`select 1 from sm_orgs where id = $1 and deleted_at is null`, [orgId]))) return;
    const cfg = jctx.cfg as ServerConfig;
    const settings = (await loadSettings(jctx.db, orgId)).insights;
    if (settings.enabled) {
      const sys = await systemCtx(cfg, orgId);
      const tz = orgTz(sys);
      const today = todayISO(tz);
      if (hourIn(tz) >= settings.hour) {
        for (const kind of ["daily", "weekly"] as const) {
          const p = periodOf(kind, today, tz);
          if (await computed(sys, p)) continue;
          await runPeriod(cfg, orgId, p);
          if (actsHere(cfg) && settings.digest === kind) await enqueue(jctx.db, { kind: "ai.insights.digest", orgId, payload: { period: kind, key: p.key }, dedupeKey: `ai.insights.digest:${kind}:${p.key}`, maxAttempts: 3 });
        }
      }
      if (actsHere(cfg)) await announceAnomalies(cfg, orgId);
    }
    return { again: INSIGHTS_TICK_EVERY };
  });
  registerJobHandler("ai.insights.digest", async (job, jctx) => {
    const orgId = job.org_id;
    const p = (job.payload ?? {}) as { period?: "daily" | "weekly"; key?: string; done?: string[] };
    if (!orgId || !p.period || !p.key || !actsHere(jctx.cfg)) return;
    const r = await sendDigests(jctx.cfg as ServerConfig, orgId, { kind: p.period, key: p.key }, { done: new Set(p.done ?? []), deadline: jctx.deadline - 1000 });
    if (r.more) {
      await jctx.save({ ...p, done: [...r.done] });
      return { again: 0 };
    }
  });
}

export const insightsRunSchema = z.object({ period: z.enum(["daily", "weekly"]) });
