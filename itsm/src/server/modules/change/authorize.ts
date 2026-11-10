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
// Approver sources for the rules' levels: «change_manager» (the change's manager when that person is a change manager,
// else the change managers' group of the settings, else holders of the role), «cab» and «ecab» (the members of the
// change's CAB when it is an active board of its kind, else the default / the emergency CAB) and
// «service_owner» (from the CMDB's provider, src/server/modules/change/impact.ts).
import { aggregate } from "@shared/sla/approvals";
import { nextState, lifecycleOf } from "@shared/change/logic";
import type { TableDef } from "@shared/model/types";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { addJournalIn, emitEvent, registerHooks, savepoint, transitionIn, updateIn, type WriteArgs } from "../../engine";
import { cancelApprovalsIn, onApprovalSettled, registerApproverSource } from "../sla";
import { actorOf, changeConfig, eqAll, iso, liveRow, liveRows, msOf, sysOf, type Row } from "./common";
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

/** May `cab` decide a change of this kind: active, and an emergency board exactly for emergencies? */
export const cabFits = (cab: Row | null | undefined, emergency: boolean): boolean => !!cab && cab.active !== false && (cab.kind === "emergency") === emergency;

/**
 * The CAB a change goes to (its own, else the default CAB; for an emergency the ECAB of the settings). Inactive boards
 * are passed over; so is the change's own board (its writers set it) when it is of the other kind — an emergency
 * board for a normal change.
 */
export async function cabFor(q: Queryable, ctx: Ctx, change: Row, emergency = false): Promise<Row | null> {
  const sys = sysOf(ctx);
  const cfg = await changeConfig(q, sys);
  const pick = async (id: unknown, fits: (cab: Row) => boolean = (cab) => cab.active !== false) => {
    const cab = id ? await liveRow(q, sys, "cab", id) : null;
    return cab && fits(cab) ? cab : null;
  };
  if (emergency) {
    const e = (await pick(cfg.emergency_cab_id)) ?? (await liveRows(q, sys, "cab", { and: [{ f: "kind", op: "eq", v: "emergency" }, { f: "active", op: "eq", v: true }] }, { order: "t.name", limit: 1 }))[0];
    if (e) return e;
  }
  return (await pick(change.cab_id, (cab) => cabFits(cab, false))) ?? (await pick(cfg.default_cab_id)) ?? (await liveRows(q, sys, "cab", { and: [{ f: "kind", op: "eq", v: "change" }, { f: "active", op: "eq", v: true }] }, { order: "t.name", limit: 1 }))[0] ?? null;
}

/** The change managers of the organisation: holders of the role and members of the settings' change managers' group. */
export async function changeManagers(q: Queryable, ctx: Ctx): Promise<string[]> {
  const cfg = await changeConfig(q, ctx);
  return [...new Set([...(await roleHolders(q, ctx, "change_manager")), ...(cfg.change_manager_group_id ? await groupUsers(q, ctx, [cfg.change_manager_group_id]) : [])])];
}

/** Separation of duties beyond the approvals service's own (requester side and assignee): not the coordinator. */
const others = (row: Row, people: string[]): string[] => people.filter((u) => u !== row.change_owner_id);

