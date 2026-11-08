// Authorization of changes through the approvals service (docs/spec/services/sla.md §4). The organisation's approval
// rules on `change_request` (seeded: low risk → the requester's manager, moderate → a change manager, high and very
// high → the CAB, emergency → the ECAB, a late change → also a change manager) ask when a change enters «در انتظار
// تأیید»; this file reacts to their outcome inside the same transaction (a "*" hook installed after the SLA service):
//
//   · entering authorize stamps the cycle (`auth_cycle_at`): only approvals of this cycle count;
//   · nothing to approve in this cycle (no rule matched, or auto-approval) → the change moves on at once;
//   · every round of the cycle approved → the next state of its model (scheduled, or implement for emergencies);
//   · a round rejected → back to the draft with «ردشده؛ نیازمند بازنگری» and a note;
//   · a person moving the change back (revert, re-assessment) withdraws the cycle's open approvals.
//
// Approver sources for the rules' levels: «change_manager» (the change's manager, else the change managers' group of
// the settings, else holders of the role), «cab» and «ecab» (the members of the change's CAB / the emergency CAB) and
// «service_owner» (from the CMDB's provider, src/server/modules/change/impact.ts).
import { aggregate } from "@shared/sla/approvals";
import { nextState, lifecycleOf } from "@shared/change/logic";
import type { TableDef } from "@shared/model/types";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { addJournalIn, emitEvent, isSystemCtx, registerHooks, transitionIn, updateIn, type WriteArgs } from "../../engine";
import { registerApproverSource } from "../sla";
import { changeConfig, eqAll, iso, liveRow, liveRows, msOf, sysOf, type Row } from "./common";
import { impactProvider } from "./impact";

const OPEN = new Set(["requested", "waiting"]);

/** Approvals of a change's current authorization cycle (created since it last entered «در انتظار تأیید»). */
export async function cycleApprovals(q: Queryable, ctx: Ctx, change: Row): Promise<Row[]> {
  const rows = await liveRows(q, sysOf(ctx), "approval", eqAll({ table_key: "change_request", record_id: String(change.id) }), { order: "t.round, t.level, t.created_at, t.id" });
  const since = msOf(change.auth_cycle_at);
  return since === null ? rows : rows.filter((r) => (msOf(r.created_at) ?? 0) >= since);
}

/** The cycle's votes: approved, rejected, open and in all. */
export function tally(rows: readonly Row[]): { approved: number; rejected: number; open: number; total: number; outcome: string } {
  return {
    approved: rows.filter((r) => r.state === "approved").length,
    rejected: rows.filter((r) => r.state === "rejected").length,
    open: rows.filter((r) => OPEN.has(r.state)).length,
    total: rows.filter((r) => r.state !== "skipped").length,
    outcome: rows.length ? aggregate(rows as never[]) : "not_requested",
  };
}

/** Members and leads of groups, valid now (the approvals service's notion of a group's people). */
export async function groupUsers(q: Queryable, ctx: Ctx, groups: string[]): Promise<string[]> {
  const ids = groups.filter(Boolean);
  if (!ids.length) return [];
  const now = Date.now();
  const rows = await liveRows(q, sysOf(ctx), "group_member", { and: [{ f: "group_id", op: "in", v: ids }, { f: "kind", op: "in", v: ["member", "lead"] }] });
  return [...new Set(rows.filter((r) => (msOf(r.valid_from) ?? 0) <= now && (msOf(r.valid_to) === null || msOf(r.valid_to)! > now)).map((r) => String(r.user_id)))];
}

/** Holders of a role (on their profile or through a group's roles). */
export async function roleHolders(q: Queryable, ctx: Ctx, role: string): Promise<string[]> {
  const sys = sysOf(ctx);
  const profiles = await liveRows(q, sys, "member_profile", { f: "roles", op: "eq", v: role });
  const groups = await liveRows(q, sys, "group", { f: "roles", op: "eq", v: role });
  return [...new Set([...profiles.map((p) => String(p.user_id)), ...(await groupUsers(q, ctx, groups.map((g) => String(g.id))))])];
}

/** The people of a CAB: its members, its group's members and leads, its chair. */
export async function cabPeople(q: Queryable, ctx: Ctx, cab: Row): Promise<string[]> {
  const fromGroup = cab.group_id ? await groupUsers(q, ctx, [String(cab.group_id)]) : [];
  return [...new Set([...(Array.isArray(cab.members) ? cab.members : []), ...fromGroup, ...(cab.manager_id ? [cab.manager_id] : [])].map(String))];
}

/** The CAB a change goes to (its own, else the default CAB; for an emergency the ECAB of the settings). */
export async function cabFor(q: Queryable, ctx: Ctx, change: Row, emergency = false): Promise<Row | null> {
  const sys = sysOf(ctx);
  const cfg = await changeConfig(q, sys);
  const pick = async (id: unknown) => (id ? await liveRow(q, sys, "cab", id) : null);
  if (emergency) {
    const e = (await pick(cfg.emergency_cab_id)) ?? (await liveRows(q, sys, "cab", { and: [{ f: "kind", op: "eq", v: "emergency" }, { f: "active", op: "eq", v: true }] }, { order: "t.name", limit: 1 }))[0];
    if (e) return e;
  }
  return (await pick(change.cab_id)) ?? (await pick(cfg.default_cab_id)) ?? (await liveRows(q, sys, "cab", { and: [{ f: "kind", op: "eq", v: "change" }, { f: "active", op: "eq", v: true }] }, { order: "t.name", limit: 1 }))[0] ?? null;
}

