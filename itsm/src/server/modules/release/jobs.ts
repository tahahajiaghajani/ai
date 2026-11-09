// Background work of release management (all as the system of the organisation, on the runtime that acts for it):
//   · release.setup       a new release gets its template's tasks (due dates from the template's offsets), its
//                         readiness check results and its first risk score
//   · release.recalc      readiness checks evaluated again (on entering test or readiness, on demand) or only rolled
//                         up, and the risk score
//   · release.deployment  what a deployment's new state does around it (deploy.ts: its change, recovery, the release,
//                         the CIs' versions)
//   · release.sweep       every 30 minutes while releases are open: risk of open releases, checks of releases waiting
//                         for their decision, early life support that ended (→ review, event release.els_ended),
//                         releases whose flags are all on (released_at)
// Subscribers: links of releases and deployments recount their scope and incidents; a change of a release moving
// re-evaluates the release; a new incident is tagged with the releases in early life support and the production
// deployments before it (suspects).
import type { Ctx } from "../../context";
import { createIn, emitEvent, onRecordEvent, savepoint, systemCtx, transitionIn, updateIn } from "../../engine";
import { enqueue, registerJobHandler, type JobContext } from "../../jobs";
import { actsHere } from "../notify";
import { ensureResultsIn, evaluateChecksIn, stampReadinessIn, storedReadiness } from "./checks";
import { deploymentEffects, linkedReleases, recountDeployment, recountRelease, tagIncident } from "./deploy";
import { recalcRiskIn } from "./risk";
import { releasePeople } from "./decision";
import { isUuid, liveRow, liveRows, msOf, sysOf, type Row } from "./common";

export const RELEASE_SWEEP_EVERY = 30 * 60_000;
const DAY = 86_400_000;
const lastSweep = new Map<string, number>();

/** Queue the organisation's sweep (at most once per ten minutes per process; one queued job per organisation). */
export async function ensureReleaseSweep(q: JobContext["db"], orgId: string): Promise<void> {
  if (Date.now() - (lastSweep.get(orgId) ?? 0) < 10 * 60_000) return;
  lastSweep.set(orgId, Date.now());
  await enqueue(q, { kind: "release.sweep", orgId, delayMs: 60_000, dedupeKey: "release.sweep", maxAttempts: 5 });
}
export const resetReleaseSweepThrottle = () => lastSweep.clear();

/** Copy the template's tasks into a new release (once: only when the release has no task yet). */
export async function setupRelease(sys: Ctx, id: string): Promise<{ tasks: number; checks: number }> {
  return sys.write(async (tx) => {
    const rel = await liveRow(tx, sys, "release", id);
    if (!rel) return { tasks: 0, checks: 0 };
    let tasks = 0;
    const t = isUuid(rel.template_id) ? await liveRow(tx, sys, "release_template", rel.template_id) : null;
    const existing = await liveRows(tx, sys, "release_task", { f: "release_id", op: "eq", v: id }, { limit: 1 });
    if (t && Array.isArray(t.tasks) && !existing.length) {
      const base = msOf(rel.planned_start) ?? msOf(rel.created_at) ?? Date.now();
      const end = msOf(rel.planned_end);
      let prev: string | null = null;
      for (const [i, raw] of (t.tasks as Row[]).slice(0, 100).entries()) {
        const offset = Number(raw.offset_days);
        const due = Number.isFinite(offset) ? new Date(base + offset * DAY) : end !== null ? new Date(end) : null;
        const row: Row = await createIn(tx, sys, "release_task", {
          release_id: id,
          short_description: String(raw.short_description ?? "").slice(0, 200),
          description: raw.description ?? null,
          phase: raw.phase ?? "build",
          mandatory: raw.mandatory !== false,
          planned_hours: raw.planned_hours ?? null,
          sort_order: (i + 1) * 10,
          due_at: due ? due.toISOString() : null,
          assignment_group_id: rel.assignment_group_id ?? null,
          depends_on: raw.after_previous && prev ? [prev] : [],
        }, { trusted: true });
        prev = String(row.id);
        tasks++;
      }
    }
    const checks = await ensureResultsIn(tx, sys, rel);
    await stampReadinessIn(tx, sys, (await liveRow(tx, sys, "release", id)) ?? rel, await storedReadiness(tx, sys, id));
    await recalcRiskIn(tx, sys, id);
    return { tasks, checks };
  });
}

/** Re-evaluate (or only roll up) a release's checks and its risk. */
export async function recalcRelease(sys: Ctx, id: string, opts: { checks?: boolean } = {}): Promise<void> {
  await sys.write(async (tx) => {
    const rel = await liveRow(tx, sys, "release", id);
    if (!rel || ["closed", "canceled"].includes(String(rel.state))) return;
    if (opts.checks || ["test", "readiness"].includes(String(rel.state))) await evaluateChecksIn(tx, sys, id);
    else await stampReadinessIn(tx, sys, rel, await storedReadiness(tx, sys, id));
    await recalcRiskIn(tx, sys, id);
  });
}

export interface ReleaseSweepResult {
  risk: number;
  checked: number;
  els_ended: number;
  released: number;
  pending: boolean;
}

