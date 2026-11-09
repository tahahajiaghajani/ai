// Project and portfolio management (docs/modules/project_FA.md): tables in src/shared/tables/project.ts, pure logic
// (critical path, WBS, health, scores, heat map) in src/shared/project/logic.ts, screens in src/ui/modules/project,
// HTTP in src/server/routes/project.ts. `installProjectModule()` wires in:
//   · hooks and the gate guard «project_gate», the time approver guard
//   · the project gate on the approvals service (the sponsor, then the portfolio's manager: approver source
//     «portfolio_manager»); a settled round moves the project from «در انتظار تصویب»
//   · jobs: project.recalc (plan, roll-ups, health), project.hours (approved time), the daily sweep of running projects
//   · the AI skill project.status_summary; record meta `project`; the seed of a new organisation
import { PROJECT_RUNNING } from "@shared/tables/project";
import { registerOrgSeed } from "../orgs/service";
import { onApprovalSettled, registerApproverSource, SEED_DELAY_MS } from "../sla";
import { access } from "../../access/provider";
import { onRecordEvent, registerRecordMeta, systemCtx, transitionIn } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig, type JobContext } from "../../jobs";
import { actsHere } from "../notify";
import { installProjectHooks } from "./hooks";
import { installProjectSkills } from "./ai";
import { recalcProjectIn } from "./schedule";
import { hoursOfTask } from "./actions";
import { seedProjectDefaultsIn, type SeedCounts } from "./seed";
import { isUuid, liveRow, liveRows, managesProjects } from "./common";

let installed = false;
const SWEEP_EVERY = 6 * 3_600_000;
const lastSweep = new Map<string, number>();

export async function seedProjectDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedProjectDefaultsIn(tx, sys, opts));
}

async function ensureProjectSweep(q: JobContext["db"], orgId: string): Promise<void> {
  if (Date.now() - (lastSweep.get(orgId) ?? 0) < 60 * 60_000) return;
  lastSweep.set(orgId, Date.now());
  await enqueue(q, { kind: "project.sweep", orgId, delayMs: 5 * 60_000, dedupeKey: "project.sweep", maxAttempts: 5 });
}
export const resetProjectSweepThrottle = () => lastSweep.clear();

export function installProjectModule(): void {
  if (installed) return;
  installed = true;
  installProjectHooks();
  installProjectSkills();
  // «مدیر سبد» in approval rules: the project's portfolio manager, else its owner
  registerApproverSource("portfolio_manager", async (q, ctx, _def, row) => {
    if (!isUuid(row.portfolio_id)) return [];
    const p = await liveRow(q, ctx, "portfolio", row.portfolio_id);
    return [p?.manager_id ?? p?.owner_id].filter((x): x is string => typeof x === "string" && !!x && x !== row.project_manager_id);
  });
  onApprovalSettled("project", async ({ tx, ctx, record, outcome }) => {
    if (record.state !== "gate" || outcome === "canceled") return;
    await transitionIn(tx, ctx, "project", String(record.id), outcome === "approved" ? "approved" : "proposed", {}, { trusted: true });
  });
  registerRecordMeta("project", async ({ q, ctx, def, row }) => ({ project: { can_work: access().canWrite(ctx, def, row), manages: await managesProjects(q, ctx) } }));
  registerJobHandler("project.recalc", async (job, jctx) => {
    if (!job.org_id || typeof job.payload?.id !== "string") return;
    const sys = await systemCtx(jctx.cfg, job.org_id);
    await sys.write((tx) => recalcProjectIn(tx, sys, String(job.payload.id)));
  });
  registerJobHandler("project.hours", async (job, jctx) => {
    if (!job.org_id || typeof job.payload?.task !== "string") return;
    await hoursOfTask(await systemCtx(jctx.cfg, job.org_id), String(job.payload.task));
  });
  registerJobHandler("project.sweep", async (job, jctx) => {
    if (!job.org_id || !actsHere(jctx.cfg)) return;
    const sys = await systemCtx(jctx.cfg, job.org_id);
    const running = await liveRows(sys.db, sys, "project", { f: "state", op: "in", v: PROJECT_RUNNING }, { limit: 1000 });
    for (const p of running) {
      if (Date.now() > jctx.deadline) return { again: 60_000 };
      await sys.write((tx) => recalcProjectIn(tx, sys, String(p.id)));
    }
    return running.length ? { again: SWEEP_EVERY } : undefined;
  });
  onRecordEvent("project", async (e, jctx) => {
    if (actsHere(jctx.cfg)) await ensureProjectSweep(jctx.db, e.org_id);
  }, { tables: ["project"], kinds: ["record.created", "record.state_changed"] });
  registerJobHandler("project.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedProjectDefaults(jctx.cfg, job.org_id);
  });
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "project.seed", orgId, delayMs: SEED_DELAY_MS + 60_000, dedupeKey: "project.seed", maxAttempts: 5 }).then(() => undefined));
}

export { seedProjectDefaultsIn, PROJECT_SEED_VERSION, PROJECT_ROLES, type SeedCounts } from "./seed";
export { recalcProjectIn, takeBaselineIn, baselineVariance } from "./schedule";
export { convertDemand, projectFrom, copyProject, baseline, recalcProject, draftStatus, statusFacts, timesheet, hoursOfTask, needProjectWrite, PROJECT_ORIGINS } from "./actions";
export { ganttOf, portfolioView, demandBoard, resourceView } from "./views";
export { projectConfig, managesProjects } from "./common";
export { projectSkills } from "./ai";
