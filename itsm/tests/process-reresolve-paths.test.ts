// Release 1.1.5 — a workflow step that waits with nobody is looked for again whichever path gives it its person. The
// record engine's watch (holders, positions, groups, group members, roles, profiles) and the members page already
// queued the organisation's `process.reresolve`; a membership has no record event, so every other path that switches
// one on, brings one back or gives it another role queues it too: a Windows app's push of the membership, the
// directory (LDAP/AD synchronisation's apply step, SCIM provisioning), the members' import and a member added on the
// members page. Holder imports (the positions page's file, the generic record import) go through the engine. Each
// queues the same single job (its dedupe key), a quiet half minute later and only while some case waits, and the
// step then reaches the person.
import { describe, it, expect, beforeAll } from "vitest";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";
import { emptyPlan } from "@shared/integration/directory";
import { createIn } from "@server/engine";
import { applyPlan } from "@server/modules/integration/directory";
import { RERESOLVE_JOB } from "@server/modules/process/reresolve";
import { BY_ENTITY } from "@server/sync/registry";
import { readAggregates } from "@server/sync/apply";
import { edge, node, person, publish, start, tasks, world, type World } from "./process-engine-helpers";

let w: World;
let P = "";
let unit = "";
let mgr = "";
let req = "";
const values = { u_amount: "100" };
const rights = (fields: Record<string, string>, dflt = "read") => ({ default: dflt, fields });

/** start → «a» (every holder of `position`, wherever) → end. */
const line = (position: string, label: string) =>
  ({
    nodes: [
      node("t", "trigger"),
      node("s", "form_step", { action: "fill", start: true, form: w.forms.req, rights: rights({}, "edit") }, "ثبت درخواست"),
      node("a", "form_step", { action: "fill", form: w.forms.review, rights: rights({ u_finance_note: "edit" }), assignees: [{ kind: "position", position, where: "anywhere" }] }, label),
      node("ok", "end", { outcome: "completed" }),
    ],
    edges: [edge("t", "s"), edge("s", "a"), edge("a", "ok")],
  }) as any;

const openAt = async (id: string) => (await tasks(w, id)).filter((t) => t.step_key === "a" && t.status === "open").map((t) => t.assigned_to).sort();
const queued = () =>
  w.o.db.query<{ later: boolean }>(`select run_at > now() + interval '20 seconds' as later from sm_jobs where org_id = $1 and kind = $2 and status = 'queued'`, [w.o.org, RERESOLVE_JOB]);
const forget = () => w.o.db.query(`delete from sm_jobs where org_id = $1 and kind = $2`, [w.o.org, RERESOLVE_JOB]);
/** The organisation's re-resolution brought forward and run. */
async function run() {
  await w.o.db.query(`update sm_jobs set run_at = now() where org_id = $1 and kind = $2 and status = 'queued'`, [w.o.org, RERESOLVE_JOB]);
  await w.k.drain();
}
const emailOf = async (user: string) => (await w.o.db.one<{ email: string }>(`select email from sm_users where id = $1`, [user]))!.email;
const membershipOf = async (user: string) => (await w.o.db.one<{ id: string }>(`select id::text as id from sm_org_members where org_id = $1 and user_id = $2`, [w.o.org, user]))!.id;

let n = 0;
/**
 * A case whose step «a» waits with nobody: its position's only holder is switched off («off»), has left the
 * organisation («gone») or there is no holder yet («none»). The queue is emptied, so what queues it next is the path.
 */
async function waiting(how: "off" | "gone" | "none") {
  const key = `path_${++n}_${uuidv7().slice(-4)}`;
  const label = `مرحلهٔ مسیر ${n}`;
  await w.sys.write((tx) => createIn(tx, w.sys, "position", { key, name: `نقش مسیر ${n}` }, { trusted: true }));
  const holder = await person(w, `دارندهٔ مسیر ${n}`, { unit });
  if (how !== "none") {
    const position = (await w.o.db.one<{ id: string }>(`select id from sm_positions where org_id = $1 and key = $2`, [w.o.org, key]))!.id;
    await w.sys.write((tx) => createIn(tx, w.sys, "position_holder", { position_id: position, user_id: holder, org_unit_id: unit, kind: "primary" }, { trusted: true }));
  }
  if (how === "off") await w.o.db.query(`update sm_org_members set is_active = false where org_id = $1 and user_id = $2`, [w.o.org, holder]);
  if (how === "gone") await w.o.db.query(`update sm_org_members set is_active = false, deleted_at = now() where org_id = $1 and user_id = $2`, [w.o.org, holder]);
  const p = await publish(w, line(key, label), { managers: [mgr] });
  const id = (await start(w, req, p, { values })).case!;
  await w.k.drain();
  expect(await openAt(id)).toEqual([]);
  await forget();
  return { id, holder, key };
}