/** One pass of the sweep (`now` for tests). */
export async function releaseSweep(sys: Ctx, deadline = Number.POSITIVE_INFINITY, now = Date.now()): Promise<ReleaseSweepResult> {
  const out: ReleaseSweepResult = { risk: 0, checked: 0, els_ended: 0, released: 0, pending: false };
  const open = await liveRows(sys.db, sys, "release", { f: "state", op: "nin", v: ["closed", "canceled"] }, { order: "t.planned_end nulls last", limit: 2000 });
  out.pending = open.length > 0;
  for (const rel of open) {
    if (Date.now() > deadline) break;
    const id = String(rel.id);
    await sys.write(async (tx) => {
      if (["test", "readiness"].includes(String(rel.state))) {
        await evaluateChecksIn(tx, sys, id);
        out.checked++;
      }
      if (await recalcRiskIn(tx, sys, id)) out.risk++;
      // early life support ended
      if (rel.state === "els" && msOf(rel.els_end_at) !== null && msOf(rel.els_end_at)! <= now) {
        const moved = await savepoint(tx, () => transitionIn(tx, sys, "release", id, "review", {}, { trusted: true })).then(() => true, () => false);
        if (moved) {
          out.els_ended++;
          await emitEvent(tx, sys, { kind: "record.release.els_ended", table: "release", id, number: rel.number ?? null, data: { users: releasePeople(rel), incidents: Number(rel.els_incidents ?? 0) } });
        }
      }
      // deployed with feature flags held back: released once every flag of the release is on
      if (rel.deployed_at && !rel.released_at) {
        const flags = await liveRows(tx, sys, "feature_flag", { f: "release_id", op: "eq", v: id });
        if (flags.length && flags.every((f) => f.state === "on")) {
          await updateIn(tx, sys, "release", id, { released_at: new Date(now).toISOString() }, { trusted: true, keepVersion: true });
          out.released++;
        }
      }
    });
  }
  return out;
}

export function installReleaseJobs(): (() => void)[] {
  return [
    registerJobHandler("release.setup", async (job, jctx) => {
      if (!job.org_id || typeof job.payload?.id !== "string") return;
      await setupRelease(await systemCtx(jctx.cfg, job.org_id), String(job.payload.id));
    }),
    registerJobHandler("release.recalc", async (job, jctx) => {
      if (!job.org_id || typeof job.payload?.id !== "string") return;
      await recalcRelease(await systemCtx(jctx.cfg, job.org_id), String(job.payload.id), { checks: job.payload.checks === true });
    }),
    registerJobHandler("release.deployment", async (job, jctx) => {
      if (!job.org_id || typeof job.payload?.id !== "string") return;
      const sys = await systemCtx(jctx.cfg, job.org_id);
      await deploymentEffects(sys, String(job.payload.id));
      const dep = await liveRow(sys.db, sys, "deployment", job.payload.id);
      if (dep && isUuid(dep.release_id)) await recalcRelease(sys, String(dep.release_id));
    }),
    registerJobHandler("release.sweep", async (job, jctx) => {
      if (!job.org_id || !actsHere(jctx.cfg)) return;
      const sys = await systemCtx(jctx.cfg, job.org_id);
      const r = await releaseSweep(sys, jctx.deadline);
      return r.pending ? { again: RELEASE_SWEEP_EVERY } : undefined;
    }),
    onRecordEvent("release", async (e, jctx) => {
      if (actsHere(jctx.cfg)) await ensureReleaseSweep(jctx.db, e.org_id);
    }, { tables: ["release"], kinds: ["record.created", "record.state_changed"] }),
    // the scope of a release: changes it includes, problems and known errors it fixes, incidents of its early life
    // support; and the incidents a deployment caused
    onRecordEvent("release.links", async (e, jctx) => {
      if (!actsHere(jctx.cfg)) return;
      const sys = await systemCtx(jctx.cfg, e.org_id);
      const kind = String(e.data?.kind ?? "");
      if (e.table === "release" && ["release_includes", "fixes", "els_incident"].includes(kind)) {
        await sys.write((tx) => recountRelease(tx, sys, e.id));
        if (kind === "release_includes") await recalcRelease(sys, e.id);
      } else if (e.table === "deployment" && kind === "caused_by") {
        await sys.write((tx) => recountDeployment(tx, sys, e.id));
      }
    }, { tables: ["release", "deployment"], kinds: ["record.linked", "record.unlinked"] }),
    // a change of a release moved: its release's counts and checks follow
    onRecordEvent("release.changes", async (e, jctx) => {
      if (!actsHere(jctx.cfg)) return;
      const sys = await systemCtx(jctx.cfg, e.org_id);
      const releases = await sys.write((tx) => linkedReleases(tx, sys, "change_request", e.id));
      for (const r of releases) {
        await sys.write((tx) => recountRelease(tx, sys, r));
        await recalcRelease(sys, r);
      }
      // a change's caused incidents count for its deployments
      const deps = await liveRows(sys.db, sys, "deployment", { f: "change_id", op: "eq", v: e.id });
      for (const d of deps) await sys.write((tx) => recountDeployment(tx, sys, String(d.id)));
    }, { tables: ["change_request"], kinds: ["record.state_changed", "record.linked", "record.unlinked"] }),
    // a new incident: early life support of releases and suspects among recent production deployments
    onRecordEvent("release.incidents", async (e, jctx) => {
      if (!actsHere(jctx.cfg)) return;
      const sys = await systemCtx(jctx.cfg, e.org_id);
      const tagged = await sys.write(async (tx) => {
        const inc = await liveRow(tx, sysOf(sys), "incident", e.id);
        return inc ? tagIncident(tx, sys, inc) : { els: [], suspects: [] };
      });
      for (const r of tagged.els) await sys.write((tx) => recountRelease(tx, sys, r));
    }, { tables: ["incident"], kinds: ["record.created"] }),
  ];
}
