// Shared set-up of the event tests: an organisation on an in-memory server with the team «پشتیبانی شبکه» (an
// operations engineer and an agent in it, a manager), another team «پایگاه داده» (an agent), a requester, an
// auditor and an operations manager, the module's defaults (seeded after the team has members, so its on-call
// schedule has rotations), CIs with a dependency, and helpers to make sources with keys, post deliveries to the
// sign-in-free endpoint and run the queue.
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { tick } from "@server/jobs";
import { systemCtx } from "@server/engine";
import type { Ctx } from "@server/context";
import { forgetSources, resetIngestThrottle, resetSweepThrottle } from "@server/modules/event";
import { resetRateLimits } from "@server/http/ratelimit";

export type Who = "ops" | "agent" | "other" | "req" | "auditor" | "mgr";

export interface EventWorld {
  e: EngineOrg;
  P: string;
  o: Client;
  p: Record<Who, { client: Client; userId: string }>;
  g: { network: string; db: string };
  sys: Ctx;
  ci: { app: string; db: string; host: string };
  drain(): Promise<void>;
  /** a source with a fresh key */
  source(data?: Record<string, unknown>): Promise<{ id: string; key: string }>;
  /** POST a delivery to the sign-in-free endpoint; the response status and JSON */
  send(key: string, payload: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any; headers: Headers }>;
  /** a raw request to the app (path under /api) */
  raw(method: string, path: string, body?: string, headers?: Record<string, string>): Promise<Response>;
}

const ROLES: Record<Who, string> = { ops: "ops_engineer", agent: "agent", other: "agent", req: "requester", auditor: "auditor", mgr: "ops_manager" };

export async function eventWorld(): Promise<EventWorld> {
  resetRateLimits();
  forgetSources();
  resetIngestThrottle();
  resetSweepThrottle();
  const e = await engineOrg();
  const P = `/o/${e.org}`;
  const o = e.owner;
  const p = {} as EventWorld["p"];
  for (const k of Object.keys(ROLES) as Who[]) p[k] = await e.member("member", `${k}@example.com`);
  const network = (await o.post(`${P}/r/group`, { name: "پشتیبانی شبکه", types: ["assignment", "oncall"], manager_id: p.mgr.userId })).row.id as string;
  const db = (await o.post(`${P}/r/group`, { name: "پایگاه داده", types: ["assignment"] })).row.id as string;
  await o.post(`${P}/access/groups/${network}/members`, { user_ids: [p.ops.userId, p.agent.userId] });
  await o.post(`${P}/access/groups/${db}/members`, { user_ids: [p.other.userId] });
  await o.post(`${P}/event/seed`, { force: true });
  for (const k of Object.keys(ROLES) as Who[]) await o.put(`${P}/access/members/${p[k].userId}`, { roles: [ROLES[k]], persona: k === "req" ? "requester" : "agent" });
  // CIs: an application that depends on a database server, which runs on a host
  const app = (await o.post(`${P}/r/ci`, { name: "سامانهٔ پرداخت", class: "business_application", state: "operational", criticality: "1", support_group_id: network })).row.id as string;
  const dbci = (await o.post(`${P}/r/ci`, { name: "db01", class: "database", state: "operational", hostname: "db01", criticality: "2", support_group_id: db })).row.id as string;
  const host = (await o.post(`${P}/r/ci`, { name: "srv-db01", class: "server", state: "operational", hostname: "srv-db01", fqdn: "srv-db01.example.local", ip_address: "10.0.0.5", support_group_id: db })).row.id as string;
  await o.post(`${P}/cmdb/seed`, {}).catch(() => undefined);
  await o.post(`${P}/r/ci_rel`, { parent_id: app, type: "depends_on", child_id: dbci });
  await o.post(`${P}/r/ci_rel`, { parent_id: dbci, type: "runs_on", child_id: host });
  const sys = await systemCtx(e.cfg, e.org);
  const drain = async () => {
    for (let i = 0; i < 30; i++) {
      const r = await tick(e.cfg, { budgetMs: 30_000 });
      if (!r.ran && !r.more) break;
    }
  };
  await drain();
  const raw = (method: string, path: string, body?: string, headers: Record<string, string> = {}) => Promise.resolve(e.app.fetch(new Request(`http://local.test/api${path}`, { method, headers, body })));
  const send = async (key: string, payload: unknown, headers: Record<string, string> = {}) => {
    const res = await raw("POST", `/public/events/${key}`, typeof payload === "string" ? payload : JSON.stringify(payload), { "content-type": "application/json", ...headers });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };
  const source = async (data: Record<string, unknown> = {}) => {
    const row = (await o.post(`${P}/r/event_source`, { name: `منبع ${Math.random().toString(36).slice(2, 7)}`, kind: "generic", ...data })).row;
    const k = await o.post(`${P}/event/sources/${row.id}/key`, {});
    return { id: row.id as string, key: k.key as string };
  };
  return { e, P, o, p, g: { network, db }, sys, ci: { app, db: dbci, host }, drain, source, send, raw };
}
