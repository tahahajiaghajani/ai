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
//   · AI: skills esm.hr_case_summary and esm.onboarding_checklist; the HR and legal tables' default data-use policies
//     (`ESM_DATA_USE`: legal requests and employee-relations notes «هرگز», HR cases, tasks, profiles and HSE events
//     «فقط محلی») hold for every AI surface, the generated tools included; privileged legal requests are closed to AI
//     record by record (the AI-use rule the generated tools, skills and retrieval all honour)
//   · the portal's registration hook (department sections) and the record meta `esm`
import { stateCategory } from "@shared/model/task";
import { tableDef } from "@shared/tables";
import { registerOrgSeed } from "../orgs/service";
import { onApprovalSettled, SEED_DELAY_MS, settledVerdict } from "../sla";
import { access } from "../../access/provider";
import { onBeforeCommit, onRecordEvent, pushGuard, registerHooks, registerRecordMeta, systemCtx, transitionIn } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig, type JobContext } from "../../jobs";
import { actsHere } from "../notify";
import { registerAiChannel } from "../ai/rag/registry";
import { registerPortalItems, registerPortalLink } from "../portal/common";
import { orgSchema } from "../../engine";
import { DEPT_TABLES, hrStaffOnly, installEsmHooks } from "./hooks";
import { advanceJourneyIn, followRecordIn, journeyHooks, JOB_ORDER, placeActivityOrder } from "./journeys";
import { facilityHooks, installReservationApprovals, JOB_NO_SHOW, noShowJob } from "./facilities";
import { autoCloseIn, parentsOf, rollupChildrenAtCommit } from "./cases";
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
    // under the journey's key, like an activity's completion: the two take turns, so the sweep reads the activities a
    // completion committed and never writes an older progress over it
    await sys.write(async (tx) => {
      onBeforeCommit(tx, `esm.journey.advance:${j.id}`, async () => void (await advanceJourneyIn(tx, sys, String(j.id))));
    });
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
  registerHooks("journey", { beforeWrite: j.journeyBefore, afterWrite: j.journeyAfter, validatePush: pushGuard(j.journeyGuard) });
  registerHooks("journey_activity", { beforeWrite: j.activityBefore, afterWrite: j.activityAfter, guards: { activity_done: j.activityDone, hr_staff: hrStaffOnly } });
  const f = facilityHooks;
  registerHooks("reservation", { beforeWrite: f.reservationBefore, afterWrite: f.reservationAfter, guards: { reservation_free: f.reservationFree, reservation_window: f.reservationWindow } });
  registerHooks("visit", { beforeWrite: f.visitBefore, afterWrite: f.visitAfter, guards: { visit_acknowledged: f.visitAcknowledged } });
  installReservationApprovals();
  installEsmSkills();
  registerPortalSectionSource("esm", departmentSections);
  // the self-service portal: department cases in «درخواست‌های من» and their ticket pages (read with the person's own
  // access; the display title — neutral for sensitive services — never the summary), «رزرو فضا» among the quick links
  for (const table of DEPT_TABLES) {
    const def = tableDef(table);
    if (def) registerPortalItems({ table, kind_label: def.label, ...(def.fields.some((f) => f.name === "title") ? { title: "title" } : {}) });
  }
  registerPortalLink({
    key: "esm.book_space",
    name: "رزرو فضا",
    path: "facilities/book",
    description: "اتاق جلسه، میز یا تجهیزات را برای نیم‌ساعت‌های آزاد رزرو کنید",
    icon: "calendar-range",
    keywords: "رزرو اتاق جلسه میز فضا سالن تجهیزات",
    sort_order: 20,
    available: async (ctx) => {
      if (ctx.actor === "system") return false;
      const def = (await orgSchema(ctx)).def("reservation");
      return !!def && access().canCreate(ctx, def, null);
    },
  });

  // an approval activity of a journey settles with its round
  onApprovalSettled("journey_activity", async (s) => {
    const verdict = settledVerdict(s);
    if (!verdict || !["pending", "in_progress"].includes(String(s.record.state))) return;
    const sys = sysOf(s.ctx);
    if (s.record.state === "pending") await transitionIn(s.tx, sys, "journey_activity", String(s.record.id), "in_progress", {}, { trusted: true });
    await transitionIn(s.tx, sys, "journey_activity", String(s.record.id), verdict === "approved" ? "done" : "failed", verdict === "approved" ? {} : { outcome: "تأیید نشد" }, { trusted: true });
  });

  // AI: no skill, retrieval or generated record tool reads a privileged legal request (on top of the table's «هرگز»
  // default, which an AI administrator may relax)
  registerAiChannel("legal_request", (alias) => `coalesce(${alias}.privileged, false) = false`);

  registerRecordMeta("esm_department", async ({ q, ctx, row }) => ({ esm: { administers: await administersDepartment(q, ctx, row) } }));
  for (const t of DEPT_TABLES) {
    registerRecordMeta(t, async ({ q, ctx, def, row }) => {
      const dept = await departmentById(q, ctx, row.department_id);
      // working the case (transfer, child work) is for those who change it in full, never its requester's own-record mode
      const prov = access();
      const mode = prov.writeMode ? prov.writeMode(ctx, def, row) : prov.canWrite(ctx, def, row) ? "full" : null;
      return { esm: { can_work: mode === "full", department: dept ? { id: dept.id, key: dept.key, name: dept.name } : null } };
    });
  }

  registerJobHandler(JOB_NO_SHOW, (job, jctx) => noShowJob(job, jctx));
  registerJobHandler(JOB_ORDER, async (job, jctx) => {
    if (!job.org_id || typeof job.payload?.id !== "string") return;
    await placeActivityOrder(jctx.cfg, job.org_id, job.payload.id);
  });
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
    // the roll-up at commit under the parent's key: two children closing at once are counted after each other's commit
    for (const p of parents) await sys.write(async (tx) => rollupChildrenAtCommit(tx, sys, p.table, p.id));
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
