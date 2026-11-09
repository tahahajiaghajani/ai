// Shared set-up of the ESM, CSM and field-service tests: an organisation on an in-memory server with the IT catalogue
// and the departments' content pack seeded, and signed-in people: an HR agent (payroll) and an HR desk agent, an
// employee-relations specialist, a facilities agent, a finance agent, an IT agent (built-in «agent», no department
// workspace), an IT administrator (tenant_admin), an auditor, an employee, their manager and a new hire.
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { Client } from "./helpers";
import { tick } from "@server/jobs";
import { systemCtx } from "@server/engine";
import type { Ctx } from "@server/context";

export type Who = "hr" | "hrdesk" | "er" | "fac" | "fin" | "it" | "admin" | "auditor" | "emp" | "mgr" | "hire";

export interface EsmWorld {
  e: EngineOrg;
  P: string;
  o: Client;
  p: Record<Who, { client: Client; userId: string }>;
  ws: Record<string, string>;
  g: Record<string, string>;
  dept: Record<string, Record<string, any>>;
  svc: Record<string, Record<string, any>>;
  sys: Ctx;
  drain(): Promise<void>;
  get(table: string, id: string, as?: Client, expect?: number): Promise<Record<string, any>>;
}

const ROLES: Partial<Record<Who, string[]>> = { it: ["agent"], admin: ["tenant_admin"], auditor: ["auditor"], emp: ["requester"], mgr: ["requester"], hire: ["requester"] };
const GROUP_OF: Partial<Record<Who, string>> = { hr: "حقوق و دستمزد", hrdesk: "کارشناسان منابع انسانی", er: "روابط کار و رسیدگی", fac: "پشتیبانی و تأسیسات", fin: "خدمات مالی" };

let worlds = 0;

/**
 * A member signed in from an address of its own (the platform limits sign-ins per address and minute; a test file
 * that builds several worlds signs in many people).
 */
export async function memberAt(e: EngineOrg, email: string, ip: string, role: "member" | "viewer" | "admin" = "member"): Promise<{ client: Client; userId: string }> {
  const added = await e.owner.post(`/o/${e.org}/members`, { email, full_name: email.split("@")[0], role });
  const client = new Client(e.app);
  const res = await e.app.fetch(new Request("http://local.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ email, password: added.temp_password }) }));
  if (res.status !== 200) throw new Error(`login ${email} → ${res.status}: ${await res.text()}`);
  const set = res.headers.get("set-cookie");
  if (set) client.cookie = set.split(";")[0];
  const who = await client.get("/auth/me");
  return { client, userId: who.user.id };
}

export async function esmWorld(opts: { seed?: boolean } = {}): Promise<EsmWorld> {
  const n = ++worlds;
  const e = await engineOrg();
  const P = `/o/${e.org}`;
  const o = e.owner;
  await o.post(`${P}/request/seed`, {});
  if (opts.seed !== false) await o.post(`${P}/esm/seed`, {});
  const p = {} as EsmWorld["p"];
  const all: Who[] = ["hr", "hrdesk", "er", "fac", "fin", "it", "admin", "auditor", "emp", "mgr", "hire"];
  for (const [i, k] of all.entries()) p[k] = await memberAt(e, `${k}.${n}@example.com`, `10.${n % 250}.${i}.1`);
  const groups = (await o.get(`${P}/r/group?size=200`)).rows as { id: string; name: string }[];
  const g: Record<string, string> = Object.fromEntries(groups.map((x) => [x.name, x.id]));
  for (const k of all) {
    const roles = ROLES[k] ?? [];
    await o.put(`${P}/access/members/${p[k].userId}`, { roles, persona: roles.includes("requester") ? "requester" : "agent", ...(k === "emp" || k === "hire" ? { manager_id: p.mgr.userId } : {}) });
    if (GROUP_OF[k] && g[GROUP_OF[k]!]) await o.post(`${P}/access/groups/${g[GROUP_OF[k]!]}/members`, { user_ids: [p[k].userId] });
  }
  // the IT agent works in an IT group of no department
  g.it = (await o.post(`${P}/r/group`, { name: "میز خدمت فناوری", types: ["assignment"] })).row.id;
  await o.post(`${P}/access/groups/${g.it}/members`, { user_ids: [p.it.userId] });
  const sys = await systemCtx(e.cfg, e.org);
  const drain = async () => {
    for (let i = 0; i < 40; i++) {
      const r = await tick(e.cfg, { budgetMs: 30_000 });
      if (!r.ran && !r.more) break;
    }
  };
  await drain();
  const wsRows = (await o.get(`${P}/r/workspace?size=50`)).rows as { id: string; key: string }[];
  const ws = Object.fromEntries(wsRows.map((x) => [x.key, x.id]));
  const depts = opts.seed === false ? [] : ((await e.owner.get(`${P}/r/esm_department?size=50`)).rows as Record<string, any>[]);
  const dept = Object.fromEntries(depts.map((d) => [d.key, d]));
  const svcs = opts.seed === false ? [] : ((await e.owner.get(`${P}/r/esm_service?size=200`)).rows as Record<string, any>[]);
  const svc = Object.fromEntries(svcs.map((s) => [s.code, s]));
  const get = async (table: string, id: string, as: Client = o, expect = 200) => (await as.get(`${P}/r/${table}/${id}`, expect))?.row;
  return { e, P, o, p, ws, g, dept, svc, sys, drain, get };
}

/** A date `days` from today (YYYY-MM-DD, UTC). */
export function dayFrom(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** An instant `hours` from now. */
export function inHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}
