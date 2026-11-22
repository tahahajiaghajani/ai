// The purge's preview names what it touches in words a person reads (the owner's click-through of 1.1.5: «دارندگان
// نقش‌های سازمانی · ۴ · 01a201e6-…» — a bucket's samples were its table's display column, and a holder's display is
// its person's id). A display that is a reference reads as the referenced row's own display; a person placed somewhere
// reads «نگار کارشناس‌پور در «مدیر گروه»» (src/server/modules/demo/samples.ts) — in every bucket: the real rows deleted
// with the pack, the definitions cleaned, the records routed again. The pack is simulated as
// tests/demo-purge-conflicts.test.ts does (a loaded pack row, an account of the pack's).
import { describe, it, expect } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { createIn, systemCtx } from "@server/engine";
import { inDemoScope } from "@server/db/scope";
import { uuidv7 } from "@shared/id";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function packOf(e: EngineOrg) {
  await e.db.query(
    `insert into sm_demo_packs (org_id, state, size, progress, counters, started_by) values ($1, 'loaded', 'small', jsonb_build_object('saved_at', now(), 'computed', '[]'::jsonb, 'seeds_done', true, 'saved', true), '{}'::jsonb, $2)`,
    [e.org, e.ownerId],
  );
}

/** An account of the pack's, as the loader adds them: marked with the organisation's pack, a member. */
async function persona(e: EngineOrg, name: string): Promise<string> {
  const id = uuidv7();
  await e.db.query(`insert into sm_users (id, email, full_name, prefs) values ($1, $2, $3, $4::jsonb)`, [id, `p-${id.slice(-8)}@aftab-bank.example`, name, JSON.stringify({ demo_org: e.org })]);
  await e.db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_users')`, [e.org, id]);
  await e.db.query(`insert into sm_org_members (id, org_id, user_id, role, title, origin) values ($1, $2, $3, 'member', 'نمایشی', 'cloud')`, [uuidv7(), e.org, id]);
  return id;
}

describe("the purge's preview names rows in words, never by id", () => {
  it("a holder reads «… در «مدیر گروه»», a member «… در «گروه …»», a person's settings by the person's name", async () => {
    const e = await engineOrg();
    const sys = await systemCtx(e.cfg, e.org);
    await packOf(e);
    const nagar = await persona(e, "نگار کارشناس‌پور");
    // what the owner built on the pack: a real position and a real group with the pack's person in them …
    await sys.write(async (tx) => {
      const p = await createIn(tx, sys, "position", { key: "group_head", name: "مدیر گروه" }, { trusted: true });
      await createIn(tx, sys, "position_holder", { position_id: p.id, user_id: nagar, kind: "primary" }, { trusted: true });
      const g = await createIn(tx, sys, "group", { name: "گروه شبکه", types: ["assignment"] }, { trusted: true });
      await createIn(tx, sys, "group_member", { group_id: g.id, user_id: nagar, kind: "member" }, { trusted: true });
    });
    // … and the owner's portal settings, which chose a portal of the pack's (a kept row whose display is its person)
    const portal = await inDemoScope(e.org, () => sys.write((tx) => createIn(tx, sys, "portal", { name: "درگاه نمایشی" }, { trusted: true })));
    await sys.write((tx) => createIn(tx, sys, "portal_pref", { user_id: e.ownerId, portal_id: portal.id }, { trusted: true }));

    const report = await e.owner.get(`/o/${e.org}/demo/report`);
    expect(report.partial ?? false).toBe(false);
    const deleted = new Map((report.deleted as { table: string; samples: string[] }[]).map((d) => [d.table, d.samples]));
    // recorded on demo data, going with it: «who in what»
    expect(deleted.get("position_holder")).toEqual(["نگار کارشناس‌پور در «مدیر گروه»"]);
    expect(deleted.get("group_member")).toEqual(["نگار کارشناس‌پور در «گروه شبکه»"]);
    // a record routed again: the owner's settings, by the owner's name
    const owner = (await e.db.one<{ full_name: string }>(`select full_name from sm_users where id = $1`, [e.ownerId]))!.full_name;
    expect((report.rerouted as { table: string; samples: string[] }[]).find((r) => r.table === "portal_pref")?.samples).toEqual([owner]);
    // no bucket names anything by its id
    const words = [
      ...(report.deleted as { samples: string[] }[]).flatMap((d) => d.samples),
      ...(report.cleaned as { name: string }[]).map((c) => c.name),
      ...(report.rerouted as { samples: string[] }[]).flatMap((r) => r.samples),
    ];
    expect(words.length).toBeGreaterThan(0);
    expect(words.filter((x) => UUID.test(x))).toEqual([]);
  }, 300_000);
});
