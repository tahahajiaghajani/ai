// The service portfolio (docs/modules/service_portfolio_FA.md): tables in src/shared/tables/service_portfolio.ts, pure
// logic in src/shared/service_portfolio, screens in src/ui/modules/service_portfolio, HTTP API in
// src/server/routes/service_portfolio.ts. `installServicePortfolioModule()` (once per process, routes/modules.ts, after
// configuration management — every service and offering is a CI) wires it into the platform:
//   · hooks of its tables (hooks.ts): the service's and offering's CIs, lifecycle stamps and guards, commitments that
//     generate SLA definitions, subscriptions, trees, proposals that charter services, design readiness, TIME decisions
//   · service roles in context (roles.ts): owners read records linked to their service; approver sources
//     «service_owner» and «service_change_approvers» for approval rules of changes and requests
//   · jobs (jobs.ts): live status from incidents and CIs, daily scores, review reminders, agreements, technology risk
//   · record meta `service_portfolio` on GET /r/service/:id: what the caller may do and the AI skills
//   · services as retrieval documents (rag.ts) and the assistant's status tool (ai.ts)
//   · the seed of a new organisation (seed.ts)
// Extension points for later modules: `servicePicker` and `servicesImpactedBy` (incident, problem, change: affected
// services from CIs), `entitledOfferings` (the request catalogue), `myServices` (the portal), `refreshStatuses`
// (event management), `registerPortfolioAi` (the AI layer).
import { registerOrgSeed } from "../orgs/service";
import { SEED_DELAY_MS } from "../sla";
import { registerRecordMeta, systemCtx } from "../../engine";
import { access } from "../../access/provider";
import { enqueue, type JobConfig } from "../../jobs";
import { installPortfolioHooks } from "./hooks";
import { installPortfolioJobs } from "./jobs";
import { installPortfolioRag } from "./rag";
import { installServiceRoles } from "./roles";
import { installPortfolioTools, portfolioAiCapabilities } from "./ai";
import { isPortfolioManager } from "./common";
import { seedPortfolioDefaultsIn, type SeedCounts } from "./seed";

let installed = false;

/** Add the defaults of the service portfolio to an organisation (as the system; idempotent). */
export async function seedPortfolioDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedPortfolioDefaultsIn(tx, sys, opts));
}

export function installServicePortfolioModule(): void {
  if (installed) return;
  installed = true;
  installPortfolioHooks();
  installPortfolioJobs();
  installPortfolioRag();
  installPortfolioTools();
  installServiceRoles();
  registerRecordMeta("service", async ({ ctx, def, row }) => ({
    service_portfolio: {
      can_write: ctx.actor === "system" || access().canWrite(ctx, def, row),
      can_manage: await isPortfolioManager(ctx),
      ai: portfolioAiCapabilities(),
    },
  }));
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "service.seed", orgId, delayMs: SEED_DELAY_MS + 45_000, dedupeKey: "service.seed", maxAttempts: 5 }).then(() => undefined));
}

export { PORTFOLIO_SEED_VERSION, seedPortfolioDefaultsIn } from "./seed";
export { serviceConfig, isPortfolioManager, subscriptionPeople, memberAnchors, CATALOGUE_STATES, PIPELINE_STATES, RETIRED_STATES } from "./common";
export { refreshStatuses, serviceSignals, statusPage, statusHistory, notifySubscribers, notifyLifecycle, orgOfStatusToken, publicView, overallOf } from "./status";
export { scoreDay, openStates, linkedTo } from "./score";
export { serviceScorecard, portfolioReport, rationalization, catalogueHealth } from "./insights";
export { myServices, entitledOfferings, offeringOpenTo, servicePicker } from "./entitle";
export { technologyFindings, technologyRisk, standardCondition, standardRisk } from "./technology";
export { servicesOfRecord } from "./roles";
export { portfolioSweep, ensurePortfolioSweep, resetPortfolioSweepThrottle, reviewReminders, expireAgreements, touchesStatus } from "./jobs";
export { registerPortfolioAi, portfolioAi, portfolioAiCapabilities, type PortfolioAi } from "./ai";
export { CI_STATE_OF } from "./hooks";
