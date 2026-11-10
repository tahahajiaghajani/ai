// Presence (WFM-012): each person sets their own state from the agent home; the screen's heartbeat records activity,
// and a person idle longer than the organisation's limit goes «دور از میز» automatically (and comes back on activity).
// Every change closes the open interval of the presence log (time available, for utilisation). Team presence is a
// projection for the team and those who oversee it.
import { PRESENCE_STATES } from "@shared/tables/workforce";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, updateIn } from "../../engine";
import { bad, forbidden } from "../../http/errors";
import { liveRows, membersOf, msOf, myGroups, namesOf, overseesGroup, sysOf, workforceConfig, type Row } from "./common";

const STATES = PRESENCE_STATES.map((o) => o.value);

/** The person's state row (created on first use). */
async function agentRowIn(tx: Tx, ctx: Ctx, userId: string): Promise<Row> {
  const sys = sysOf(ctx);
  const [row] = await liveRows(tx, sys, "wfm_agent", { f: "user_id", op: "eq", v: userId }, { limit: 1 });
  if (row) return row;
  return createIn(tx, sys, "wfm_agent", { user_id: userId, presence: "offline", presence_since: new Date().toISOString() }, { trusted: true });
}

/** Change a person's presence (inside `tx`): the log's open interval closes, a new one opens. */
export async function setPresenceIn(tx: Tx, ctx: Ctx, userId: string, state: string, note: string | null = null, auto = false): Promise<Row> {
  if (!STATES.includes(state)) throw bad("وضعیت حضور شناخته نیست");
  const sys = sysOf(ctx);
  const row = await agentRowIn(tx, sys, userId);
  const now = new Date();
  if (row.presence === state && (note ?? null) === (row.presence_note ?? null)) {
    return updateIn(tx, sys, "wfm_agent", String(row.id), { last_seen: now.toISOString(), auto_away: auto && state === "away" }, { trusted: true });
  }
  const [open] = await liveRows(tx, sys, "wfm_presence_log", { and: [{ f: "user_id", op: "eq", v: userId }, { f: "to_at", op: "empty" }] }, { order: "t.from_at desc", limit: 1 });
  if (open) {
    const minutes = Math.max(0, Math.round((now.getTime() - (msOf(open.from_at) ?? now.getTime())) / 60_000));
    await updateIn(tx, sys, "wfm_presence_log", String(open.id), { to_at: now.toISOString(), minutes }, { trusted: true });
  }
  if (state !== "offline") await createIn(tx, sys, "wfm_presence_log", { user_id: userId, state, from_at: now.toISOString() }, { trusted: true });
  return updateIn(tx, sys, "wfm_agent", String(row.id), { presence: state, presence_note: note, presence_since: now.toISOString(), last_seen: now.toISOString(), auto_away: auto && state === "away" }, { trusted: true });
}

export async function setPresence(ctx: Ctx, state: string, note: string | null = null): Promise<Row> {
  const sys = sysOf(ctx);
  return sys.write((tx) => setPresenceIn(tx, sys, ctx.user.id, state, note));
}

/** The screen's heartbeat: activity, automatic away after the idle limit and back again. */
export async function heartbeat(ctx: Ctx, idleMs: number): Promise<{ presence: string; auto_away: boolean }> {
  const sys = sysOf(ctx);
  const cfg = await workforceConfig(ctx.db, sys);
  return sys.write(async (tx) => {
    const row = await agentRowIn(tx, sys, ctx.user.id);
    const idle = idleMs >= cfg.idle_minutes * 60_000;
    if (idle && row.presence === "available") {
      const r = await setPresenceIn(tx, sys, ctx.user.id, "away", "دوری خودکار", true);
      return { presence: String(r.presence), auto_away: true };
    }
    if (!idle && row.presence === "away" && row.auto_away) {
      const r = await setPresenceIn(tx, sys, ctx.user.id, "available", null);
      return { presence: String(r.presence), auto_away: false };
    }
    if (!idle && row.presence === "offline") {
      const r = await setPresenceIn(tx, sys, ctx.user.id, "available", null);
      return { presence: String(r.presence), auto_away: false };
    }
    await updateIn(tx, sys, "wfm_agent", String(row.id), { last_seen: new Date().toISOString() }, { trusted: true });
    return { presence: String(row.presence), auto_away: !!row.auto_away };
  });
}

/** Presence of a team's people (for the team and those who oversee it). */
export async function teamPresence(ctx: Ctx, groupId: string): Promise<{ user_id: string; name: string; presence: string; since: string | null; note: string | null }[]> {
  const sys = sysOf(ctx);
  if (!(await myGroups(ctx.db, ctx)).includes(groupId) && !(await overseesGroup(ctx.db, ctx, groupId))) throw forbidden("حضور اعضای این تیم برای شما باز نیست");
  const people = (await membersOf(ctx.db, sys, [groupId])).get(groupId) ?? [];
  const rows = people.length ? await liveRows(ctx.db, sys, "wfm_agent", { f: "user_id", op: "in", v: people }) : [];
  const names = await namesOf(ctx.db, ctx.org.id, people);
  return people.map((u) => {
    const r = rows.find((x) => x.user_id === u);
    return { user_id: u, name: names.get(u) ?? "", presence: String(r?.presence ?? "offline"), since: r?.presence_since ?? null, note: r?.presence_note ?? null };
  }).sort((a, b) => STATES.indexOf(a.presence) - STATES.indexOf(b.presence) || a.name.localeCompare(b.name, "fa"));
}

/** The caller's own preferences: leaderboard opt-in and personal WIP limit. */
export async function setPrefs(ctx: Ctx, prefs: { leaderboard?: boolean; wip_limit?: number | null }): Promise<Row> {
  const sys = sysOf(ctx);
  return sys.write(async (tx) => {
    const row = await agentRowIn(tx, sys, ctx.user.id);
    const patch: Row = {};
    if (prefs.leaderboard !== undefined) patch.leaderboard = prefs.leaderboard;
    if (prefs.wip_limit !== undefined) patch.wip_limit = prefs.wip_limit;
    return Object.keys(patch).length ? updateIn(tx, sys, "wfm_agent", String(row.id), patch, { trusted: true }) : row;
  });
}

export async function myAgentRow(ctx: Ctx): Promise<Row | null> {
  const [row] = await liveRows(ctx.db, sysOf(ctx), "wfm_agent", { f: "user_id", op: "eq", v: ctx.user.id }, { limit: 1 });
  return row ?? null;
}
