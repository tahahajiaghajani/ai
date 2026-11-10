// Extension points of the AI layer in incident and problem management — the one place it plugs in (catalogue
// INC-009/011/019/038/047/049/056/067/068/080, PRB-012/014/018/021/027; docs/modules/incident_FA.md «هوش مصنوعی»).
//
// Until the AI layer registers implementations, every feature here has a rule-based fallback (similar incidents,
// known-error matching, problem candidates, the review draft) or stays hidden in the UI (`aiCapabilities()` tells the
// screens which buttons to show). Contract for implementations:
//   · run as the person: use the `ctx` given (never a system context for a person's request); everything read goes
//     through the engine with that ctx, so the model never sees what the person may not read;
//   · never inside a write transaction and never writing: they return suggestions, a person applies them (the
//     routes write what the person accepted, with their own access);
//   · candidates returned by `similar`/`cluster` are re-read and re-scored here with the caller's access.
import type { Ctx } from "../../context";
import type { CandidateGroup, RcaCanvas } from "@shared/problem/logic";

export interface IncidentAi {
  /** INC-067 a state-aware summary of the incident (Markdown), citing journal entry ids */
  summarize?(ctx: Ctx, incidentId: string): Promise<{ text: string; citations?: string[] }>;
  /** INC-019 semantic neighbours (ids and a 0–1 score); re-read with the caller's access before use */
  similar?(ctx: Ctx, incidentId: string, opts: { limit: number }): Promise<{ id: string; score: number }[]>;
  /** INC-011 triage of a draft: suggested field values with confidence and a reason */
  triage?(ctx: Ctx, draft: Record<string, unknown>): Promise<{ field: string; value: unknown; confidence: number; reason?: string }[]>;
  /** INC-068 resolution notes for the resolve dialog */
  suggestResolution?(ctx: Ctx, incidentId: string): Promise<{ close_notes: string; close_code?: string; confidence?: number }>;
  /** INC-038 a KCS article drafted from a resolved incident */
  draftKnowledge?(ctx: Ctx, incidentId: string): Promise<{ title: string; body: string }>;
  /** INC-049 a stakeholder update drafted from the incident, its SLA and timeline */
  draftUpdate?(ctx: Ctx, incidentId: string, audience: string): Promise<{ subject: string; body: string }>;
  /** INC-056 sections of the post-incident review (merged over the rule-based draft) */
  draftReview?(ctx: Ctx, incidentId: string): Promise<Partial<Record<"summary" | "impact" | "root_cause" | "detection" | "resolution" | "went_well" | "went_wrong" | "lessons", string>>>;
  /** INC-047 major-incident candidates over a recent window (system context of the organisation) */
  detectMajor?(ctx: Ctx, opts: { windowMinutes: number }): Promise<{ incidents: string[]; title: string; confidence: number }[]>;
  /** INC-080 a narrative of a periodic review over the figures the server computed (`stats`; numbers come from code) */
  summarizePeriod?(ctx: Ctx, reviewId: string): Promise<{ text: string }>;
}

export interface ProblemAi {
  /** PRB-018 next whys, hypotheses with evidence and a draft conclusion (merged into the RCA canvas by a person) */
  draftRca?(ctx: Ctx, problemId: string): Promise<Partial<RcaCanvas>>;
  /** PRB-021 a known-error record drafted from the problem */
  draftKnownError?(ctx: Ctx, problemId: string): Promise<{ short_description: string; symptoms: string; workaround: string; root_cause?: string }>;
  /** PRB-012 clusters of recurring incidents (system context); they become `ml` candidates next to the rule-based ones */
  cluster?(ctx: Ctx, opts: { windowDays: number }): Promise<CandidateGroup[]>;
  /** PRB-027 a summary of the problem, its incidents and the work done */
  summarize?(ctx: Ctx, problemId: string): Promise<{ text: string }>;
  /** PRB-014 problems and known errors an incident probably belongs to */
  linkSuggestions?(ctx: Ctx, incidentId: string): Promise<{ table: "problem" | "known_error"; id: string; score: number }[]>;
}

let incident: IncidentAi = {};
let problem: ProblemAi = {};

/** Plug the AI layer's incident skills in (a later registration replaces the earlier one); returns an unregister function. */
export function registerIncidentAi(impl: IncidentAi): () => void {
  incident = impl;
  return () => {
    if (incident === impl) incident = {};
  };
}

export function registerProblemAi(impl: ProblemAi): () => void {
  problem = impl;
  return () => {
    if (problem === impl) problem = {};
  };
}

export const incidentAi = (): IncidentAi => incident;
export const problemAi = (): ProblemAi => problem;

/** Which AI skills are registered («incident.summarize», «problem.draftRca» …): the screens show only those actions. */
export function aiCapabilities(): string[] {
  return [
    ...Object.keys(incident).filter((k) => typeof (incident as Record<string, unknown>)[k] === "function").map((k) => `incident.${k}`),
    ...Object.keys(problem).filter((k) => typeof (problem as Record<string, unknown>)[k] === "function").map((k) => `problem.${k}`),
  ];
}