/** The approver sources of change rules (registered once). */
export function installApproverSources(): (() => void)[] {
  return [
    registerApproverSource("change_manager", async (q, ctx, _def, row) => {
      // the change's own change manager — only when that person is one (a change's writers set the field)
      const named = typeof row.change_manager_id === "string" && row.change_manager_id && row.change_manager_id !== row.change_owner_id ? row.change_manager_id : null;
      if (named && (await changeManagers(q, ctx)).includes(named)) return [named];
      const cfg = await changeConfig(q, ctx);
      if (cfg.change_manager_group_id) {
        const people = others(row, await groupUsers(q, ctx, [cfg.change_manager_group_id]));
        if (people.length) return people;
      }
      return others(row, await roleHolders(q, ctx, "change_manager"));
    }),
    registerApproverSource("cab", async (q, ctx, _def, row) => {
      const cab = await cabFor(q, ctx, row);
      return cab ? others(row, await cabPeople(q, ctx, cab)) : [];
    }),
    registerApproverSource("ecab", async (q, ctx, _def, row) => {
      const cab = await cabFor(q, ctx, row, true);
      return cab ? others(row, await cabPeople(q, ctx, cab)) : [];
    }),
    registerApproverSource("service_owner", async (q, ctx, _def, row) => {
      const owners = impactProvider().owners;
      return owners ? owners(q, ctx, row) : [];
    }),
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Reactions: entering «در انتظار تأیید» is a "*" hook installed after the SLA service (the approval rows of the write
// exist when it runs); every round that settles later — a decision, an expiry, a withdrawal — calls the approvals
// service's `onApprovalSettled` in its own transaction, which settles the cycle. While a change waits in «در انتظار
// تأیید» its `approval` field holds the aggregate of the CURRENT cycle only.

async function note(tx: Tx, ctx: Ctx, def: TableDef, row: Row, body: string, actor: string | null): Promise<void> {
  await addJournalIn(tx, sysOf(ctx, actor), def, row, { kind: "system", body }, { trusted: true, author: actor });
}

/** Withdraw the change's open approvals (canceled when it went back, no longer required when authorized by hand). */
async function withdrawOpen(tx: Tx, ctx: Ctx, change: Row, state: "canceled" | "no_longer_required", comment: string): Promise<number> {
  return (await cancelApprovalsIn(tx, sysOf(ctx), "change_request", String(change.id), { state, comment })).canceled;
}

const people = (...xs: unknown[]): string[] => [...new Set(xs.filter((x): x is string => typeof x === "string" && !!x))];

/**
 * Settle the current authorization cycle of a change in «در انتظار تأیید»: rejected → back to the draft with
 * «ردشده؛ نیازمند بازنگری»; still open → the field shows «درخواست شده»; approved (or nothing to ask) → the next state
 * of its model. A refusal of that move (a blackout, a lockdown, a missing field) leaves the change waiting with a note.
 */
export async function settleCycle(tx: Tx, ctx: Ctx, def: TableDef, row: Row, actor: string | null): Promise<string | null> {
  const id = String(row.id);
  const rows = await cycleApprovals(tx, ctx, row);
  const t = tally(rows);
  const sys = sysOf(ctx, actor);
  if (t.outcome === "rejected") {
    await transitionIn(tx, sys, "change_request", id, "new", { status_reason: "rejected", approval: "rejected" }, { trusted: true });
    await note(tx, ctx, def, row, "تغییر تأیید نشد و به پیش‌نویس برگشت؛ پس از بازنگری دوباره برای تأیید بفرستید.", actor);
    await emitEvent(tx, sys, { kind: "record.change.rejected", table: "change_request", id, number: row.number ?? null, data: { users: people(row.change_owner_id, row.caller_id, row.opened_by) } });
    return "rejected";
  }
  if (t.open) {
    if (row.approval !== "requested") await updateIn(tx, sysOf(ctx), "change_request", id, { approval: "requested" }, { trusted: true, keepVersion: true });
    return null;
  }
  const to = nextState(lifecycleOf(row.model_states, row.type), "authorize");
  if (!to) return null;
  try {
    await savepoint(tx, () => transitionIn(tx, sys, "change_request", id, to, { approval: rows.length ? "approved" : (row.approval ?? "not_requested") }, { trusted: true }));
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    await note(tx, ctx, def, row, `تأییدهای لازم داده شد اما تغییر به «${to === "implement" ? "در حال اجرا" : "زمان‌بندی‌شده"}» نرفت: ${why}. پس از رفع مشکل، آن را دستی ادامه دهید.`, actor);
    if (row.approval !== "approved" && rows.length) await updateIn(tx, sysOf(ctx), "change_request", id, { approval: "approved" }, { trusted: true, keepVersion: true });
    return null;
  }
  const why = rows.length ? (t.approved ? "همهٔ تأییدهای لازم داده شد" : "تأیید خودکار شد") : "قاعدهٔ تأییدی برای این تغییر نبود";
  await note(tx, ctx, def, row, `${why}؛ تغییر به «${to === "implement" ? "در حال اجرا" : "زمان‌بندی‌شده"}» رفت.`, actor);
  await emitEvent(tx, sys, { kind: "record.change.authorized", table: "change_request", id, number: row.number ?? null, data: { users: people(row.change_owner_id, row.assigned_to, row.caller_id) } });
  return to;
}

/** The cycle's approvals were withdrawn: when nothing is open any more, the change goes back to «ارزیابی» (or «پیش‌نویس»). */
async function withdrawnCycle(tx: Tx, ctx: Ctx, def: TableDef, row: Row, actor: string | null): Promise<void> {
  if (tally(await cycleApprovals(tx, ctx, row)).open) return;
  const to = lifecycleOf(row.model_states, row.type).includes("assess") ? "assess" : "new";
  await transitionIn(tx, sysOf(ctx, actor), "change_request", String(row.id), to, { approval: "not_requested" }, { trusted: true });
  await note(tx, ctx, def, row, "تأییدهای تغییر پس گرفته شد؛ تغییر برای ارزیابی دوباره برگشت و پیش از اجرا باید دوباره تأیید شود.", actor);
}

async function react(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.def.key !== "change_request" || w.op === "delete") return;
  const row = w.row;
  const prev = w.prev;
  const actor = actorOf(w.ctx);
  // left «در انتظار تأیید»: back (or canceled) withdraws the cycle's open approvals; forward by hand (an approver with
  // the change area's approve right) makes them no longer required
  if (prev?.state === "authorize" && row.state !== "authorize") {
    const back = row.state === "new" || row.state === "assess" || row.state === "canceled";
    const n = await withdrawOpen(w.tx, w.ctx, row, back ? "canceled" : "no_longer_required", back ? "تغییر از «در انتظار تأیید» برگشت" : "تغییر بدون این تأیید مجاز شد");
    if (n) await note(w.tx, w.ctx, w.def, row, back ? `${n} تأیید باز پس گرفته شد (تغییر از «در انتظار تأیید» برگشت).` : `تغییر به‌دست دارندهٔ اختیار تأیید مجاز شد؛ ${n} تأیید باز دیگر لازم نیست.`, actor);
    return;
  }
  // entering it: nothing to approve, auto-approval or the first open round (later rounds settle through the service)
  if (row.state === "authorize" && (!prev || prev.state !== "authorize")) await settleCycle(w.tx, w.ctx, w.def, row, actor);
}

/** The reactions to approvals; call after `installSlaService()` (its approval rows must exist when this runs). */
export function installAuthorization(): (() => void)[] {
  return [
    registerHooks("*", { afterWrite: (w) => react(w as WriteArgs & { row: Row }) }),
    // a round of the change's approvals settled (decided, expired, withdrawn): the cycle may be complete
    onApprovalSettled("change_request", (s) => {
      if (s.record.state !== "authorize") return undefined;
      // approvals withdrawn are not approvals: with nothing left open the change goes back to be assessed again
      if (s.outcome === "canceled") return withdrawnCycle(s.tx, s.ctx, s.def, s.record, s.by);
      return settleCycle(s.tx, s.ctx, s.def, s.record, s.by).then(() => undefined);
    }),
    ...installApproverSources(),
  ];
}

/** The approval rows of a change the caller may decide now (as its approver or an approver's delegate). */
export async function myOpenApproval(q: Queryable, ctx: Ctx, changeId: string, delegators: readonly string[]): Promise<Row | null> {
  const rows = await liveRows(q, sysOf(ctx), "approval", { and: [{ f: "table_key", op: "eq", v: "change_request" }, { f: "record_id", op: "eq", v: changeId }, { f: "state", op: "eq", v: "requested" }] });
  return rows.find((r) => r.approver_id === ctx.user.id) ?? rows.find((r) => delegators.includes(String(r.approver_id))) ?? null;
}
