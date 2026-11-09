// Hooks of release management (same transaction as the write; no model or network calls):
//   release          template snapshot on create (plans, tasks, early life support), required dates of a window,
//                    hold bookkeeping, the CMDB's impacted services, early-life-support end, schedule adherence,
//                    guards «release_go» (no blocking check left, a Go decision when the policy asks for one) and
//                    «release_emergency»; scope copies pushed to the rows hanging off the release
//   release_task     the release's manager copied, dependencies done before a task starts or ends
//   check results    waivers by the release manager's authority with a reason; a person's verdict stamped
//   deployment       production flag and copies from the release and environment, timestamps and durations,
//                    lead time, the guard «deployment_gate» (approval and authorized change on protected
//                    environments, the release's Go for production) and the policy note
//   definitions      revisions of templates and policies, environment keys, window dates, booking overlaps,
//                    artifacts' component count, defects found in production
import { DEPLOYMENT_FAILED, RELEASE_PREPARING, RELEASE_TASK_DONE } from "@shared/tables/release";
import { elsEnd, goProblem, onSchedule } from "@shared/release/logic";
import { pushGuard, registerHooks, updateIn, type PushArgs, type WriteArgs } from "../../engine";
import { enqueue } from "../../jobs";
import { bad, conflict, forbidden } from "../../http/errors";
import { servicesImpactedBy } from "../cmdb";
import { copyOf, storedReadiness } from "./checks";
import { environmentOf, ids, isProductionEnv, isUuid, liveRow, liveRows, managesReleases, msOf, releaseConfig, sysOf, type Row } from "./common";

const now = () => new Date().toISOString();
const AUTHORIZED_CHANGE = ["scheduled", "implement", "review", "closed"];
const CHILD_TABLES = ["release_check_result", "release_decision", "release_note"];

/** Template values copied into an empty field of a new release. */
const TEMPLATE_FIELDS = ["build_plan", "test_plan", "deployment_plan", "rollback_plan", "communication_plan"];