/** A Windows app's push of rows (`base`: the revision it last pulled). */
async function push(rows: { entity: string; row: Record<string, unknown>; base: number }[]) {
  const out = await w.o.owner.post(`/sync/push`, {
    org_id: w.o.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL,
    aggregates: rows.map((r) => ({ entity: r.entity, id: r.row.id, base_rev: r.base, row: r.row })),
  });
  return out.results as { status: string; message?: string }[];
}
/** The membership of `user` exactly as a pull hands it to a Windows app. */
async function pulledMembership(user: string) {
  const [agg] = await readAggregates(w.o.db, BY_ENTITY.get("member")!, [await membershipOf(user)]);
  return { row: agg.row, base: agg.base_rev };
}

beforeAll(async () => {
  w = await world();
  P = w.P;
  // the workflows' notices are seeded by a delayed job (a day-old organisation has them)
  await w.o.db.query(`update sm_jobs set run_at = now() where org_id = $1 and kind = 'process.seed' and status = 'queued'`, [w.o.org]);
  await w.k.drain();
  unit = String((await w.sys.write((tx) => createIn(tx, w.sys, "org_unit", { name: "ادارهٔ مسیرها", kind: "department" }, { trusted: true }))).id);
  mgr = await person(w, "مسئول گردش‌کار مسیرها");
  req = await person(w, "درخواست‌دهندهٔ مسیرها", { unit });
}, 600_000);

describe("a Windows app's push of a membership", () => {
  it("switched on again: queued once, a quiet half minute later, and the step reaches the holder", async () => {
    const c = await waiting("off");
    const m = await pulledMembership(c.holder);
    expect(await push([{ entity: "member", row: { ...m.row, is_active: true, updated_at: new Date().toISOString() }, base: m.base }])).toEqual([expect.objectContaining({ status: "ok" })]);
    expect(await queued()).toEqual([{ later: true }]);
    await run();
    expect(await openAt(c.id)).toEqual([c.holder]);
  });

  it("another role queues it as well; a push that changes neither (the title) does not", async () => {
    await waiting("none");
    const other = await person(w, "کارمند با عنوان تازه", { unit });
    const t = await pulledMembership(other);
    expect(await push([{ entity: "member", row: { ...t.row, title: "کارشناس ارشد", updated_at: new Date().toISOString() }, base: t.base }])).toEqual([expect.objectContaining({ status: "ok" })]);
    expect(await queued()).toEqual([]);
    const r = await pulledMembership(other);
    expect(await push([{ entity: "member", row: { ...r.row, role: "viewer", updated_at: new Date().toISOString() }, base: r.base }])).toEqual([expect.objectContaining({ status: "ok" })]);
    expect(await queued()).toEqual([{ later: true }]);
  });
});

