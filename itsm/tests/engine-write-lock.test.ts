// The organisation's write lock (PERFORMANCE_FA.md «دور دوم»): a write takes it when it starts; a `late` write — and
// `internal` bookkeeping — only right before its first write of a synced row (the engine's `ensureOrgLock`), so its
// reads and preparation run without it, and bookkeeping in tables that are not synced takes no lock at all. Revisions
// stay in commit order. The probe of measurement runs reports wait and hold per labelled transaction.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { createIn, systemCtx } from "@server/engine";
import { setLockProbe, withLockLabel, type LockSample } from "@server/db/lockprobe";
import type { Ctx } from "@server/context";
import type { Tx } from "@server/db";

let e: EngineOrg;
let sys: Ctx;

/** The statements of every transaction run while `fn` runs, in order. */
async function transactions(fn: () => Promise<void>): Promise<string[][]> {
  const out: string[][] = [];
  const db = e.db as { tx: (f: (tx: Tx) => Promise<unknown>) => Promise<unknown> };
  const orig = db.tx.bind(e.db);
  db.tx = (f) =>
    orig((tx: Tx) => {
      const seen: string[] = [];
      out.push(seen);
      const watch = <T extends (...a: any[]) => any>(g: T) => ((text: string, ...rest: unknown[]) => {
        seen.push(text.replace(/\s+/g, " ").trim());
        return g(text, ...rest);
      }) as unknown as T;
      return f({ ...tx, query: watch(tx.query.bind(tx)), one: watch(tx.one.bind(tx)) });
    });
  try {
    await fn();
  } finally {
    db.tx = orig;
  }
  return out;
}
const isLock = (q: string) => /^insert into sm_org_sync\b/i.test(q);
const head = async () => Number((await e.db.one<{ rev: string }>(`select rev from sm_org_sync where org_id = $1`, [e.org]))!.rev);

beforeAll(async () => {
  e = await engineOrg();
  sys = await systemCtx(e.cfg, e.org);
});

afterEach(() => setLockProbe(null));

describe("the organisation's write lock", () => {
  it("is taken first by an ordinary write", async () => {
    const [tx] = await transactions(() => sys.write(async (t) => void (await createIn(t, sys, "todo", { short_description: "قفل از آغاز" }))));
    expect(isLock(tx[0])).toBe(true);
  });

  it("is taken by a late write only before its first synced row, after its reads", async () => {
    const before = await head();
    const [tx] = await transactions(() =>
      sys.write(async (t) => {
        await t.query(`select count(*) from sm_todos where org_id = $1`, [e.org]);
        await createIn(t, sys, "todo", { short_description: "قفل دیرهنگام" });
        await createIn(t, sys, "todo", { short_description: "دومی" });
      }, { late: true }),
    );
    const lock = tx.findIndex(isLock);
    expect(lock).toBeGreaterThan(tx.findIndex((q) => /^select count\(\*\) from sm_todos\b/.test(q)));
    expect(tx.filter(isLock)).toHaveLength(1);
    // the record's own insert follows the lock: the row and its revision are written under it
    expect(tx.slice(lock + 1).some((q) => /^insert into sm_todos\b/i.test(q))).toBe(true);
    expect(tx.slice(0, lock).some((q) => /^insert into sm_todos\b/i.test(q))).toBe(false);
    // revisions continue the organisation's sequence
    const revs = (await e.db.query<{ rev: string }>(`select rev from sm_todos where org_id = $1 and short_description in ('قفل دیرهنگام', 'دومی') order by rev`, [e.org])).map((r) => Number(r.rev));
    expect(revs.every((r) => r > before)).toBe(true);
  });

  it("is not taken by bookkeeping that writes no synced row", async () => {
    const [tx] = await transactions(() => sys.write((t) => t.query(`select 1`).then(() => undefined), { internal: true }));
    expect(tx.filter(isLock)).toHaveLength(0);
  });

  it("reports wait and hold per labelled transaction to the probe of measurement runs", async () => {
    const samples: LockSample[] = [];
    setLockProbe((x) => samples.push(x));
    await withLockLabel("PATCH /o/:org/r/todo/:id", () => sys.write(async (t) => void (await createIn(t, sys, "todo", { short_description: "سنجش" }))));
    await sys.write((t) => t.query(`select 1`).then(() => undefined), { internal: true });
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ label: "PATCH /o/:org/r/todo/:id", committed: true });
    expect(samples[0].holdMs).toBeGreaterThanOrEqual(0);
    expect(samples[0].waitMs).toBeGreaterThanOrEqual(0);
    setLockProbe(null);
    await sys.write(async (t) => void (await createIn(t, sys, "todo", { short_description: "بی‌سنجش" })));
    expect(samples).toHaveLength(1);
  });
});
