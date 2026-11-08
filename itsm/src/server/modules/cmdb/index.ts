// Configuration management (docs/modules/cmdb_FA.md): tables in src/shared/tables/cmdb.ts, pure logic in
// src/shared/cmdb, screens in src/ui/modules/cmdb, HTTP API in src/server/routes/cmdb.ts. `installCmdbModule()` (once
// per process, src/server/routes/modules.ts) wires the module into the platform:
//   · hooks of its tables (hooks.ts): classes and relationship types mirrored into their choice lists, class attributes,
//     identifiers, provenance, configuration control, relationships' access and anchors
//   · jobs (jobs.ts): health per CI and the nightly pass, relationship upkeep, drift, expiry warnings, URL sources, the
//     Windows app's own collector, the inbound webhook topics «cmdb.*» (other systems report CIs)
//   · record meta `cmdb` on GET /r/ci/:id: the class's label and attributes, what the caller may do, AI skills
//   · CIs as retrieval documents (rag.ts) and the assistant's graph tools (ai.ts)
//   · the seed of a new organisation (seed.ts)
// Extension points for later modules: `impactAnalysis`, `servicesImpactedBy` and `dependencyMap` (incident, problem,
// change, event and continuity work), `createOrUpdate` (discovery, connectors, ITAM), `registerCmdbAi` (the AI layer).
import { registerOrgSeed } from "../orgs/service";
import { SEED_DELAY_MS } from "../sla";
import { registerRecordMeta, systemCtx } from "../../engine";
import { access } from "../../access/provider";
import { enqueue, type JobConfig } from "../../jobs";
import { installCmdbHooks } from "./hooks";
import { installCmdbJobs } from "./jobs";
import { installCmdbRag } from "./rag";
import { cmdbAiCapabilities, installCmdbTools } from "./ai";
import { classTree } from "./common";
import { seedCmdbDefaultsIn, type SeedCounts } from "./seed";
import { installCmdbChangeLink } from "./change";

let installed = false;

/** Add the defaults of configuration management to an organisation (as the system; idempotent). */
export async function seedCmdbDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedCmdbDefaultsIn(tx, sys, opts));
}

export function installCmdbModule(): void {
  if (installed) return;
  installed = true;
  installCmdbHooks();
  installCmdbJobs();
  installCmdbRag();
  installCmdbTools();
  // change enablement: impacted services, related-CI conflicts and the owners of «service_owner» (change/impact.ts)
  installCmdbChangeLink();
  registerRecordMeta("ci", async ({ q, ctx, def, row }) => {
    const tree = await classTree(q, ctx);
    const cls = tree.resolve(String(row.class));
    return {
      cmdb: {
        class_label: tree.label(String(row.class)),
        family: cls?.family ?? "logical",
        attrs: cls?.allAttrs ?? [],
        ancestry: (cls?.ancestry ?? []).map((k) => ({ key: k, label: tree.label(k) })),
        can_write: ctx.actor === "system" || access().canWrite(ctx, def, row),
        ai: cmdbAiCapabilities(),
      },
    };
  });
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "cmdb.seed", orgId, delayMs: SEED_DELAY_MS + 30_000, dedupeKey: "cmdb.seed", maxAttempts: 5 }).then(() => undefined));
}

export { CMDB_SEED_VERSION, seedCmdbDefaultsIn } from "./seed";
export { classTree, relTypes, cmdbConfig, invalidateCmdbCache } from "./common";
export { dependencyMap, pathBetween, walk, redactMap, readableCis, overlays } from "./graph";
export { relatedCis, recordOwners, CMDB_IMPACT_PROVIDER } from "./change";
export { impactAnalysis, servicesImpactedBy, computeImpact, impactText, SERVICE_CLASSES } from "./impact";
export { createOrUpdate, identifyOnly, identifyItem, startRun, finishRun, mapRow, ensureDedupTask, mayWrite } from "./ire";
export { computeHealth, healthSummary, storeFacts } from "./health";
export { takeSnapshot, compareBaseline, driftFromBaseline, recordDrift } from "./baseline";
export { mergeCis, mergePreview, undoMerge, ciReferences } from "./merge";
export { collectLocalInventory, inventoryItems, machineClass, runLocalCollector } from "./collector";
export { suggestFromIncidents, acceptSuggestion, rejectSuggestion, applyRelRules } from "./suggest";
export { runQuery, type CmdbQuery, type QueryStep } from "./query";
export { ciSummaryFacts, provenance } from "./facts";
export { registerCmdbAi, cmdbAi, cmdbAiCapabilities, type CmdbAi } from "./ai";
export { cmdbSweep, ensureCmdbSweep, expiryWarnings, applyPolicies, runUrlSource, resetCmdbSweepThrottle } from "./jobs";
