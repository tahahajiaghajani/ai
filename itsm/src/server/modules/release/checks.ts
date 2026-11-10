// Readiness checks of a release (REL-013): the checks that apply (the template's list, else every active check of
// the library for the release's type, plus the mandatory checks of the type's policy) become result rows on the
// release; automatic rules are evaluated against what is stored now — tasks, the changes it includes, approvals,
// deployments to test environments, open critical defects, the plans and notes, freezes in the window (the change
// module's windows and the module's own release freezes) and conditions on the record; manual checks wait for a
// person. The roll-up (checks, failures, readiness percent) is stamped on the release. Everything runs as the system
// inside the caller's transaction; results are re-evaluated on demand, on entering readiness and by the sweep.
import { evaluate } from "@shared/model/conditions";
import { occurrences, type WindowLike } from "@shared/change/logic";
import { deploymentOutcome } from "@shared/devops/logic";
import { checkApplies, readinessOf, type Readiness } from "@shared/release/logic";
import { CHECK_RULES, DEFECT_DONE, DEPLOYMENT_FINISHED, RELEASE_TASK_DONE } from "@shared/tables/release";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { condEnv, createIn, orgSchema, orgTz, updateIn } from "../../engine";
import { occurrencesBetween } from "../change";
import { DAY_MS } from "@shared/release/logic";
import { eqAll, faList, ids, isUuid, liveRow, liveRows, msOf, sysOf, type Row } from "./common";

const AUTHORIZED = ["scheduled", "implement", "review", "closed"];
const NON_PROD = ["test", "uat", "staging"];

/** Scope columns a row hanging off a release copies from it. */
export const copyOf = (release: Row): Row => ({
  assignment_group_id: release.assignment_group_id ?? null,
  assigned_to: release.assigned_to ?? null,
  release_manager_id: release.release_manager_id ?? null,
});

/** The library checks that apply to a release. */
export async function applicableChecks(tx: Tx, ctx: Ctx, release: Row): Promise<Row[]> {
  const sys = sysOf(ctx);
  const library = await liveRows(tx, sys, "release_check", { f: "active", op: "eq", v: true }, { order: "t.sort_order, t.name" });
  const template = isUuid(release.template_id) ? await liveRow(tx, sys, "release_template", release.template_id) : null;
  const named = ids(template?.checks);
  let chosen = named.length ? library.filter((c) => named.includes(String(c.id))) : library.filter((c) => checkApplies(c, release));
  const policies = await liveRows(tx, sys, "release_policy", { f: "active", op: "eq", v: true });
  const mandatory = new Set(policies.filter((p) => !p.type || p.type === release.type).flatMap((p) => ids(p.mandatory_checks)));
  for (const c of library) if (mandatory.has(String(c.id)) && !chosen.some((x) => x.id === c.id)) chosen = [...chosen, c];
  return chosen;
}

/** Create the result rows a release is missing (pending), as the system. */
export async function ensureResultsIn(tx: Tx, ctx: Ctx, release: Row): Promise<number> {
  const sys = sysOf(ctx);
  const checks = await applicableChecks(tx, ctx, release);
  const have = new Set((await liveRows(tx, sys, "release_check_result", { f: "release_id", op: "eq", v: release.id })).map((r) => String(r.check_id)));
  let added = 0;
  for (const c of checks) {
    if (have.has(String(c.id))) continue;
    await createIn(tx, sys, "release_check_result", {
      release_id: release.id, check_id: c.id, name: c.name, rule: c.rule, phase: c.phase ?? "readiness", blocking: c.blocking !== false, status: "pending", ...copyOf(release),
    }, { trusted: true });
    added++;
  }
  return added;
}

/** Ids of the records of `table` a release links to with `kind` (either direction), as the system. */
export async function linkedIds(tx: Tx, ctx: Ctx, releaseId: string, kind: string, table: string): Promise<string[]> {
  const rows = await tx.query<{ id: string }>(
    `select case when l.from_id = $2 then l.to_id else l.from_id end as id from sm_links l
      where l.org_id = $1 and l.deleted_at is null and l.kind = $3
        and ((l.from_table = 'release' and l.from_id = $2 and l.to_table = $4) or (l.to_table = 'release' and l.to_id = $2 and l.from_table = $4))`,
    [ctx.org.id, releaseId, kind, table],
  );
  return [...new Set(rows.map((r) => String(r.id)))];
}

/** The changes a release includes (as the system). */
export async function releaseChanges(tx: Tx, ctx: Ctx, releaseId: string): Promise<Row[]> {
  const list = await linkedIds(tx, ctx, releaseId, "release_includes", "change_request");
  return list.length ? liveRows(tx, sysOf(ctx), "change_request", { f: "id", op: "in", v: list }) : [];
}

