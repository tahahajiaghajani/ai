// Supplier and contract management (docs/modules/supplier_FA.md): tables in src/shared/tables/supplier.ts, pure logic
// in src/shared/supplier, screens in src/ui/modules/supplier, the HTTP API in src/server/routes/supplier.ts.
// `installSupplierModule()` (src/server/routes/modules.ts): hooks, the approvals service activating approved contracts
// (a rejected one goes back to negotiation), the daily sweep (renewal reminders once per threshold, expiry or automatic
// renewal, obligations coming due) and the monthly scorecards, the clause extraction skill, the seed.
import { onApprovalSettled, SEED_DELAY_MS, settledVerdict } from "../sla";
import { registerOrgSeed } from "../orgs/service";
import { systemCtx, transitionIn } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import { actsHere } from "../notify";
import { installSupplierHooks } from "./hooks";
import { installSupplierAi } from "./ai";
import { computeScorecards, supplierSweep } from "./service";
import { seedSupplierDefaultsIn } from "./seed";
import type { SeedCounts } from "../itam/seed";

let installed = false;
const DAY = 24 * 3600_000;
const lastSweep = new Map<string, number>();

export async function seedSupplierDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedSupplierDefaultsIn(tx, sys, opts));
}

/** Queue the organisation's daily contract sweep (at most once per hour per process). */
export async function ensureSupplierSweep(q: Parameters<typeof enqueue>[0], orgId: string, delayMs = 5 * 60_000): Promise<void> {
  if (Date.now() - (lastSweep.get(orgId) ?? 0) < 3600_000) return;
  lastSweep.set(orgId, Date.now());
  await enqueue(q, { kind: "supplier.sweep", orgId, delayMs, dedupeKey: "supplier.sweep", maxAttempts: 5 });
}
export const resetSupplierSweepThrottle = () => lastSweep.clear();

export function installSupplierModule(): void {
  if (installed) return;
  installed = true;
  installSupplierHooks();
  installSupplierAi();
  // the contract's approvals as a whole (settledVerdict): never a withdrawal, never one round of several
  onApprovalSettled("contract", async (s) => {
    const { tx, ctx, record } = s;
    if (record.state !== "pending_approval") return;
    const verdict = settledVerdict(s);
    if (verdict === "approved") await transitionIn(tx, ctx, "contract", String(record.id), "active", {});
    if (verdict === "rejected") await transitionIn(tx, ctx, "contract", String(record.id), "negotiation", {});
  });
  registerJobHandler("supplier.sweep", async (job, jctx) => {
    if (!job.org_id || !actsHere(jctx.cfg)) return;
    const sys = await systemCtx(jctx.cfg, job.org_id);
    await supplierSweep(sys);
    await computeScorecards(sys);
    return { again: DAY };
  });
  registerJobHandler("supplier.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedSupplierDefaults(jctx.cfg, job.org_id);
    await ensureSupplierSweep(jctx.db, job.org_id, DAY);
  });
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "supplier.seed", orgId, delayMs: SEED_DELAY_MS + 4 * 60_000, dedupeKey: "supplier.seed", maxAttempts: 5 }).then(() => undefined));
}

export { renewals, renewContract, supplier360, computeScorecards, supplierSweep, contractText, supplierConfig } from "./service";
export { extractClauses, SUPPLIER_SKILLS } from "./ai";
export { seedSupplierDefaultsIn, SUPPLIER_SEED_VERSION } from "./seed";
