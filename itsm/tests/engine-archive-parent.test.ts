// Archival never takes a record that other records scope as their parent (`scope.parent`): a security incident's
// tasks, evidence and regulatory clocks read through the incident's rule on the hot table, so once the archived
// incident's tombstone were purged they would read nothing for everyone (security managers and auditors included).
import { describe, it, expect, beforeAll } from "vitest";
import { physicalTables, tableDef } from "@shared/tables";
import { scopeColumns } from "@shared/access/evaluate";
import { archivable } from "@server/engine/ddl";
import { archivableTables, archiveBatch, get, list, purgeArchived } from "@server/engine";
import { memberCtx } from "@server/access";
import { secWorld, type SecWorld } from "./security-helpers";

describe("archival of parent records", () => {
  it("no archivable table is the scope parent of another table", () => {
    const parents = new Set(physicalTables().map((d) => scopeColumns(d).parent?.table).filter((t): t is string => !!t));
    expect(parents.has("sec_incident")).toBe(true);
    expect(archivableTables().filter((d) => parents.has(d.key)).map((d) => d.key)).toEqual([]);
    expect(archivable(tableDef("sec_incident")!)).toBe(false);
    // tables nobody scopes as a parent stay archivable
    expect(archivable(tableDef("incident")!)).toBe(true);
  });

  describe("a security incident closed and untouched for years", () => {
    let w: SecWorld;
    let sir: Record<string, any>;
    let task: Record<string, any>;

    beforeAll(async () => {
      w = await secWorld();
      sir = await w.sir({ short_description: "رخداد امنیتی بسته‌شدهٔ قدیمی" });
      task = (await w.p.soc.client.post(`${w.P}/r/sec_task`, { short_description: "جداسازی میزبان آلوده", sec_incident_id: sir.id })).row;
      await w.drain();
      // closed five years ago; `itsm.applying` keeps the sync trigger off updated_at
      await w.e.db.tx(async (tx) => {
        await tx.query(`select set_config('itsm.applying', 'on', true)`);
        await tx.query(`update sm_sec_incidents set active = false, closed_at = now() - interval '5 years', updated_at = now() - interval '5 years' where id = $1`, [sir.id]);
      });
    }, 300_000);

    it("stays in the hot table through archival and purge, and its tasks stay readable to the security manager", async () => {
      const def = tableDef("sec_incident")!;
      expect(await archiveBatch(w.sys, def, 3)).toBe(0);
      expect(await purgeArchived(w.sys, def)).toBe(0);
      expect((await w.e.db.one<{ deleted_at: string | null }>(`select deleted_at from sm_sec_incidents where id = $1`, [sir.id]))?.deleted_at).toBeNull();
      const ciso = await memberCtx(w.e.cfg, w.e.org, w.p.ciso.userId);
      expect((await get(ciso, "sec_task", task.id)).row.id).toBe(task.id);
      expect((await list(ciso, "sec_task", { size: 50 })).rows.map((r) => r.id)).toContain(task.id);
    });
  });
});
