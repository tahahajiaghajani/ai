// Shared set-up of the change tests: an organisation on an in-memory server with the module's defaults, a change
// manager («مدیران تغییر»), three CAB members («هیئت مشاوران تغییر»), an implementer of the network group, an agent of
// another group, a requester, their line manager and an auditor — each holding a built-in ITSM role and signed in.
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { tick } from "@server/jobs";
import { systemCtx } from "@server/engine";
import type { Ctx } from "@server/context";

export type Who = "cm" | "cab1" | "cab2" | "cab3" | "agent" | "other" | "req" | "mgr" | "auditor";

export interface World {
  e: EngineOrg;
  /** /o/<org> */
  P: string;
  o: Client;
  p: Record<Who, { client: Client; userId: string }>;
  g: { network: string; servers: string; managers: string; board: string };
  sys: Ctx;
  /** run queued jobs (events, notifications, conflicts) until none is left */
  drain(): Promise<void>;
  /** a normal change ready for assessment, created by `as` (default: the implementer) */
  change(data?: Record<string, unknown>, as?: Client): Promise<Record<string, any>>;
  /** move a change through the given states as `as` (default: the implementer) */
  move(id: string, states: string[], as?: Client, data?: Record<string, unknown>): Promise<Record<string, any>>;
  get(id: string, as?: Client): Promise<Record<string, any>>;
  /** the approvals of a change */
  approvals(id: string): Promise<Record<string, any>[]>;
  /** a real CI (references to the CMDB are checked), created by the owner */
  ci(name: string, data?: Record<string, unknown>): Promise<string>;
}

const ROLES: Record<Who, string> = { cm: "change_manager", cab1: "cab_member", cab2: "cab_member", cab3: "cab_member", agent: "agent", other: "agent", req: "requester", mgr: "team_lead", auditor: "auditor" };

export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** A weekday noon `days` from now (UTC), clear of the seeded windows. */
export function at(days: number, hour = 9): string {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

export const PLANS = {
  description: "ارتقای سیستم‌عامل دیوارهٔ آتش مرکز داده به نسخهٔ پایدار تازه",
  justification: "نسخهٔ کنونی پشتیبانی نمی‌شود و آسیب‌پذیری‌های شناخته‌شده دارد؛ ارتقا لازم است.",
  expected_outcome: "دیوارهٔ آتش با نسخهٔ پشتیبانی‌شده و بدون آسیب‌پذیری شناخته‌شده",
  implementation_plan: "1. پشتیبان‌گیری از پیکربندی\n2. بارگذاری نسخهٔ تازه روی دستگاه پشتیبان\n3. جابه‌جایی نقش‌ها\n4. ارتقای دستگاه دوم",
  backout_plan: "بازگرداندن نسخهٔ پیشین از تصویر پشتیبان و جابه‌جایی دوبارهٔ نقش‌ها.",
  test_plan: "آزمون عبور ترافیک خدمت‌های اصلی و بررسی رویدادنگار دیوارهٔ آتش.",
};

export async function world(): Promise<World> {
  const e = await engineOrg();
  const P = `/o/${e.org}`;
  const o = e.owner;
  await o.post(`${P}/change/seed`, {});
  const groups = (await o.get(`${P}/r/group?size=50`)).rows as { id: string; name: string }[];
  const managers = groups.find((x) => x.name === "مدیران تغییر")!.id;
  const board = groups.find((x) => x.name === "هیئت مشاوران تغییر")!.id;
  const network = (await o.post(`${P}/r/group`, { name: "پشتیبانی شبکه", types: ["assignment"] })).row.id as string;
  const servers = (await o.post(`${P}/r/group`, { name: "سرورها", types: ["assignment"] })).row.id as string;
  const p = {} as World["p"];
  for (const k of Object.keys(ROLES) as Who[]) p[k] = await e.member("member", `${k}@example.com`);
  for (const k of Object.keys(ROLES) as Who[]) {
    const manager = k === "req" || k === "agent" || k === "other" ? p.mgr.userId : null;
    await o.put(`${P}/access/members/${p[k].userId}`, { roles: [ROLES[k]], persona: k === "req" ? "requester" : "agent", ...(manager ? { manager_id: manager } : {}) });
  }
  await o.post(`${P}/access/groups/${network}/members`, { user_ids: [p.agent.userId] });
  await o.post(`${P}/access/groups/${servers}/members`, { user_ids: [p.other.userId] });
  await o.post(`${P}/access/groups/${managers}/members`, { user_ids: [p.cm.userId] });
  await o.post(`${P}/access/groups/${board}/members`, { user_ids: [p.cab1.userId, p.cab2.userId, p.cab3.userId] });
  const sys = await systemCtx(e.cfg, e.org);
  const drain = async () => {
    for (let i = 0; i < 20; i++) {
      const r = await tick(e.cfg, { budgetMs: 30_000 });
      if (!r.ran && !r.more) break;
    }
  };
  await drain();
  const change = async (data: Record<string, unknown> = {}, as: Client = p.agent.client) =>
    (await as.post(`${P}/r/change_request`, { short_description: "ارتقای دیوارهٔ آتش", type: "normal", assignment_group_id: network, planned_start: at(12), planned_end: at(12, 11), ...PLANS, ...data })).row;
  const get = async (id: string, as: Client = o) => (await as.get(`${P}/r/change_request/${id}`)).row;
  const move = async (id: string, states: string[], as: Client = p.agent.client, data: Record<string, unknown> = {}) => {
    let row = await get(id, as);
    for (const to of states) row = (await as.post(`${P}/r/change_request/${id}/transition`, { to, data, version: row.version })).row;
    return row;
  };
  const approvals = async (id: string) => (await o.get(`${P}/approvals/record/change_request/${id}`)).approvals as Record<string, any>[];
  const ci = async (name: string, data: Record<string, unknown> = {}) => (await o.post(`${P}/r/ci`, { name, class: "server", state: "operational", ...data })).row.id as string;
  return { e, P, o, p, g: { network, servers, managers, board }, sys, drain, change, move, get, approvals, ci };
}

/** Move a timestamp column of a row (test set-up only). */
export async function backdate(e: EngineOrg, table: string, id: string, column: string, daysAgo: number): Promise<void> {
  await e.db.query(`update ${table} set ${column} = now() - ($2 || ' days')::interval where id = $1`, [id, String(daysAgo)]);
}
