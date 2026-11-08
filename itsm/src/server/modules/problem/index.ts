// Problem management (docs/modules/problem_FA.md): tables in src/shared/tables/problem.ts, screens in
// src/ui/modules/problem, HTTP API in src/server/routes/problem.ts. `installProblemModule()` (once per process, after
// the incident module) registers the hooks, the subscriber and jobs, the ITIL matrix default of `problem`, the record
// meta `problem` (may the caller work it / take the manager's decisions) and the seed of a new organisation.
import { registerPriorityDefault, SEED_DELAY_MS } from "../sla";
import { registerOrgSeed } from "../orgs/service";
import { registerRecordMeta, systemCtx } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import { aiCapabilities, canManageMajor, canWork, type SeedCounts } from "../incident";
import { installProblemHooks } from "./hooks";
import { installProblemJobs } from "./jobs";
import { seedProblemDefaultsIn } from "./seed";

let installed = false;

export async function seedProblemDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedProblemDefaultsIn(tx, sys, opts));
}

export function installProblemModule(): void {
  if (installed) return;
  installed = true;
  installProblemHooks();
  installProblemJobs();
  registerPriorityDefault("problem");
  registerRecordMeta("problem", ({ ctx, def, row }) => ({
    problem: { can_work: canWork(ctx, def, row), can_manage: canManageMajor(ctx, def, row), ai: aiCapabilities().filter((k) => k.startsWith("problem.")) },
  }));
  registerJobHandler("problem.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedProblemDefaults(jctx.cfg, job.org_id);
  });
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "problem.seed", orgId, delayMs: SEED_DELAY_MS + 90_000, dedupeKey: "problem.seed", maxAttempts: 5 }).then(() => undefined));
}

export { seedProblemDefaultsIn, PROBLEM_SEED_VERSION } from "./seed";
export { recountProblem, recountKnownError } from "./hooks";
export {
  createFromIncidents, linkIncidents, mergeProblems, shareSolution, createKnownError, copyFindings, runCandidates, promoteCandidate, mergeCandidate,
  type Outcome, type FromIncidentsInput,
} from "./services";
export { problemSweep, ensureProblemSweep, resetProblemSweepThrottle, PROBLEM_SWEEP_EVERY, type ProblemSweepResult } from "./jobs";
export { problemDashboard, type ProblemDashboard } from "./dashboard";
