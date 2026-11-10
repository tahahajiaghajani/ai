// Service level management (docs/modules/slm_FA.md): tables in src/shared/tables/slm.ts (the agreement register is
// the service portfolio's `service_agreement`, extended there), pure logic in src/shared/slm, screens in
// src/ui/modules/slm, HTTP API in src/server/routes/slm.ts. `installSlmModule()` (once per process, routes/modules.ts,
// after the service portfolio and analytics) wires it into the platform:
//   · hooks (hooks.ts): the agreement lifecycle and the portfolio's status, targets → the SLA service's definitions,
//     reviews and their packs, improvements, credits, XLA policies
//   · the approvals service: a settled round on an agreement moves it to «ابلاغ و آماده‌سازی» or back to «مذاکره»
//   · measuring (measure.ts) on writes and by the sweep (jobs.ts): compliance per Jalali period, credits, at-risk events,
//     reminders and the interval reviews
//   · live XLA scores of records (xla.ts) and the experience sources (experience.ts: the portal's survey answers when
//     that table exists; other modules plug theirs in with `registerExperienceSource`)
//   · AI skills with rule-based fallbacks (ai.ts); record meta `slm` on agreements; the seed of a new organisation
import { registerOrgSeed } from "../orgs/service";
import { onApprovalSettled, settledVerdict, SEED_DELAY_MS } from "../sla";
import { registerRecordMeta, systemCtx, transitionIn } from "../../engine";
import { access } from "../../access/provider";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import { installSlmHooks } from "./hooks";
import { installSlmJobs } from "./jobs";
import { installXla } from "./xla";
import { installSlmSkills } from "./ai";
import { registerExperienceSource, SURVEY_SOURCE } from "./experience";
import { managesSlm, sysOf } from "./common";
import { seedSlmDefaultsIn, type SeedCounts } from "./seed";

let installed = false;

/** Add the defaults of service level management to an organisation (as the system; idempotent). */
export async function seedSlmDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedSlmDefaultsIn(tx, sys, opts));
}

export function installSlmModule(): void {
  if (installed) return;
  installed = true;
  installSlmHooks();
  installSlmJobs();
  installXla();
  installSlmSkills();
  registerExperienceSource(SURVEY_SOURCE);
  // a settled approval round of an agreement: approved → communication and enablement, rejected → back to negotiation
  onApprovalSettled("service_agreement", async (s) => {
    const verdict = settledVerdict(s);
    if (s.record.state !== "awaiting_approval" || !verdict) return;
    await transitionIn(s.tx, sysOf(s.ctx), "service_agreement", String(s.record.id), verdict === "approved" ? "enablement" : "negotiation", {}, { trusted: true });
  });
  registerRecordMeta("service_agreement", async ({ q, ctx, def, row }) => ({
    slm: { can_write: ctx.actor === "system" || access().canWrite(ctx, def, row), manages: await managesSlm(q, ctx) },
  }));
  registerJobHandler("slm.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedSlmDefaults(jctx.cfg, job.org_id);
  });
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "slm.seed", orgId, delayMs: SEED_DELAY_MS + 75_000, dedupeKey: "slm.seed", maxAttempts: 5 }).then(() => undefined));
}

export { SLM_SEED_VERSION, SLM_ROLES, seedSlmDefaultsIn, templates as slmTemplates, type SeedCounts } from "./seed";
export { agreement360, slmOverview, documentOf, acceptAgreement, fromTemplate, linkCommitments, setManualValue, recommend, measureNow, moveAgreement } from "./agreements";
export { atRisk, resetRiskCache } from "./risk";
export { storeMeasures, measureAgreementIn, measureTarget, timerCounts, agreementPeriod } from "./measure";
export { buildPack, packOf, breachBreakdown } from "./review";
export { scoreRecordIn, policyOf, xlaFacts } from "./xla";
export { registerExperienceSource, experienceResponses, type ExperienceSource } from "./experience";
export { slmSweep, ensureSlmSweep, resetSlmSweepThrottle } from "./jobs";
export { slmSkills, runSkillOrRules, answersWithoutAi } from "./ai";
export { slmConfig, managesSlm, readsSlm } from "./common";
export { syncTargetDefinition, definitionValues, generationProblem } from "./definitions";
