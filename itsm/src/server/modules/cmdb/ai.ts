// The AI layer's plug-in points in configuration management (catalogue CMDB-029/039/040/041/043/044/045/047) and the
// assistant's graph tools (CMDB-046). Until the AI layer registers implementations, the rule-based parts stand on
// their own: co-occurrence relationship suggestions, identification-rule duplicates, the health facts. Contract for
// implementations (as in incident management): run with the asking member's `ctx`, read through the engine, never
// inside a write transaction and never writing — they return suggestions a person applies.
//
// The assistant's tools below are read-only, permission-trimmed (hidden CIs are counted, never named) and bounded.
import { z } from "zod";
import type { Ctx } from "../../context";
import type { CmdbQuery } from "./query";
import { registerTool } from "../ai/tools";
import { defineTool } from "../ai/tools/registry";
import { list } from "../../engine";
import { impactAnalysis } from "./impact";
import { dependencyMap, pathBetween } from "./graph";
import { ciSummaryFacts } from "./facts";

export interface CmdbAi {
  /** CMDB-041 relationships the evidence suggests (config files, observed connections) — proposals for owners */
  suggestRelationships?(ctx: Ctx, ciId: string): Promise<{ parent_id: string; child_id: string; type: string; score: number; evidence: unknown }[]>;
  /** CMDB-029 an explanation of a de-duplication task from the computed pair features */
  explainDuplicate?(ctx: Ctx, taskId: string): Promise<{ text: string; survivor_id?: string; root_cause?: string }>;
  /** CMDB-039 a governance narrative over the health facts (numbers come from code; the model narrates and ranks) */
  qualityNarrative?(ctx: Ctx, facts: unknown): Promise<{ text: string; recommendations?: { title: string; path?: string }[] }>;
  /** CMDB-040 missing values with their evidence and confidence */
  enrich?(ctx: Ctx, ciId: string): Promise<{ field: string; value: unknown; confidence: number; reason: string }[]>;
  /** CMDB-043 a Persian or English question → the query tree of `runQuery` (validated before it runs) */
  naturalQuery?(ctx: Ctx, text: string): Promise<CmdbQuery>;
  /** CMDB-044 a short summary of a CI from the facts the server assembled */
  summarize?(ctx: Ctx, ciId: string, facts: unknown): Promise<{ text: string }>;
  /** CMDB-047 why an import run or a collector failed, with a suggested fix */
  diagnoseImport?(ctx: Ctx, runId: string): Promise<{ text: string }>;
}

let impl: CmdbAi = {};

/** Plug the AI layer's CMDB skills in (a later registration replaces the earlier one); returns an unregister function. */
export function registerCmdbAi(next: CmdbAi): () => void {
  impl = next;
  return () => {
    if (impl === next) impl = {};
  };
}

export const cmdbAi = (): CmdbAi => impl;

/** Which CMDB AI skills are registered («cmdb.summarize» …): the screens show only those actions. */
export function cmdbAiCapabilities(): string[] {
  return Object.keys(impl).filter((k) => typeof (impl as Record<string, unknown>)[k] === "function").map((k) => `cmdb.${k}`);
}

/** A CI the caller may read, by number («CI0000012»), id or words of its name. */
async function findCi(ctx: Ctx, ref: string): Promise<{ id: string; name: string; number: string | null } | null> {
  const q = ref.trim();
  if (!q) return null;
  const r = await list(ctx, "ci", { q, size: 3, fields: ["number", "name", "class"], total: false });
  const row = r.rows[0];
  return row ? { id: String(row.id), name: String(row.name ?? ""), number: (row.number as string) ?? null } : null;
}

const CI_REF = z.string().min(1).max(200).describe("the CI's number (e.g. CI0000012) or words of its name");

const impactTool = defineTool({
  name: "cmdb_impact_of",
  title_fa: "تحلیل اثر پیکربندی",
  description:
    "Impact analysis in the CMDB: which CIs, services and offerings depend on a CI if it goes down (or is degraded or in maintenance), with severity (1 = down), hops and the path, the number of critical CIs, users and subscribers affected, and how many CIs the caller may not see (counted, never named). Use it for «what breaks if X fails», blast radius and change risk questions. Input: the CI's number or name.",
  input: z.object({ ci: CI_REF, state: z.enum(["down", "degraded", "maintenance"]).optional() }),
  kind: "read",
  area: "ai",
  level: "view",
  async run(ctx, input) {
    const ci = await findCi(ctx, input.ci);
    if (!ci) return { data: { found: false }, summary_fa: "پیکربندی پیدا نشد" };
    const r = await impactAnalysis(ctx, { ci_ids: [ci.id], state: input.state ?? "down" });
    return {
      data: {
        ci: { number: ci.number, name: ci.name },
        state: r.state,
        counts: r.counts,
        services: r.services.slice(0, 20).map((s) => ({ kind: s.kind, number: s.number, name: s.name, tier: s.tier, severity: s.severity })),
        cis: r.cis.slice(0, 25).map((c) => ({ number: c.number, name: c.name, class: c.class_label, severity: c.severity, hops: c.depth, path: c.path.map((p) => p.name).join(" ← ") })),
        truncated: r.cis.length > 25,
      },
      summary_fa: `${r.counts.services} خدمت و ${r.counts.cis} پیکربندی متأثر`,
      refs: [{ type: "ci", id: ci.id, label: ci.name, path: `cis/${ci.id}` }],
    };
  },
});

