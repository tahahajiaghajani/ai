// Shared set-up of the security module's tests: an organisation on an in-memory server with the incident and security
// defaults, and signed-in members — two SOC analysts (members of «مرکز عملیات امنیت»: secure workspace, restricted
// group, the analyst role through the group), a CISO (security_manager, also in the SOC group), a vulnerability manager,
// a GRC manager, a risk owner, a security analyst outside the SOC group, a service-desk agent, a requester and an
// auditor. The owner is a tenant administrator who is not a member of the secure workspace.
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { tick } from "@server/jobs";
import { systemCtx } from "@server/engine";
import type { Ctx } from "@server/context";

export type Who = "soc" | "soc2" | "ciso" | "vm" | "grc" | "ro" | "analyst" | "agent" | "req" | "auditor";

export interface SecWorld {
  e: EngineOrg;
  P: string;
  o: Client;
  p: Record<Who, { client: Client; userId: string }>;
  g: { soc: string; vuln: string; grc: string; desk: string; infra: string };
  ws: string;
  sys: Ctx;
  drain(): Promise<void>;
  /** a security incident created by a SOC analyst (or `as`) */
  sir(data?: Record<string, unknown>, as?: Client): Promise<Record<string, any>>;
}

const ROLES: Record<Who, string[]> = {
  soc: ["agent"], soc2: ["agent"], ciso: ["security_manager"], vm: ["vulnerability_manager"], grc: ["grc_manager"], ro: ["risk_owner"],
  analyst: ["security_analyst"], agent: ["agent"], req: ["requester"], auditor: ["auditor"],
};

export async function secWorld(): Promise<SecWorld> {
  const e = await engineOrg();
  const P = `/o/${e.org}`;
  const o = e.owner;
  await o.post(`${P}/incident/seed`, {});
  await o.post(`${P}/security/seed`, {});
  const groups = (await o.get(`${P}/r/group?size=100`)).rows as { id: string; name: string }[];
  const gid = (n: string) => groups.find((x) => x.name === n)!.id;
  const infra = (await o.post(`${P}/r/group`, { name: "زیرساخت", types: ["assignment"] })).row.id as string;
  const p = {} as SecWorld["p"];
  for (const k of Object.keys(ROLES) as Who[]) {
    p[k] = await e.member("member", `${k}@example.com`);
    await o.put(`${P}/access/members/${p[k].userId}`, { roles: ROLES[k], persona: k === "req" ? "requester" : "agent" });
  }
  const g = { soc: gid("مرکز عملیات امنیت"), vuln: gid("مدیریت آسیب‌پذیری"), grc: gid("ریسک و انطباق"), desk: gid("میز خدمت"), infra };
  await o.post(`${P}/access/groups/${g.soc}/members`, { user_ids: [p.soc.userId, p.soc2.userId, p.ciso.userId] });
  await o.post(`${P}/access/groups/${g.vuln}/members`, { user_ids: [p.vm.userId] });
  await o.post(`${P}/access/groups/${g.grc}/members`, { user_ids: [p.grc.userId] });
  await o.post(`${P}/access/groups/${g.desk}/members`, { user_ids: [p.agent.userId] });
  const ws = (await o.get(`${P}/r/workspace?size=50`)).rows.find((w: any) => w.key === "security")!.id as string;
  const sys = await systemCtx(e.cfg, e.org);
  const drain = async () => {
    for (let i = 0; i < 30; i++) {
      const r = await tick(e.cfg, { budgetMs: 30_000 });
      if (!r.ran && !r.more) break;
    }
  };
  await drain();
  const sir = async (data: Record<string, unknown> = {}, as: Client = p.soc.client) => (await as.post(`${P}/r/sec_incident`, { short_description: "رخداد امنیتی آزمایشی", category: "malware", severity: "2", business_impact: "2", ...data })).row;
  return { e, P, o, p, g, ws, sys, drain, sir };
}

/** Move a timestamp column of a row into the past (test set-up only). */
export async function backdate(e: EngineOrg, table: string, id: string, column: string, daysAgo: number): Promise<void> {
  await e.db.query(`update ${table} set ${column} = now() - ($2 || ' days')::interval where id = $1`, [id, String(daysAgo)]);
}
