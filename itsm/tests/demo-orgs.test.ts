// Two organisations of one server (the web version, a server edition with several organisations) each load the demo
// pack. The pack's addresses carry the organisation's mark (`agent.<mark>@aftab-bank.example`, unique accounts): it was
// the first six digits of the organisation's id — a uuidv7, whose first digits are its creation time — so every
// organisation made within the same few hours asked for the first one's addresses, and its load failed on the unique
// address. The console lists the personas with the addresses the load stored, so a pack loaded by an earlier version
// keeps signing in with the addresses it has. And the load never takes over an account that is not its own when an
// address is taken: not another organisation's live persona, nor one of the organisation's own people (1.1.5) — it takes
// the next address; an account an earlier purge kept for another organisation is still the pack's again.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { Client, signupWithOrg } from "./helpers";
import { systemCtx } from "@server/engine";
import { tick } from "@server/jobs";
import { inDemoScope } from "@server/db/scope";
import { demoStatus } from "@server/modules/demo";
import { addPerson, newMemo, STEPS, type LoadMemo } from "@server/modules/demo/load";
import { uuidv7 } from "@shared/id";

let e: EngineOrg;
let org2: string;
const memos: Record<string, LoadMemo> = {};

async function load(org: string) {
  for (let i = 0; i < 30; i++) {
    await e.db.query(`update sm_jobs set run_at = now() where org_id = $1 and status in ('queued', 'running') and (kind like '%seed%' or kind like '%install%')`, [org]);
    const r = await tick(e.cfg, { budgetMs: 60_000 });
    if (!r.ran && !r.more) break;
  }
  const sys = await systemCtx(e.cfg, org);
  const memo = (memos[org] = newMemo("small"));
  for (const key of ["org", "groups", "people"]) {
    const s = STEPS.find((x) => x.key === key)!;
    for (let i = 0; i < 50 && !(await inDemoScope(org, () => s.run({ cfg: e.cfg, orgId: org, memo, deadline: Date.now() + 600_000 }, sys))); i++);
  }
  await e.db.query(
    `insert into sm_demo_packs (org_id, state, size, progress, counters, loaded_at) values ($1, 'loaded', 'small', jsonb_build_object('memo', $2::jsonb, 'seeds_done', true), '{}'::jsonb, now())`,
    [org, JSON.stringify(memo)],
  );
}

beforeAll(async () => {
  e = await engineOrg();
  org2 = await signupWithOrg(new Client(e.app), { email: "second-bank@example.com", timezone: "Asia/Tehran" });
  await load(e.org);
  await load(org2);
}, 900_000);

describe("two organisations of one server each load the demo pack", () => {
  it("each with its own personas and addresses", async () => {
    // (made a moment apart: their ids' first digits, the time, are the same)
    expect(org2.replace(/-/g, "").slice(0, 6)).toBe(e.org.replace(/-/g, "").slice(0, 6));
    const people = async (org: string) => (await e.db.query<{ email: string }>(`select email from sm_users where prefs ->> 'demo_org' = $1 order by email`, [org])).map((r) => r.email);
    const a = await people(e.org);
    const b = await people(org2);
    expect(a.length).toBeGreaterThan(100);
    expect(b.length).toBe(a.length);
    expect(b.filter((x) => a.includes(x))).toEqual([]);
    for (const org of [e.org, org2]) {
      for (const [persona, id] of Object.entries(memos[org].people.personas)) {
        const row = await e.db.one<{ email: string; member: boolean }>(
          `select u.email, exists (select 1 from sm_org_members m where m.org_id = $2 and m.user_id = u.id) as member from sm_users u where u.id = $1`, [id, org]);
        expect(row!.email.startsWith(`${persona}.`)).toBe(true);
        expect(row!.member).toBe(true);
      }
    }
  });

  it("the console lists the addresses the load stored, an earlier version's too", async () => {
    // a pack loaded by 1.1.4 kept the addresses it was given then
    const old = `agent.${org2.replace(/-/g, "").slice(0, 6)}x@aftab-bank.example`;
    await e.db.query(`update sm_users set email = $2 where id = $1`, [memos[org2].people.personas.agent, old]);
    for (const org of [e.org, org2]) {
      const status = await demoStatus(e.db, org);
      expect(status.accounts?.length).toBe(16);
      for (const a of status.accounts ?? []) {
        const id = memos[org].people.personas[a.persona as keyof LoadMemo["people"]["personas"]];
        expect(a.email, a.persona).toBe((await e.db.one<{ email: string }>(`select email from sm_users where id = $1`, [id]))!.email);
      }
    }
    expect((await demoStatus(e.db, org2)).accounts?.find((a) => a.persona === "agent")?.email).toBe(old);
  });
});

