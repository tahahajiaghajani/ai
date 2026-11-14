// Workflow cases run on the flows executor (design F D4, F4a): a run of kind `process` executes the graph of its
// case's published `process_version` (the run's `version_id`; `flow_id` is the process), not a flow version, and the
// process's own node handlers (`processHandlers`: the form step, «انتخاب», «تعیین مقدار», the notices) apply to its
// runs only — automation flows never meet them. The run's trigger record is the case (`process_case`).
import type { Queryable } from "../../../db";
import type { FlowGraph } from "@shared/flows";
import { CASE_ROOT } from "@shared/process/graph";
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

/**
 * The case as its run reads it (`{{case.…}}`): its values by library field name, beside its number, title, people
 * and unit (CASE_META_KEYS) — fresh before every step, so a condition after a step sees what that step merged.
 */
export async function caseContext(q: Queryable, orgId: string, caseId: string | null): Promise<Record<string, unknown> | null> {
  if (!caseId) return null;
  const row = await q.one<{ number: string | null; title: string | null; requested_by: string | null; requested_for: string | null; unit_id: string | null; data: Record<string, unknown> | null }>(
    `select number, title, requested_by, requested_for, unit_id, data from sm_process_cases where org_id = $1 and id = $2`,
    [orgId, caseId],
  );
  if (!row) return null;
  const values = row.data && typeof row.data === "object" && !Array.isArray(row.data) ? row.data : {};
  return { ...values, number: row.number, title: row.title, requested_by: row.requested_by, requested_for: row.requested_for, unit_id: row.unit_id };
}

/** Register the `process` run kind with the executor (once per process; returns the unregister function). */
export function registerProcessRuns(): () => void {
  return registerRunKind(PROCESS_RUN_KIND, {
    graph: (q, run) => processVersionGraph(q, run.org_id, run.version_id),
    handlers: processHandlers,
    async context(q, run) {
      if (run.trigger_table !== "process_case") return null;
      const kase = await caseContext(q, run.org_id, run.trigger_record_id);
      return kase ? { [CASE_ROOT]: kase } : null;
    },
  });
}
