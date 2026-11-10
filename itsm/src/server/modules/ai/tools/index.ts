// The assistant's tool catalogue. The platform offers a few generic tools — who is asking and where (the
// organisation, today's date in its calendar, the caller's role and access), its members, an exact calculator, charts of
// rows another tool stored and the search over the knowledge they may read. A module adds its own tools (reading its
// records, its reports, drafts of its records) with `registerTool`, next to the executors of its proposals
// (./proposals.ts). `toolsFor` returns the tools this caller may use, filtered by the member's permissions, the
// organisation's modules and the proposals switch.
//
// On top of these, every table the caller may read has generated tools (./records.ts: search, get, aggregate, history
// and drafts), chosen per turn by tool retrieval (./select.ts): `toolsForTurn` assembles what one answer is offered.
import type { Ctx } from "../../../context";
import type { AiPageContext } from "@shared/ai/types";
import type { AiToolDef } from "./registry";
import { calculate, getOrgContext, renderChart } from "./basics";
import { listMembers } from "./members";
import { searchKnowledge } from "./knowledge";
import { recordTools, type ToolEntry } from "./records";
import { selectRecordTools, TOOLS_PER_TURN } from "./select";
import { installRecordExecutors } from "./record-executors";

export const ALL_TOOLS: AiToolDef[] = [getOrgContext, listMembers, calculate, renderChart, searchKnowledge] as AiToolDef[];

/** Adds a module's tool (a tool of the same name is replaced). Returns its removal. */
export function registerTool(tool: AiToolDef): () => void {
  const at = ALL_TOOLS.findIndex((t) => t.name === tool.name);
  if (at >= 0) ALL_TOOLS.splice(at, 1, tool);
  else ALL_TOOLS.push(tool);
  return () => {
    const i = ALL_TOOLS.indexOf(tool);
    if (i >= 0) ALL_TOOLS.splice(i, 1);
  };
}

export function toolsFor(ctx: Ctx, opts: { proposals: boolean }): AiToolDef[] {
  return ALL_TOOLS.filter(
    (t) =>
      ctx.can(t.area, t.level) &&
      (!t.modules || t.modules.every((m) => ctx.hasModule(m))) &&
      (t.kind !== "propose" || (opts.proposals && ctx.can("ai", "edit"))),
  );
}

export function toolByName(name: string): AiToolDef | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

/** Every tool a caller may use: the registered ones and the generated record tools (not yet built). */
export async function toolCatalog(ctx: Ctx, opts: { proposals: boolean }): Promise<{ registered: AiToolDef[]; generated: ToolEntry[] }> {
  installRecordExecutors();
  const proposals = opts.proposals && ctx.can("ai", "edit");
  const registered = toolsFor(ctx, { proposals });
  const names = new Set(registered.map((t) => t.name));
  const generated = (await recordTools(ctx, { proposals })).filter((e) => !names.has(e.name));
  return { registered, generated };
}

/**
 * The tools of one answer: every registered tool the caller may use, and the generated record tools that fit the page
 * and the question (tool retrieval) — plus those already used in the conversation.
 */
export async function toolsForTurn(
  ctx: Ctx,
  opts: { proposals: boolean; question: string; context?: AiPageContext | null; used?: string[]; max?: number },
): Promise<AiToolDef[]> {
  const { registered, generated } = await toolCatalog(ctx, opts);
  const picked = selectRecordTools(generated, { question: opts.question, context: opts.context, used: opts.used }, { max: opts.max ?? TOOLS_PER_TURN });
  return [...registered, ...picked.map((e) => e.build())];
}

export { recordTools, excludeFromTools, registerToolTableView, type ToolEntry, type RecordOp, type ToolTableView } from "./records";
export { selectRecordTools, contextTable, TOOLS_PER_TURN } from "./select";
export { installRecordExecutors } from "./record-executors";
