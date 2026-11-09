// IT asset management (docs/modules/itam_FA.md): tables in src/shared/tables/itam.ts, pure logic in
// src/shared/itam/logic.ts, screens in src/ui/modules/itam, the HTTP API in src/server/routes/itam.ts.
// `installItamModule()` (once per process, src/server/routes/modules.ts, after the CMDB and the request module):
//   · hooks of its tables (hooks.ts) and the background work (jobs.ts)
//   · the participant grant «itam.holder»: the person an asset is handed to reads it, its assignment history and their
//     acknowledgements without any role in the asset area («دارایی‌های من», single records only — lists of the area
//     stay with its roles; ACCESS §7)
//   · the approvals service settles requisitions (approved / rejected) and disposal orders (approved)
//   · the AI skills (licence optimisation narrative, asset summary) with rule-based fallbacks (ai.ts)
//   · the seed of a new organisation (seed.ts), queued after the SLA service's calendars and the request catalogue
import type { TableDef } from "@shared/model/types";
import { registerParticipantSource } from "../../access";
import { onApprovalSettled, SEED_DELAY_MS, settledVerdict } from "../sla";
import { registerOrgSeed } from "../orgs/service";
import { registerRecordMeta, systemCtx, transitionIn } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import { installItamHooks } from "./hooks";
import { ensureItamSweep, installItamJobs } from "./jobs";
import { installItamAi } from "./ai";
import { seedItamDefaultsIn, type SeedCounts } from "./seed";
import { holds } from "./common";

let installed = false;

/** Add the defaults of IT asset management to an organisation (as the system; idempotent). */
export async function seedItamDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedItamDefaultsIn(tx, sys, opts));
}

/** The tables the holder grant applies to, and the user field naming the holder. */
const HOLDER_FIELDS: Record<string, string> = { asset: "assigned_to", asset_acknowledgement: "user_id", asset_assignment: "assigned_to" };

export function installItamModule(): void {
  if (installed) return;
  installed = true;
  installItamHooks();
  installItamJobs();
  installItamAi();
  registerParticipantSource({
    name: "itam.holder",
    reach: "grant",
    async tables(q, orgId, userId) {
      const r = await q.one(`select 1 from sm_assets where org_id = $1 and deleted_at is null and assigned_to = $2::uuid limit 1`, [orgId, userId]);
      const k = await q.one(`select 1 from sm_asset_acks where org_id = $1 and deleted_at is null and user_id = $2::uuid limit 1`, [orgId, userId]);
      return [...(r ? ["asset", "asset_assignment"] : []), ...(k ? ["asset_acknowledgement"] : [])];
    },
    sql(def: TableDef, alias: string, params: unknown[], userId: string) {
      const field = HOLDER_FIELDS[def.key];
      if (!field) return null;
      params.push(userId);
      return `${alias}.${field} = $${params.length}::uuid`;
    },
  });
  // the record's approvals as a whole (settledVerdict): one round approved while another is open moves nothing, a
  // withdrawal never approves, a re-run that leaves nothing open reads the aggregate
  onApprovalSettled("purchase_requisition", async (s) => {
    const { tx, ctx, record } = s;
    if (record.state !== "pending_approval") return;
    const verdict = settledVerdict(s);
    if (verdict === "approved") await transitionIn(tx, ctx, "purchase_requisition", String(record.id), "approved", {});
    if (verdict === "rejected") await transitionIn(tx, ctx, "purchase_requisition", String(record.id), "rejected", {});
  });
  onApprovalSettled("disposal_order", async (s) => {
    if (s.record.state === "requested" && settledVerdict(s) === "approved") await transitionIn(s.tx, s.ctx, "disposal_order", String(s.record.id), "approved", {});
  });
  registerRecordMeta("asset", async ({ ctx }) => ({
    itam: { can_manage: await holds(ctx, "asset", "write", "group") },
  }));
  registerJobHandler("itam.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedItamDefaults(jctx.cfg, job.org_id);
    await ensureItamSweep(jctx.db, job.org_id, 6 * 3600_000);
  });
  // after the SLA service's calendars and the request module's catalogue (bound to models when present)
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "itam.seed", orgId, delayMs: SEED_DELAY_MS + 3 * 60_000, dedupeKey: "itam.seed", maxAttempts: 5 }).then(() => undefined));
}

export { seedItamDefaultsIn, ITAM_SEED_VERSION, type SeedCounts } from "./seed";
export { checkout, checkin, asset360, myAssets, decideAck, reportAsset, linkCi, assetsForDiscovered, leaverReturn } from "./assets";
export { stockDashboard, checkStockRules, requisitionFromRules, ordersFromRequisition, receive, scan, stockLevels } from "./stock";
export { syncInstalls, renormalize, reconcile, compliance, licenceFacts } from "./sam";
export { itamSweep, ensureItamSweep, resetItamSweepThrottle } from "./jobs";
export { itamText, licenceNarrative, assetSummaryText, ITAM_SKILLS } from "./ai";
export { itamConfig, holds, hasGroup } from "./common";
