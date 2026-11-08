// Extension points of the AI layer in change enablement — the one place it plugs in (catalogue CHG-012, 024, 025,
// 039, 049, 053, 068–072; docs/modules/change_FA.md «هوش مصنوعی»).
//
// Every feature here works without AI: the risk explanation, the CAB pack and minutes, the PIR draft, similar changes,
// the readiness check and free slots have deterministic versions in the module; an implementation registered here
// adds a narrative or a draft on top and the screens show its buttons only when `aiCapabilities()` names it.
// Contract for implementations:
//   · run as the person: use the `ctx` given (never a system context for a person's request); read through the engine
//     with that ctx, so the model never sees what the person may not read;
//   · never inside a write transaction and never writing: they return text or proposals that a person applies (the
//     routes write what the person accepted, with their own access);
//   · AI never authorizes a change, never records a CAB decision and never passes a gate on its own.
import type { Ctx } from "../../context";

export type PlanField = "implementation_plan" | "backout_plan" | "test_plan" | "communication_plan" | "justification";
export type PirSection = "side_effects" | "timeline_md" | "went_well" | "went_wrong" | "lessons" | "follow_up";

export interface ChangeAi {
  /** CHG-024 a Persian narrative of why the change has its risk, grounded on the stored factors */
  riskNarrative?(ctx: Ctx, changeId: string): Promise<{ text: string }>;
  /** CHG-025 suggested answers (with reasons) for the risk questionnaire */
  riskAnswers?(ctx: Ctx, changeId: string): Promise<{ question_id: string; value: string; reason?: string }[]>;
  /** CHG-069 drafts of plans and justification (the person edits before saving) */
  draftPlans?(ctx: Ctx, changeId: string, fields: PlanField[]): Promise<Partial<Record<PlanField, string>>>;
  /** CHG-068 a state-aware summary of the change */
  summarize?(ctx: Ctx, changeId: string): Promise<{ text: string }>;
  /** CHG-071 semantic neighbours (ids and a 0–1 score); re-read with the caller's access before use */
  similar?(ctx: Ctx, changeId: string, opts: { limit: number }): Promise<{ id: string; score: number }[]>;
  /** CHG-070 a documentation-quality rubric over the deterministic readiness checks */
  validate?(ctx: Ctx, changeId: string): Promise<{ score: number; findings: string[] }>;
  /** CHG-039 the CAB pack of a meeting (one page per change) */
  cabPack?(ctx: Ctx, meetingId: string): Promise<{ text: string }>;
  /** CHG-039 minutes and action items drafted from the meeting's notes and decisions */
  draftMinutes?(ctx: Ctx, meetingId: string): Promise<{ text: string }>;
  /** CHG-053 sections of the post-implementation review (merged over the deterministic draft) */
  draftPir?(ctx: Ctx, changeId: string): Promise<Partial<Record<PirSection, string>>>;
  /** CHG-049 a narrative of the candidate slots the deterministic assistant found */
  explainSlots?(ctx: Ctx, changeId: string, slots: { start: string; end: string }[]): Promise<{ text: string }>;
  /** CHG-012 standard-change candidates among recent successful normal changes (system context of the organisation) */
  standardCandidates?(ctx: Ctx, opts: { windowDays: number }): Promise<{ changes: string[]; title: string; confidence: number }[]>;
}

let impl: ChangeAi = {};

/** Plug the AI layer's change skills in (a later registration replaces the earlier one); returns an unregister function. */
export function registerChangeAi(next: ChangeAi): () => void {
  impl = next;
  return () => {
    if (impl === next) impl = {};
  };
}

export const changeAi = (): ChangeAi => impl;

/** Which AI skills are registered («change.riskNarrative» …): the screens show only those actions. */
export function aiCapabilities(): string[] {
  return Object.keys(impl)
    .filter((k) => typeof (impl as Record<string, unknown>)[k] === "function")
    .map((k) => `change.${k}`);
}
