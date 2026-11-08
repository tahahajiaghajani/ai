// Extension points of the AI layer in service requests — the one place it plugs in (catalogue REQ-056…REQ-064;
// docs/modules/request_FA.md «هوش مصنوعی»). docs/spec/AI.md is not on this branch yet: until the AI layer registers
// implementations, the routes answer 501 for these features and the screens hide their buttons
// (`requestAiCapabilities()` tells them which exist). Contract for implementations:
//   · run as the person: use the `ctx` given (never a system context for a person's request); read through the engine
//     with that ctx, so the model never sees what the person may not read;
//   · never inside a write transaction and never writing: they return drafts and suggestions; a person applies them
//     through the normal routes (the builder saves a generated item as a draft; the order form shows suggested answers
//     the person confirms; the server checks them like any answers);
//   · questions classed sensitive or secret (REQ-041) never reach a prompt — `promptSafe` strips them.
//
// TODO(AI layer):
//   - REQ-058 generateItem: details, questions, policies, approval and a flow draft from a description
//   - REQ-057 prefill: answers of an item's form from free text or an e-mail (only applied when every required answer
//     is filled; otherwise a suggestion), and `matchItems` for intent-to-item matching (embedding shortlist + LLM)
//   - REQ-056 conversational ordering: every published item an assistant tool built from its schema, as the requester
//   - REQ-059 approval assistance: summary, policy checks and a recommendation on a pending approval
//   - REQ-060 agentic fulfilment of low-risk items through tools, supervised per item
//   - REQ-061 delivery-date and breach prediction; REQ-062 summaries and reply drafts; REQ-064 catalogue gaps from
//     ad-hoc requests and search failures
import type { Ctx } from "../../context";
import type { Answers, FormSchema } from "@shared/request/form";
import { isPrivateClass } from "@shared/request/form";

/** A catalogue item drafted from text (the builder saves it as a draft; nothing is published by the model). */
export interface ItemDraft {
  name: string;
  short_description?: string;
  description?: string;
  type?: string;
  delivery_days?: number | null;
  variables: { name: string; label: string; type: string; required?: boolean; choices?: { value: string; label: string }[]; help?: string }[];
  policies?: { name: string; condition: unknown; actions: { variable: string; visible?: boolean; mandatory?: boolean }[] }[];
  approval?: { levels: unknown[] } | null;
  tasks?: { short_description: string; instructions?: string }[];
  /** fields the model filled (shown as «پیشنهاد هوش مصنوعی» until a person edits them) */
  generated: string[];
}

export interface RequestAi {
  /** REQ-058 an item drafted from a description (in the catalogue `catalogId`) */
  generateItem?(ctx: Ctx, input: { text: string; catalogId?: string | null }): Promise<ItemDraft>;
  /** REQ-057 answers of an item's form from free text, with a confidence per answer */
  prefill?(ctx: Ctx, input: { itemId: string; schema: FormSchema; text: string }): Promise<{ answers: Answers; confidence: Record<string, number> }>;
  /** REQ-057 items that match a free-text need (ids the caller may order, best first) */
  matchItems?(ctx: Ctx, input: { text: string; limit: number }): Promise<{ id: string; score: number }[]>;
  /** REQ-059 a summary and recommendation for an approver */
  approvalBrief?(ctx: Ctx, input: { requestItemId: string }): Promise<{ summary: string; recommendation?: "approve" | "reject" | "ask"; reasons?: string[] }>;
  /** REQ-062 a summary of a requested item and its tasks */
  summarize?(ctx: Ctx, input: { requestItemId: string }): Promise<{ text: string }>;
}

let impl: RequestAi = {};

/** Plug the AI layer's request skills in (a later registration replaces the earlier one); returns an unregister function. */
export function registerRequestAi(next: RequestAi): () => void {
  impl = next;
  return () => {
    if (impl === next) impl = {};
  };
}

export const requestAi = (): RequestAi => impl;

/** Which AI skills are registered («request.generateItem», «request.prefill» …): the screens show only those actions. */
export function requestAiCapabilities(): string[] {
  return Object.keys(impl).filter((k) => typeof (impl as Record<string, unknown>)[k] === "function").map((k) => `request.${k}`);
}

/** The questions and answers a prompt may carry: sensitive and secret ones are left out (REQ-041). */
export function promptSafe(schema: FormSchema, answers: Answers): { schema: FormSchema; answers: Answers } {
  const keep = schema.variables.filter((v) => v.type !== "secret" && !isPrivateClass(v.field_class));
  const names = new Set([...keep.map((v) => v.name), ...schema.grids.filter((g) => !g.columns.some((c) => isPrivateClass(c.field_class))).map((g) => g.code)]);
  return {
    schema: { ...schema, variables: keep, grids: schema.grids.filter((g) => names.has(g.code)) },
    answers: Object.fromEntries(Object.entries(answers).filter(([k]) => names.has(k))),
  };
}
