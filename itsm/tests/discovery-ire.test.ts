// The reconciliation engine's edits for discovery (design A §8.2, §8.5), each with its test: `create: false`
// (match-only and review-first sources) and the identity hint `ci_hint` (linked items skip identification; a refresh
// costs one update) — DA1 part 1; the demo boundary both ways (identification, hints and relationship targets), the
// relation origin of connector sources, the rule cache (one read of the identification rules per call), the source
// stamp at most once a minute for connectors, and the identity locks a creating call takes — part 2. The race the
// locks prevent is proved on a real PostgreSQL (tests/discovery-pg.test.ts).
import { beforeAll, describe, expect, it } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { createIn, removeIn, systemCtx, updateIn } from "@server/engine";
import type { Ctx } from "@server/context";
import { inDemoScope } from "@server/db/scope";
import { createOrUpdate, HINT_ENTRY, IDENTITY_BUCKETS, ireCounters } from "@server/modules/cmdb/ire";

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

describe("IRE edits for discovery (design A §8.2 #3–#6, §8.5)", () => {
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
  const isDemo = async (id: string | null) => !!(await e.db.one(`select 1 from sm_demo_rows where org_id = $1 and row_id = $2`, [e.org, id]));
  const demo = <T,>(fn: () => Promise<T>) => inDemoScope(e.org, fn);
  const source = (kind: string, name: string) => sys.write((tx) => createIn(tx, sys, "cmdb_data_source", { name, kind, priority: 90 }, { trusted: true }));

  it("demo boundary: real imports never match the demo pack's CIs, the pack matches only its own (identification, hints, relationship targets)", async () => {
    const [real] = (await createOrUpdate(sys, { items: [server("REAL-1", "SN-BOUND-REAL")] })).results;
    const [pack] = (await demo(() => createOrUpdate(sys, { items: [server("DEMO-1", "SN-BOUND-DEMO")] }))).results;
    expect(real.action).toBe("created");
    expect(pack.action).toBe("created");
    expect(await isDemo(pack.ci_id)).toBe(true);
    expect(await isDemo(real.ci_id)).toBe(false);
    // a real source reporting the demo CI's identity creates its own CI
    const [outside] = (await createOrUpdate(sys, { items: [server("DEMO-1", "SN-BOUND-DEMO")] })).results;
    expect(outside.action).toBe("created");
    expect(outside.ci_id).not.toBe(pack.ci_id);
    expect(await isDemo(outside.ci_id)).toBe(false);
    // the pack reporting a real identity makes its own; its own identity it updates
    const [inside] = (await demo(() => createOrUpdate(sys, { items: [server("REAL-1", "SN-BOUND-REAL")] }))).results;
    expect(inside.action).toBe("created");
    expect(inside.ci_id).not.toBe(real.ci_id);
    expect(await isDemo(inside.ci_id)).toBe(true);
    const [own] = (await demo(() => createOrUpdate(sys, { items: [server("DEMO-1", "SN-BOUND-DEMO", { os: "Linux" })] }))).results;
    expect(own).toMatchObject({ action: "updated", ci_id: pack.ci_id });
    // hints never cross: a real item hinted at the demo CI is identified as usual (its own real CI by serial)…
    const [hintOut] = (await createOrUpdate(sys, { items: [{ ...server("REAL-1", "SN-BOUND-REAL"), ci_hint: pack.ci_id }] })).results;
    expect(hintOut.ci_id).toBe(real.ci_id);
    expect(hintOut.matched_by).not.toBe(HINT_ENTRY);
    // …and a demo item hinted at a real CI too
    const [hintIn] = (await demo(() => createOrUpdate(sys, { items: [{ ...server("DEMO-1", "SN-BOUND-DEMO"), ci_hint: real.ci_id }] }))).results;
    expect(hintIn.ci_id).toBe(pack.ci_id);
    expect(hintIn.matched_by).not.toBe(HINT_ENTRY);
    // relationship targets: a real CI never relates to the pack's, by id or by identification
    const [only] = (await demo(() => createOrUpdate(sys, { items: [server("DEMO-ONLY", "SN-BOUND-DEMO-ONLY")] }))).results;
    const rels = await createOrUpdate(sys, {
      items: [
        { ...server("REAL-1", "SN-BOUND-REAL"), relations: [{ type: "runs_on", ci_id: only.ci_id! }] },
        { ...server("REAL-2", "SN-BOUND-REAL-2"), relations: [{ type: "runs_on", match: { class: "server", values: { serial_number: "SN-BOUND-DEMO-ONLY", manufacturer: "HPE" } } }] },
      ],
    });
    expect(rels.relations).toMatchObject({ created: 0, failed: 2 });
    const crossing = await e.db.one<{ n: number }>(`select count(*)::int as n from sm_ci_rels where org_id = $1 and deleted_at is null and (parent_id = $2 or child_id = $2)`, [e.org, only.ci_id]);
    expect(crossing!.n).toBe(0);
    // the same relationships inside the pack's scope are made
    const inPack = await demo(() => createOrUpdate(sys, { items: [{ ...server("DEMO-1", "SN-BOUND-DEMO"), relations: [{ type: "runs_on", ci_id: only.ci_id! }] }] }));
    expect(inPack.relations.created).toBe(1);
  });

  it("relationships made by a connector's source are «discovery»; a file's stay «import»", async () => {
    const conn = await source("connector", "منبع اتصال آزمایشی");
    const file = await source("file", "منبع فایل آزمایشی");
    const items = (p: string) => [{ ...server(`${p}-VM`, `SN-${p}-VM`), class: "virtual_machine", relations: [{ type: "runs_on", item: 1 }] }, server(`${p}-HOST`, `SN-${p}-HOST`)];
    const a = await createOrUpdate(sys, { source_id: conn.id, items: items("ORIG-C") });
    const b = await createOrUpdate(sys, { source_id: file.id, items: items("ORIG-F") });
    expect(a.relations.created).toBe(1);
    expect(b.relations.created).toBe(1);
    const origin = async (r: typeof a) => (await e.db.one<{ o: string }>(`select origin_kind as o from sm_ci_rels where org_id = $1 and parent_id = $2 and deleted_at is null`, [e.org, r.results[0].ci_id]))!.o;
    expect(await origin(a)).toBe("discovery");
    expect(await origin(b)).toBe("import");
  });

  it("reads the identification rules once per call, whatever the number of items and classes", async () => {
    const before = ireCounters.ruleReads;
    const items = Array.from({ length: 12 }, (_, i) => (i % 3 === 2 ? { class: "virtual_machine", values: { name: `CACHE-VM-${i}`, hostname: `cache-vm-${i}` } } : server(`CACHE-${i}`, `SN-CACHE-${i}`)));
    const r = await createOrUpdate(sys, { items: [...items, { ...server("CACHE-REL", "SN-CACHE-REL"), relations: [{ type: "runs_on", match: { class: "server", values: { hostname: "cache-0" } } }] }] });
    expect(r.created).toBe(13);
    expect(ireCounters.ruleReads - before).toBe(1);
  });

  it("stamps a connector's data source at most once a minute; every call of other sources", async () => {
    const conn = await source("connector", "منبع اتصال مهر");
    const file = await source("file", "منبع فایل مهر");
    const stamp = async (id: string) => (await e.db.one<{ t: string | null; s: string | null }>(`select last_run_at as t, last_status as s from sm_cmdb_sources where id = $1`, [id]))!;
    for (const src of [conn, file]) await createOrUpdate(sys, { source_id: src.id, items: [server(`STAMP-${src.kind}-1`, `SN-STAMP-${src.kind}-1`)] });
    const first = { conn: await stamp(conn.id), file: await stamp(file.id) };
    expect(first.conn.t).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    for (const src of [conn, file]) await createOrUpdate(sys, { source_id: src.id, items: [server(`STAMP-${src.kind}-2`, `SN-STAMP-${src.kind}-2`)] });
    expect(await stamp(conn.id)).toEqual(first.conn);
    expect((await stamp(file.id)).t).not.toBe(first.file.t);
    // a minute later the connector's source is stamped again
    await e.db.query(`update sm_cmdb_sources set last_run_at = now() - interval '61 seconds' where id = $1`, [conn.id]);
    const aged = await stamp(conn.id);
    await createOrUpdate(sys, { source_id: conn.id, items: [server("STAMP-connector-3", "SN-STAMP-connector-3")] });
    expect((await stamp(conn.id)).t).not.toBe(aged.t);
  });

  it("a call that may create takes its items' identity locks first, in at most a bounded number of buckets; others take none", async () => {
    const locks = async (fn: () => Promise<unknown>) => {
      const before = ireCounters.identityLocks;
      await fn();
      return ireCounters.identityLocks - before;
    };
    const many = Array.from({ length: 150 }, (_, i) => server(`LOCK-${i}`, `SN-LOCK-${i}`, { fqdn: `lock-${i}.bank.local`, mac_address: `00:50:56:00:${String(Math.floor(i / 100)).padStart(2, "0")}:${String(i % 100).padStart(2, "0")}` }));
    const n = await locks(() => createOrUpdate(sys, { items: many }));
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(IDENTITY_BUCKETS);
    expect(await locks(() => createOrUpdate(sys, { items: [server("LOCK-ONE", "SN-LOCK-ONE")] }))).toBeGreaterThan(0);
    // nothing to create: no locks
    expect(await locks(() => createOrUpdate(sys, { create: false, items: [server("LOCK-NONE", "SN-LOCK-NONE")] }))).toBe(0);
    expect(await locks(() => createOrUpdate(sys, { dry_run: true, items: [server("LOCK-DRY", "SN-LOCK-DRY")] }))).toBe(0);
    // linked items update through their hint: no locks, unless the hint is dead (then they may create)
    const [linked] = (await createOrUpdate(sys, { items: [server("LOCK-LINKED", "SN-LOCK-LINKED")] })).results;
    expect(await locks(() => createOrUpdate(sys, { items: [{ ...server("LOCK-LINKED", "SN-LOCK-LINKED", { os: "Linux" }), ci_hint: linked.ci_id }] }))).toBe(0);
    await sys.write((tx) => removeIn(tx, sys, "ci", linked.ci_id!));
    expect(await locks(() => createOrUpdate(sys, { items: [{ ...server("LOCK-LINKED", "SN-LOCK-LINKED"), ci_hint: linked.ci_id }] }))).toBeGreaterThan(0);
  });
});
