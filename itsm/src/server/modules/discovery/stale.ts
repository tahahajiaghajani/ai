// The contact ladder (design A §10): gone → stale → missing → retired, judged on the tools' own last contact, with
// the mass-drop guard, `delete_policy` and missing-asset tasks. DA1 part 2 owns this file and replaces the stub below;
// the pull runner already queues `discovery.stale` after every complete pass the guard let through.
import type { Ctx } from "../../context";
import type { Job, JobContext, JobResult } from "../../jobs";

/** The ladder of one connector's targets (job `discovery.stale`): DA1 part 2. Until then it does nothing. */
export async function staleJob(_sys: Ctx, _connectorId: string, _job: Job, _jctx: JobContext): Promise<JobResult> {
  void _sys;
  void _connectorId;
  void _job;
  void _jctx;
}