const dependenciesTool = defineTool({
  name: "cmdb_dependencies",
  title_fa: "وابستگی‌های پیکربندی",
  description:
    "The CMDB dependency map around a CI or service: what it depends on («dependencies»), what depends on it («dependents») or both, up to 4 hops, as nodes (number, name, class, state) and relationships (parent, type, child). Hidden CIs appear as «پیکربندی محدود» placeholders only when they keep a path. Use for «what does the payroll service run on», «which apps use this database».",
  input: z.object({ ci: CI_REF, direction: z.enum(["both", "dependents", "dependencies"]).optional(), depth: z.number().int().min(1).max(4).optional() }),
  kind: "read",
  area: "ai",
  level: "view",
  async run(ctx, input) {
    const ci = await findCi(ctx, input.ci);
    if (!ci) return { data: { found: false }, summary_fa: "پیکربندی پیدا نشد" };
    const m = await dependencyMap(ctx, { roots: [ci.id], depth: input.depth ?? 2, direction: input.direction ?? "both", overlays: false, max_nodes: 120 });
    const names = new Map(m.nodes.map((n) => [n.id, n.restricted ? "پیکربندی محدود" : n.name ?? ""]));
    return {
      data: {
        root: { number: ci.number, name: ci.name },
        nodes: m.nodes.slice(0, 80).map((n) => (n.restricted ? { restricted: true } : { number: n.number, name: n.name, class: n.class_label, state: n.state_label, hops: n.depth })),
        relationships: m.edges.slice(0, 120).map((e) => ({ parent: names.get(e.source), type: e.label, child: names.get(e.target) })),
        restricted: m.restricted,
        truncated: m.truncated || m.nodes.length > 80,
      },
      summary_fa: `${m.nodes.length} پیکربندی در نقشه`,
    };
  },
});

const pathTool = defineTool({
  name: "cmdb_path_between",
  title_fa: "مسیر میان دو پیکربندی",
  description: "The shortest chain of CMDB relationships between two CIs (any type, both ways, up to 6 hops), as names and relationship labels; hidden CIs on the way appear as placeholders. Use for «how is X connected to Y».",
  input: z.object({ from: CI_REF, to: CI_REF }),
  kind: "read",
  area: "ai",
  level: "view",
  async run(ctx, input) {
    const a = await findCi(ctx, input.from);
    const b = await findCi(ctx, input.to);
    if (!a || !b) return { data: { found: false }, summary_fa: "پیکربندی پیدا نشد" };
    const p = await pathBetween(ctx, a.id, b.id);
    const names = new Map(p.nodes.map((n) => [n.id, n.restricted ? "پیکربندی محدود" : n.name ?? ""]));
    return { data: { found: p.found, steps: p.edges.map((e) => ({ parent: names.get(e.source), type: e.label, child: names.get(e.target) })) }, summary_fa: p.found ? `${p.edges.length} گام` : "مسیری پیدا نشد" };
  },
});

const summaryTool = defineTool({
  name: "cmdb_ci_summary",
  title_fa: "خلاصهٔ پیکربندی",
  description:
    "Facts about one CI from the CMDB as the caller may see them: class, state, owner and support group, environment and criticality, technical identity, data health (score and issues), relationships by type, open incidents, problems, findings and drift, services it supports and when it was last discovered. Numbers are counts of records the caller may read.",
  input: z.object({ ci: CI_REF }),
  kind: "read",
  area: "ai",
  level: "view",
  async run(ctx, input) {
    const ci = await findCi(ctx, input.ci);
    if (!ci) return { data: { found: false }, summary_fa: "پیکربندی پیدا نشد" };
    return { data: await ciSummaryFacts(ctx, ci.id), summary_fa: ci.name };
  },
});

/** The assistant's CMDB tools (installed once by `installCmdbModule`). */
export function installCmdbTools(): (() => void)[] {
  return [impactTool, dependenciesTool, pathTool, summaryTool].map((t) => registerTool(t as never));
}
