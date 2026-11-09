// Shared set-up of the release, DevOps and project tests: an organisation on an in-memory server with the change and
// release defaults, a release manager («مدیران انتشار»), a change manager, an engineer of the release team, an agent
// of another group, a requester and an auditor — each holding a built-in ITSM role and signed in.
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { tick } from "@server/jobs";
import { systemCtx } from "@server/engine";
import type { Ctx } from "@server/context";

export type Who = "rm" | "cm" | "dev" | "other" | "req" | "auditor";

export interface World {
  e: EngineOrg;
  P: string;
  o: Client;
  p: Record<Who, { client: Client; userId: string }>;
  g: { team: string; others: string; releaseManagers: string };
  env: Record<string, string>;
  sys: Ctx;
  drain(): Promise<void>;
  release(data?: Record<string, unknown>, as?: Client): Promise<Record<string, any>>;
  get(table: string, id: string, as?: Client): Promise<Record<string, any>>;
  move(table: string, id: string, states: string[], as?: Client, data?: Record<string, unknown>): Promise<Record<string, any>>;
}

const ROLES: Record<Who, string> = { rm: "release_manager", cm: "change_manager", dev: "release_engineer", other: "release_engineer", req: "requester", auditor: "auditor" };

export const DAY = 86_400_000;
/** A weekday instant `days` from now at `hour` UTC. */
export function at(days: number, hour = 9): string {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

export async function world(opts: { seed?: boolean } = {}): Promise<World> {
  const e = await engineOrg();
  const P = `/o/${e.org}`;
  const o = e.owner;
  await o.post(`${P}/change/seed`, {});
  if (opts.seed !== false) await o.post(`${P}/release/seed`, {});
  const groups = (await o.get(`${P}/r/group?size=100`)).rows as { id: string; name: string }[];
  const releaseManagers = groups.find((x) => x.name === "مدیران انتشار")?.id ?? "";
  const team = (await o.post(`${P}/r/group`, { name: "تیم انتشار پرتال", types: ["assignment"] })).row.id as string;
  const others = (await o.post(`${P}/r/group`, { name: "پشتیبانی شبکه", types: ["assignment"] })).row.id as string;
  const p = {} as World["p"];
  for (const k of Object.keys(ROLES) as Who[]) p[k] = await e.member("member", `${k}@example.com`);
  for (const k of Object.keys(ROLES) as Who[]) await o.put(`${P}/access/members/${p[k].userId}`, { roles: [ROLES[k]], persona: k === "req" ? "requester" : "agent" });
  await o.post(`${P}/access/groups/${team}/members`, { user_ids: [p.dev.userId] });
  await o.post(`${P}/access/groups/${others}/members`, { user_ids: [p.other.userId] });
  if (releaseManagers) await o.post(`${P}/access/groups/${releaseManagers}/members`, { user_ids: [p.rm.userId] });
  const sys = await systemCtx(e.cfg, e.org);
  const drain = async () => {
    for (let i = 0; i < 30; i++) {
      const r = await tick(e.cfg, { budgetMs: 30_000 });
      if (!r.ran && !r.more) break;
    }
  };
  await drain();
  const envRows = opts.seed === false ? [] : ((await o.get(`${P}/r/release_environment?size=50`)).rows as { id: string; key: string }[]);
  const env = Object.fromEntries(envRows.map((x) => [x.key, x.id]));
  const release = async (data: Record<string, unknown> = {}, as: Client = p.dev.client) =>
    (await as.post(`${P}/r/release`, {
      short_description: "انتشار نسخهٔ تازهٔ پرتال", version_name: "2.4.0", type: "minor", assignment_group_id: team,
      planned_start: at(1), planned_end: at(10, 18), rollback_plan: "بازگرداندن نسخهٔ پیشین از کتابخانهٔ نرم‌افزار در ۲۰ دقیقه.", ...data,
    })).row;
  const get = async (table: string, id: string, as: Client = o) => (await as.get(`${P}/r/${table}/${id}`)).row;
  const move = async (table: string, id: string, states: string[], as: Client = p.dev.client, data: Record<string, unknown> = {}) => {
    let row = await get(table, id, as);
    for (const to of states) row = (await as.post(`${P}/r/${table}/${id}/transition`, { to, data, version: row.version })).row;
    return row;
  };
  return { e, P, o, p, g: { team, others, releaseManagers }, env, sys, drain, release, get, move };
}
