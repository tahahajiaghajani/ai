// The purge never stops on one row (docs/DEMO_FA.md «حذف کامل», release 1.1.5). Each row-level revert, clear and delete
// runs in its own savepoint; a row that would collide with a live one (a unique key a real person took meanwhile) or
// that a hook refuses stays as it is and is reported, and the purge goes on to its end.
//   · a demo person's request removed a real group membership and an administrator added the person back: putting the
//     old row back would collide with the live one (sm_group_members_group_id_user_id_uk) — before 1.1.5 the purge's
//     expand phase rolled back on every attempt and the pack stayed in «purging» for ever; now the live row is kept
//   · demo work deleted a real row and a real person made another with the same unique name: it is not written back
//   · what was built on top of the pack in the simplest ways (refsweep, the probe's fast repro): a real business rule
//     that set a demo group, a real custom user field naming a demo person, a real task on a demo incident
// The pack is simulated as tests/demo-safety.test.ts does (a loaded pack row, demo rows written inside the demo scope).
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { createIn, removeIn, systemCtx } from "@server/engine";
import { inDemoScope } from "@server/db/scope";
import { danglingRefs, runToEnd } from "@server/modules/demo";
import { hashPassword } from "@server/auth/password";
import { uuidv7 } from "@shared/id";
import type { Ctx } from "@server/context";

async function packOf(e: EngineOrg) {
  await e.db.query(
    `insert into sm_demo_packs (org_id, state, size, progress, counters, started_by) values ($1, 'loaded', 'small', jsonb_build_object('saved_at', now(), 'computed', '[]'::jsonb, 'seeds_done', true, 'saved', true), '{}'::jsonb, $2)`,
    [e.org, e.ownerId],
  );
}

async function persona(e: EngineOrg, local: string): Promise<string> {
  const id = uuidv7();
  await e.db.query(`insert into sm_users (id, email, full_name, password_hash, prefs) values ($1, $2, $3, $4, $5::jsonb)`, [
    id, `${local}.${e.org.slice(0, 6)}@aftab-bank.example`, `نمایشی ${local}`, await hashPassword("demo-persona-pass-1405"), JSON.stringify({ demo_org: e.org }),
  ]);
  await e.db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_users')`, [e.org, id]);
  await e.db.query(`insert into sm_org_members (id, org_id, user_id, role, title, origin) values ($1, $2, $3, 'member', 'نمایشی', 'cloud')`, [uuidv7(), e.org, id]);
  await e.owner.put(`/o/${e.org}/access/members/${id}`, { roles: ["agent"], persona: "agent" });
  return id;
}

/** The ids of every row of the organisation (and its people), to tell what the purge removed. */
async function allIds(e: EngineOrg): Promise<Set<string>> {
  const out = new Set<string>();
  const tables = await e.db.query<{ t: string }>(
    `select c.table_name as t from information_schema.columns c join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
      where c.table_schema = current_schema() and c.table_name like 'sm\\_%' and c.column_name = 'org_id'
        and exists (select 1 from information_schema.columns i where i.table_schema = c.table_schema and i.table_name = c.table_name and i.column_name = 'id' and i.data_type = 'uuid')`,
  );
  for (const { t } of tables) for (const r of await e.db.query<{ id: string }>(`select id::text as id from ${t} where org_id = $1`, [e.org])) out.add(r.id);
  for (const r of await e.db.query<{ id: string }>(`select id::text as id from sm_users where prefs ->> 'demo_org' = $1`, [e.org])) out.add(r.id);
  return out;
}

const purge = async (e: EngineOrg) => {
  await e.owner.post(`/o/${e.org}/demo/purge`, { confirm: "حذف کامل" });
  await runToEnd(e.cfg, e.org, "purge", { budgetMs: 300_000 });
  return (await e.db.one<{ data: Record<string, any> }>(`select data from sm_audit where org_id = $1 and action = 'demo_purge' order by at desc limit 1`, [e.org]))?.data;
};