async function releaseBefore(w: WriteArgs): Promise<void> {
  const { tx, ctx, next, prev, op } = w;
  const sys = sysOf(ctx);
  if (op === "create") {
    if (isUuid(next.template_id)) {
      const t = await liveRow(tx, sys, "release_template", next.template_id);
      if (!t || t.active === false) throw bad("این الگوی انتشار فعال نیست");
      for (const f of TEMPLATE_FIELDS) if (!String(next[f] ?? "").trim() && t[f]) next[f] = t[f];
      if (next.els_days === null || next.els_days === undefined) next.els_days = t.els_days ?? null;
      if (!next.type && t.type) next.type = t.type;
    }
    if (next.els_days === null || next.els_days === undefined) {
      const policy = (await liveRows(tx, sys, "release_policy", { f: "active", op: "eq", v: true })).find((p) => p.type === next.type && p.els_days !== null && p.els_days !== undefined);
      next.els_days = policy ? policy.els_days : (await releaseConfig(tx, ctx)).els_days;
    }
  }
  const start = msOf(next.planned_start);
  const end = msOf(next.planned_end);
  if (start !== null && end !== null && end < start) throw bad("تاریخ عرضه پیش از شروع برنامه‌ریزی‌شده است");
  // the policy's least notice between registration and delivery (REL-002); the emergency procedure has none
  if (end !== null && next.type !== "emergency" && !w.trusted && (op === "create" || w.changed.has("planned_end") || w.changed.has("type")) && RELEASE_PREPARING.includes(String(next.state ?? "draft"))) {
    const policy = (await liveRows(tx, sys, "release_policy", { f: "active", op: "eq", v: true })).find((p) => p.type === next.type && Number(p.min_lead_days ?? 0) > 0);
    const registered = msOf(next.created_at) ?? Date.now();
    const days = Number(policy?.min_lead_days ?? 0);
    if (policy && end - registered < days * 86_400_000) throw bad(`خط‌مشی «${policy.name}» دست‌کم ${days.toLocaleString("fa-IR")} روز فاصله از ثبت تا عرضه می‌خواهد؛ تاریخ عرضه را دیرتر بگذارید یا رویهٔ اضطراری را به کار ببرید`);
  }
  if (isUuid(next.window_id) && (w.changed.has("window_id") || op === "create")) {
    const win = await liveRow(tx, sys, "release_window", next.window_id);
    if (win && Number(win.capacity ?? 0) > 0) {
      const taken = (await liveRows(tx, sys, "release", { f: "window_id", op: "eq", v: next.window_id })).filter((r) => r.id !== next.id && !["closed", "canceled"].includes(String(r.state)));
      if (taken.length >= Number(win.capacity)) throw conflict(`ظرفیت «${win.name}» (${Number(win.capacity).toLocaleString("fa-IR")} انتشار) پر است`);
    }
  }
  if (isUuid(next.parent_release_id) && next.parent_release_id === next.id) throw bad("انتشار نمی‌تواند والد خودش باشد");
  if (w.changed.has("parent_release_id") && isUuid(next.parent_release_id)) {
    // no cycles in the release train
    let p: string | null = next.parent_release_id;
    for (let i = 0; p && i < 20; i++) {
      if (p === next.id) throw bad("این والد یک چرخه در قطار انتشار می‌سازد");
      p = (await liveRow(tx, sys, "release", p))?.parent_release_id ?? null;
    }
  }
  // the CMDB's services reached by the release's CIs
  if (op === "create" || w.changed.has("affected_cis") || w.changed.has("ci_id")) {
    const cis = ids([...(Array.isArray(next.affected_cis) ? next.affected_cis : []), next.ci_id]);
    try {
      next.impacted_services = cis.length ? (await servicesImpactedBy(tx, sys, cis)).slice(0, 200) : [];
    } catch {
      next.impacted_services = next.impacted_services ?? [];
    }
  }
  if (op === "transition" && w.transition) {
    const to = w.transition.to;
    if (to === "on_hold" && prev) next.state_before_hold = prev.state;
    if (["planning", "build"].includes(to) && !next.actual_start) next.actual_start = now();
    if (to === "deploying" && prev?.state === "readiness" && next.go_no_go === "no_go") throw conflict("تصمیم «توقف» برای این انتشار ثبت شده است");
    // a new decision cycle starts on entering readiness (a No-Go stays visible while the release goes back)
    if (to === "readiness" && prev?.state !== "readiness") {
      next.go_no_go = "pending";
      next.go_no_go_at = null;
      next.go_conditions = null;
    }
    if (to === "review" || to === "closed") next.actual_end = next.actual_end ?? now();
  }
  if (w.changed.has("deployed_at") || (next.deployed_at && (next.els_end_at === null || next.els_end_at === undefined))) {
    next.els_end_at = elsEnd(next.deployed_at, Number(next.els_days ?? 0));
    next.on_schedule = onSchedule(next.planned_end, next.deployed_at);
  }
}

/** Push the release's scope columns to the rows hanging off it when they change. */
async function releaseAfter(w: WriteArgs): Promise<void> {
  const { tx, ctx, next, op } = w;
  if (op === "delete") return;
  const sys = sysOf(ctx);
  if (op !== "create" && ["assignment_group_id", "assigned_to", "release_manager_id"].some((f) => w.changed.has(f))) {
    const copy = copyOf(next);
    for (const table of [...CHILD_TABLES, "release_task", "deployment"]) {
      for (const r of await liveRows(tx, sys, table, { f: "release_id", op: "eq", v: next.id })) {
        const patch: Row = table === "release_task" || table === "deployment" ? { release_manager_id: copy.release_manager_id } : copy;
        if (Object.entries(patch).some(([k, v]) => r[k] !== v)) await updateIn(tx, sys, table, String(r.id), patch, { trusted: true, keepVersion: true });
      }
    }
  }
  if (op === "create") {
    await enqueue(tx, { kind: "release.setup", orgId: ctx.org.id, payload: { id: next.id }, dedupeKey: `release.setup:${next.id}` });
  }
  if (op === "transition" && w.transition && ["test", "readiness"].includes(w.transition.to)) {
    await enqueue(tx, { kind: "release.recalc", orgId: ctx.org.id, payload: { id: next.id, checks: true }, delayMs: 0, dedupeKey: `release.recalc:${next.id}` });
  }
}

