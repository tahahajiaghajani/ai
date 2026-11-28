// The purge never makes a real record «global» under domain separation (Kariz 1.1.5 review,
// purge-editions-domain-null-global). The anchors phase gives a kept row whose domain went with the pack the nearest
// kept domain above it; when there is none — the owner marked the pack's own bank, a top-level unit, «دامنهٔ جداگانه»
// to try separation on the demo data — it wrote NULL, and a NULL domain is readable in every domain: members of the
// organisation's other domains with domain-scope roles read the record afterwards. Now such a record is recorded on
// demo data while domains are separated (as one in a workspace that goes with the pack): listed in the preview under
// «ثبت‌شده روی دادهٔ نمایشی» and removed with the pack; without separation a NULL domain widens nothing and the record
// stays, its domain cleared; under a kept domain it moves up to that domain (as before).
import { describe, it, expect } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { create, createIn, systemCtx } from "@server/engine";
import { inDemoScope } from "@server/db/scope";
import { memberCtx, readableIds } from "@server/access";
import { runToEnd } from "@server/modules/demo";
import { danglingRefs } from "@server/modules/demo/verify";
import { uuidv7 } from "@shared/id";

async function world(separation: boolean) {
  const e: EngineOrg = await engineOrg();
  const P = `/o/${e.org}`;
  const sys = await systemCtx(e.cfg, e.org);
  await e.db.query(
    `insert into sm_demo_packs (org_id, state, size, progress, counters, started_by) values ($1, 'loaded', 'small', jsonb_build_object('saved_at', now(), 'computed', '[]'::jsonb, 'seeds_done', true, 'saved', true), '{}'::jsonb, $2)`,
    [e.org, e.ownerId],
  );
  const unit = (name: string, parent: string | null, extra: Record<string, unknown> = {}) => sys.write(async (tx) => String((await createIn(tx, sys, "org_unit", { name, parent_id: parent, ...extra }, { trusted: true })).id));
  // the organisation's own company, and the pack's bank (top-level: the pack's root has no parent) with a branch,
  // which the owner marked as a separate domain
  const real = await unit("شرکت واقعی", null, { kind: "company", is_domain: true });
  const bank = await inDemoScope(e.org, () => unit("بانک نمونهٔ آفتاب", null, { kind: "company", is_domain: true }));
  const branch = await inDemoScope(e.org, () => unit("شعبهٔ مرکزی", bank));
  // a kept domain above a pack domain: a real holding with a pack subsidiary marked as a domain
  const holding = await unit("هلدینگ واقعی", null, { kind: "company", is_domain: true });
  const sub = await inDemoScope(e.org, () => unit("شرکت تابعهٔ نمایشی", holding, { kind: "company", is_domain: true }));
  if (separation) await e.owner.put(`${P}/access/settings`, { domain_separation: true });
  // a domain-scope reader of the organisation's own company: every incident of its domain (and the global ones)
  await e.owner.put(`${P}/access/roles/incident_reader`, { name: "خوانندهٔ رخدادها", persona: "agent", grants: { incident: { read: "all" } }, field_groups: [], contains: [], workspaces: "member", domains: "own" });
  const reader = await e.member("member", `reader-${uuidv7().slice(-6)}@example.com`);
  await e.owner.put(`${P}/access/members/${reader.userId}`, { roles: ["incident_reader"], persona: "agent", org_unit_id: real });
  // real employees placed in the pack's branch and in the pack's subsidiary file real incidents
  const placed = await e.member("member", `placed-${uuidv7().slice(-6)}@example.com`);
  await e.owner.put(`${P}/access/members/${placed.userId}`, { roles: ["requester"], persona: "requester", org_unit_id: branch });
  const moved = await e.member("member", `moved-${uuidv7().slice(-6)}@example.com`);
  await e.owner.put(`${P}/access/members/${moved.userId}`, { roles: ["requester"], persona: "requester", org_unit_id: sub });
  const inc = String((await create(sys, "incident", { short_description: "چاپگر شعبه کار نمی‌کند", caller_id: placed.userId }, { trusted: true })).row.id);
  const up = String((await create(sys, "incident", { short_description: "نامهٔ شرکت تابعه", caller_id: moved.userId }, { trusted: true })).row.id);
  const anchors = (id: string) => e.db.one<{ unit_id: string | null; domain_id: string | null }>(`select unit_id, domain_id from sm_incidents where id = $1`, [id]);
  expect(await anchors(inc)).toEqual({ unit_id: branch, domain_id: bank });
  expect(await anchors(up)).toMatchObject({ domain_id: sub });
  const reads = async (id: string) => (await readableIds(await memberCtx(e.cfg, e.org, reader.userId), "incident", [id])).has(id);
  const removed: string[] = [];
  const purge = async () => {
    removed.push(...(await e.db.query<{ id: string }>(`select row_id::text as id from sm_demo_rows where org_id = $1`, [e.org])).map((r) => r.id));
    await e.db.query(`update sm_sessions set reauth_at = now() where user_id = $1`, [e.ownerId]);
    await e.owner.post(`${P}/demo/purge`, { confirm: "حذف کامل" });
    await runToEnd(e.cfg, e.org, "purge", { budgetMs: 300_000 });
    expect(await e.db.one(`select 1 as x from sm_demo_packs where org_id = $1`, [e.org])).toBeNull();
  };
  return { e, P, inc, up, holding, anchors, reads, purge, removed };
}

describe("the purge and a real record in a domain that goes with the pack", () => {
  it("under domain separation: removed with the pack (never made global), listed beforehand; under a kept domain it moves up", async () => {
    const w = await world(true);
    // the other company's reader does not read the pack domain's incident
    expect(await w.reads(w.inc)).toBe(false);
    const preview = await w.e.owner.get(`${w.P}/demo/report`);
    expect((preview.deleted as { table: string; rows: number }[]).find((d) => d.table === "incident")?.rows).toBe(1);
    await w.purge();
    // gone with the pack: nobody of another domain reads it
    expect(await w.e.db.one(`select 1 as x from sm_incidents where id = $1`, [w.inc])).toBeNull();
    expect(await w.reads(w.inc)).toBe(false);
    // a kept domain above: the record stays and moves up to it
    expect(await w.anchors(w.up)).toEqual({ unit_id: null, domain_id: w.holding });
    expect(await danglingRefs(w.e.db, w.e.org, w.removed)).toEqual([]);
  }, 600_000);

  it("without domain separation a domain widens nothing: the record stays, its domain cleared", async () => {
    const w = await world(false);
    await w.purge();
    expect(await w.anchors(w.inc)).toEqual({ unit_id: null, domain_id: null });
    expect(await danglingRefs(w.e.db, w.e.org, w.removed)).toEqual([]);
  }, 600_000);
});
