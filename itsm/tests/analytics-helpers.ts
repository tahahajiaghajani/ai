// Shared set-up of the analytics tests: the incident world (a service-desk agent, an agent of another group, two
// requesters, a major-incident manager, a problem manager and an auditor, under «نیاز به دانستن») plus a service-desk
// manager (who authors reports), the analytics defaults, and incidents in both groups.
import { world, type World } from "./incident-helpers";
import type { Client } from "./helpers";

export interface AnalyticsWorld extends World {
  sdm: { client: Client; userId: string };
  /** incidents by group */
  inc: { desk: Record<string, any>[]; network: Record<string, any>[]; own: Record<string, any> };
  /** run a definition as `who` */
  run(who: Client, spec: Record<string, unknown>, expect?: number): Promise<any>;
  /** the number of incidents `who` can list */
  listed(who: Client, table?: string, filter?: unknown): Promise<number>;
}

export async function analyticsWorld(): Promise<AnalyticsWorld> {
  const w = await world({ preset: "need_to_know" });
  const sdm = await w.e.member("member", "sdm@example.com");
  await w.o.put(`${w.P}/access/members/${sdm.userId}`, { roles: ["service_desk_manager"], persona: "agent" });
  await w.o.post(`${w.P}/access/groups/${w.g.desk}/members`, { user_ids: [sdm.userId] });
  const desk = [
    await w.incident({ short_description: "قطعی ایمیل", priority: "1", assignment_group_id: w.g.desk, assigned_to: w.p.agent.userId }),
    await w.incident({ short_description: "کندی سامانه", priority: "3", assignment_group_id: w.g.desk }),
    await w.incident({ short_description: "چاپگر", priority: "4", assignment_group_id: w.g.desk }),
  ];
  const network = [
    await w.incident({ short_description: "قطعی شبکهٔ طبقه ۳", priority: "2", assignment_group_id: w.g.network, assigned_to: w.p.other.userId }),
    await w.incident({ short_description: "وای‌فای", priority: "3", assignment_group_id: w.g.network }),
  ];
  const own = await w.incident({ short_description: "لپ‌تاپ من", category: "hardware", subcategory: "hardware.computer" }, w.p.req.client);
  await w.o.post(`${w.P}/analytics/seed`, {});
  await w.drain();
  const run = (who: Client, spec: Record<string, unknown>, expect = 200) => who.post(`${w.P}/analytics/run`, { spec: { v: 1, measures: [{ fn: "count" }], dims: [], viz: "score", ...spec } }, expect);
  const listed = async (who: Client, table = "incident", filter: unknown = null) => (await who.post(`${w.P}/r/${table}/query`, { filter, size: 1, total: true })).total as number;
  return { ...w, sdm, inc: { desk, network, own }, run, listed };
}