/** The approver sources of change rules (registered once). */
export function installApproverSources(): (() => void)[] {
  return [
    registerApproverSource("change_manager", async (q, ctx, _def, row) => {
      if (typeof row.change_manager_id === "string" && row.change_manager_id) return [row.change_manager_id];
      const cfg = await changeConfig(q, ctx);
      if (cfg.change_manager_group_id) {
        const people = await groupUsers(q, ctx, [cfg.change_manager_group_id]);
        if (people.length) return people;
      }
      return roleHolders(q, ctx, "change_manager");
    }),
    registerApproverSource("cab", async (q, ctx, _def, row) => {
      const cab = await cabFor(q, ctx, row);
      return cab ? cabPeople(q, ctx, cab) : [];
    }),
    registerApproverSource("ecab", async (q, ctx, _def, row) => {
      const cab = await cabFor(q, ctx, row, true);
      return cab ? cabPeople(q, ctx, cab) : [];
    }),
    registerApproverSource("service_owner", async (q, ctx, _def, row) => {
      const owners = impactProvider().owners;
      return owners ? owners(q, ctx, row) : [];
    }),
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Reactions (a "*" hook installed after the SLA service: the approval rows of the write exist when it runs)

async function note(tx: Tx, ctx: Ctx, def: TableDef, row: Row, body: string, actor: string | null): Promise<void> {
  await addJournalIn(tx, sysOf(ctx, actor), def, row, { kind: "system", body }, { trusted: true, author: actor });
}

async function withdrawOpen(tx: Tx, ctx: Ctx, change: Row): Promise<number> {
  const sys = sysOf(ctx);
  const rows = await liveRows(tx, sys, "approval", eqAll({ table_key: "change_request", record_id: String(change.id) }));
  let n = 0;
  for (const r of rows) {
    if (!OPEN.has(r.state)) continue;
    await updateIn(tx, sys, "approval", r.id, { state: "canceled", decided_at: iso(Date.now()), comments: "تغییر به ارزیابی یا پیش‌نویس برگشت" }, { trusted: true });
    r.state = "canceled";
    n++;
  }
  if (n) {
    const agg = aggregate(rows as never[]);
    if (change.approval !== agg) await updateIn(tx, sys, "change_request", String(change.id), { approval: agg }, { trusted: true, keepVersion: true });
  }
  return n;
}

async function react(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.def.key !== "change_request" || w.op === "delete") return;
  const row = w.row;
  const prev = w.prev;
  const actor = isSystemCtx(w.ctx) ? null : w.ctx.user.id;
  // moved back by a person (or a flow): the cycle's open approvals are no longer asked
  if (prev?.state === "authorize" && (row.state === "new" || row.state === "assess")) {
    const n = await withdrawOpen(w.tx, w.ctx, row);
    if (n) await note(w.tx, w.ctx, w.def, row, `${n} تأیید باز پس گرفته شد (تغییر از «در انتظار تأیید» برگشت).`, actor);
    return;
  }
  if (row.state !== "authorize") return;
  const entering = !prev || prev.state !== "authorize";
  if (!entering && !w.changed.has("approval")) return;
  const rows = await cycleApprovals(w.tx, w.ctx, row);
  const t = tally(rows);
  const lifecycle = lifecycleOf(row.model_states, row.type);
  const sys = sysOf(w.ctx, actor);
  if (t.open) return;
  if (t.outcome === "rejected") {
    await transitionIn(w.tx, sys, "change_request", String(row.id), "new", { status_reason: "rejected" }, { trusted: true });
    await note(w.tx, w.ctx, w.def, row, "تغییر تأیید نشد و به پیش‌نویس برگشت؛ پس از بازنگری دوباره برای تأیید بفرستید.", actor);
    const users = [row.change_owner_id, row.caller_id, row.opened_by].filter((x): x is string => typeof x === "string" && !!x);
    await emitEvent(w.tx, sys, { kind: "record.change.rejected", table: "change_request", id: String(row.id), number: row.number ?? null, data: { users: [...new Set(users)] } });
    return;
  }
  const to = nextState(lifecycle, "authorize");
  if (!to) return;
  await transitionIn(w.tx, sys, "change_request", String(row.id), to, {}, { trusted: true });
  const why = rows.length ? (t.approved ? "همهٔ تأییدهای لازم داده شد" : "تأیید خودکار شد") : "قاعدهٔ تأییدی برای این تغییر نبود";
  await note(w.tx, w.ctx, w.def, row, `${why}؛ تغییر به «${to === "implement" ? "در حال اجرا" : "زمان‌بندی‌شده"}» رفت.`, actor);
}

/** The reactions to approvals; call after `installSlaService()` (its approval rows must exist when this runs). */
export function installAuthorization(): (() => void)[] {
  return [registerHooks("*", { afterWrite: (w) => react(w as WriteArgs & { row: Row }) }), ...installApproverSources()];
}

/** The approval rows of a change the caller may decide now (as its approver or an approver's delegate). */
export async function myOpenApproval(q: Queryable, ctx: Ctx, changeId: string, delegators: readonly string[]): Promise<Row | null> {
  const rows = await liveRows(q, sysOf(ctx), "approval", { and: [{ f: "table_key", op: "eq", v: "change_request" }, { f: "record_id", op: "eq", v: changeId }, { f: "state", op: "eq", v: "requested" }] });
  return rows.find((r) => r.approver_id === ctx.user.id) ?? rows.find((r) => delegators.includes(String(r.approver_id))) ?? null;
}
