// The demo pack's capture (src/server/db/scope.ts, migration 0098_demo, engine/ddl.ts DEMO_CAPTURE_FN): rows inserted
// inside the demo scope of an organisation are recorded in sm_demo_rows — in transactions, lone statements and the
// jobs that demo work queued about demo rows — and nothing else is: another organisation's rows, the same
// organisation's ordinary work, an organisation-wide job demo work happened to queue.
import { describe, expect, it, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { createIn, systemCtx } from "@server/engine";
import { enqueue, registerJobHandler, tick } from "@server/jobs";
import { inDemoScope, demoScopeOrg } from "@server/db/scope";
import { uuidv7 } from "@shared/id";

let e: EngineOrg;
const seen: { kind: string; scope: string | null }[] = [];

registerJobHandler("democap.probe", async (job, jctx) => {
  seen.push({ kind: String(job.payload.tag ?? ""), scope: demoScopeOrg() });
  // what a job writes: a job row of its own (any table with id + org_id would do)
  if (job.org_id) await enqueue(jctx.db, { kind: "democap.child", orgId: job.org_id, payload: { tag: `${job.payload.tag}-child`, ref: job.payload.ref ?? null } });
});
registerJobHandler("democap.child", async () => {});

const demoRows = async (org: string) => (await e.db.query<{ row_id: string; tbl: string }>(`select row_id, tbl from sm_demo_rows where org_id = $1`, [org]));

beforeAll(async () => {
  e = await engineOrg();
}, 300_000);

describe("demo capture", () => {
  it("records rows inserted in the demo scope, and only those", async () => {
    const sys = await systemCtx(e.cfg, e.org);
    const outside = await sys.write((tx) => createIn(tx, sys, "todo", { short_description: "کار واقعی" }, { trusted: true }));
    const inside = await inDemoScope(e.org, () => sys.write((tx) => createIn(tx, sys, "todo", { short_description: "کار نمایشی" }, { trusted: true })));
    // a lone statement inside the scope runs in a transaction that carries the setting
    const lone = uuidv7();
    await inDemoScope(e.org, () => e.db.query(`insert into sm_kb_events (id, org_id, kind) values ($1, $2, 'view')`, [lone, e.org]));
    const rows = await demoRows(e.org);
    const ids = new Set(rows.map((r) => r.row_id));
    expect(ids.has(inside.id)).toBe(true);
    expect(ids.has(lone)).toBe(true);
    expect(ids.has(outside.id)).toBe(false);
    // the demo record's events (the outbox) are demo rows too
    const events = await e.db.query<{ id: string }>(`select id from sm_jobs where org_id = $1 and payload->>'id' = $2`, [e.org, inside.id]);
    expect(events.length).toBeGreaterThan(0);
    for (const j of events) expect(ids.has(j.id)).toBe(true);
    expect(rows.find((r) => r.row_id === inside.id)?.tbl).toBe("sm_todos");
    // the setting does not outlive the transaction
    const after = await e.db.one<{ v: string | null }>(`select current_setting('itsm.demo', true) as v`);
    expect(after?.v ?? "").toBe("");
  });

  it("another organisation's rows are never recorded under this organisation's scope", async () => {
    const other = await engineOrg();
    const sys = await systemCtx(other.cfg, other.org);
    // the scope names e.org; a write to the other organisation (another database here, the same rule in one)
    const row = await inDemoScope(e.org, () => sys.write((tx) => createIn(tx, sys, "todo", { short_description: "سازمان دیگر" }, { trusted: true })));
    const rows = await other.db.query(`select 1 from sm_demo_rows where row_id = $1`, [row.id]);
    expect(rows.length).toBe(0);
  });

  it("a job runs in the demo scope only when demo work queued it about demo rows", async () => {
    const sys = await systemCtx(e.cfg, e.org);
    const demoTodo = await inDemoScope(e.org, () => sys.write((tx) => createIn(tx, sys, "todo", { short_description: "نمایشی ۲" }, { trusted: true })));
    seen.length = 0;
    await inDemoScope(e.org, async () => {
      await enqueue(e.db, { kind: "democap.probe", orgId: e.org, payload: { tag: "about-demo", ref: demoTodo.id } });
      await enqueue(e.db, { kind: "democap.probe", orgId: e.org, payload: { tag: "org-wide" } });
      await enqueue(e.db, { kind: "democap.probe", orgId: e.org, payload: { tag: "pack", __demo: true } });
    });
    await enqueue(e.db, { kind: "democap.probe", orgId: e.org, payload: { tag: "ordinary", ref: demoTodo.id } });
    // a tick started inside the scope lends it to no job
    for (let i = 0; i < 5; i++) await inDemoScope(e.org, () => tick(e.cfg, { budgetMs: 10_000 }));
    const scope = Object.fromEntries(seen.map((s) => [s.kind, s.scope]));
    expect(scope["about-demo"]).toBe(e.org);
    expect(scope.pack).toBe(e.org);
    expect(scope["org-wide"]).toBeNull();
    expect(scope.ordinary).toBeNull();
    // what the demo jobs wrote is demo data; what the others wrote is not
    const children = await e.db.query<{ id: string; tag: string }>(`select id, payload->>'tag' as tag from sm_jobs where org_id = $1 and kind = 'democap.child'`, [e.org]);
    const ids = new Set((await demoRows(e.org)).map((r) => r.row_id));
    const byTag = Object.fromEntries(children.map((c) => [c.tag, ids.has(c.id)]));
    expect(byTag["about-demo-child"]).toBe(true);
    expect(byTag["pack-child"]).toBe(true);
    expect(byTag["org-wide-child"]).toBe(false);
    expect(byTag["ordinary-child"]).toBe(false);
  });
});
