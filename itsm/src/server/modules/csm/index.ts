// Customer service management (docs/modules/csm_FA.md): tables in src/shared/tables/csm.ts, pure logic in
// src/shared/csm/logic.ts, screens in src/ui/modules/csm, HTTP in src/server/routes/csm.ts. `installCsmModule()` wires
// in the hooks (accounts and their company units, contacts, cases with entitlement at intake, units, escalations),
// the subscribers (internal records' states back to linked cases as internal notes, proactive cases on a major
// incident, the customer's answer to «منتظر مشتری», the sentiment of the customer's words), the jobs (csm.sweep:
// auto-close and relationship health; csm.proactive; csm.seed), the AI skills, the portal's customer section and the
// record meta `csm`.
import { sentimentOf } from "@shared/csm/logic";
import { tableDef } from "@shared/tables";
import { registerOrgSeed } from "../orgs/service";
import { SEED_DELAY_MS } from "../sla";
import { access } from "../../access/provider";
import { onRecordEvent, registerRecordMeta, systemCtx, transitionIn, updateIn } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig, type JobContext } from "../../jobs";
import { actsHere } from "../notify";
import { registerPortalSectionSource } from "../esm/portal";
import { installCsmHooks } from "./hooks";
import { autoCloseIn, healthSweepIn, proactiveCasesIn, syncInternalIn } from "./service";
import { installCsmSkills } from "./ai";
import { customerSections } from "./portal";
import { seedCsmDefaultsIn, type SeedCounts } from "./seed";
import { csmConfig, liveRow, managesCsm, sysOf } from "./common";

let installed = false;
const SWEEP_EVERY = 6 * 3_600_000;
const lastSweep = new Map<string, number>();

/** Records whose states flow back to the customer cases linked to them (as internal notes). */
export const INTERNAL_TABLES = ["incident", "problem", "change_request"];

export async function seedCsmDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedCsmDefaultsIn(tx, sys, opts));
}

async function ensureSweep(q: JobContext["db"], orgId: string): Promise<void> {
  if (Date.now() - (lastSweep.get(orgId) ?? 0) < 60 * 60_000) return;
  lastSweep.set(orgId, Date.now());
  await enqueue(q, { kind: "csm.sweep", orgId, delayMs: 10 * 60_000, dedupeKey: "csm.sweep", maxAttempts: 5 });
}
export const resetCsmSweepThrottle = () => lastSweep.clear();

export async function csmSweep(cfg: JobConfig, orgId: string, deadline = Date.now() + 30_000): Promise<{ closed: number; accounts: number }> {
  const sys = await systemCtx(cfg, orgId);
  const closed = await sys.write((tx) => autoCloseIn(tx, sys));
  const accounts = await sys.write((tx) => healthSweepIn(tx, sys, deadline));
  return { closed, accounts };
}

export function installCsmModule(): void {
  if (installed) return;
  installed = true;
  installCsmHooks();
  installCsmSkills();
  registerPortalSectionSource("csm", customerSections);

  registerRecordMeta("customer_case", async ({ ctx, def, row }) => ({ csm: { can_work: access().canWrite(ctx, def, row) } }));
  registerRecordMeta("customer_account", async ({ q, ctx, def, row }) => ({ csm: { can_work: access().canWrite(ctx, def, row), manages: await managesCsm(q, ctx) } }));

  registerJobHandler("csm.sweep", async (job, jctx) => {
    if (!job.org_id || !actsHere(jctx.cfg)) return;
    await csmSweep(jctx.cfg, job.org_id, jctx.deadline);
    return { again: SWEEP_EVERY };
  });
  registerJobHandler("csm.proactive", async (job, jctx) => {
    if (!job.org_id || typeof job.payload?.incident !== "string") return;
    const sys = await systemCtx(jctx.cfg, job.org_id);
    await sys.write((tx) => proactiveCasesIn(tx, sys, String(job.payload.incident)));
  });
  registerJobHandler("csm.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedCsmDefaults(jctx.cfg, job.org_id);
  });
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "csm.seed", orgId, delayMs: SEED_DELAY_MS + 120_000, dedupeKey: "csm.seed", maxAttempts: 5 }).then(() => undefined));

  // internal work's states come back to the customer cases linked to it — as internal notes only
  onRecordEvent("csm.internal_sync", async (e, jctx) => {
    if (e.via === "sync" && !actsHere(jctx.cfg)) return;
    if (!tableDef("customer_case")) return;
    const sys = await systemCtx(jctx.cfg, e.org_id);
    await sys.write((tx) => syncInternalIn(tx, sys, e.table, e.id));
  }, { tables: INTERNAL_TABLES, kinds: ["record.state_changed"] });

  // a major incident reaches the customers whose installed base it touches, before they call
  onRecordEvent("csm.proactive", async (e, jctx) => {
    if (!actsHere(jctx.cfg)) return;
    const sys = await systemCtx(jctx.cfg, e.org_id);
    const cfg = await csmConfig(jctx.db, sys);
    if (!cfg.proactive_on_major) return;
    await enqueue(jctx.db, { kind: "csm.proactive", orgId: e.org_id, payload: { incident: e.id }, dedupeKey: `csm.proactive:${e.id}`, maxAttempts: 5 });
  }, { tables: ["incident"], kinds: ["record.incident.major_declared"] });

  // the customer's answer moves a case waiting for them back to work; their words update the case's sentiment
  onRecordEvent("csm.customer_reply", async (e, jctx) => {
    const entry = (e as { entry?: { id?: string; kind?: string } }).entry;
    if (!entry || entry.kind !== "comment" || !e.actor) return;
    const sys = await systemCtx(jctx.cfg, e.org_id);
    await sys.write(async (tx) => {
      const row = await liveRow(tx, sys, "customer_case", e.id);
      if (!row || ![row.caller_id, row.requested_for].includes(e.actor)) return;
      const j = entry.id ? await tx.one<{ body: string }>(`select body from sm_journal where org_id = $1 and id = $2`, [e.org_id, entry.id]) : null;
      if (j?.body) {
        const s = sentimentOf(j.body);
        if (s.sentiment !== row.sentiment) await updateIn(tx, sys, "customer_case", e.id, { sentiment: s.sentiment }, { trusted: true, keepVersion: true });
      }
      if (row.state === "awaiting_customer") await transitionIn(tx, sysOf(sys), "customer_case", e.id, "open", {}, { trusted: true });
    });
  }, { tables: ["customer_case"], kinds: ["record.commented"] });

  onRecordEvent("csm.sweep", async (e, jctx) => {
    if (actsHere(jctx.cfg)) await ensureSweep(jctx.db, e.org_id);
  }, { tables: ["customer_case", "customer_account"], kinds: ["record.created", "record.state_changed"] });
}

export { seedCsmDefaultsIn, CSM_SEED_VERSION, CSM_ROLES, type SeedCounts } from "./seed";
export { customer360, proactiveCasesIn, raiseInternal, syncInternalIn, broadcast, nextCase, reviewPack, sendNotice, healthSweepIn, autoCloseIn, csmDashboard, affectedAccounts } from "./service";
export { csmConfig, managesCsm } from "./common";
export { csmSkills } from "./ai";
export { customerSections } from "./portal";