/** Blocking freezes, blackouts and release freezes that overlap a release's window. */
export async function freezesFor(tx: Tx, ctx: Ctx, release: Row): Promise<{ name: string; start: number; end: number }[]> {
  const end = msOf(release.planned_end);
  if (end === null) return [];
  const start = msOf(release.planned_start) ?? end - DAY_MS;
  const from = Math.min(start, end - DAY_MS);
  const out: { name: string; start: number; end: number }[] = [];
  try {
    for (const o of await occurrencesBetween(tx, sysOf(ctx), from, end + 1)) {
      if ((o.kind === "freeze" || o.kind === "blackout") && o.enforcement !== "warn") out.push({ name: o.name, start: o.start, end: o.end });
    }
  } catch {
    // no change module tables yet: nothing to check
  }
  const tz = orgTz(ctx);
  const own = await liveRows(tx, sysOf(ctx), "release_window", { and: [{ f: "active", op: "eq", v: true }, { f: "kind", op: "eq", v: "release_freeze" }] });
  for (const w of own) {
    const types = Array.isArray(w.types) ? w.types : [];
    if (types.length && !types.includes(release.type)) continue;
    for (const o of occurrences(windowLike(w), from, end + 1, tz)) out.push({ name: o.name, start: o.start, end: o.end });
  }
  return out;
}

export const windowLike = (w: Row): WindowLike => ({
  id: String(w.id), name: String(w.name ?? ""), kind: String(w.kind ?? "slot"), active: w.active !== false, start_at: w.start_at, end_at: w.end_at,
  recurrence: w.recurrence ?? "none", weekdays: Array.isArray(w.weekdays) ? w.weekdays : [], until: w.until ?? null,
});

type Verdict = { status: "pass" | "fail" | "na"; message: string };

const numberList = (rows: Row[], max = 5) => faList(rows.slice(0, max).map((r) => String(r.number ?? r.short_description ?? r.name ?? ""))) + (rows.length > max ? "…" : "");

/** The verdict of an automatic rule, or null for manual checks. */
async function verdict(tx: Tx, ctx: Ctx, release: Row, check: Row, rule: string): Promise<Verdict | null> {
  const sys = sysOf(ctx);
  switch (rule) {
    case "tasks_done": {
      const open = (await liveRows(tx, sys, "release_task", eqAll({ release_id: release.id, mandatory: true }))).filter((t) => !RELEASE_TASK_DONE.includes(String(t.state)));
      return open.length ? { status: "fail", message: `${open.length.toLocaleString("fa-IR")} کار الزامی باز است: ${numberList(open)}` } : { status: "pass", message: "همهٔ کارهای الزامی انجام شده است" };
    }
    case "changes_authorized": {
      const changes = (await releaseChanges(tx, ctx, String(release.id))).filter((c) => c.state !== "canceled");
      if (!changes.length) return { status: "na", message: "انتشار تغییری ندارد" };
      const bad = changes.filter((c) => !AUTHORIZED.includes(String(c.state)));
      return bad.length ? { status: "fail", message: `تغییرهای مجازنشده: ${numberList(bad)}` } : { status: "pass", message: `${changes.length.toLocaleString("fa-IR")} تغییر مجاز است` };
    }
    case "approvals_complete":
      return release.approval === "requested" ? { status: "fail", message: "تأییدهای انتشار هنوز باز است" }
        : release.approval === "rejected" ? { status: "fail", message: "تأیید انتشار رد شده است" }
          : { status: "pass", message: release.approval === "approved" ? "تأییدهای انتشار کامل است" : "تأییدی لازم نبوده است" };
    case "test_deploy_ok": {
      const deps = await liveRows(tx, sys, "deployment", { f: "release_id", op: "eq", v: release.id });
      const envs = new Map((await liveRows(tx, sys, "release_environment", null)).map((e) => [String(e.id), e]));
      const ok = deps.filter((d) => deploymentOutcome(d) === "ok" && NON_PROD.includes(String(envs.get(String(d.environment_id))?.kind ?? "")));
      return ok.length ? { status: "pass", message: `استقرار موفق در ${faList([...new Set(ok.map((d) => String(envs.get(String(d.environment_id))?.name ?? "")))])}` } : { status: "fail", message: "هنوز استقرار موفقی در محیط آزمون یا پیش‌تولید ثبت نشده است" };
    }
    case "no_open_critical_defects": {
      const open = (await liveRows(tx, sys, "defect", { and: [{ f: "release_id", op: "eq", v: release.id }, { f: "severity", op: "in", v: ["critical", "high"] }] })).filter((d) => !DEFECT_DONE.includes(String(d.state)));
      return open.length ? { status: "fail", message: `نقص‌های بحرانی یا مهم باز: ${numberList(open)}` } : { status: "pass", message: "نقص بحرانی یا مهم بازی نمانده است" };
    }
    case "rollback_plan":
      return String(release.rollback_plan ?? "").trim().length >= 10 ? { status: "pass", message: "برنامهٔ بازگشت نوشته شده است" } : { status: "fail", message: "برنامهٔ بازگشت خالی است" };
    case "release_notes": {
      if (String(release.release_notes ?? "").trim()) return { status: "pass", message: "یادداشت انتشار نوشته شده است" };
      const notes = await liveRows(tx, sys, "release_note", eqAll({ release_id: release.id, state: "published" }), { limit: 1 });
      return notes.length ? { status: "pass", message: "یادداشت انتشار منتشر شده است" } : { status: "fail", message: "یادداشت انتشار هنوز آماده نیست" };
    }
    case "no_freeze": {
      if (!release.planned_end) return { status: "fail", message: "تاریخ عرضه تعیین نشده است" };
      const hits = await freezesFor(tx, ctx, release);
      return hits.length ? { status: "fail", message: `بازهٔ انتشار با «${faList([...new Set(hits.map((h) => h.name))])}» هم‌پوشانی دارد` } : { status: "pass", message: "با دورهٔ انجماد یا ممنوعیتی هم‌پوشانی ندارد" };
    }
    case "condition": {
      if (!check?.condition) return { status: "na", message: "شرطی تعریف نشده است" };
      const schema = await orgSchema(sys, tx);
      const env = await condEnv(sys);
      const holds = evaluate(check.condition, release, env, schema.def("release") ?? undefined, schema.lookup);
      return holds ? { status: "pass", message: "شرط برقرار است" } : { status: "fail", message: "شرط برقرار نیست" };
    }
    default:
      return null;
  }
}

