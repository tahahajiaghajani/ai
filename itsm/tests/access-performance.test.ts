// Lists stay fast under the access predicate: on 10 000 tickets the page queries the engine generates for a
// requester (own fields), an agent (group scope under need-to-know, workspaces) and a department head (unit tree)
// are answered through indexes — never a sequential scan of the table — and return in well under a second.
import { describe, it, expect, beforeAll } from "vitest";
import { TICKET } from "./fixtures/access";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { list } from "@server/engine";
import type { Ctx } from "@server/context";

describe("list performance under the access predicate", () => {
  let e: EngineOrg;
  const who: Record<"req" | "agent" | "head", string> = { req: "", agent: "", head: "" };
  let seen: { sql: string; params: unknown[] }[] = [];

  beforeAll(async () => {
    e = await engineOrg();
    const P = `/o/${e.org}`;
    const o = e.owner;
    for (const k of Object.keys(who) as (keyof typeof who)[]) who[k] = (await e.member("member", `perf-${k}@example.com`)).userId;
    const ws = (await o.post(`${P}/r/workspace`, { key: "it", name: "فناوری اطلاعات" })).row.id;
    const units: string[] = [];
    let parent: string | null = null;
    for (let i = 0; i < 40; i++) {
      const id: string = (await o.post(`${P}/r/org_unit`, { name: `واحد ${i}`, parent_id: i % 8 === 0 ? null : parent })).row.id;
      units.push(id);
      parent = id;
    }
    const groups: string[] = [];
    for (let i = 0; i < 20; i++) groups.push((await o.post(`${P}/r/group`, { name: `گروه ${i}`, workspace_id: ws })).row.id);
    await o.put(`${P}/access/settings`, { preset: "need_to_know" });
    await o.post(`${P}/access/groups/${groups[3]}/members`, { user_ids: [who.agent] });
    await o.put(`${P}/access/members/${who.agent}`, { roles: ["agent"] });
    await o.put(`${P}/access/members/${who.req}`, { roles: ["requester"], org_unit_id: units[9] });
    await o.put(`${P}/access/members/${who.head}`, { roles: ["requester"], org_unit_id: units[8] });
    await o.patch(`${P}/r/org_unit/${units[8]}`, { manager_id: who.head });
    await e.db.query(
      `insert into ${TICKET.table} (id, org_id, no, short_description, state, priority, caller_id, opened_by, assigned_to, assignment_group_id,
                                    workspace_id, unit_id, watch_list, custom, updated_at)
       select gen_random_uuid(), $1, g, 'تیکت ' || g, case when g % 3 = 0 then 'new' else 'closed' end, (1 + g % 5)::text,
              case when g % 500 = 0 then $2::uuid else gen_random_uuid() end, gen_random_uuid(),
              case when g % 700 = 0 then $3::uuid end, ($4::uuid[])[1 + g % 20], $5::uuid, ($6::uuid[])[1 + g % 40],
              '[]'::jsonb, '{}'::jsonb, now() - (g || ' minutes')::interval
       from generate_series(1, 10000) g`,
      [e.org, who.req, who.agent, `{${groups.join(",")}}`, ws, `{${units.join(",")}}`],
    );
    await e.db.query(`insert into sm_numbers (org_id, table_key, last) values ($1, 'acc_ticket', 10000) on conflict do nothing`, [e.org]);
    await e.db.query(`analyze ${TICKET.table}`);
  });

  async function spied(userId: string): Promise<Ctx> {
    const real = await e.ctxOf(userId);
    const spy = (fn: (sql: string, params?: unknown[]) => Promise<unknown>) => (sql: string, params?: unknown[]) => {
      seen.push({ sql, params: params ?? [] });
      return fn(sql, params);
    };
    return { ...real, db: { ...real.db, query: spy(real.db.query.bind(real.db)), one: spy(real.db.one.bind(real.db)) } as Ctx["db"] };
  }

  async function plans(userId: string, params: Parameters<typeof list>[2]): Promise<{ plans: string[]; rows: number; ms: number }> {
    seen = [];
    const ctx = await spied(userId);
    const t0 = performance.now();
    const r = await list(ctx, "acc_ticket", params);
    const ms = performance.now() - t0;
    const out: string[] = [];
    for (const q of seen.filter((x) => new RegExp(`from ${TICKET.table} t where`).test(x.sql) && / limit \d+/.test(x.sql))) {
      const rows = await e.db.query<{ "QUERY PLAN": string }>(`explain ${q.sql}`, q.params);
      out.push(rows.map((x) => x["QUERY PLAN"]).join("\n"));
    }
    return { plans: out, rows: r.rows.length, ms };
  }

  for (const [label, key, expected] of [
    ["requester (own records)", "req", 20],
    ["agent (their group, need-to-know)", "agent", 50],
    ["department head (their unit tree, as requesters)", "head", 50],
  ] as const) {
    it(`answers ${label} from indexes`, async () => {
      for (const p of [{}, { filter: { f: "state", op: "eq", v: "new" } }, { sort: "-number" }] as Parameters<typeof list>[2][]) {
        const { plans: ps, rows, ms } = await plans(who[key], p);
        expect(ps.length).toBeGreaterThan(0);
        for (const plan of ps) expect(plan, `${label} ${JSON.stringify(p)}\n${plan}`).not.toMatch(new RegExp(`Seq Scan on ${TICKET.table}`));
        if (!p?.filter) expect(rows, label).toBe(expected);
        expect(ms, label).toBeLessThan(1500);
      }
    });
  }

  // docs/PERFORMANCE_FA.md §۶: the rule's terms are index conditions (a NULL term is as good as false in a filter)
  it("compiles the read rule to plain index conditions on the own, group and unit anchors", async () => {
    seen = [];
    await list(await spied(who.agent), "acc_ticket", {});
    const q = seen.find((x) => new RegExp(`from ${TICKET.table} t where`).test(x.sql) && / limit \d+/.test(x.sql))!;
    expect(q.sql).not.toMatch(/coalesce\(t\.(caller_id|requested_for|opened_by|assigned_to|assignment_group_id|unit_id|watch_list)\b/);
    expect(q.sql).toMatch(/t\.assignment_group_id = any\(\$\d+::uuid\[\]\)/);
  });

  it("finds a requester's own records through the own-field indexes", async () => {
    const { plans: ps, rows } = await plans(who.req, {});
    expect(rows).toBe(20);
    expect(ps.join("\n")).toMatch(/Bitmap Index Scan on sm_acc_tickets_(caller_id|requested_for|opened_by)_idx/);
  });

  it("answers an agent's open queue from the open-group index", async () => {
    const { plans: ps } = await plans(who.agent, { filter: { and: [{ f: "assignment_group_id", op: "is_my_group" }, { f: "active", op: "eq", v: true }] }, sort: "-updated_at" });
    expect(ps.join("\n")).toMatch(/sm_acc_tickets_open_grp_idx/);
  });
});

