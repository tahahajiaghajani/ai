// Shared set-up of the ITAM, supplier and financial tests: an organisation on an in-memory server with the three
// modules' defaults (and the SLA service's calendars), and signed-in members holding built-in or seeded roles — an
// asset manager, an agent, two requesters (the asset holders), an auditor, the seeded «مدیر مالی فناوری اطلاعات» and
// «مدیر تدارکات», and a member without ITSM roles.
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { tick } from "@server/jobs";
import { systemCtx } from "@server/engine";
import type { Ctx } from "@server/context";
import { seedItamDefaults, resetItamSweepThrottle } from "@server/modules/itam";
import { seedSupplierDefaults, resetSupplierSweepThrottle } from "@server/modules/supplier";
import { seedFinancialDefaults, resetFinancialSweepThrottle } from "@server/modules/financial";

export type Who = "am" | "agent" | "req" | "req2" | "auditor" | "fin" | "proc";

export interface ItamWorld {
  e: EngineOrg;
  P: string;
  o: Client;
  p: Record<Who, { client: Client; userId: string }>;
  sys: Ctx;
  drain(): Promise<void>;
  /** the id of a seeded row of `table` by a field value */
  idOf(table: string, field: string, value: unknown): Promise<string>;
  /** an asset created by the asset manager (in stock at the central stockroom unless the data says otherwise) */
  asset(data?: Record<string, unknown>): Promise<Record<string, any>>;
}

const ROLES: Record<Who, string> = { am: "asset_manager", agent: "agent", req: "requester", req2: "requester", auditor: "auditor", fin: "it_finance", proc: "procurement_manager" };

export async function itamWorld(): Promise<ItamWorld> {
  resetItamSweepThrottle();
  resetSupplierSweepThrottle();
  resetFinancialSweepThrottle();
  const e = await engineOrg();
  const P = `/o/${e.org}`;
  const o = e.owner;
  await seedItamDefaults(e.cfg, e.org);
  await seedSupplierDefaults(e.cfg, e.org);
  await seedFinancialDefaults(e.cfg, e.org);
  const p = {} as ItamWorld["p"];
  for (const k of Object.keys(ROLES) as Who[]) {
    p[k] = await e.member("member", `${k}@example.com`);
    await o.put(`${P}/access/members/${p[k].userId}`, { roles: [ROLES[k]], persona: k.startsWith("req") ? "requester" : "agent" });
  }
  const sys = await systemCtx(e.cfg, e.org);
  const drain = async () => {
    for (let i = 0; i < 40; i++) {
      const r = await tick(e.cfg, { budgetMs: 30_000 });
      if (!r.ran && !r.more) break;
    }
  };
  await drain();
  const idOf = async (table: string, field: string, value: unknown) => {
    const r = await o.post(`${P}/r/${table}/query`, { filter: { f: field, op: "eq", v: value }, size: 1 });
    if (!r.rows[0]) throw new Error(`${table}.${field} = ${String(value)} not found`);
    return r.rows[0].id as string;
  };
  const central = await idOf("stockroom", "code", "WH-01");
  const laptop = await idOf("asset_model", "name", "لنوو ThinkPad E14 Gen 5");
  const asset = async (data: Record<string, unknown> = {}) => (await p.am.client.post(`${P}/r/asset`, { model_id: laptop, state: "in_stock", stockroom_id: central, ...data })).row;
  return { e, P, o, p, sys, drain, idOf, asset };
}
