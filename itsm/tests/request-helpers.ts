// Helpers of the request module's tests: an organisation with the starter IT catalogue seeded (as the job would),
// members with ITSM roles and managers, the job queue drained (flows, approvals, events), direct reads of records.
import { tick } from "@server/jobs";
import { seedRequestDefaults, resetSweepThrottle } from "@server/modules/request";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";

export type Who = { client: Client; userId: string };

export interface RequestKit {
  o: EngineOrg;
  P: string;
  drain(): Promise<void>;
  /** a catalogue item by code (as stored) */
  item(code: string): Promise<Record<string, any>>;
  /** a member with ITSM roles (none: legacy member, works as an agent) and optionally a manager */
  person(email: string, opts?: { roles?: string[]; manager?: string; role?: "member" | "viewer" | "admin" }): Promise<Who>;
  group(name: string): Promise<string>;
  addToGroup(group: string, users: string[]): Promise<void>;
  /** rows of a table straight from the database (live rows of the organisation) */
  rows(table: string, where?: string, params?: unknown[]): Promise<Record<string, any>[]>;
  ritm(id: string): Promise<Record<string, any>>;
  approvals(recordId: string): Promise<Record<string, any>[]>;
}

const TABLES: Record<string, string> = {
  catalog: "sm_catalogs", request: "sm_requests", request_item: "sm_request_items", request_task: "sm_request_tasks", request_answer: "sm_request_answers",
  catalog_item: "sm_catalog_items", request_subscription: "sm_request_subscriptions", todo: "sm_todos", flow: "sm_flows", approval: "sm_approvals",
};

export async function requestKit(): Promise<RequestKit> {
  resetSweepThrottle();
  const o = await engineOrg();
  const P = `/o/${o.org}`;
  await seedRequestDefaults(o.cfg, o.org);
  const kit: RequestKit = {
    o,
    P,
    async drain() {
      for (let i = 0; i < 100; i++) {
        const r = await tick(o.cfg, { budgetMs: 20_000 });
        if (!r.more && r.ran + r.failed === 0) return;
      }
    },
    async item(code) {
      const [row] = await kit.rows("catalog_item", "code = $2", [code]);
      if (!row) throw new Error(`no item ${code}`);
      return row;
    },
    async person(email, opts = {}) {
      const who = await o.member(opts.role ?? "member", email);
      const profile: Record<string, unknown> = {};
      if (opts.roles) {
        profile.roles = opts.roles;
        profile.persona = opts.roles.includes("requester") ? "requester" : "agent";
      }
      if (opts.manager) profile.manager_id = opts.manager;
      if (Object.keys(profile).length) await o.owner.put(`${P}/access/members/${who.userId}`, profile);
      return who;
    },
    async group(name) {
      const r = await o.db.one<{ id: string }>(`select id from sm_groups where org_id = $1 and name = $2 and deleted_at is null`, [o.org, name]);
      if (!r) throw new Error(`no group ${name}`);
      return r.id;
    },
    async addToGroup(group, users) {
      await o.owner.post(`${P}/access/groups/${group}/members`, { user_ids: users });
    },
    async rows(table, where = "true", params = []) {
      const t = TABLES[table] ?? table;
      return o.db.query<Record<string, any>>(`select * from ${t} where org_id = $1 and deleted_at is null and (${where}) order by created_at, id`, [o.org, ...params]);
    },
    async ritm(id) {
      const [r] = await kit.rows("request_item", "id = $2", [id]);
      return r;
    },
    async approvals(recordId) {
      return o.db.query<Record<string, any>>(`select * from sm_approvals where org_id = $1 and record_id = $2 and deleted_at is null order by round, level, created_at`, [o.org, recordId]);
    },
  };
  return kit;
}
