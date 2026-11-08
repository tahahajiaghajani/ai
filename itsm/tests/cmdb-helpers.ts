// Shared set-up of the configuration management and service portfolio tests: an organisation on an in-memory server
// with the CMDB defaults (class pack, relationship types, rules), groups «زیرساخت» and «شبکه», and signed-in members
// holding built-in roles — a configuration manager, an asset manager of each group, an agent, a requester, an auditor,
// a service owner and a member with a custom role that reads only its group's CIs.
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { tick } from "@server/jobs";
import { systemCtx } from "@server/engine";
import type { Ctx } from "@server/context";

export type Who = "cm" | "am" | "am2" | "agent" | "req" | "auditor" | "so" | "grp";

export interface CmdbWorld {
  e: EngineOrg;
  P: string;
  o: Client;
  p: Record<Who, { client: Client; userId: string }>;
  g: { infra: string; network: string };
  sys: Ctx;
  drain(): Promise<void>;
  /** a CI created by the owner */
  ci(data: Record<string, unknown>, as?: Client): Promise<Record<string, any>>;
  /** a relationship «parent <type> child» created by the owner */
  rel(parent: string, type: string, child: string, data?: Record<string, unknown>, as?: Client): Promise<Record<string, any>>;
}

const ROLES: Record<Who, string> = { cm: "configuration_manager", am: "asset_manager", am2: "asset_manager", agent: "agent", req: "requester", auditor: "auditor", so: "service_owner", grp: "cmdb_group_reader" };

export async function cmdbWorld(): Promise<CmdbWorld> {
  const e = await engineOrg();
  const P = `/o/${e.org}`;
  const o = e.owner;
  await o.post(`${P}/cmdb/seed`, {});
  // a custom role: reads the CIs of its groups only (to prove placeholders and counts)
  await o.put(`${P}/access/roles/cmdb_group_reader`, {
    name: "خوانندهٔ پیکربندی گروه", description: "", persona: "agent", grants: { cmdb: { read: "group", write: "none", delete: "none", create: false, approve: false, admin: false }, service: { read: "all", write: "none", delete: "none", create: false, approve: false, admin: false }, incident: { read: "all", write: "none", delete: "none", create: false, approve: false, admin: false } },
    field_groups: [], contains: [], workspaces: "member", domains: "own", active: true,
  });
  const infra = (await o.post(`${P}/r/group`, { name: "زیرساخت", types: ["assignment"] })).row.id as string;
  const network = (await o.post(`${P}/r/group`, { name: "شبکه", types: ["assignment"] })).row.id as string;
  const p = {} as CmdbWorld["p"];
  for (const k of Object.keys(ROLES) as Who[]) {
    p[k] = await e.member("member", `${k}@example.com`);
    await o.put(`${P}/access/members/${p[k].userId}`, { roles: [ROLES[k]], persona: k === "req" ? "requester" : "agent" });
  }
  await o.post(`${P}/access/groups/${infra}/members`, { user_ids: [p.am.userId, p.grp.userId] });
  await o.post(`${P}/access/groups/${network}/members`, { user_ids: [p.am2.userId] });
  const sys = await systemCtx(e.cfg, e.org);
  const drain = async () => {
    for (let i = 0; i < 30; i++) {
      const r = await tick(e.cfg, { budgetMs: 30_000 });
      if (!r.ran && !r.more) break;
    }
  };
  await drain();
  const ci = async (data: Record<string, unknown>, as: Client = o) => (await as.post(`${P}/r/ci`, { state: "operational", ...data })).row;
  const rel = async (parent: string, type: string, child: string, data: Record<string, unknown> = {}, as: Client = o) => (await as.post(`${P}/r/ci_rel`, { parent_id: parent, type, child_id: child, ...data })).row;
  return { e, P, o, p, g: { infra, network }, sys, drain, ci, rel };
}