export interface ChecksOutcome {
  results: Row[];
  readiness: Readiness;
}

/**
 * Evaluate a release's automatic checks and stamp the roll-up (as the system, inside `tx`). Waived and manual
 * results keep their status; a manual check is never decided by a rule.
 */
export async function evaluateChecksIn(tx: Tx, ctx: Ctx, releaseId: string): Promise<ChecksOutcome> {
  const sys = sysOf(ctx);
  const release = await liveRow(tx, sys, "release", releaseId);
  if (!release) return { results: [], readiness: readinessOf([]) };
  await ensureResultsIn(tx, ctx, release);
  const results = await liveRows(tx, sys, "release_check_result", { f: "release_id", op: "eq", v: releaseId }, { order: "t.phase, t.name" });
  const library = new Map((await liveRows(tx, sys, "release_check", null)).map((c) => [String(c.id), c]));
  const now = new Date().toISOString();
  const out: Row[] = [];
  for (const r of results) {
    const rule = String(r.rule ?? library.get(String(r.check_id))?.rule ?? "manual");
    if (r.status === "waived" || rule === "manual" || !CHECK_RULES.some((o) => o.value === rule)) {
      out.push(r);
      continue;
    }
    const v = await verdict(tx, ctx, release, library.get(String(r.check_id)) ?? {}, rule);
    if (!v) {
      out.push(r);
      continue;
    }
    if (v.status !== r.status || v.message !== r.message) out.push(await updateIn(tx, sys, "release_check_result", String(r.id), { status: v.status, message: v.message, evaluated_at: now }, { trusted: true, keepVersion: true }));
    else out.push(await updateIn(tx, sys, "release_check_result", String(r.id), { evaluated_at: now }, { trusted: true, keepVersion: true }));
  }
  const readiness = readinessOf(out);
  await stampReadinessIn(tx, ctx, release, readiness, now);
  return { results: out, readiness };
}

/** Stamp a readiness roll-up on the release (no version move: open forms stay valid). */
export async function stampReadinessIn(tx: Tx, ctx: Ctx, release: Row, r: Readiness, at = new Date().toISOString()): Promise<void> {
  const patch: Row = { checks_total: r.total, checks_failed: r.failed, checks_pending: r.pending, readiness_pct: r.pct, checks_run_at: at };
  if (Object.keys(patch).some((k) => k !== "checks_run_at" && release[k] !== patch[k]) || !release.checks_run_at) {
    await updateIn(tx, sysOf(ctx), "release", String(release.id), patch, { trusted: true, keepVersion: true });
  }
}

/** The roll-up from the stored results only (no evaluation). */
export async function storedReadiness(tx: Tx, ctx: Ctx, releaseId: string): Promise<Readiness> {
  return readinessOf(await liveRows(tx, sysOf(ctx), "release_check_result", { f: "release_id", op: "eq", v: releaseId }));
}

export { DEPLOYMENT_FINISHED };
