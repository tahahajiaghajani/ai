// Archival (docs/PERFORMANCE_FA.md §۸): closed records untouched for N years move to the table's archive at night —
// out of the hot table (a tombstone stays a while so Windows apps drop their copies), still readable through the same
// access rule (lists and aggregates with `archived`, the record and its journal read-only, labels « (بایگانی)»), and
// searchable; nothing moves while the setting is off.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { aggregate, archiveBatch, archiveTableOf, get, list, listJournal, purgeArchived, systemCtx } from "@server/engine";
import { tableDef } from "@shared/tables";
import { tick } from "@server/jobs";

describe("archival of old closed records", () => {
  let e: EngineOrg;
  const ids: Record<string, string> = {};
  const P = () => `/o/${e.org}`;

  beforeAll(async () => {
    e = await engineOrg();
    for (const [k, title, closed] of [["old", "چاپگر شعبهٔ قدیمی", true], ["oldOpen", "کار باز قدیمی", false], ["recent", "چاپگر تازه", true]] as const) {
      const r = await e.owner.post(`${P()}/r/todo`, { short_description: title });
      ids[k] = r.row.id;
      if (closed) await e.owner.post(`${P()}/r/todo/${r.row.id}/transition`, { to: "closed", close_notes: "انجام شد" }).catch(async () => {
        await e.db.query(`update sm_todos set state = 'closed', active = false where id = $1`, [r.row.id]);
      });
    }
    await e.owner.post(`${P()}/r/todo/${ids.old}/journal`, { kind: "comment", body: "یادداشت قدیمی" });
    // five years untouched (the closed one and the open one); `itsm.applying` keeps the sync trigger off updated_at
    await e.db.tx(async (tx) => {
      await tx.query(`select set_config('itsm.applying', 'on', true)`);
      await tx.query(`update sm_todos set active = false where id = $1`, [ids.old]);
      await tx.query(`update sm_todos set updated_at = now() - interval '5 years' where id = any($1::uuid[])`, [`{${ids.old},${ids.oldOpen}}`]);
    });
  });

  it("moves nothing while the setting is off", async () => {
    const s = await e.owner.get(`${P()}/archive`);
    expect(s.settings.enabled).toBe(false);
    expect(s.tables.some((t: { key: string }) => t.key === "todo")).toBe(true);
    await e.owner.post(`${P()}/archive/run`, {}, 400);
  });

  it("moves closed records untouched for the years set, at night, and keeps them readable and searchable", async () => {
    const saved = await e.owner.put(`${P()}/archive`, { enabled: true, years: 3 });
    expect(saved.settings).toEqual({ enabled: true, years: 3 });
    // saving queues the nightly run; «اجرا اکنون» brings it forward
    expect((await e.db.one<{ later: boolean }>(`select run_at > now() as later from sm_jobs where kind = 'engine.archive' and status = 'queued'`))?.later).toBe(true);
    await e.owner.post(`${P()}/archive/run`, {});
    await tick(e.cfg, { budgetMs: 20_000 });
    const ctx = await e.ctxOf(e.ownerId);
    const hot = await list(ctx, "todo", { size: 50 });
    expect(hot.rows.map((r) => r.id)).not.toContain(ids.old);
    expect(hot.rows.map((r) => r.id)).toContain(ids.oldOpen); // still open
    expect(hot.rows.map((r) => r.id)).toContain(ids.recent);
    const arc = await list(ctx, "todo", { archived: true, size: 50 });
    expect(arc.rows.map((r) => r.id)).toEqual([ids.old]);
    expect((await list(ctx, "todo", { archived: true, q: "چاپگر" })).rows.map((r) => r.id)).toEqual([ids.old]);
    expect((await aggregate(ctx, "todo", { archived: true, groupBy: ["state"] })).rows.map((r) => r.values.count)).toEqual([1]);
    // the record and its journal, read-only
    const rec = await get(ctx, "todo", ids.old);
    expect(rec.meta.archived).toBe(true);
    expect(rec.meta.canWrite).toBe(false);
    expect(rec.meta.transitions).toEqual([]);
    expect((await listJournal(ctx, "todo", ids.old)).entries.some((x) => x.body === "یادداشت قدیمی")).toBe(true);
    await e.owner.patch(`${P()}/r/todo/${ids.old}`, { short_description: "تغییر" }, 404);
    // the hot table keeps a tombstone (a new sync revision) until it is purged
    const tomb = await e.db.one<{ deleted_at: string | null }>(`select deleted_at from sm_todos where id = $1`, [ids.old]);
    expect(tomb?.deleted_at).toBeTruthy();
  });

  it("keeps the read rule on the archive", async () => {
    const viewer = await e.member("viewer");
    const ctx = await e.ctxOf(viewer.userId);
    const mine = await list(ctx, "todo", { archived: true }).catch(() => ({ rows: [] }));
    const hotSees = (await list(ctx, "todo", { size: 50 }).catch(() => ({ rows: [] }))).rows.length > 0;
    // a viewer reads the archive exactly as far as its role reads the table
    expect(mine.rows.length > 0).toBe(hotSees);
  });

  it("purges tombstones of records archived more than 30 days ago", async () => {
    const def = tableDef("todo")!;
    const sys = await systemCtx(e.cfg, e.org);
    expect(await archiveBatch(sys, def, 3)).toBe(0); // nothing left to move
    expect(await purgeArchived(sys, def)).toBe(0); // too recent
    await e.db.query(`update ${archiveTableOf(def)} set archived_at = now() - interval '40 days' where id = $1`, [ids.old]);
    expect(await purgeArchived(sys, def)).toBe(1);
    expect(await e.db.one(`select 1 from sm_todos where id = $1`, [ids.old])).toBeNull();
    // still in the archive, still readable
    const ctx = await e.ctxOf(e.ownerId);
    expect((await get(ctx, "todo", ids.old)).meta.archived).toBe(true);
  });
});
