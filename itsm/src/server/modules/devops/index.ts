// DevOps (docs/modules/devops_FA.md): connections to repository and pipeline tools, signed inbound webhooks
// (POST /api/public/devops/hooks/:key — HMAC, idempotent by delivery id, rate limited), the normalised development
// data, deployments of the release module from pipelines with automatic standard changes from the change module's
// catalogue, the deployment gate (POST /api/public/devops/gates/:key) with hash-chained evidence, DORA metrics and the
// pipeline view. Tables: src/shared/tables/devops.ts; pure logic: src/shared/devops/logic.ts; screens:
// src/ui/modules/devops; HTTP: src/server/routes/devops.ts. `installDevopsModule()` (after the release module) wires
// in the hooks, the gate's approvals, the sweep (gate timeouts) and the seed of a new organisation.
import { registerOrgSeed } from "../orgs/service";
import { SEED_DELAY_MS } from "../sla";
import { onRecordEvent, systemCtx } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig, type JobContext } from "../../jobs";
import { actsHere } from "../notify";
import { installDevopsHooks } from "./hooks";
import { installGateApprovals, timeoutGates } from "./gate";
import { seedDevopsDefaultsIn, type SeedCounts } from "./seed";
import { liveRows } from "./common";

let installed = false;
const SWEEP_EVERY = 10 * 60_000;
const lastSweep = new Map<string, number>();

export async function seedDevopsDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedDevopsDefaultsIn(tx, sys, opts));
}

async function ensureGateSweep(q: JobContext["db"], orgId: string): Promise<void> {
  if (Date.now() - (lastSweep.get(orgId) ?? 0) < 5 * 60_000) return;
  lastSweep.set(orgId, Date.now());
  await enqueue(q, { kind: "devops.sweep", orgId, delayMs: 60_000, dedupeKey: "devops.sweep", maxAttempts: 5 });
}
export const resetDevopsSweepThrottle = () => lastSweep.clear();

export function installDevopsModule(): void {
  if (installed) return;
  installed = true;
  installDevopsHooks();
  installGateApprovals();
  onRecordEvent("devops.gates", async (e, jctx) => {
    if (actsHere(jctx.cfg)) await ensureGateSweep(jctx.db, e.org_id);
  }, { tables: ["change_gate"], kinds: ["record.created"] });
  registerJobHandler("devops.sweep", async (job, jctx) => {
    if (!job.org_id || !actsHere(jctx.cfg)) return;
    const sys = await systemCtx(jctx.cfg, job.org_id);
    await timeoutGates(sys);
    const open = await liveRows(sys.db, sys, "change_gate", { f: "state", op: "eq", v: "pending" }, { limit: 1 });
    return open.length ? { again: SWEEP_EVERY } : undefined;
  });
  registerJobHandler("devops.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedDevopsDefaults(jctx.cfg, job.org_id);
  });
  // after the release seed (environments, settings) and the change seed (the catalogue)
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "devops.seed", orgId, delayMs: SEED_DELAY_MS + 180_000, dedupeKey: "devops.seed", maxAttempts: 5 }).then(() => undefined));
}

export { seedDevopsDefaultsIn, DEVOPS_SEED_VERSION, PIPELINE_TEMPLATE_NAME, DEMO_CONNECTION_NAME, type SeedCounts } from "./seed";
export { ingestDelivery, processEvent, openConnection, authenticate, autoStandardChange, connectionByKey, type IngestResult } from "./ingest";
export { requestGate, gateStatus, openGateIn, timeoutGates, verifyChain, evidenceHash, canonical, type GateRequest } from "./gate";
export { doraView, pipelineView, developmentOf } from "./views";
export { verifyDelivery, newSecret, randomKey, hmacHex, numberPrefixes, tableOfNumber } from "./common";