describe("the purge goes on past a row it cannot put back", () => {
  it("a real membership demo work removed and an administrator added again: the live one stays, the purge ends", async () => {
    const e = await engineOrg();
    const sys = await systemCtx(e.cfg, e.org);
    await packOf(e);
    await persona(e, "manager");
    const group = (await e.owner.post(`/o/${e.org}/r/group`, { name: "گروه واقعی شبکه", types: ["assignment"], active: true })).row.id;
    const real = await e.member("member", "real-member@bank.example");
    const first = (await e.owner.post(`/o/${e.org}/r/group_member`, { group_id: group, user_id: real.userId, kind: "member" })).row.id;
    // demo work (a demo person's request runs in the scope) removes the real membership …
    await inDemoScope(e.org, () => sys.write((tx) => removeIn(tx, sys, "group_member", first)));
    // … and a real administrator adds the person back
    const again = (await e.owner.post(`/o/${e.org}/r/group_member`, { group_id: group, user_id: real.userId, kind: "member" })).row.id;
    expect(again).not.toBe(first);
    // demo work deletes a real form for good, and a real person makes another with the same (unique) name
    const formId = (await e.owner.post(`/o/${e.org}/forms`, { name: "فرم مرخصی", layout: { tabs: [] } }, 201)).form.id;
    await inDemoScope(e.org, () => sys.write((tx) => tx.query(`delete from sm_forms where id = $1`, [formId])));
    const sameName = (await e.owner.post(`/o/${e.org}/forms`, { name: "فرم مرخصی", layout: { tabs: [] } }, 201)).form.id;

    const report = await purge(e);
    // the purge ended (before 1.1.5 it failed on every attempt with «duplicate key … sm_group_members_group_id_user_id_uk»)
    expect(await e.db.one(`select 1 as x from sm_demo_packs where org_id = $1`, [e.org])).toBeNull();
    expect(report).toBeTruthy();
    // the live membership stays, the old one stays removed
    const rows = await e.db.query<{ id: string; deleted_at: string | null }>(`select id::text as id, deleted_at from sm_group_members where org_id = $1 and group_id = $2 and user_id = $3`, [e.org, group, real.userId]);
    expect(rows.find((r) => r.id === again)?.deleted_at ?? null).toBeNull();
    expect(rows.find((r) => r.id === first)?.deleted_at).toBeTruthy();
    // the form made again keeps its name; the deleted one is not written back over it
    expect(await e.db.one(`select 1 as x from sm_forms where id = $1 and deleted_at is null`, [sameName])).toBeTruthy();
    expect(await e.db.one(`select 1 as x from sm_forms where id = $1`, [formId])).toBeNull();
    // both are reported as conflicts (counts only)
    expect(report!.left_real).toEqual(expect.arrayContaining([expect.objectContaining({ table: "sm_group_members", reason: "conflict", rows: 1 }), expect.objectContaining({ table: "sm_forms", reason: "conflict", rows: 1 })]));
  }, 600_000);
});

describe("real data built on top of the simulated pack (refsweep)", () => {
  let e: EngineOrg;
  let sys: Ctx;
  let demoGroup: string;
  let demoPerson: string;
  let demoIncident: string;
  let realIncident: string;
  let realTask: string;
  let removed: Set<string>;

  beforeAll(async () => {
    e = await engineOrg();
    sys = await systemCtx(e.cfg, e.org);
    await packOf(e);
    demoPerson = await persona(e, "agent");
    ({ demoGroup, demoIncident } = await inDemoScope(e.org, () =>
      sys.write(async (tx) => {
        const g = await createIn(tx, sys, "group", { name: "گروه نمایشی خودپرداز", types: ["assignment"], active: true }, { trusted: true });
        const i = await createIn(tx, sys, "incident", { short_description: "رخداد نمایشی" }, { trusted: true });
        return { demoGroup: String(g.id), demoIncident: String(i.id) };
      }),
    ));
    // the owner builds real things on top of it
    await e.owner.post(`/o/${e.org}/r/business_rule`, {
      name: "خودپردازها به گروه خودپرداز", table_key: "incident", timing: "before", events: ["insert", "update"],
      actions: [{ type: "set", field: "assignment_group_id", value: demoGroup }],
    });
    await e.owner.post(`/o/${e.org}/r/custom_field`, { table_key: "incident", name: "u_contact_person", label: "فرد رابط", type: "user" });
    realIncident = (await e.owner.post(`/o/${e.org}/r/incident`, { short_description: "رخداد واقعی با فرد رابط نمایشی", u_contact_person: demoPerson })).row.id;
    realTask = (await e.owner.post(`/o/${e.org}/r/incident_task`, { short_description: "کار واقعی زیر رخداد نمایشی", incident_id: demoIncident })).row.id;
    expect((await e.db.one<{ g: string | null }>(`select assignment_group_id::text as g from sm_incidents where id = $1`, [realIncident]))?.g).toBe(demoGroup);
    const before = await allIds(e);
    await purge(e);
    const after = await allIds(e);
    removed = new Set([...before].filter((id) => !after.has(id)));
  }, 900_000);

  it("a real business rule that set a demo group no longer refuses every write (its action went, the rule is off)", async () => {
    const made = await e.owner.post(`/o/${e.org}/r/incident`, { short_description: "رخداد واقعی پس از حذف" });
    expect(made.row.assignment_group_id ?? null).toBeNull();
    const rule = await e.db.one<{ actions: unknown[]; active: boolean }>(`select actions, active from sm_business_rules where org_id = $1 and name = 'خودپردازها به گروه خودپرداز'`, [e.org]);
    expect(rule?.actions).toEqual([]);
    expect(rule?.active).toBe(false);
    // its owner is told what to review
    expect(await e.db.one(`select 1 as x from sm_audit where org_id = $1 and action = 'demo_purge_review' and entity = 'business_rule'`, [e.org])).toBeTruthy();
  });

  it("a real custom user field no longer names the purged person", async () => {
    const row = await e.db.one<{ c: Record<string, unknown> }>(`select custom as c from sm_incidents where id = $1`, [realIncident]);
    expect(row?.c?.u_contact_person ?? null).toBeNull();
    // the incident kept its routing pointer to the demo group cleared too (it was set by the rule)
    expect((await e.db.one<{ g: string | null }>(`select assignment_group_id::text as g from sm_incidents where id = $1`, [realIncident]))?.g ?? null).toBeNull();
  });

  it("a real task recorded on a demo incident went with it", async () => {
    expect(await e.db.one(`select 1 as x from sm_incident_tasks where id = $1`, [realTask])).toBeNull();
  });

  it("nothing names a removed row", async () => {
    expect(await danglingRefs(e.db, e.org, removed)).toEqual([]);
  });
});
