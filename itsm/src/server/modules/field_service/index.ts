// Field service management (docs/modules/field_service_FA.md): tables in src/shared/tables/field_service.ts, pure logic
// in src/shared/field_service/logic.ts, screens in src/ui/modules/field_service, HTTP in
// src/server/routes/field_service.ts. `installFieldServiceModule()` wires in the hooks (work orders, visits and their
// steps, roll-ups and customer messages, parts, time, technicians), the jobs (fsm.sweep: planned maintenance and
// clearing old positions; fsm.seed), the AI skills, the portal's technician section and the record meta.
import type { PortalSection } from "@shared/esm/portal";
import { registerOrgSeed } from "../orgs/service";
import { SEED_DELAY_MS } from "../sla";
import { access } from "../../access/provider";
import { list, onRecordEvent, registerRecordMeta, systemCtx } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig, type JobContext } from "../../jobs";
import { actsHere } from "../notify";
import { registerPortalSectionSource } from "../esm/portal";
import type { Ctx } from "../../context";
import { installFieldHooks } from "./hooks";
import { installFieldSkills } from "./ai";
import { clearPositionsIn, generateMaintenanceIn } from "./service";
import { seedFsmDefaultsIn, type SeedCounts } from "./seed";
import { dispatches, fsmConfig, todayOf } from "./common";

let installed = false;
const SWEEP_EVERY = 6 * 3_600_000;
const lastSweep = new Map<string, number>();

export async function seedFsmDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedFsmDefaultsIn(tx, sys, opts));
}

async function ensureSweep(q: JobContext["db"], orgId: string): Promise<void> {
  if (Date.now() - (lastSweep.get(orgId) ?? 0) < 60 * 60_000) return;
  lastSweep.set(orgId, Date.now());
  await enqueue(q, { kind: "fsm.sweep", orgId, delayMs: 10 * 60_000, dedupeKey: "fsm.sweep", maxAttempts: 5 });
}
export const resetFsmSweepThrottle = () => lastSweep.clear();

export async function fsmSweep(cfg: JobConfig, orgId: string): Promise<{ generated: number; cleared: number }> {
  const sys = await systemCtx(cfg, orgId);
  const generated = await sys.write((tx) => generateMaintenanceIn(tx, sys));
  const cleared = await sys.write((tx) => clearPositionsIn(tx, sys));
  return { generated, cleared };
}

/** The technician's section of the portal: today's visits and the way to their day. */
async function technicianSections(ctx: Ctx): Promise<PortalSection[]> {
  const today = todayOf(ctx);
  const res = await list(ctx, "wo_task", { filter: { and: [{ f: "technician_id", op: "is_me" }, { f: "state", op: "in", v: ["assigned", "accepted", "en_route", "on_site", "on_hold", "pending_parts"] }] }, size: 200, fields: ["number", "scheduled_start"] }).catch(() => null);
  if (!res || !res.rows.length) return [];
  const todays = res.rows.filter((t) => String(t.scheduled_start ?? "").slice(0, 10) === today).length;
  return [{
    key: "field:technician", kind: "field", title: "بازدیدهای من", icon: "hard-hat", color: "orange", intro: null, order: 3,
    links: [{ key: "my-day", label: "کارهای امروز", path: "field/my-day", count: todays }],
    services: [], facts: [{ key: "open", label: "بازدیدهای باز", value: String(res.rows.length) }], kb_base_id: null, catalog_id: null,
  }];
}

export function installFieldServiceModule(): void {
  if (installed) return;
  installed = true;
  installFieldHooks();
  installFieldSkills();
  registerPortalSectionSource("field_service", technicianSections);
  registerRecordMeta("wo_task", async ({ q, ctx, def, row }) => ({ field: { can_work: access().canWrite(ctx, def, row), mine: row.technician_id === ctx.user.id, dispatches: await dispatches(q, ctx), map_provider: (await fsmConfig(q, ctx)).map_provider } }));
  registerRecordMeta("work_order", async ({ q, ctx, def, row }) => ({ field: { can_work: access().canWrite(ctx, def, row), dispatches: await dispatches(q, ctx) } }));
  registerJobHandler("fsm.sweep", async (job, jctx) => {
    if (!job.org_id || !actsHere(jctx.cfg)) return;
    await fsmSweep(jctx.cfg, job.org_id);
    return { again: SWEEP_EVERY };
  });
  registerJobHandler("fsm.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedFsmDefaults(jctx.cfg, job.org_id);
  });
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "fsm.seed", orgId, delayMs: SEED_DELAY_MS + 150_000, dedupeKey: "fsm.seed", maxAttempts: 5 }).then(() => undefined));
  onRecordEvent("fsm.sweep", async (e, jctx) => {
    if (actsHere(jctx.cfg)) await ensureSweep(jctx.db, e.org_id);
  }, { tables: ["work_order", "maintenance_plan", "wo_task"], kinds: ["record.created", "record.state_changed"] });
}

export { seedFsmDefaultsIn, FSM_SEED_VERSION, FSM_ROLES, type SeedCounts } from "./seed";
export { dispatchBoard, candidatesFor, assignTask, autoAssign, workOrderFrom, myDay, visitStep, signOff, serviceReport, appointmentSlots, bookAppointment, generateMaintenanceIn, clearPositionsIn, fieldDashboard } from "./service";
export { rollupWorkOrderIn } from "./hooks";
export { fsmConfig, dispatches } from "./common";
export { fieldSkills, briefingFacts } from "./ai";