/** Is the policy of this release's type asking for a recorded Go decision (default yes)? */
async function decisionRequired(w: WriteArgs): Promise<boolean> {
  const policies = await liveRows(w.tx, sysOf(w.ctx), "release_policy", { f: "active", op: "eq", v: true });
  const own = policies.find((p) => p.type === w.next.type) ?? policies.find((p) => !p.type);
  return own ? own.go_no_go_required !== false : true;
}

/**
 * The module's definitions — templates, policies, the check library, environments, windows and the settings — are
 * the release manager's (the release area's approve right): a role that may create releases does not change the rules
 * they are judged by. The system and trusted server code (the seed) always may.
 */
export const DEFINITION_TABLES = ["release_template", "release_policy", "release_check", "release_environment", "release_window", "release_config"];

async function definitionsGuard(w: WriteArgs): Promise<void> {
  if (w.trusted || w.ctx.actor === "system") return;
  if (!(await managesReleases(w.tx, w.ctx))) throw forbidden(`تعریف «${w.def.label}» با مدیر انتشار است`);
}

/**
 * A Windows app's push runs no beforeWrite: the scope columns a row copies from its release (who reaches it) are the
 * cloud's, taken from the stored release — never from the push.
 */
async function releaseCopyOnPush(p: PushArgs): Promise<Row | null> {
  const rel = isUuid(p.next.release_id) ? await liveRow(p.tx, sysOf(p.ctx), "release", p.next.release_id) : null;
  const copy = copyOf(rel ?? {});
  return p.def.key === "release_task" || p.def.key === "deployment" ? { release_manager_id: copy.release_manager_id } : copy;
}

/** The pushed twin of the check result's rules: a waiver is the release manager's, with a reason; automatic checks
 * are their rule's. */
async function checkResultOnPush(w: WriteArgs): Promise<void> {
  if (!w.changed.has("status")) return;
  if (w.next.status === "waived") {
    if (!(await managesReleases(w.tx, w.ctx))) throw forbidden("چشم‌پوشی از بررسی آمادگی با مدیر انتشار است");
    if (!String(w.next.waiver_reason ?? "").trim()) throw bad("دلیل چشم‌پوشی را بنویسید");
  }
  const prev = w.prev;
  if (prev && prev.rule !== "manual" && !["waived", "na"].includes(String(w.next.status)) && prev.status !== "waived") throw bad("نتیجهٔ بررسی خودکار را قاعدهٔ آن تعیین می‌کند؛ فقط می‌توان چشم‌پوشی کرد");
}

