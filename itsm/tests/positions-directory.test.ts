// F3 — Active Directory group mappings to organisational roles (design F D11, docs/AD_FA.md §4), end to end against
// the fake domain controller: a mapping's `position_id` makes the group's members holders of that position, in the
// unit its `unit_from` names (the department's unit by name or code, a fixed unit, or the person's unit as the
// directory sets it), as rows the source keeps («فهرست کاربران (AD)»).
//   · never silently: at sign-in only while the mappings are the approved ones with automatic roles on (else listed as
//     pending «position:<id>»), in an «اعمال» only with roles confirmed, in a scheduled run only for approved mappings;
//   · taken back when the person leaves the group (at sign-in and in the synchronisation, no confirmation needed) —
//     only the source's own rows: a manual holder is never doubled nor removed;
//   · a holding that cannot be kept (a unit of another kind) is a problem in the sign-in log, never an error.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adWorld, AGENTS, GROUPS, type AdWorld } from "./auth-ad-helpers";
import { group, person, serviceAccount } from "./ldap-fake";
import { quietLog } from "./helpers";
import { enqueue, tick } from "@server/jobs";
import { mappingFingerprint } from "@server/modules/integration/directory-login";
import type { ServerConfig } from "@server/context";
import { createHash } from "node:crypto";

const HEADS = `CN=Kariz-Branch-Heads,${GROUPS}`;
const CREDIT = `CN=Kariz-Credit,${GROUPS}`;
const TELLERS = `CN=Kariz-Tellers,${GROUPS}`;

const people = {
  ali: person("ali", { name: "Ali Rezaei", extra: { department: ["1001"] } }),
  sara: person("sara", { name: "Sara Ahmadi", extra: { department: ["شعبهٔ تجریش"] } }),
  reza: person("reza", { name: "Reza Karimi" }),
  mina: person("mina", { name: "Mina Moradi", extra: { department: ["ادارهٔ مالی"] } }),
  nima: person("nima", { name: "Nima Jafari", extra: { department: ["1002"] } }),
};

let w: AdWorld;
const U: Record<string, string> = {};
const POS: Record<string, string> = {};

const memberOf = (dn: string) => w.dc.entries.find((x) => x.dn === dn)!.attrs;
const leave = (groupDn: string, who: { dn: string }) => {
  memberOf(groupDn).member = memberOf(groupDn).member.filter((m) => m !== who.dn);
};
const join = (groupDn: string, who: { dn: string }) => {
  memberOf(groupDn).member = [...new Set([...memberOf(groupDn).member, who.dn])];
};

/** A person's holders: position key, unit, source (and whether this source keeps it). */
async function holders(email: string): Promise<{ key: string; unit: string | null; source: string; ours: boolean }[]> {
  return w.db.query(
    `select p.key, h.org_unit_id as unit, h.source, coalesce(h.source_ref = $2, false) as ours from sm_position_holders h
     join sm_positions p on p.id = h.position_id join sm_users u on u.id = h.user_id
     where h.org_id = $3 and lower(u.email) = $1 and h.deleted_at is null order by p.key, h.org_unit_id`,
    [email, w.source.id, w.org],
  );
}

const lastSignIn = async (email: string) => (await w.owner.get(`${w.P}/auth/signins?${new URLSearchParams({ ok: "true", q: email })}`)).events[0] as { data: { pending_roles?: string[]; problems?: string[] } };
const mappings = () => [
  { source: AGENTS, role: "agent", group_id: w.team },
  { source: HEADS, position_id: POS.head, unit_from: "department" },
  { source: CREDIT, position_id: POS.officer, unit_from: U.vanak },
  { source: TELLERS, position_id: POS.teller, unit_id: U.tajrish },
];

beforeAll(async () => {
  w = await adWorld({
    entries: [
      serviceAccount(),
      ...Object.values(people),
      group("Kariz-Agents", []),
      group("Kariz-Branch-Heads", [people.ali.dn, people.sara.dn, people.mina.dn, people.nima.dn]),
      group("Kariz-Credit", [people.reza.dn]),
      group("Kariz-Tellers", [people.reza.dn]),
    ],
    // units are the organisation's own here: the directory names them, it does not make them
    source: { unit_from: "none" },
  });
  const R = `${w.P}/r`;
  U.vanak = (await w.owner.post(`${R}/org_unit`, { name: "شعبهٔ ونک", code: "1001", kind: "branch" })).row.id;
  U.tajrish = (await w.owner.post(`${R}/org_unit`, { name: "شعبهٔ تجریش", code: "1002", kind: "branch" })).row.id;
  U.finance = (await w.owner.post(`${R}/org_unit`, { name: "ادارهٔ مالی", code: "FIN", kind: "department" })).row.id;
  POS.head = (await w.owner.post(`${R}/position`, { key: "branch_head", name: "رئیس شعبه", unit_kind: "branch" })).row.id;
  POS.officer = (await w.owner.post(`${R}/position`, { key: "credit_officer", name: "کارشناس اعتبارات" })).row.id;
  POS.teller = (await w.owner.post(`${R}/position`, { key: "teller", name: "تحویلدار", unit_kind: "branch" })).row.id;
  // the administrator (the source's approver) maps the groups to organisational roles: the approval no longer covers them
  await w.owner.patch(`${R}/directory_source/${w.source.id}`, { group_map: mappings() });
}, 600_000);
afterAll(() => w.close());

