// The AI layer's plug-in points in the service portfolio (catalogue SPF-021/022/023/024/025/040/042) and the
// assistant's read tool over service status. Until the AI layer registers implementations, the rule-based parts stand
// on their own: name and tag overlap for duplicate services (insights.ts), CI-derived affected services (entitle.ts),
// the computed scorecard. Contract (as in incident management and the CMDB): run with the asking member's `ctx`, read
// through the engine, never inside a write transaction and never writing — they return drafts a person applies.
import { z } from "zod";
import type { Ctx } from "../../context";
import { registerTool } from "../ai/tools";
import { defineTool } from "../ai/tools/registry";
import { list } from "../../engine";
import { statusLabel } from "@shared/service_portfolio/logic";
import { serviceScorecard } from "./insights";

export interface PortfolioAi {
  /** SPF-022 consumer-language Persian description, value statement, outcomes and FAQ from the service's data */
  describe?(ctx: Ctx, serviceId: string, opts: { tone?: "formal" | "plain" }): Promise<{ description: string; value_proposition?: string; outcomes?: string; faq?: { q: string; a: string }[]; readability?: number }>;
  /** SPF-022 a whole service with offerings drafted from a short brief */
  scaffold?(ctx: Ctx, brief: string): Promise<{ service: Record<string, unknown>; offerings: Record<string, unknown>[] }>;
  /** SPF-040 a translation of the service's name and description (Persian ↔ English) for a person to review */
  translate?(ctx: Ctx, serviceId: string, to: "fa" | "en"): Promise<{ name: string; description: string }>;
  /** SPF-024 the likely service, offering and CI of a ticket's text (abstains below its threshold) */
  classify?(ctx: Ctx, input: { text: string; caller_id?: string | null; ci_id?: string | null }): Promise<{ service_id: string | null; offering_id: string | null; ci_id: string | null; confidence: number; reason?: string }[]>;
  /** SPF-021 services that overlap in meaning (beyond the rule-based name overlap) */
  duplicates?(ctx: Ctx): Promise<{ a: string; b: string; score: number; reason: string }[]>;
  /** SPF-023 catalogue gaps and retirement candidates from clustered requests and incidents, as a cited memo */
  gaps?(ctx: Ctx, period: { from: string; to: string }): Promise<{ text: string; clusters: { label: string; size: number; service_id?: string | null; examples: string[] }[] }>;
  /** SPF-025 demand forecast per service with prediction intervals (Iranian calendar effects) */
  forecast?(ctx: Ctx, serviceId: string, months: number): Promise<{ period: string; forecast: number; low: number; high: number }[]>;
  /** SPF-042 a short narrative of a service's health from the scorecard the server computed */
  narrative?(ctx: Ctx, serviceId: string, facts: unknown): Promise<{ text: string }>;
}

let impl: PortfolioAi = {};

/** Plug the AI layer's portfolio skills in (a later registration replaces the earlier one); returns an unregister function. */
export function registerPortfolioAi(next: PortfolioAi): () => void {
  impl = next;
  return () => {
    if (impl === next) impl = {};
  };
}

export const portfolioAi = (): PortfolioAi => impl;

/** Which portfolio AI skills are registered («service.describe» …): the screens show only those actions. */
export function portfolioAiCapabilities(): string[] {
  return Object.keys(impl).filter((k) => typeof (impl as Record<string, unknown>)[k] === "function").map((k) => `service.${k}`);
}

const statusTool = defineTool({
  name: "service_status_of",
  title_fa: "وضعیت و کارنامهٔ خدمت",
  description:
    "The live status of an IT service from the service portfolio and its scorecard: status (operational, degraded, partial or major outage, maintenance) with the reason, open and major incidents, incidents and SLA breaches of the last 30 days, open problems, subscribers, availability over 30 days against the target, satisfaction, offerings, and when its review is due. Counts are the caller's reads. Input: the service's number (SVC00012) or words of its name.",
  input: z.object({ service: z.string().min(1).max(200).describe("the service's number or words of its name") }),
  kind: "read",
  area: "ai",
  level: "view",
  async run(ctx, input) {
    const r = await list(ctx, "service", { q: input.service.trim(), size: 1, fields: ["number", "name"], total: false });
    const row = r.rows[0];
    if (!row) return { data: { found: false }, summary_fa: "خدمت پیدا نشد" };
    const card = await serviceScorecard(ctx, String(row.id));
    return {
      data: { service: card.service, status_label: statusLabel(card.service.status), kpis: card.kpis, review: card.review, offerings: card.offerings.slice(0, 10), hidden: card.hidden, period: "۳۰ روز گذشته" },
      summary_fa: `«${card.service.name}»: ${statusLabel(card.service.status)}${card.service.status_reason ? ` (${card.service.status_reason})` : ""}`,
    };
  },
});

export function installPortfolioTools(): (() => void)[] {
  return [registerTool(statusTool as never)];
}