describe("an address already taken", () => {
  it("never takes over another organisation's live persona or one of the organisation's own people: the next address", async () => {
    const sys = await systemCtx(e.cfg, org2);
    const tag = uuidv7().slice(-8);
    const at = (local: string, n?: number) => `${local}.${tag}${n ? `.${n}` : ""}@aftab-bank.example`;
    const account = async (email: string, prefs: Record<string, unknown>, memberOf: string | null) => {
      const id = uuidv7();
      await e.db.query(`insert into sm_users (id, email, full_name, password_hash, prefs) values ($1, $2, 'حساب پیشین', 'hash-before', $3::jsonb)`, [id, email, JSON.stringify(prefs)]);
      if (memberOf) await e.db.query(`insert into sm_org_members (id, org_id, user_id, role, title, origin) values ($1, $2, $3, 'member', 'کارشناس', 'cloud')`, [uuidv7(), memberOf, id]);
      return id;
    };
    const add = (email: string) =>
      inDemoScope(org2, () => sys.write((tx) => addPerson(tx, sys, org2, { email, name: "فرد نمایشی", title: "کارشناس", roles: ["agent"], hash: "hash-of-the-pack" })));
    const user = (id: string) => e.db.one<{ email: string; hash: string | null; prefs: Record<string, unknown> }>(`select email, password_hash as hash, prefs from sm_users where id = $1`, [id]);
    const memberHere = async (id: string) => !!(await e.db.one(`select 1 as x from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is null`, [org2, id]));
    const pack = async (id: string) => !!(await e.db.one(`select 1 as x from sm_demo_rows where org_id = $1 and row_id = $2`, [org2, id]));

    // the first organisation's live persona has the address (the 1.1.4 address tag made such clashes likely)
    const theirs = await account(at("agent"), { demo_org: e.org }, e.org);
    const a = await add(at("agent"));
    expect(a).not.toBe(theirs);
    expect((await user(a))?.email).toBe(at("agent", 2));
    expect(await user(theirs)).toMatchObject({ email: at("agent"), hash: "hash-before", prefs: { demo_org: e.org } });
    expect(await memberHere(theirs)).toBe(false);

    // a former persona an administrator added back as one of the organisation's own members
    const own = await account(at("manager"), {}, org2);
    const b = await add(at("manager"));
    expect(b).not.toBe(own);
    expect((await user(b))?.email).toBe(at("manager", 2));
    expect(await user(own)).toMatchObject({ hash: "hash-before", prefs: {} });
    expect(await pack(own)).toBe(false);
    expect(await memberHere(own)).toBe(true);

    // an account an earlier purge of this organisation kept because it belongs to another organisation is the pack's again
    const kept = await account(at("soc"), {}, e.org);
    expect(await add(at("soc"))).toBe(kept);
    expect(await user(kept)).toMatchObject({ email: at("soc"), hash: "hash-of-the-pack", prefs: { demo_org: org2 } });
    expect(await pack(kept)).toBe(true);
    // and the pack's own account (a step run again) is its own
    expect(await add(at("agent", 2))).toBe(a);
  }, 120_000);
});
