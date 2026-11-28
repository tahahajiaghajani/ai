// A purge an earlier version started goes on with the names of what goes (Kariz 1.1.5 review,
// purge-editions-upgrade-midpurge-names). 1.1.5's expand phase reads, while the pack's rows still exist, the names its
// later phases ask (`progress.gone`: positions, library fields, table fields, emptied positions, the domains) — a 1.1.4
// purge stopped between its phases (expand, clear, remove, accounts, restore, finish; none wrote `gone`) went on with
// no names: a real form kept the pack's library field by name, and a purge already past 1.1.4's remove never ran the
// reroute and anchors phases at all — a real record kept a reference to the pack's removed account. Now a purge
// without `gone` reads the names while the rows are still there (at its clear or remove phase, then cleans the
// definitions first), and one past its remove clears the kept records' references from what the registry still names
// and writes a review line saying what could not be checked by name. The 1.1.4 state is set as it left it: a pack
// purging, its report, the registry, no `gone`.
import { describe, it, expect } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { createIn, systemCtx } from "@server/engine";
import { inDemoScope } from "@server/db/scope";
import { purgeStep } from "@server/modules/demo";
import { danglingRefs } from "@server/modules/demo/verify";
import { uuidv7 } from "@shared/id";

/** The report 1.1.4's expand phase stored (no buckets). */
const REPORT_114 = { tables: {}, rows: 0, derived: 0, accounts: { removed: 0, kept: 0 }, references: [], files: 0, tombstones: 0, restored: {}, kept_trail: 0, unattributed: [] };

async function world() {
  const e: EngineOrg = await engineOrg();
  const P = `/o/${e.org}`;
  const sys = await systemCtx(e.cfg, e.org);
  // the organisation's own library field, and one of the pack's, both on a real form
  await e.owner.post(`${P}/fields/library`, { name: "u_real_note", label: "یادداشت", type: "text" }, 201);
  await inDemoScope(e.org, () => sys.write((tx) => createIn(tx, sys, "field_def", { name: "u_pack_note", label: "یادداشت نمایشی", type: "text" }, { trusted: true })));
  const form = String((await e.owner.post(`${P}/forms`, { name: "فرم واقعی", layout: { tabs: [{ label: "فرم", sections: [{ label: null, items: [{ field: "u_real_note" }, { field: "u_pack_note" }] }] }] } }, 201)).form.id);
  // one of the pack's people, and a real incident given to them
  const pack = uuidv7();
  await e.db.query(`insert into sm_users (id, email, full_name, prefs) values ($1, $2, 'کارشناس نمایشی', $3::jsonb)`, [pack, `p-${pack.slice(-8)}@aftab-bank.example`, JSON.stringify({ demo_org: e.org })]);
  await e.db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_users')`, [e.org, pack]);
  await e.db.query(`insert into sm_org_members (id, org_id, user_id, role, origin) values ($1, $2, $3, 'member', 'cloud')`, [uuidv7(), e.org, pack]);
  const inc = String((await sys.write((tx) => createIn(tx, sys, "incident", { short_description: "چاپگر کار نمی‌کند", caller_id: e.ownerId, assigned_to: pack }, { trusted: true }))).id);
  const removed = (await e.db.query<{ id: string }>(`select row_id::text as id from sm_demo_rows where org_id = $1`, [e.org])).map((r) => r.id);
  /** The pack as 1.1.4 left it, stopped at `phase` (its earlier phases done). */
  const leftBy114 = (phase: string) =>
    e.db.query(
      `insert into sm_demo_packs (org_id, state, size, progress, counters, started_by, purge_started_at)
       values ($1, 'purging', 'small', jsonb_build_object('saved_at', now(), 'computed', '[]'::jsonb, 'seeds_done', true, 'saved', true, 'purge', $2::text, 'report', $3::jsonb), '{}'::jsonb, $4, now())`,
      [e.org, phase, JSON.stringify(REPORT_114), e.ownerId],
    );
  const toEnd = async () => {
    for (let i = 0; i < 200; i++) {
      const p = await e.db.one<{ state: string }>(`select state from sm_demo_packs where org_id = $1`, [e.org]);
      if (!p || p.state !== "purging") return;
      await purgeStep(e.cfg, e.org);
    }
    throw new Error("the purge did not end");
  };
  const layout = async () => JSON.stringify((await e.db.one<{ layout: unknown }>(`select layout from sm_forms where id = $1`, [form]))!.layout);
  const reviews = async () => (await e.db.query<{ summary: string }>(`select summary from sm_audit where org_id = $1 and action = 'demo_purge_review' order by at`, [e.org])).map((r) => r.summary);
  return { e, sys, form, pack, inc, removed, leftBy114, toEnd, layout, reviews };
}

describe("a purge 1.1.4 started, continued by 1.1.5", () => {
  for (const phase of ["clear", "remove"]) {
    it(`stopped at its ${phase} phase: the names are read while the rows are there, and the definitions cleaned by them`, async () => {
      const w = await world();
      await w.leftBy114(phase);
      expect(await w.layout()).toContain("u_pack_note");
      await w.toEnd();
      expect(await w.e.db.one(`select 1 as x from sm_field_defs where org_id = $1 and name = 'u_pack_note'`, [w.e.org])).toBeNull();
      // the real form keeps its own field and no longer names the pack's
      expect(await w.layout()).toContain("u_real_note");
      expect(await w.layout()).not.toContain("u_pack_note");
      expect((await w.reviews()).some((s) => s.includes("فرم واقعی"))).toBe(true);
      expect(await w.e.db.one<{ assigned_to: string | null }>(`select assigned_to from sm_incidents where id = $1`, [w.inc])).toEqual({ assigned_to: null });
      expect(await danglingRefs(w.e.db, w.e.org, w.removed)).toEqual([]);
    }, 300_000);
  }

  it("past its remove phase: the kept records' references to the pack are cleared, and a review line says what could not be checked by name", async () => {
    const w = await world();
    // 1.1.4's remove phase removed the pack's rows (the registry stays until the finish), its accounts not yet
    await inDemoScope(null, () => w.e.db.query(`delete from sm_field_defs where org_id = $1 and name = 'u_pack_note'`, [w.e.org]));
    await w.leftBy114("accounts");
    await w.toEnd();
    // the pack's account is gone, and nothing real names it any more
    expect(await w.e.db.one(`select 1 as x from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is null`, [w.e.org, w.pack])).toBeNull();
    expect(await w.e.db.one<{ assigned_to: string | null }>(`select assigned_to from sm_incidents where id = $1`, [w.inc])).toEqual({ assigned_to: null });
    expect(await danglingRefs(w.e.db, w.e.org, w.removed)).toEqual([]);
    // the names went with the rows: the owner is told what to look at
    const line = (await w.reviews()).find((s) => s.includes("با نام"));
    expect(line).toBeTruthy();
    expect(line).toContain("فرم واقعی");
  }, 300_000);
});
