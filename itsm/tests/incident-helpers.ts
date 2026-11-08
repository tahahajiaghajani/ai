// Shared set-up of the incident and problem tests: an organisation on an in-memory server with the module's defaults,
// a service-desk agent («میز خدمت»), an agent of another group, a requester, a major-incident manager, a problem
// manager and an auditor, each holding the built-in ITSM role and signed in.
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { tick } from "@server/jobs";
import { systemCtx } from "@server/engine";
import type { Ctx } from "@server/context";

export type Who = "agent" | "other" | "req" | "req2" | "mim" | "pm" | "auditor";

export interface World {
  e: EngineOrg;
  /** /o/<org> */
  P: string;
  o: Client;
  p: Record<Who, { client: Client; userId: string }>;
  g: { desk: string; security: string; network: string };
  sys: Ctx;
  /** run queued jobs (events, notifications, cascades) until none is left */
  drain(): Promise<void>;
  /** an incident created by the owner (or `as`) with sensible defaults */
  incident(data?: Record<string, unknown>, as?: Client): Promise<Record<string, any>>;
}

const ROLES: Record<Who, string> = { agent: "agent", other: "agent", req: "requester", req2: "requester", mim: "incident_manager", pm: "problem_manager", auditor: "auditor" };

export async function world(opts: { preset?: "open" | "need_to_know" } = {}): Promise<World> {
  const e = await engineOrg();
  const P = `/o/${e.org}`;
  const o = e.owner;
  await o.post(`${P}/incident/seed`, {});
  const groups = (await o.get(`${P}/r/group?size=50`)).rows as { id: string; name: string }[];
  const desk = groups.find((x) => x.name === "میز خدمت")!.id;
  const security = groups.find((x) => x.name === "امنیت اطلاعات")!.id;
  const network = (await o.post(`${P}/r/group`, { name: "پشتیبانی شبکه", types: ["assignment"] })).row.id as string;
  const p = {} as World["p"];
  for (const k of Object.keys(ROLES) as Who[]) {
    p[k] = await e.member("member", `${k}@example.com`);
    await o.put(`${P}/access/members/${p[k].userId}`, { roles: [ROLES[k]], persona: k.startsWith("req") ? "requester" : "agent" });
  }
  await o.post(`${P}/access/groups/${desk}/members`, { user_ids: [p.agent.userId, p.mim.userId] });
  await o.post(`${P}/access/groups/${network}/members`, { user_ids: [p.other.userId, p.pm.userId] });
  if (opts.preset) await o.put(`${P}/access/settings`, { preset: opts.preset, domain_separation: false });
  const sys = await systemCtx(e.cfg, e.org);
  const drain = async () => {
    for (let i = 0; i < 20; i++) {
      const r = await tick(e.cfg, { budgetMs: 30_000 });
      if (!r.ran && !r.more) break;
    }
  };
  await drain();
  const incident = async (data: Record<string, unknown> = {}, as: Client = o) => (await as.post(`${P}/r/incident`, { short_description: "رخداد آزمایشی", ...data })).row;
  return { e, P, o, p, g: { desk, security, network }, sys, drain, incident };
}

/** Move a timestamp column of a row into the past (test set-up only). */
export async function backdate(e: EngineOrg, table: string, id: string, column: string, daysAgo: number): Promise<void> {
  await e.db.query(`update ${table} set ${column} = now() - ($2 || ' days')::interval where id = $1`, [id, String(daysAgo)]);
}
