// Discovery: assets and their status from monitoring, discovery and endpoint tools (design A, docs/modules/
// discovery_FA.md). Tables in src/shared/tables/discovery.ts, the shared vocabulary and pure rules in
// src/shared/discovery, the kinds in connectors/ (one file each, registry.ts).
// `installDiscoveryModule()` (once per process, src/server/routes/modules.ts, after the CMDB, ITAM and event modules):
//   · the connector guard (guard.ts, §14.5): who may change which field, re-authentication, secrets cleared when the
//     address moves, the soft delete, journal lines; the Windows app configures no connector (§14.7)
//   · the connector's configuration hook (config.ts): kind once, its data source, config_version, mapping, options and
//     schedules, the sweep queued when a connector may run
//   · the jobs (jobs.ts): the sweep, pulls (runner.ts), status passes (DA2), the contact ladder (stale.ts)
//   · a de-duplication task that closes re-queues the items naming it (§7.4)
//   · the guard on connector-owned CMDB data sources (precedence.ts, §8.1)
// Mismatches with the asset register (§8.3) are kept by mismatch.ts; the routes' services (test, preview, run, cancel,
// the queue's actions…) are in service.ts, mounted by src/server/routes/discovery.ts as /api/o/:org/discovery/*. The
// Windows app runs none of the jobs and answers none of the routes (§14.7).
import { onRecordEvent } from "../../engine";
import { inDemoScope, isDemoRow } from "../../db/scope";
import { installConnectorConfig } from "./config";
import { installConnectorGuard } from "./guard";
import { installDiscoveryJobs, queuePull } from "./jobs";
import { installSourceGuard } from "./precedence";
import { editionOf } from "./net";
import { installDiscoveryStatus } from "./status";
import { installDiscoveryPush } from "./push";

let installed = false;

/** A closed de-duplication task (merged, or «تکراری نیست») re-queues the duplicate items naming it (§7.4). */
function installDedupListener(): void {
  onRecordEvent(
    "discovery.dedup_closed",
    async (e, jctx) => {
      if (editionOf({ mode: jctx.cfg.mode ?? "cloud", server: jctx.cfg.server }) === "desktop") return;
      if (e.kind !== "record.state_changed" || !["resolved", "closed", "canceled"].includes(String(e.to_category ?? ""))) return;
      const rows = await jctx.db.query<{ connector_id: string }>(
        `update sm_discovery_items set retry_at = now(), updated_at = now()
         where org_id = $1 and dedup_task_id = $2 and deleted_at is null and state = 'duplicate' returning connector_id`,
        [e.org_id, e.id],
      );
      for (const connector of new Set(rows.map((r) => r.connector_id))) {
        const demo = await isDemoRow(jctx.db, e.org_id, connector);
        await inDemoScope(demo ? e.org_id : null, () => queuePull(jctx.db, e.org_id, connector, { trigger: "schedule", retryOnly: true, demo }));
      }
    },
    { tables: ["cmdb_dedup_task"], kinds: ["record.state_changed"] },
  );
}

export function installDiscoveryModule(): void {
  if (installed) return;
  installed = true;
  // the guard first: a refused write makes no data source
  installConnectorGuard();
  installConnectorConfig();
  installSourceGuard();
  installDiscoveryJobs();
  installDedupListener();
  installDiscoveryStatus();
  installDiscoveryPush();
}

export { runPull, acceptNewSize, cancelRun, consecutiveFailures, runningRun, loadConnector } from "./runner";
export { queuePull, discoverySweep, ensureDiscoverySweep, dailyUpkeep, JOB_KINDS, resetDiscoveryThrottles } from "./jobs";
export { serverKind, serverKinds } from "./registry";
export { stagePage, itemHash, pendingCount } from "./stage";
export { applyMismatch, dismissMismatch, mismatchDigest, refreshMismatches, MISMATCH_LABELS, type MismatchEntry, type MismatchData } from "./mismatch";
export { sourceOwner, ownedSourceMessage } from "./precedence";
export { rightsOf, type DiscoveryRights } from "./guard";
