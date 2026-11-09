// Enterprise service management (docs/modules/esm_FA.md): tables in src/shared/tables/esm.ts, pure logic in
// src/shared/esm/logic.ts, screens in src/ui/modules/esm, HTTP in src/server/routes/esm.ts. `installEsmModule()`
// wires in:
//   · hooks: departments and their delegated administrators, department cases (workspace stamping, service defaults,
//     masked titles, secure-workspace watchers), HR tasks, profiles and notes, journeys and activities, reservations
//     and visitors (src/server/modules/esm/{hooks,journeys,facilities}.ts)
//   · the approvals service: approval activities of journeys, bookings of spaces that need approval
//   · subscribers: journeys follow their work records; cases count their children in other departments; the
//     requester's answer moves «منتظر اطلاعات» on
//   · jobs: esm.no_show (bookings nobody checked in to), esm.sweep (auto-close, journeys' due work, visitors who
//     never came), esm.seed (the departments' content pack of a new organisation)
//   · AI: skills esm.hr_case_summary and esm.onboarding_checklist; legal requests and employee-relations notes stay out
//     of the assistant's generated tools; privileged legal requests never reach a model
//   · the portal's registration hook (department sections) and the record meta `esm`
import { stateCategory } from "@shared/model/task";
import { tableDef } from "@shared/tables";
import { registerOrgSeed } from "../orgs/service";
import { onApprovalSettled, SEED_DELAY_MS, settledVerdict } from "../sla";
import { access } from "../../access/provider";
import { onRecordEvent, registerHooks, registerRecordMeta, systemCtx, transitionIn } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig, type JobContext } from "../../jobs";
import { actsHere } from "../notify";
import { registerAiChannel } from "../ai/rag/registry";
import { excludeFromTools } from "../ai/tools/records";
import { DEPT_TABLES, installEsmHooks } from "./hooks";
import { advanceJourneyIn, followRecordIn, journeyHooks } from "./journeys";
import { facilityHooks, installReservationApprovals, JOB_NO_SHOW, noShowJob } from "./facilities";
import { autoCloseIn, parentsOf, rollupChildrenIn } from "./cases";
import { installEsmSkills } from "./ai";
import { departmentSections, registerPortalSectionSource } from "./portal";
import { seedEsmDefaultsIn, type SeedCounts } from "./seed";
import { administersDepartment, departmentById, liveRows, sysOf, todayOf } from "./common";

let installed = false;
const SWEEP_EVERY = 60 * 60_000;
const lastSweep = new Map<string, number>();

/** Tables whose records journeys wait for (their state changes move activities). */
export const FOLLOWED = ["hr_task", "request_item", ...DEPT_TABLES];

export async function seedEsmDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedEsmDefaultsIn(tx, sys, opts));
}

async function ensureSweep(q: JobContext["db"], orgId: string): Promise<void> {
  if (Date.now() - (lastSweep.get(orgId) ?? 0) < 30 * 60_000) return;
  lastSweep.set(orgId, Date.now());
  await enqueue(q, { kind: "esm.sweep", orgId, delayMs: 10 * 60_000, dedupeKey: "esm.sweep", maxAttempts: 5 });
}
export const resetEsmSweepThrottle = () => lastSweep.clear();

/** One sweep of an organisation: resolved cases that waited too long close, journeys start their due work, visitors who never came. */
export async function esmSweep(cfg: JobConfig, orgId: string, deadline = Date.now() + 30_000): Promise<{ closed: number; journeys: number; visits: number }> {
  const sys = await systemCtx(cfg, orgId);
  const closed = await sys.write((tx) => autoCloseIn(tx, sys));
  const journeys = await liveRows(sys.db, sys, "journey", { f: "state", op: "in", v: ["active", "planned"] }, { limit: 2000 });
  for (const j of journeys) {
    if (Date.now() > deadline) break;
    await sys.write((tx) => advanceJourneyIn(tx, sys, String(j.id)));
  }
  // visitors still expected after their day ended never came
  const today = todayOf(sys);
  const stale = await liveRows(sys.db, sys, "visit", { and: [{ f: "state", op: "eq", v: "expected" }, { f: "expected_at", op: "lt", v: `${today}T00:00:00Z` }] }, { limit: 500 });
  for (const v of stale) await sys.write((tx) => transitionIn(tx, sys, "visit", String(v.id), "no_show", {}, { trusted: true }));
  return { closed, journeys: journeys.length, visits: stale.length };
}

