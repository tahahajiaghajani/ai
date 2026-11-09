// Light IT financial management (docs/modules/financial_FA.md): tables in src/shared/tables/financial.ts, pure logic
// in src/shared/financial/logic.ts, screens in src/ui/modules/financial, the HTTP API in src/server/routes/financial.ts.
// `installFinancialModule()` (src/server/routes/modules.ts, after ITAM and the supplier module whose costs it captures):
// hooks, the approvals service approving submitted budgets (a rejection returns them to draft), the daily sweep (this
// month's and last month's costs captured, budget alerts, next year's calendar from Esfand), the variance narrative
// skill, the seed.
import { onApprovalSettled, SEED_DELAY_MS } from "../sla";
import { registerOrgSeed } from "../orgs/service";
import { systemCtx, transitionIn } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import { actsHere } from "../notify";
import { fiscalYearOf, periodKeyOf } from "@shared/financial/logic";
import { addDays } from "@shared/jalali";
import type { Ctx } from "../../context";
import { installFinancialHooks } from "./hooks";
import { installFinancialAi } from "./ai";
import { budgetAlerts, capture, ensureFiscalYear, financialConfig } from "./service";
import { seedFinancialDefaultsIn } from "./seed";
import { orgToday } from "../itam/common";
import type { SeedCounts } from "../itam/seed";

let installed = false;
const DAY = 24 * 3600_000;
const lastSweep = new Map<string, number>();

export async function seedFinancialDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedFinancialDefaultsIn(tx, sys, opts));
}

export async function ensureFinancialSweep(q: Parameters<typeof enqueue>[0], orgId: string, delayMs = 10 * 60_000): Promise<void> {
  if (Date.now() - (lastSweep.get(orgId) ?? 0) < 3600_000) return;
  lastSweep.set(orgId, Date.now());
  await enqueue(q, { kind: "financial.sweep", orgId, delayMs, dedupeKey: "financial.sweep", maxAttempts: 5 });
}
export const resetFinancialSweepThrottle = () => lastSweep.clear();

/** The daily work: costs of this month and the last captured, budget alerts, next year's calendar near the year's end. */
export async function financialSweep(sys: Ctx): Promise<{ captured: number; alerts: number }> {
  const today = orgToday(sys);
  const cfg = await financialConfig(sys.db, sys);
  let captured = 0;
  if (cfg.auto_capture) {
    for (const d of [addDays(today, -32), today]) captured += (await capture(sys, periodKeyOf(d))).created;
  }
  const jy = fiscalYearOf(today);
  await ensureFiscalYear(sys, jy);
  if (fiscalYearOf(addDays(today, 30)) !== jy) await ensureFiscalYear(sys, jy + 1);
  const alerts = await budgetAlerts(sys);
  return { captured, alerts };
}

export function installFinancialModule(): void {
  if (installed) return;
  installed = true;
  installFinancialHooks();
  installFinancialAi();
  onApprovalSettled("budget", async ({ tx, ctx, record, outcome }) => {
    if (record.state !== "submitted") return;
    if (outcome === "approved") await transitionIn(tx, ctx, "budget", String(record.id), "approved", {});
    if (outcome === "rejected") await transitionIn(tx, ctx, "budget", String(record.id), "draft", {});
  });
  registerJobHandler("financial.sweep", async (job, jctx) => {
    if (!job.org_id || !actsHere(jctx.cfg)) return;
    await financialSweep(await systemCtx(jctx.cfg, job.org_id));
    return { again: DAY };
  });
  registerJobHandler("financial.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedFinancialDefaults(jctx.cfg, job.org_id);
    await ensureFinancialSweep(jctx.db, job.org_id, DAY);
  });
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "financial.seed", orgId, delayMs: SEED_DELAY_MS + 5 * 60_000, dedupeKey: "financial.seed", maxAttempts: 5 }).then(() => undefined));
}

export { budgetVsActualFor, spendFor, capture, reverseEntry, calculateRun, postRun, statementOf, serviceCost, ensureFiscalYear, financialConfig, budgetAlerts } from "./service";
export { varianceNarrative, varianceFacts, varianceText, FINANCIAL_SKILLS } from "./ai";
export { seedFinancialDefaultsIn, FINANCIAL_SEED_VERSION } from "./seed";
