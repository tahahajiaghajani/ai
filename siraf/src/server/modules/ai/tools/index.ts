// Tool catalogue (stream D). `toolsFor` returns the tools this caller may use, filtered by the
// member's permissions, the business's modules and the AI feature switches.
import type { Ctx } from "../../../context";
import type { AiToolDef } from "./registry";
import { calculate, getBusinessContext, renderChart } from "./basics";
import { findRecords, getRecord } from "./records";
import { runReportTool } from "./reports";
import { analyzeMetric } from "./metrics";
import { coinBubbleTool, getRates, positions, priceQuote } from "./market";
import { chequesCalendarTool, findAnomaliesTool, forecastTool, inventoryAdvice, receivablesCollection } from "./operations";
import { proposeFxDeal, proposeGoldDoc, proposeInvoice, proposeParty, proposeTreasuryDoc, proposeVoucher } from "./propose";

export const ALL_TOOLS: AiToolDef[] = [
  getBusinessContext,
  findRecords,
  getRecord,
  runReportTool,
  analyzeMetric,
  calculate,
  getRates,
  priceQuote,
  positions,
  forecastTool,
  receivablesCollection,
  chequesCalendarTool,
  inventoryAdvice,
  findAnomaliesTool,
  coinBubbleTool,
  renderChart,
  proposeInvoice,
  proposeVoucher,
  proposeTreasuryDoc,
  proposeGoldDoc,
  proposeFxDeal,
  proposeParty,
] as AiToolDef[];

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
