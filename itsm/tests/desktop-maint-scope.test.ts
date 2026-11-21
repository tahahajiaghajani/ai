// The database maintenance is the Windows app's alone (src/desktop): the web version and the server edition keep
// PostgreSQL's own autovacuum, and nothing of theirs imports the maintenance, the upkeep, the streaming backup or the
// heavy lock. For a memory database (the tests, `npm run start:local --memory`) or anything but PGlite, all of it is
// nothing.
import { describe, it, expect, afterAll } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createPgliteDb } from "@server/db/pglite";
import { startupMaintenance } from "@local/maintenance";
import { createUpkeep } from "@local/upkeep";
import { createHeavyLock } from "@local/heavy";
import type { Db } from "@server/db";
import { capture, cleanFolders, tempFolder } from "./desktop-maint-helpers";

afterAll(cleanFolders);

const root = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mts|mjs|js)$/.test(n) ? [p] : [];
  });
}

describe("the maintenance's scope", () => {
  it("is imported by no file of the web version's server or the server edition", () => {
    const offenders: string[] = [];
    for (const dir of ["src/server", "src/server-edition"]) {
      for (const file of files(join(root, dir))) {
        // every module specifier of the file (static and dynamic imports, re-exports)
        const specifiers = [...readFileSync(file, "utf8").matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].map((m) => m[1]);
        if (specifiers.some((s) => /(?:^@local\/|(?:^|\/)desktop\/)(?:maintenance|upkeep|backup-stream|heavy)$/.test(s))) offenders.push(file.slice(root.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps PostgreSQL's autovacuum for the server edition (its tuning still sets it)", () => {
    expect(readFileSync(join(root, "src/server-edition/pgtune.ts"), "utf8")).toMatch(/autovacuum/);
  });

  it("does nothing for a memory database, or a database that is not PGlite", async () => {
    const mem = await createPgliteDb({ vector: false });
    try {
      expect(mem.wal).toBeNull();
      const log = capture();
      const r = await startupMaintenance(mem, { dataDir: tempFolder(), dbDir: tempFolder(), log });
      expect(r.report.skipped).toBe("not a data folder");
      expect(r.db).toBe(mem);
      expect(log.lines).toEqual([]);
      const up = createUpkeep({ db: mem, log, quietMs: () => 3_600_000, lock: createHeavyLock() });
      up.start();
      expect((await up.pass()).skipped).toBe("not a data folder");
      await up.stop();
    } finally {
      await mem.close();
    }
    // a database of the web version (postgres.js): never touched
    let asked = 0;
    const pg = {
      kind: "postgres",
      query: async () => (asked++, []),
      one: async () => (asked++, null),
      exec: async () => void asked++,
      tx: async () => {
        throw new Error("no");
      },
      close: async () => {},
    } as unknown as Db;
    const r = await startupMaintenance(pg, { dataDir: tempFolder(), dbDir: tempFolder(), log: capture() });
    expect(r.report.skipped).toBe("not a data folder");
    expect((await createUpkeep({ db: pg, log: capture(), quietMs: () => 3_600_000, lock: createHeavyLock() }).pass()).skipped).toBe("not a data folder");
    expect(asked).toBe(0);
    // and with memory set, a data folder's database too (start:local in memory)
    const r2 = await startupMaintenance(pg, { dataDir: tempFolder(), dbDir: tempFolder(), log: capture(), memory: true });
    expect(r2.report.skipped).toBe("not a data folder");
  });
});
