// Security operations, vulnerability response and governance, risk and compliance (docs/modules/security_FA.md):
// tables in src/shared/tables/security.ts, pure logic in src/shared/security, screens in src/ui/modules/security,
// HTTP API in src/server/routes/security.ts. `installSecurityModule()` (once per process, src/server/routes/modules.ts,
// after the SLA service and the modules whose records it links) wires the module into the platform:
//   · hooks of its tables (hooks.ts): the secure workspace, risk scores, phases, custody, deadlines, vulnerability
//     scoring and exceptions, GRC status, risk calculations — with `derivePush` for a Windows app's pushes
//   · subscribers and jobs (jobs.ts): auto-promotion of IT incidents, security reviews of changes, evidence hashes,
//     major security incidents, approval rounds, rescoring, the hourly sweep
//   · the AI index and channels (rag.ts), the policy-campaign audience as a participant grant, the AI skills (ai.ts)
//   · the link kind «ارتقا به / ارتقایافته از» between IT and security incidents
//   · record meta `security` (AI skills; for security records, the read audit) and the seed of a new organisation
// Extension points: `importScan` (scanner connectors), `reportPhishing` (an inbound mailbox), `autoPromote`,
// `measureIndicators` / `indicatorValue` (the analytics module wires these as indicators at integration).
import { registerLinkKind } from "@shared/model/links";
import { registerRecordMeta, systemCtx } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import { registerOrgSeed } from "../orgs/service";
import { SEED_DELAY_MS } from "../sla";
import type { SeedCounts } from "../incident";
import { installSecurityHooks } from "./hooks";
import { ensureSecuritySweep, installSecurityJobs } from "./jobs";
import { installSecurityRag } from "./rag";
import { installSecuritySkills, securityAiCapabilities } from "./ai";
import { logSecureRead } from "./admin";
import { seedSecurityDefaultsIn } from "./seed";

let installed = false;

/** Add the defaults of the security module to an organisation (as the system; idempotent). */
export async function seedSecurityDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  const out = await sys.write((tx) => seedSecurityDefaultsIn(tx, sys, opts));
  await ensureSecuritySweep(cfg.db, orgId, 5 * 60_000);
  return out;
}

const READ_AUDITED = new Set(["sec_incident", "sec_evidence"]);

export function installSecurityModule(): void {
  if (installed) return;
  installed = true;
  registerLinkKind("promoted_to", { out: "ارتقا به", in: "ارتقایافته از" });
  installSecurityHooks();
  installSecurityJobs();
  installSecurityRag();
  installSecuritySkills();
  for (const table of ["sec_incident", "sec_evidence", "sec_vuln_item", "sec_vuln_remediation", "grc_control", "grc_policy", "grc_risk", "sec_observable", "grc_reg_alert"]) {
    registerRecordMeta(table, async ({ ctx, row }) => {
      if (READ_AUDITED.has(table)) await logSecureRead(ctx, table, row);
      return { security: { ai: securityAiCapabilities() } };
    });
  }
  registerJobHandler("security.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedSecurityDefaults(jctx.cfg, job.org_id);
  });
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "security.seed", orgId, delayMs: SEED_DELAY_MS + 120_000, dedupeKey: "security.seed", maxAttempts: 5 }).then(() => undefined));
}

export { SECURITY_SEED_VERSION, SECURITY_ROLES, seedSecurityDefaultsIn } from "./seed";
export { securityConfig, secureWorkspace, SECURE_WORKSPACE_KEY } from "./common";
export { applyPlaybook, applyPlaybookIn, promoteIncident, autoPromote, promotedFrom, reportPhishing, myReports, addObservables, extractIncidentObservables, enrichObservable, upsertObservable, transferCustody, startClock, submitStage, socWorkspace, handoverText, incidentFacts, regimesFor } from "./ops";
export { importScan, groupRemediations, remediationChange, scanCoverage, scoreItem, rescoreVulnerability, matchHosts, applyException, releaseException } from "./vuln";
export { soaView, approveSoa, crosswalk, complianceByFramework, measureIndicators, indicatorValue, planControlTests, myPolicies, acknowledgePolicy, campaignStatus, campaignAudience, remindCampaigns, riskHeatmap, recomputeRequirements, recomputeFramework } from "./grc";
export { securityDashboard } from "./dashboard";
export { accessRisk, privilegedActions, hardening, startVerification, checkVerification, scanPii, redactPii, logSecureRead } from "./admin";
export { securitySweep, ensureSecuritySweep, resetSecuritySweepThrottle, SWEEP_EVERY } from "./jobs";
export { securitySkills, securityAiCapabilities } from "./ai";
export { openTasks, syncIncidentFlags } from "./hooks";
