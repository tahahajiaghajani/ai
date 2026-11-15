// A process's draft (design F §3.5, §8.4, package F4c): what the designer autosaves into `process.draft` — the graph
// with each step's settings, the starters, the title template, «درخواست‌دهنده چه می‌بیند», the managers, the manager
// groups and confidentiality — read back into its shape here (unknown keys dropped, lists bounded), so the publish,
// the diff and the previews all read the same thing. A version carries the same settings as published.
import { cleanGraph } from "@shared/flows/validate";
import { cleanRule, MAX_RULES, type AssigneeRule } from "@shared/process/assignees";
import { formStepOf, type ProcessGraph } from "@shared/process/graph";
import { TITLE_MAX } from "@shared/process/title";

export interface ProcessDraft {
  graph: ProcessGraph;
  /** who may start a case (empty: every member) */
  starters: AssigneeRule[];
  title_template: string | null;
  /** fields the requester reads beyond the start form */
  requester_view: string[];
  managers: string[];
  manager_groups: string[];
  confidential: boolean;
}

/** A draft larger than this is refused (the graph, its settings and the access lists). */
export const MAX_DRAFT_BYTES = 1_000_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME = /^[a-z][a-z0-9_]{0,62}$/;

function obj(v: unknown): Record<string, unknown> {
  if (typeof v === "string") {
    try {
      return obj(JSON.parse(v));
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const ids = (v: unknown, max: number): string[] =>
  [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && UUID.test(x)).map((x) => x.toLowerCase()))].slice(0, max);

/** A draft from stored or posted JSON. */
export function cleanDraft(raw: unknown): ProcessDraft {
  const o = obj(raw);
  const graph = cleanGraph(o.graph && typeof o.graph === "object" ? o.graph : { nodes: [], edges: [] }) as unknown as ProcessGraph;
  const title = typeof o.title_template === "string" ? o.title_template.trim().slice(0, TITLE_MAX) : "";
  return {
    graph,
    starters: (Array.isArray(o.starters) ? o.starters : []).map(cleanRule).filter((r): r is AssigneeRule => !!r).slice(0, MAX_RULES),
    title_template: title || null,
    requester_view: [...new Set((Array.isArray(o.requester_view) ? o.requester_view : []).filter((x): x is string => typeof x === "string" && NAME.test(x)))].slice(0, 200),
    managers: ids(o.managers, 100),
    manager_groups: ids(o.manager_groups, 50),
    confidential: o.confidential === true,
  };
}

/** The forms the draft's steps use (their ids, in the graph's order). */
export function graphForms(graph: ProcessGraph): string[] {
  const out: string[] = [];
  for (const n of graph.nodes) {
    if (n.type !== "form_step") continue;
    const f = formStepOf(n.config).form;
    if (f && UUID.test(f) && !out.includes(f.toLowerCase())) out.push(f.toLowerCase());
  }
  return out;
}

/** Every assignee rule a draft names (steps, fallbacks, reassign escalations, «اعلان» recipients, starters). */
export function draftRules(d: Pick<ProcessDraft, "graph" | "starters">): AssigneeRule[] {
  const out: AssigneeRule[] = [...d.starters];
  for (const n of d.graph.nodes) {
    if (n.type === "form_step") {
      const s = formStepOf(n.config);
      out.push(...s.assignees, ...(s.fallback ?? []));
      for (const e of s.escalate ?? []) if (e.action === "reassign") out.push(...e.rules);
    } else if (n.type === "notify" && Array.isArray(n.config?.to)) {
      out.push(...(n.config.to as unknown[]).map(cleanRule).filter((r): r is AssigneeRule => !!r));
    }
  }
  return out;
}