describe("the directory", () => {
  it("LDAP/AD synchronisation switching a member on again (its apply step, as a manual apply and the periodic sync run it)", async () => {
    const c = await waiting("off");
    const src = (
      await w.o.owner.post(`${P}/r/directory_source`, {
        name: "اکتیو دایرکتوری مسیرها", kind: "ldap", mode: "apply", ldap_url: "ldaps://dc.corp.example:636", bind_dn: "CN=svc,DC=corp,DC=ir", bind_password: "pw", base_dn: "DC=corp,DC=ir",
      })
    ).row;
    const plan = { ...emptyPlan(), reactivate: [{ user_id: c.holder, email: await emailOf(c.holder), name: "دارنده", reason: "در فهرست کاربران دوباره فعال است" }] };
    const r = await applyPlan(await w.o.ctxOf(w.o.ownerId), src, plan, false);
    expect(r.reactivated).toBe(1);
    expect(await queued()).toEqual([{ later: true }]);
    await run();
    expect(await openAt(c.id)).toEqual([c.holder]);
  });

  it("SCIM switching a member on again, and bringing back one who had left", async () => {
    await w.o.owner.put(`/admin/orgs/${w.o.org}/plan`, { plan: "enterprise" });
    const src = (await w.o.owner.post(`${P}/r/directory_source`, { name: "Entra ID مسیرها", kind: "scim", mode: "preview" })).row;
    const token = (await w.o.owner.post(`${P}/integration/secret`, { table: "directory_source", id: src.id })).secret;
    await w.o.owner.post(`${P}/integration/directory/${src.id}/approve`);
    const cur = await w.o.owner.get(`${P}/r/directory_source/${src.id}`);
    await w.o.owner.patch(`${P}/r/directory_source/${src.id}`, { mode: "apply", version: cur.row.version });
    const scim = (method: string, path: string, body: unknown) =>
      w.o.app.fetch(new Request(`http://local.test/api/v1/scim/${src.id}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/scim+json" }, body: JSON.stringify(body) }));
    const off = await waiting("off");
    const on = await scim("PATCH", `/Users/${off.holder}`, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "replace", path: "active", value: true }] });
    expect(on.status).toBe(200);
    expect(await queued()).toEqual([{ later: true }]);
    await run();
    expect(await openAt(off.id)).toEqual([off.holder]);
    // a person who left comes back through the provider's «create»
    const gone = await waiting("gone");
    const email = await emailOf(gone.holder);
    const back = await scim("POST", "/Users", { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], userName: email, externalId: `aad-${n}`, displayName: "دارندهٔ بازگشته", emails: [{ value: email, primary: true }], active: true });
    expect(back.status).toBe(201);
    expect(await queued()).toEqual([{ later: true }]);
    await run();
    expect(await openAt(gone.id)).toEqual([gone.holder]);
  });
});

describe("imports and the members page", () => {
  it("the members' import bringing back members who had left: one job for the whole file", async () => {
    const a = await waiting("gone");
    const b = await waiting("gone");
    const rows = [
      { email: await emailOf(a.holder), name: "دارندهٔ بازگشتهٔ یکم" },
      { email: await emailOf(b.holder), name: "دارندهٔ بازگشتهٔ دوم" },
    ];
    const r = await w.o.owner.post(`${P}/admin/members/import`, { rows, dry_run: false, membership_role: "member" });
    expect(r.created).toBe(2);
    expect(await queued()).toEqual([{ later: true }]);
    await run();
    expect([await openAt(a.id), await openAt(b.id)]).toEqual([[a.holder], [b.holder]]);
  });

  it("a member the members page adds back", async () => {
    const c = await waiting("gone");
    await w.o.owner.post(`${P}/members`, { email: await emailOf(c.holder), full_name: "دارندهٔ بازگشته", role: "member" });
    expect(await queued()).toEqual([{ later: true }]);
    await run();
    expect(await openAt(c.id)).toEqual([c.holder]);
  });

  it("the positions page's holder import and the generic record import (the record engine's watch)", async () => {
    const c = await waiting("none");
    const done = await w.o.owner.post(`${P}/positions/holders/import`, { rows: [{ "نقش سازمانی": c.key, "ایمیل": await emailOf(c.holder) }], dry_run: false });
    expect(done).toMatchObject({ created: 1, errors: [] });
    await w.k.drain();
    expect(await queued()).toEqual([{ later: true }]);
    await run();
    expect(await openAt(c.id)).toEqual([c.holder]);
    const d = await waiting("none");
    const position = (await w.o.db.one<{ id: string }>(`select id from sm_positions where org_id = $1 and key = $2`, [w.o.org, d.key]))!.id;
    const imported = await w.o.owner.post(`${P}/r/position_holder/import`, { rows: [{ position_id: position, user_id: d.holder, org_unit_id: unit, kind: "primary" }] });
    expect(imported).toMatchObject({ created: 1 });
    await w.k.drain();
    expect(await queued()).toEqual([{ later: true }]);
    await run();
    expect(await openAt(d.id)).toEqual([d.holder]);
  });

  it("nothing is queued while no case waits", async () => {
    const waitingNow = (await w.o.db.query<{ id: string }>(`select id::text as id from sm_process_cases where org_id = $1 and state = 'waiting'`, [w.o.org])).map((r) => r.id);
    await w.o.db.query(`update sm_process_cases set state = 'active' where id = any($1::uuid[])`, [`{${waitingNow.join(",")}}`]);
    try {
      const x = await person(w, "عضو بی‌پرونده", { unit });
      await w.o.db.query(`update sm_org_members set is_active = false where org_id = $1 and user_id = $2`, [w.o.org, x]);
      const m = await pulledMembership(x);
      expect(await push([{ entity: "member", row: { ...m.row, is_active: true, updated_at: new Date().toISOString() }, base: m.base }])).toEqual([expect.objectContaining({ status: "ok" })]);
      expect(await queued()).toEqual([]);
    } finally {
      await w.o.db.query(`update sm_process_cases set state = 'waiting' where id = any($1::uuid[])`, [`{${waitingNow.join(",")}}`]);
    }
  });
});
