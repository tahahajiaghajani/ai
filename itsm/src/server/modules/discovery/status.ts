// Status of the discovery module (design A §9): item status → discovery_state per CI or asset, the board queries, the
// event sink. DA2 owns this file and replaces the stub below; until then inventory passes stage each item's status
// (stage.ts) and nothing aggregates it onto its target.
import type { Ctx } from "../../context";
import type { JobContext, JobResult } from "../../jobs";

/** A status pass of a connector (job `discovery.status`): DA2. Until then it does nothing. */
export async function statusPass(_sys: Ctx, _connectorId: string, _jctx: JobContext): Promise<JobResult> {
  void _sys;
  void _connectorId;
  void _jctx;
}