describe("what an approval covers", () => {
  it("a source without organisational roles keeps its fingerprint; naming or moving one needs a new approval", () => {
    const src = { group_map: [{ source: AGENTS, role: "agent", group_id: "g1" }], default_role: "requester", auto_roles: true, membership_role: "viewer" };
    // the fingerprint as sources approved before organisational roles existed have it
    const before = createHash("sha256")
      .update(JSON.stringify({ m: [{ s: AGENTS.toLowerCase(), g: "g1", r: "agent", u: null, w: null }], d: "requester", a: true, ms: "viewer" }))
      .digest("hex")
      .slice(0, 32);
    expect(mappingFingerprint(src)).toBe(before);
    const withRole = { ...src, group_map: [...src.group_map, { source: HEADS, position_id: "P1", unit_from: "department" }] };
    expect(mappingFingerprint(withRole)).not.toBe(before);
    const moved = { ...src, group_map: [...src.group_map, { source: HEADS, position_id: "P1", unit_from: "u-2" }] };
    expect(mappingFingerprint(moved)).not.toBe(mappingFingerprint(withRole));
  });
});

describe("directory sign-in", () => {
  it("gives no holder while the mappings are not the approved ones — it lists them as pending", async () => {
    for (const login of ["ali", "sara"]) await w.signIn(login, "Passw0rd!");
    expect(await holders("ali@corp.test")).toEqual([]);
    expect((await lastSignIn("ali@corp.test")).data.pending_roles).toEqual([`position:${POS.head}`]);
    // meanwhile sara is made «رئیس شعبه» of Tajrish by hand: the directory must neither double nor take it
    const saraId = (await w.db.one<{ id: string }>(`select id from sm_users where lower(email) = 'sara@corp.test'`))!.id;
    await w.owner.post(`${w.P}/r/position_holder`, { position_id: POS.head, user_id: saraId, org_unit_id: U.tajrish });
  });

  it("once approved, keeps a holder in the unit each mapping names", async () => {
    await w.owner.post(`${w.P}/integration/directory/${w.source.id}/approve`);
    await w.signIn("ali", "Passw0rd!");
    // the department «1001» is Vanak's code
    expect(await holders("ali@corp.test")).toEqual([{ key: "branch_head", unit: U.vanak, source: "directory", ours: true }]);
    // reza: a fixed unit (Vanak), and the unit his mapped group gives him (Tajrish)
    await w.signIn("reza", "Passw0rd!");
    expect(await holders("reza@corp.test")).toEqual([
      { key: "credit_officer", unit: U.vanak, source: "directory", ours: true },
      { key: "teller", unit: U.tajrish, source: "directory", ours: true },
    ]);
    // sara (the department by its name) already holds it by hand: never doubled, still «دستی»
    await w.signIn("sara", "Passw0rd!");
    expect(await holders("sara@corp.test")).toEqual([{ key: "branch_head", unit: U.tajrish, source: "manual", ours: false }]);
    // mina's department is no branch: no holder, the reason in the sign-in log — the sign-in itself goes through
    await w.signIn("mina", "Passw0rd!");
    expect(await holders("mina@corp.test")).toEqual([]);
    expect((await lastSignIn("mina@corp.test")).data.problems).toEqual(["«ادارهٔ مالی» از نوع واحدهای «رئیس شعبه» نیست"]);
  });

  it("the administrator's tools show the mapping's organisational role", async () => {
    const t = await w.owner.post(`${w.P}/integration/directory/${w.source.id}/login-test`, { login: "ali" });
    expect(t.access.positions).toEqual([{ position_id: POS.head, unit_from: "department", source: HEADS }]);
    const m = await w.owner.get(`${w.P}/integration/directory/${w.source.id}/mappings`);
    expect(m.rows.find((r: { source: string }) => r.source === HEADS)).toMatchObject({ position_id: POS.head, unit_from: "department", found: true, members: 4 });
  });

  it("takes the directory's holder back when the person leaves the group; a manual one stays", async () => {
    const aliId = (await w.db.one<{ id: string }>(`select id from sm_users where lower(email) = 'ali@corp.test'`))!.id;
    await w.owner.post(`${w.P}/r/position_holder`, { position_id: POS.officer, user_id: aliId });
    leave(HEADS, people.ali);
    leave(HEADS, people.sara);
    await w.signIn("ali", "Passw0rd!");
    expect(await holders("ali@corp.test")).toEqual([{ key: "credit_officer", unit: null, source: "manual", ours: false }]);
    await w.signIn("sara", "Passw0rd!");
    expect(await holders("sara@corp.test")).toEqual([{ key: "branch_head", unit: U.tajrish, source: "manual", ours: false }]);
    join(HEADS, people.ali);
    join(HEADS, people.sara);
  });
});

