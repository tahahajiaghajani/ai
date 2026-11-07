// The assistant's tool catalogue. The platform offers a few generic tools — who is asking and where (the
// organisation, today's date in its calendar, the caller's role and access), its members, an exact calculator and
// charts of rows another tool stored. A module adds its own tools (reading its records, its reports, drafts of its
// records) with `registerTool`, next to the executors of its proposals (./proposals.ts). `toolsFor` returns the tools
// this caller may use, filtered by the member's permissions, the organisation's modules and the proposals switch.
import type { Ctx } from "../../../context";
import type { AiToolDef } from "./registry";
import { calculate, getOrgContext, renderChart } from "./basics";
import { listMembers } from "./members";

export const ALL_TOOLS: AiToolDef[] = [getOrgContext, listMembers, calculate, renderChart] as AiToolDef[];

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
