// Shared set-up of the portal's tests: an organisation on an in-memory server with the incident, knowledge, request and
// portal defaults, two units, and members holding built-in ITSM roles:
//   req    a requester of «مالی» whose manager is `mgr`
//   req2   another requester of «مالی» (same unit, no relation to req's records)
//   mgr    a requester who manages req (the manager approver of req's orders)
//   other  a requester of «فروش» (another unit)
//   agent  a service-desk agent («میز خدمت»)
//   sdm    a service desk manager (surveys, the portal's look)
//   km     a knowledge manager (public knowledge)
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { tick } from "@server/jobs";
import { systemCtx } from "@server/engine";
import { seedRequestDefaults } from "@server/modules/request";
import { resetRateLimits } from "@server/http/ratelimit";
import type { Ctx } from "@server/context";

export type Who = "req" | "req2" | "mgr" | "other" | "agent" | "sdm" | "km";

export interface PortalWorld {
  e: EngineOrg;
  P: string;
  o: Client;
  p: Record<Who, { client: Client; userId: string }>;
  units: { finance: string; sales: string };
  g: { desk: string; managers: string };
  sys: Ctx;
  drain(): Promise<void>;
  /** an incident filed by `as` (a requester files only their own fields) */
  incident(as: Client, data?: Record<string, unknown>): Promise<Record<string, any>>;
  /** a request without a session (an anonymous visitor of the public pages, a messenger's webhook) */
  anon: Client;
}

const ROLES: Record<Who, string> = { req: "requester", req2: "requester", mgr: "requester", other: "requester", agent: "agent", sdm: "service_desk_manager", km: "knowledge_manager" };

export async function portalWorld(): Promise<PortalWorld> {
  resetRateLimits();
  const e = await engineOrg();
  const P = `/o/${e.org}`;
  const o = e.owner;
  await o.post(`${P}/incident/seed`, {});
  await o.post(`${P}/knowledge/seed`, {});
  await seedRequestDefaults(e.cfg, e.org);
  await o.post(`${P}/portal/seed`, {});
  const finance = (await o.post(`${P}/r/org_unit`, { name: "مالی", kind: "department" })).row.id as string;
  const sales = (await o.post(`${P}/r/org_unit`, { name: "فروش", kind: "department" })).row.id as string;
  const groups = (await o.get(`${P}/r/group?size=100`)).rows as { id: string; name: string }[];
  const desk = groups.find((x) => x.name === "میز خدمت")!.id;
  const managers = groups.find((x) => x.name === "مدیران دانش")!.id;
  const p = {} as PortalWorld["p"];
  for (const k of Object.keys(ROLES) as Who[]) p[k] = await e.member("member", `${k}@example.com`);
  for (const k of Object.keys(ROLES) as Who[]) {
    const profile: Record<string, unknown> = { roles: [ROLES[k]], persona: ROLES[k] === "requester" ? "requester" : "agent" };
    if (k === "req" || k === "req2" || k === "mgr") profile.org_unit_id = finance;
    if (k === "other") profile.org_unit_id = sales;
    if (k === "req") profile.manager_id = p.mgr.userId;
    await o.put(`${P}/access/members/${p[k].userId}`, profile);
  }
  await o.post(`${P}/access/groups/${desk}/members`, { user_ids: [p.agent.userId] });
  await o.post(`${P}/access/groups/${managers}/members`, { user_ids: [p.km.userId, e.ownerId] });
  const sys = await systemCtx(e.cfg, e.org);
  const drain = async () => {
    for (let i = 0; i < 40; i++) {
      const r = await tick(e.cfg, { budgetMs: 30_000 });
      if (!r.ran && !r.more) break;
    }
  };
  await drain();
  const { Client: ClientClass } = await import("./helpers");
  return {
    e,
    P,
    o,
    p,
    units: { finance, sales },
    g: { desk, managers },
    sys,
    drain,
    anon: new ClientClass(e.app),
    async incident(as, data = {}) {
      return (await as.post(`${P}/r/incident`, { short_description: "چاپگر کار نمی‌کند", description: "چاپگر طبقهٔ دوم کاغذ گیر می‌کند", ...data })).row;
    },
  };
}

/** The HTTP status of a request (the client throws on any status but the expected one). */
export async function statusOf(c: Client, method: string, path: string, body?: unknown): Promise<number> {
  try {
    await c.req(method, path, body ?? (method === "GET" ? undefined : {}), 200);
    return 200;
  } catch (e) {
    const m = /→ (\d{3})/.exec(String(e));
    return m ? Number(m[1]) : 0;
  }
}