describe("directory synchronisation", () => {
  it("previews the holdings; an «اعمال» gives them only with roles confirmed", async () => {
    // automatic roles off: an «اعمال» grants roles (and holdings) only when the administrator confirms them
    await w.owner.patch(`${w.P}/r/directory_source/${w.source.id}`, { auto_roles: false });
    const p = await w.owner.post(`${w.P}/integration/directory/${w.source.id}/preview`);
    expect(p.plan.position_adds).toContainEqual({ position_id: POS.head, user: "nima@corp.test", email: "nima@corp.test", unit_id: U.tajrish, source: HEADS });
    expect(p.plan.position_skipped).toContainEqual(expect.objectContaining({ email: "mina@corp.test", position_id: POS.head }));
    const r = await w.owner.post(`${w.P}/integration/directory/${w.source.id}/apply`, { run_id: p.run_id, roles: false });
    expect(r).toMatchObject({ positions_added: 0, positions_pending: p.plan.position_adds.length });
    expect(await holders("nima@corp.test")).toEqual([]);
    const p2 = await w.owner.post(`${w.P}/integration/directory/${w.source.id}/preview`);
    const r2 = await w.owner.post(`${w.P}/integration/directory/${w.source.id}/apply`, { run_id: p2.run_id, roles: true });
    expect(r2.positions_added).toBeGreaterThanOrEqual(1);
    expect(await holders("nima@corp.test")).toEqual([{ key: "branch_head", unit: U.tajrish, source: "directory", ours: true }]);
  });

  it("takes back the holdings of people who left the group without any confirmation — never a manual one", async () => {
    const nimaId = (await w.db.one<{ id: string }>(`select id from sm_users where lower(email) = 'nima@corp.test'`))!.id;
    await w.owner.post(`${w.P}/r/position_holder`, { position_id: POS.officer, user_id: nimaId });
    leave(HEADS, people.nima);
    const p = await w.owner.post(`${w.P}/integration/directory/${w.source.id}/preview`);
    expect(p.plan.position_removes).toEqual([{ position_id: POS.head, user: nimaId, email: "nima@corp.test", unit_id: U.tajrish }]);
    const r = await w.owner.post(`${w.P}/integration/directory/${w.source.id}/apply`, { run_id: p.run_id, roles: false });
    expect(r.positions_removed).toBe(1);
    expect(await holders("nima@corp.test")).toEqual([{ key: "credit_officer", unit: null, source: "manual", ours: false }]);
  });

  it("a scheduled run gives holdings only for the mappings an administrator approved", async () => {
    const cfg: ServerConfig = {
      mode: "cloud", db: w.db, secret: "test-secret", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog,
      fetch: globalThis.fetch.bind(globalThis), auth: { directoryLan: true },
    } as ServerConfig;
    // automatic roles back on, every 24 hours, and one more mapping — by the approver, so the approval stays but no
    // longer covers the mappings
    await w.owner.patch(`${w.P}/r/directory_source/${w.source.id}`, {
      auto_roles: true, schedule_hours: 24, group_map: [...mappings(), { source: `CN=Kariz-Credit-Deputies,${GROUPS}`, position_id: POS.officer, unit_from: U.tajrish }],
    });
    expect((await w.owner.get(`${w.P}/integration/directory/${w.source.id}/mappings`)).approved).toBe(false);
    join(HEADS, people.nima);
    const run = async () => {
      await enqueue(w.db, { kind: "integration.directory.sync", orgId: w.org, payload: { id: w.source.id }, maxAttempts: 1 });
      for (let i = 0; i < 5; i++) {
        await tick(cfg, { budgetMs: 30_000 });
        const left = await w.db.one(`select 1 from sm_jobs where org_id = $1 and kind = 'integration.directory.sync' and status in ('pending', 'running') and run_at <= now()`, [w.org]);
        if (!left) break;
      }
    };
    await run();
    const last = await w.db.one<{ status: string; stats: Record<string, number> }>(`select status, stats from sm_directory_runs where source_id = $1 and kind = 'apply' order by started_at desc limit 1`, [w.source.id]);
    expect(last?.status).toBe("done");
    expect(last?.stats.position_adds).toBeGreaterThanOrEqual(1);
    expect((await holders("nima@corp.test")).map((h) => h.key)).toEqual(["credit_officer"]);
    // approved: the next run gives it
    await w.owner.post(`${w.P}/integration/directory/${w.source.id}/approve`);
    await run();
    expect(await holders("nima@corp.test")).toEqual([
      { key: "branch_head", unit: U.tajrish, source: "directory", ours: true },
      { key: "credit_officer", unit: null, source: "manual", ours: false },
    ]);
  });
});
