// The assistant's tool registry — the contract between the agent loop and the tool implementations.
// Tools run as the signed-in user: they get the caller's Ctx, re-check permissions like the route they
// mirror, never accept an org or user id from the model, return bounded JSON (amounts as decimal strings
// with units, Jalali dates) and never write.
// Writes are proposals: a tool of kind "propose" returns `proposal`; the loop stores it and a person
// confirms it later through POST /ai/actions/:id/confirm, which calls the proposal's executor.
import type { z } from "zod";
import type { Ctx } from "../../../context";
import type { Area, Level } from "@shared/permissions";
import type { AiChartSpec, AiRef } from "@shared/ai/types";
import type { ModuleKey } from "@shared/constants";

export interface ToolRuntime {
  /** today's Gregorian date (YYYY-MM-DD) in the organisation's time zone */
  today: string;
  /** masked | full | aggregates — personal identifiers must be masked unless "full" */
  dataPolicy: "full" | "masked" | "aggregates";
  /** store rows for a chart or a table shown in the answer; returns a data_ref id */
  putData(rows: Record<string, unknown>[], meta?: { title?: string }): Promise<string>;
  signal?: AbortSignal;
}

/** What a proposal tool hands to the loop; the loop stores it in sm_ai_actions. */
export interface AiProposalInput {
  kind: string; // must have an executor registered in ./proposals.ts
  title_fa: string;
  summary_fa: string;
  /** the cleaned, validated input the executor will run with (stored server-side, never from the client) */
  payload: unknown;
  preview: { label: string; value: string }[];
  lines?: { cells: string[] }[];
  line_headers?: string[];
  warnings?: string[];
  edit_path?: string;
  area: Area;
  level: Level; // level the confirming person needs
  /**
   * the record(s) it is about: only people who may read the record — a batch (id null): every `@r:<table>:<id>` token
   * in `fields` — and every field named in `fields` see the proposal (and only they may apply it, with their own access)
   */
  record?: { table: string; id: string | null; fields?: string[] };
  /** a batch: how many records it changes */
  count?: number;
}

export interface ToolResult {
  /** JSON for the model: bounded (top N + totals + truncated flag), decimal strings, units, Jalali dates */
  data: unknown;
  /** one Persian line for the progress chip, e.g. «۱۲ عضو پیدا شد» */
  summary_fa?: string;
  refs?: AiRef[];
  /** rows stored with rt.putData for the UI */
  data_ref?: string;
  chart?: AiChartSpec;
  table?: { title?: string; columns: { key: string; title: string; numeric?: boolean }[]; total_rows: number };
  proposal?: AiProposalInput;
}

export interface AiToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  /** snake_case, stable */
  name: string;
  /** Persian label of the progress chip, e.g. «فهرست اعضا» */
  title_fa: string;
  /** for the model, in English, precise about units and what the tool cannot do */
  description: string;
  input: S;
  kind: "read" | "propose" | "meta";
  /** permission needed to see and use the tool (in addition to ai:view / ai:edit for proposals) */
  area: Area;
  level: Level;
  /** only offered when the organisation has these modules switched on */
  modules?: ModuleKey[];
  run(ctx: Ctx, input: z.infer<S>, rt: ToolRuntime): Promise<ToolResult>;
}

export function defineTool<S extends z.ZodTypeAny>(def: AiToolDef<S>): AiToolDef<S> {
  return def;
}
