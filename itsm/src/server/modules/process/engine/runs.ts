// Workflow cases run on the flows executor (design F D4, F4a): a run of kind `process` executes the graph of its
// case's published `process_version` (the run's `version_id`; `flow_id` is the process), not a flow version, and the
// process's own node handlers (`processHandlers`: the form step, «انتخاب», «تعیین مقدار», the notices) apply to its
// runs only — automation flows never meet them. The run's trigger record is the case (`process_case`).
import type { Queryable } from "../../../db";
import type { FlowGraph } from "@shared/flows";
import { registerRunKind } from "../../flows/executor";
import type { FlowStepHandler } from "../../flows/registry";

/** The `trigger_kind` of a case's run. */
export const PROCESS_RUN_KIND = "process";

/** Node handlers for process runs only, by node type (filled by the engine's step handlers). */
export const processHandlers: Record<string, FlowStepHandler> = {};

/** The graph of a published process version (null: no such version in the organisation). */
export async function processVersionGraph(q: Queryable, orgId: string, versionId: string | null): Promise<FlowGraph | null> {
  if (!versionId || !/^[0-9a-f-]{36}$/i.test(versionId)) return null;
  const row = await q.one<{ graph: FlowGraph | null }>(`select graph from sm_process_versions where org_id = $1 and id = $2`, [orgId, versionId]);
  return row?.graph && Array.isArray(row.graph.nodes) ? row.graph : null;
}

/** Register the `process` run kind with the executor (once per process; returns the unregister function). */
export function registerProcessRuns(): () => void {
  return registerRunKind(PROCESS_RUN_KIND, {
    graph: (q, run) => processVersionGraph(q, run.org_id, run.version_id),
    handlers: processHandlers,
  });
}
