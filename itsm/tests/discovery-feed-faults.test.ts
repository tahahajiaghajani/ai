// The drop folder when the system refuses (design A §6.6; review DA3c-2, DA3c-3): a claimed file the service may not
// read goes to failed/ with its reason and a delta pass goes on, while one another program holds is tried again; a file
// Kariz may not move out of the folder, or one another program holds, waits and the pass says why. The tests run as
// root, where permissions cannot refuse, so `open` and `rename` answer the system's errors for the files named here.
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Cursor } from "@shared/discovery/types";
import { connector, feedOptions, FEED_MESSAGES, forgetFeedFiles } from "@server/modules/discovery/connectors/feed";
import { ensureDropFolder, installDropRoot } from "@server/modules/discovery/drop";
import type { ConnCtx } from "@server/modules/discovery/kind";
import { dropFile, serverRows, toCsv } from "./mocks/discovery/feed";

const faults = vi.hoisted(() => ({ open: new Map<string, string>(), rename: new Map<string, string>() }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  const fault = (m: Map<string, string>, path: unknown) => {
    for (const [end, code] of m) if (String(path).endsWith(end)) return Object.assign(new Error(`${code}: ${String(path)}`), { code });
    return null;
  };
  return {
    ...fs,
    open: (path: string, ...rest: unknown[]) => {
      const e = fault(faults.open, path);
      return e ? Promise.reject(e) : (fs.open as (...a: unknown[]) => Promise<unknown>)(path, ...rest);
    },
    rename: (from: string, to: string) => {
      const e = fault(faults.rename, from);
      return e ? Promise.reject(e) : fs.rename(from, to);
    },
  };
});

const ctx = (id: string, options: Record<string, unknown>): ConnCtx => ({
  connector: { id, name: "پوشه", kind: "feed", base_url: null, hosts: [], auth: null } as unknown as ConnCtx["connector"],
  options: feedOptions.parse({ source: "folder", ...options }),
  secret: null,
  secret2: null,
  edition: "server",
  deadline: Date.now() + 60_000,
  now: () => new Date(),
  fetchJson: () => Promise.reject(new Error("no network")),
  fetchText: () => Promise.reject(new Error("no network")),
  log: () => undefined,
});

/** One pass as the runner drives it: pages until the listing ends (a page that throws ends it with its error). */
async function pass(c: ConnCtx) {
  const out = { ids: [] as string[], notes: [] as string[], complete: false };
  let cursor: Cursor | null = null;
  for (let i = 0; i < 20; i++) {
    const p = await connector.pages(c, cursor);
    out.ids.push(...p.records.map((r) => String(r.external_id)));
    out.notes.push(...(p.rejected ?? []).map((r) => r.message));
    out.complete = !!p.complete;
    if (!p.next) break;
    cursor = p.next;
  }
  return out;
}

describe("a drop-folder file the system refuses (design A §6.6; review DA3c-2, DA3c-3)", () => {
  let base: string;
  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "kariz-drop-faults-"));
    installDropRoot(join(base, "drop"));
  });
  afterEach(() => {
    faults.open.clear();
    faults.rename.clear();
    forgetFeedFiles();
  });
  afterAll(async () => {
    installDropRoot(null);
    await rm(base, { recursive: true, force: true });
  });

  it("a file the service may not read goes to failed/ with the reason and a delta pass reads the next; a held one is tried again (DA3c-2)", async () => {
    const c = ctx("0190f3a2-0000-7000-8000-00000000da31", { mode: "delta" });
    const d = await ensureDropFolder(c.connector.id);
    await dropFile(d.dir, "d1.csv", toCsv(serverRows(2, { from: 10 })), 300_000);
    await dropFile(d.dir, "d2.csv", toCsv(serverRows(2, { from: 20 })), 240_000);
    faults.open.set("d1.csv", "EACCES");
    // «آزمودن اتصال» names the reason
    expect(await connector.test(c)).toMatchObject({ ok: false, message: FEED_MESSAGES.fileFailed("d1.csv", FEED_MESSAGES.noRead) });
    expect(await pass(c)).toEqual({ ids: ["S20", "S21"], notes: [FEED_MESSAGES.fileFailed("d1.csv", FEED_MESSAGES.noRead)], complete: false });
    const failed = await readdir(join(d.kept, "failed"));
    expect(await readFile(join(d.kept, "failed", failed.find((n) => n.endsWith("-d1.csv.txt"))!), "utf8")).toContain(FEED_MESSAGES.noRead);
    expect(await readdir(join(d.kept, "working"))).toEqual([]);
    // another program holds the file: the page fails retryably, the file stays claimed and the next pass reads it
    await dropFile(d.dir, "d3.csv", toCsv(serverRows(1, { from: 30 })), 200_000);
    faults.open.set("d3.csv", "EBUSY");
    await expect(pass(c)).rejects.toMatchObject({ code: "network", message: FEED_MESSAGES.busy("d3.csv") });
    expect((await readdir(join(d.kept, "working"))).map((n) => n.replace(/^\d{8}T\d{9}Z-/, ""))).toEqual(["d3.csv"]);
    faults.open.clear();
    expect((await pass(c)).ids).toEqual(["S30"]);
  });

  it("a file Kariz may not move out of the folder, or one another program holds, waits and the pass says why (DA3c-3)", async () => {
    const c = ctx("0190f3a2-0000-7000-8000-00000000da32", {});
    const d = await ensureDropFolder(c.connector.id);
    await dropFile(d.dir, "old.csv", toCsv(serverRows(2)), 300_000);
    await dropFile(d.dir, "new.csv", toCsv(serverRows(3)), 240_000);
    faults.rename.set(join(d.dir, "new.csv"), "EPERM");
    expect(await pass(c)).toEqual({ ids: [], notes: [FEED_MESSAGES.noMove("new.csv")], complete: false });
    faults.rename.set(join(d.dir, "new.csv"), "EBUSY");
    expect(await pass(c)).toEqual({ ids: [], notes: [FEED_MESSAGES.busy("new.csv")], complete: false });
    expect((await readdir(d.dir)).sort()).toEqual(["new.csv", "old.csv"]);
    faults.rename.clear();
    expect(await pass(c)).toEqual({ ids: ["S1", "S2", "S3"], notes: [], complete: true });
    expect(await readdir(d.dir)).toEqual([]);
  });
});