export function installReleaseHooks(): (() => void)[] {
  return [
    ...DEFINITION_TABLES.map((t) => registerHooks(t, { beforeWrite: definitionsGuard, validatePush: pushGuard(definitionsGuard) })),
    ...[...CHILD_TABLES, "release_task", "deployment"].map((t) => registerHooks(t, { derivePush: releaseCopyOnPush })),
    registerHooks("release_check_result", { validatePush: pushGuard(checkResultOnPush) }),
    registerHooks("release_decision", {
      // decisions come from the release page (the approvals service), never from a Windows app's push
      validatePush: () => "تصمیم اجرا را از صفحهٔ انتشار ثبت کنید",
    }),
    registerHooks("release", {
      beforeWrite: releaseBefore,
      afterWrite: releaseAfter,
      guards: {
        release_go: async (w) => goProblem(w.next, await storedReadiness(w.tx, w.ctx, String(w.next.id)), { decisionRequired: await decisionRequired(w) }),
        release_emergency: (w) => (w.next.type === "emergency" ? null : "رویهٔ اضطراری فقط برای انتشار اضطراری است"),
      },
    }),

    registerHooks("release_task", {
      async beforeWrite(w) {
        const { tx, ctx, next } = w;
        if (w.op === "create" || w.changed.has("release_id")) {
          const rel = await liveRow(tx, sysOf(ctx), "release", next.release_id);
          if (!rel) throw bad("انتشار پیدا نشد");
          if (["closed", "canceled"].includes(String(rel.state))) throw conflict("به انتشار بسته یا لغوشده نمی‌توان کار افزود");
          next.release_manager_id = rel.release_manager_id ?? null;
          if (!next.assignment_group_id && rel.assignment_group_id) next.assignment_group_id = rel.assignment_group_id;
        }
        if (Array.isArray(next.depends_on) && next.depends_on.includes(next.id)) throw bad("کار نمی‌تواند به خودش وابسته باشد");
      },
      async afterWrite(w) {
        if (w.op === "delete" || (!w.changed.has("state") && !w.changed.has("due_at") && w.op !== "create")) return;
        await enqueue(w.tx, { kind: "release.recalc", orgId: w.ctx.org.id, payload: { id: w.next.release_id }, delayMs: 2_000, dedupeKey: `release.recalc:${w.next.release_id}` });
      },
      guards: {
        release_task_ready: async (w) => {
          const deps = ids(w.next.depends_on);
          if (!deps.length) return null;
          const open = (await liveRows(w.tx, sysOf(w.ctx), "release_task", { f: "id", op: "in", v: deps })).filter((t) => !RELEASE_TASK_DONE.includes(String(t.state)));
          return open.length ? `ابتدا کارهای پیش‌نیاز انجام شود: ${open.map((t) => t.number).join("، ")}` : null;
        },
      },
    }),

    registerHooks("release_check_result", {
      async beforeWrite(w) {
        const { tx, ctx, next, prev } = w;
        if (w.op === "create" || w.changed.has("release_id")) {
          const rel = await liveRow(tx, sysOf(ctx), "release", next.release_id);
          if (!rel) throw bad("انتشار پیدا نشد");
          Object.assign(next, copyOf(rel));
          if (!next.name || !next.rule) {
            const c = await liveRow(tx, sysOf(ctx), "release_check", next.check_id);
            if (!c) throw bad("بررسی آمادگی پیدا نشد");
            next.name = next.name || c.name;
            next.rule = next.rule || c.rule;
            next.phase = next.phase || c.phase;
            next.blocking = c.blocking !== false;
          }
        }
        if (w.trusted || ctx.actor === "system") return;
        if (w.changed.has("status")) {
          if (next.status === "waived") {
            if (!(await managesReleases(tx, ctx))) throw forbidden("چشم‌پوشی از بررسی آمادگی با مدیر انتشار است");
            if (!String(next.waiver_reason ?? "").trim()) throw bad("دلیل چشم‌پوشی را بنویسید");
            next.waived_by = ctx.user.id;
          } else if (prev?.status === "waived") {
            next.waived_by = null;
          }
          if (prev && prev.rule !== "manual" && !["waived", "na"].includes(String(next.status)) && prev.status !== "waived") throw bad("نتیجهٔ بررسی خودکار را قاعدهٔ آن تعیین می‌کند؛ فقط می‌توان چشم‌پوشی کرد");
          next.checked_by = ctx.user.id;
          next.evaluated_at = now();
        }
      },
      async afterWrite(w) {
        if (w.op === "delete" || !w.changed.has("status")) return;
        await enqueue(w.tx, { kind: "release.recalc", orgId: w.ctx.org.id, payload: { id: w.next.release_id, rollup: true }, delayMs: 0, dedupeKey: `release.recalc:${w.next.release_id}` });
      },
    }),

    registerHooks("release_decision", {
      async beforeWrite(w) {
        if (w.op === "delete") {
          if (w.ctx.actor !== "system") throw forbidden("تصمیم ثبت‌شده پاک نمی‌شود");
          return;
        }
        if (w.op === "update" && !w.trusted && w.ctx.actor !== "system") throw forbidden("تصمیم ثبت‌شده تغییر نمی‌کند؛ تصمیم تازه ثبت کنید");
        if (w.op === "create" && !w.trusted && w.ctx.actor !== "system") throw forbidden("تصمیم اجرا را از صفحهٔ انتشار ثبت کنید");
      },
    }),

    registerHooks("release_note", {
      async beforeWrite(w) {
        const { tx, ctx, next } = w;
        if (w.op === "create" || w.changed.has("release_id")) {
          const rel = await liveRow(tx, sysOf(ctx), "release", next.release_id);
          if (!rel) throw bad("انتشار پیدا نشد");
          Object.assign(next, copyOf(rel));
        }
        if (w.changed.has("state") && next.state === "published" && !next.published_at) {
          next.published_at = now();
          next.published_by = ctx.actor === "system" ? null : ctx.user.id;
        }
      },
    }),

    registerHooks("deployment", {
      async beforeWrite(w) {
        const { tx, ctx, next, prev } = w;
        const sys = sysOf(ctx);
        if (w.op === "delete") return;
        const env = await environmentOf(tx, ctx, next.environment_id);
        if (!env) throw bad("محیط استقرار پیدا نشد");
        next.is_production = isProductionEnv(env);
        if (w.op === "create" || w.changed.has("release_id")) {
          const rel = isUuid(next.release_id) ? await liveRow(tx, sys, "release", next.release_id) : null;
          next.release_manager_id = rel?.release_manager_id ?? null;
          if (rel) {
            if (!next.service_id && rel.service_id) next.service_id = rel.service_id;
            if (!String(next.rollback_plan ?? "").trim() && rel.rollback_plan) next.rollback_plan = rel.rollback_plan;
            if (!next.artifact_version && rel.version_name) next.artifact_version = rel.version_name;
            if (!next.assignment_group_id && rel.assignment_group_id) next.assignment_group_id = rel.assignment_group_id;
            if (Array.isArray(rel.affected_cis) && !(Array.isArray(next.targets) && next.targets.length)) next.targets = rel.affected_cis;
          }
        }
        if (!String(next.short_description ?? "").trim()) next.short_description = `استقرار ${next.artifact_version ?? ""} در ${env.name}`.replace(/\s+/g, " ").trim();
        if (!next.assignment_group_id && env.assignment_group_id) next.assignment_group_id = env.assignment_group_id;
        if (w.op === "transition" && w.transition) {
          const to = w.transition.to;
          if (to === "in_progress" && !next.actual_start) next.actual_start = now();
          if (["succeeded", "failed", "rolled_back"].includes(to)) {
            next.actual_end = next.actual_end ?? now();
            if (!next.actual_start) next.actual_start = next.actual_end;
            next.close_code = to === "succeeded" ? "successful" : to;
          }
          if (to === "canceled") next.close_code = "canceled";
        }
        const s = msOf(next.actual_start);
        const e = msOf(next.actual_end);
        if (s !== null && e !== null && e >= s) next.duration = Math.round((e - s) / 1000);
        const fc = msOf(next.first_commit_at);
        if (fc !== null && e !== null && e >= fc && ["succeeded", "closed"].includes(String(next.state))) next.lead_time = Math.round((e - fc) / 1000);
        next.change_failure = DEPLOYMENT_FAILED.includes(String(next.state)) || Number(next.incidents_caused ?? 0) > 0 || (prev?.change_failure === true && next.state === "closed" && DEPLOYMENT_FAILED.includes(String(prev.close_code ?? "")));
        // the policy note: production without an authorized change
        if (next.is_production && (w.changed.has("change_id") || w.changed.has("state") || w.op === "create")) {
          const change = isUuid(next.change_id) ? await liveRow(tx, sys, "change_request", next.change_id) : null;
          next.policy_note = !change ? "استقرار عملیاتی بدون تغییر مجاز" : !AUTHORIZED_CHANGE.includes(String(change.state)) ? `تغییر ${change.number} هنوز مجاز نشده است` : null;
        }
      },
      async afterWrite(w) {
        if (w.op === "delete") return;
        if (w.changed.has("state") || w.op === "create") {
          await enqueue(w.tx, { kind: "release.deployment", orgId: w.ctx.org.id, payload: { id: w.next.id, state: w.next.state }, dedupeKey: `release.deployment:${w.next.id}:${w.next.state}` });
        }
      },
      guards: {
        deployment_gate: async (w) => {
          const { tx, ctx, next } = w;
          const sys = sysOf(ctx);
          const env = await environmentOf(tx, ctx, next.environment_id);
          // what a pipeline already did is recorded as it happened (its gate is the deployment gate API)
          if (isUuid(next.connection_id)) return null;
          if (env && env.protection !== "open" && next.approval !== "approved") return `استقرار در محیط «${env.name}» تأیید لازم دارد؛ ابتدا «درخواست تأیید» بزنید`;
          if (env?.protection === "change") {
            const change = isUuid(next.change_id) ? await liveRow(tx, sys, "change_request", next.change_id) : null;
            if (!change) return `استقرار در محیط «${env.name}» تغییر مجاز لازم دارد`;
            if (!["scheduled", "implement"].includes(String(change.state))) return `تغییر ${change.number} در وضعیت اجرا نیست`;
          }
          if (isProductionEnv(env) && isUuid(next.release_id)) {
            const rel = await liveRow(tx, sys, "release", next.release_id);
            if (rel && RELEASE_PREPARING.includes(String(rel.state)) && rel.type !== "emergency") return `انتشار ${rel.number} هنوز به مرحلهٔ استقرار نرسیده است (تصمیم اجرا لازم است)`;
          }
          return null;
        },
      },
    }),

    registerHooks("release_template", {
      beforeWrite(w) {
        if (w.op === "update" && [...w.changed].some((f) => f !== "active")) w.next.revision = Number(w.prev?.revision ?? 1) + 1;
        if (w.next.tasks !== null && w.next.tasks !== undefined && !Array.isArray(w.next.tasks)) throw bad("کارهای الگو باید فهرست باشد");
        for (const t of Array.isArray(w.next.tasks) ? w.next.tasks : []) if (!t || typeof t !== "object" || !String((t as Row).short_description ?? "").trim()) throw bad("هر کار الگو عنوان (short_description) لازم دارد");
      },
    }),
    registerHooks("release_policy", {
      beforeWrite(w) {
        if (w.op === "update" && [...w.changed].some((f) => f !== "active")) w.next.revision = Number(w.prev?.revision ?? 1) + 1;
      },
    }),
    registerHooks("release_environment", {
      beforeWrite(w) {
        if (w.next.key) w.next.key = String(w.next.key).trim().toLowerCase().replace(/\s+/g, "-");
        if (!/^[a-z0-9][a-z0-9._-]{0,39}$/.test(String(w.next.key ?? ""))) throw bad("کلید محیط فقط حروف کوچک لاتین، رقم، نقطه و خط تیره");
        if (Array.isArray(w.next.aliases)) w.next.aliases = [...new Set((w.next.aliases as string[]).map((a) => a.trim().toLowerCase()).filter(Boolean))];
      },
    }),
    registerHooks("release_window", {
      beforeWrite(w) {
        const s = msOf(w.next.start_at);
        const e = msOf(w.next.end_at);
        if (s !== null && e !== null && e <= s) throw bad("پایان پنجره باید پس از شروع آن باشد");
      },
    }),
    registerHooks("environment_booking", {
      async beforeWrite(w) {
        const { tx, ctx, next } = w;
        if (w.op === "delete") return;
        const s = msOf(next.start_at);
        const e = msOf(next.end_at);
        if (s === null || e === null || e <= s) throw bad("پایان رزرو باید پس از شروع آن باشد");
        if (["requested", "approved", "active"].includes(String(next.state)) && (w.op === "create" || ["start_at", "end_at", "environment_id", "state"].some((f) => w.changed.has(f)))) {
          const others = (await liveRows(tx, sysOf(ctx), "environment_booking", { and: [{ f: "environment_id", op: "eq", v: next.environment_id }, { f: "state", op: "in", v: ["approved", "active"] }] }))
            .filter((b) => b.id !== next.id && (msOf(b.start_at) ?? 0) < e && (msOf(b.end_at) ?? 0) > s);
          if (others.length) throw conflict(`این محیط در این بازه رزرو شده است (${others.map((b) => b.number).join("، ")})`);
        }
      },
    }),
    registerHooks("artifact", {
      beforeWrite(w) {
        if (!w.changed.has("sbom") && w.op !== "create") return;
        const sbom = w.next.sbom as Row | null;
        const comps = Array.isArray(sbom?.components) ? sbom!.components : Array.isArray(sbom?.packages) ? sbom!.packages : null;
        w.next.components = comps ? comps.length : null;
      },
    }),
    registerHooks("defect", {
      async beforeWrite(w) {
        if (!(w.op === "create" || w.changed.has("found_in_env"))) return;
        const env = await environmentOf(w.tx, w.ctx, w.next.found_in_env);
        w.next.escaped = isProductionEnv(env);
      },
    }),
  ];
}