export function installEsmModule(): void {
  if (installed) return;
  installed = true;
  installEsmHooks();
  const j = journeyHooks;
  registerHooks("journey", { beforeWrite: j.journeyBefore, afterWrite: j.journeyAfter });
  registerHooks("journey_activity", { beforeWrite: j.activityBefore, afterWrite: j.activityAfter, guards: { activity_done: j.activityDone } });
  const f = facilityHooks;
  registerHooks("reservation", { beforeWrite: f.reservationBefore, afterWrite: f.reservationAfter, guards: { reservation_free: f.reservationFree, reservation_window: f.reservationWindow } });
  registerHooks("visit", { beforeWrite: f.visitBefore, afterWrite: f.visitAfter, guards: { visit_acknowledged: f.visitAcknowledged } });
  installReservationApprovals();
  installEsmSkills();
  registerPortalSectionSource("esm", departmentSections);

  // an approval activity of a journey settles with its round
  onApprovalSettled("journey_activity", async (s) => {
    const verdict = settledVerdict(s);
    if (!verdict || !["pending", "in_progress"].includes(String(s.record.state))) return;
    const sys = sysOf(s.ctx);
    if (s.record.state === "pending") await transitionIn(s.tx, sys, "journey_activity", String(s.record.id), "in_progress", {}, { trusted: true });
    await transitionIn(s.tx, sys, "journey_activity", String(s.record.id), verdict === "approved" ? "done" : "failed", verdict === "approved" ? {} : { outcome: "تأیید نشد" }, { trusted: true });
  });

  // AI: privileged legal requests never reach a model; legal requests and ER notes stay out of the assistant's tools
  registerAiChannel("legal_request", (alias) => `coalesce(${alias}.privileged, false) = false`);
  excludeFromTools("legal_request");
  excludeFromTools("hr_case_note");

  registerRecordMeta("esm_department", async ({ q, ctx, row }) => ({ esm: { administers: await administersDepartment(q, ctx, row) } }));
  for (const t of DEPT_TABLES) {
    registerRecordMeta(t, async ({ q, ctx, def, row }) => {
      const dept = await departmentById(q, ctx, row.department_id);
      return { esm: { can_work: access().canWrite(ctx, def, row), department: dept ? { id: dept.id, key: dept.key, name: dept.name } : null } };
    });
  }

  registerJobHandler(JOB_NO_SHOW, (job, jctx) => noShowJob(job, jctx));
  registerJobHandler("esm.sweep", async (job, jctx) => {
    if (!job.org_id || !actsHere(jctx.cfg)) return;
    await esmSweep(jctx.cfg, job.org_id, jctx.deadline);
    return { again: SWEEP_EVERY };
  });
  registerJobHandler("esm.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedEsmDefaults(jctx.cfg, job.org_id);
  });
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "esm.seed", orgId, delayMs: SEED_DELAY_MS + 90_000, dedupeKey: "esm.seed", maxAttempts: 5 }).then(() => undefined));

  // journeys follow the records their activities created (on the runtime that applied the write)
  onRecordEvent("esm.journeys.follow", async (e, jctx) => {
    if (e.via === "sync" && !actsHere(jctx.cfg)) return;
    const sys = await systemCtx(jctx.cfg, e.org_id);
    await sys.write((tx) => followRecordIn(tx, sys, e.table, e.id));
  }, { tables: FOLLOWED, kinds: ["record.state_changed", "record.deleted"] });

  // a parent case counts its children in other departments
  onRecordEvent("esm.children", async (e, jctx) => {
    const sys = await systemCtx(jctx.cfg, e.org_id);
    const data = (e as { data?: Record<string, unknown> }).data ?? {};
    const parents = e.kind === "record.state_changed" ? await parentsOf(jctx.db, e.org_id, e.table, e.id) : data.kind === "esm_child" && data.direction === "in" ? [{ table: e.table, id: e.id }] : [];
    for (const p of parents) await sys.write((tx) => rollupChildrenIn(tx, sys, p.table, p.id));
  }, { tables: DEPT_TABLES, kinds: ["record.state_changed", "record.linked", "record.unlinked"] });

  // the requester's answer moves a case waiting for information back to work
  onRecordEvent("esm.requester_reply", async (e, jctx) => {
    const entry = (e as { entry?: { kind?: string; visibility?: string } }).entry;
    if (!entry || entry.kind !== "comment" || !e.actor) return;
    const sys = await systemCtx(jctx.cfg, e.org_id);
    await sys.write(async (tx) => {
      const [row] = await liveRows(tx, sys, e.table, { f: "id", op: "eq", v: e.id }, { limit: 1 });
      if (!row || row.state !== "awaiting_info" || ![row.caller_id, row.requested_for].includes(e.actor)) return;
      await transitionIn(tx, sys, e.table, e.id, "in_progress", {}, { trusted: true });
    });
  }, { tables: DEPT_TABLES, kinds: ["record.commented"] });

  onRecordEvent("esm.sweep", async (e, jctx) => {
    if (actsHere(jctx.cfg)) await ensureSweep(jctx.db, e.org_id);
  }, { tables: [...DEPT_TABLES, "journey"], kinds: ["record.created", "record.state_changed"] });
}

/** Is a department record open (new, active or waiting)? */
export const isOpenCase = (table: string, state: unknown): boolean => ["new", "active", "waiting"].includes(String(stateCategory(tableDef(table)?.states, state)));

export { seedEsmDefaultsIn, ESM_SEED_VERSION, ESM_ROLES, type SeedCounts } from "./seed";
export { startJourney, journeyTracker, previewTemplate, myTodos, advanceJourneyIn, replanJourneyIn, followRecordIn } from "./journeys";
export { routeText, transferCase, childCase, departmentHome, myOpenCases, servicesFor, inAudience, rollupChildrenIn } from "./cases";
export { availability, promoteWaiting } from "./facilities";
export { portalSections, registerPortalSectionSource, type PortalSectionSource } from "./portal";
export { esmConfig, departments, myDepartments, administersDepartment, administersEsm } from "./common";
export { esmSkills, journeyChecklist } from "./ai";
