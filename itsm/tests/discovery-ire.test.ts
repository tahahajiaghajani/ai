// The reconciliation engine's edits for discovery (design A §8.2), each with its test. DA1 part 1 made the two the pull
// runner relies on (§7.4): `create: false` (match-only and review-first sources) and the identity hint `ci_hint`
// (linked items skip identification; a refresh costs one update). Part 2 adds the demo boundary, the connector
// relation origin and the rule cache here.
import { beforeAll, describe, expect, it } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { removeIn, systemCtx, updateIn } from "@server/engine";
import type { Ctx } from "@server/context";
import { createOrUpdate, HINT_ENTRY } from "@server/modules/cmdb/ire";

describe("IRE edits for discovery (design A §8.2 #1 and #2)", () => {
  let e: EngineOrg;
  let sys: Ctx;
  beforeAll(async () => {
    e = await engineOrg();
    await e.owner.post(`/o/${e.org}/cmdb/seed`, {});
    sys = await systemCtx(e.cfg, e.org);
  }, 120_000);

  const server = (name: string, serial: string, extra: Record<string, unknown> = {}) => ({
    class: "server",
    values: { name, hostname: name.toLowerCase(), serial_number: serial, manufacturer: "HPE", ...extra },
  });
  const cis = async () => Number((await e.db.one<{ n: number }>(`select count(*)::int as n from sm_cis where org_id = $1 and deleted_at is null`, [e.org]))!.n);

  it("create: false answers unmatched, writes nothing and skips the item's relations", async () => {
    const before = await cis();
    const r = await createOrUpdate(sys, { create: false, items: [{ ...server("NEW-1", "SN-NEW-1"), relations: [{ type: "runs_on", item: 1 }] }, server("NEW-2", "SN-NEW-2")] });
    expect(r.results.map((x) => x.action)).toEqual(["unmatched", "unmatched"]);
    expect(r.results.every((x) => x.ci_id === null)).toBe(true);
    expect(r).toMatchObject({ unmatched: 2, created: 0, relations: { created: 0 } });
    expect(await cis()).toBe(before);
    // an item that matches an existing CI is reconciled as usual
    const made = await createOrUpdate(sys, { items: [server("OLD-1", "SN-OLD-1")] });
    const again = await createOrUpdate(sys, { create: false, items: [server("OLD-1", "SN-OLD-1", { os: "Windows Server 2022" })] });
    expect(again.results[0]).toMatchObject({ action: "updated", ci_id: made.results[0].ci_id });
    // the default creates
    const created = await createOrUpdate(sys, { items: [server("NEW-1", "SN-NEW-1")] });
    expect(created.results[0].action).toBe("created");
  });

  it("ci_hint: a live CI is used without identification, a merged one followed, a deleted one ignored, a person's ignored", async () => {
    const [a] = (await createOrUpdate(sys, { items: [server("HINT-A", "SN-HINT-A")] })).results;
    // nothing in the item identifies HINT-A: the hint alone links it
    const hinted = await createOrUpdate(sys, { items: [{ ...server("renamed-a", "SN-OTHER-A"), ci_hint: a.ci_id }] });
    expect(hinted.results[0]).toMatchObject({ action: "updated", ci_id: a.ci_id, matched_by: HINT_ENTRY });
    // merged: followed to the CI it was merged into
    const [b] = (await createOrUpdate(sys, { items: [server("HINT-B", "SN-HINT-B")] })).results;
    await sys.write((tx) => updateIn(tx, sys, "ci", a.ci_id!, { merged_into: b.ci_id }, { trusted: true }));
    const merged = await createOrUpdate(sys, { items: [{ ...server("x-b", "SN-X-B"), ci_hint: a.ci_id }] });
    expect(merged.results[0]).toMatchObject({ ci_id: b.ci_id, matched_by: HINT_ENTRY });
    // deleted: identified as usual (nothing matches here, so a new CI)
    const [c] = (await createOrUpdate(sys, { items: [server("HINT-C", "SN-HINT-C")] })).results;
    await sys.write((tx) => removeIn(tx, sys, "ci", c.ci_id!));
    const gone = await createOrUpdate(sys, { items: [{ ...server("HINT-C2", "SN-HINT-C2"), ci_hint: c.ci_id }] });
    expect(gone.results[0].action).toBe("created");
    expect(gone.results[0].ci_id).not.toBe(c.ci_id);
    // disposed: identified as usual
    await e.db.query(`update sm_cis set state = 'disposed' where id = $1`, [gone.results[0].ci_id]);
    const disposed = await createOrUpdate(sys, { items: [{ ...server("HINT-D", "SN-HINT-D"), ci_hint: gone.results[0].ci_id }] });
    expect(disposed.results[0]).toMatchObject({ action: "created" });
    // a person's import carries no hint: identified as usual
    const owner = await e.ctxOf(e.ownerId);
    const person = await createOrUpdate(owner, { items: [{ ...server("PERSON-1", "SN-PERSON-1"), ci_hint: b.ci_id }] });
    expect(person.results[0].action).toBe("created");
    expect(person.results[0].ci_id).not.toBe(b.ci_id);
  });
});
