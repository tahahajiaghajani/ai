// A Windows app's custody links and device status periods reach the server as segments that read the asset's stored
// chain and periods (src/server/modules/itam/bank.ts `judgeCustody`, `judgeStatus`). Writes of an organisation run side
// by side (docs/spec/ENGINE.md §13), so each push hook takes the asset's row lock (`lockAsset`, as `addCustody` and the
// web version's status periods do) before it reads anything — also when the push carries no asset row (a request of the
// same sync sent it before; with one, the push holds that lock already): a custody event or status period the web version
// writes for the same asset meanwhile commits first, and the segment is judged after it, never beside it (two links of
// one `seq`: a chain broken for good). The web side's turn-taking runs on a real PostgreSQL in tests/sync-xid-pg.test.ts.
import { describe, expect, it } from "vitest";
import "@shared/tables";
import { hooksFor, type PushArgs } from "@server/engine/hooks";
import { installBankHooks } from "@server/modules/itam/bank";
import { tableDef } from "@shared/tables";

const ORG = "0193a000-0000-7000-8000-000000000001";
const USER = "0193a000-0000-7000-8000-000000000002";
const ASSET = "0193a000-0000-7000-8000-0000000000a1";

/** Every statement after the asset's lock stops the hook: what it read before it took the lock is all that matters here. */
class Stop extends Error {}
const isLock = (text: string) => /from sm_assets\b/.test(text) && /for update/i.test(text);

function recordingTx() {
  const seen: { text: string; params: unknown[] }[] = [];
  const run = async (text: string, params: unknown[] = []) => {
    seen.push({ text, params });
    if (isLock(text)) return [];
    throw new Stop(text);
  };
  const tx = { query: run, one: async (text: string, params?: unknown[]) => ((await run(text, params)) as unknown[])[0] ?? null, exec: run };
  return { tx, seen };
}

function derivePushOf(table: string): NonNullable<ReturnType<typeof hooksFor>[number]["derivePush"]> {
  installBankHooks();
  const hook = hooksFor(table).find((h) => h.derivePush);
  expect(hook, `${table} has a push hook`).toBeTruthy();
  return hook!.derivePush!.bind(hook);
}

async function firstStatements(table: string, args: Pick<PushArgs, "prev" | "next" | "changed">) {
  const { tx, seen } = recordingTx();
  const ctx = { actor: "user", org: { id: ORG, settings: {} }, user: { id: USER, prefs: {} } };
  const p = { tx, ctx, def: tableDef(table)!, env: {}, ...args } as unknown as PushArgs;
  await Promise.resolve(derivePushOf(table)(p)).catch((e: unknown) => {
    if (!(e instanceof Stop)) throw e;
  });
  return seen;
}

describe("a Windows app's ledger rows of an asset are judged under the asset's lock", () => {
  it("a pushed custody link: the asset is locked before its stored chain is read", async () => {
    const seen = await firstStatements("asset_custody", {
      prev: null,
      next: { id: "0193a000-0000-7000-8000-0000000000c1", org_id: ORG, asset_id: ASSET, seq: 2, event: "assigned", at: new Date().toISOString() },
      changed: new Set(["asset_id", "seq", "event", "at"]),
    });
    expect(seen.length).toBeGreaterThan(1);
    expect(isLock(seen[0].text)).toBe(true);
    expect(seen[0].params).toEqual([ASSET, ORG]);
    expect(seen.slice(1).some((s) => isLock(s.text))).toBe(false);
  });

  it("a new status period of a device: the asset is locked before its periods are read", async () => {
    const seen = await firstStatements("device_status_event", {
      prev: null,
      next: { id: "0193a000-0000-7000-8000-0000000000d1", org_id: ORG, asset_id: ASSET, status: "out_of_cash", from_at: new Date().toISOString(), to_at: null },
      changed: new Set(["asset_id", "status", "from_at"]),
    });
    expect(seen.length).toBeGreaterThan(1);
    expect(isLock(seen[0].text)).toBe(true);
    expect(seen[0].params).toEqual([ASSET, ORG]);
  });

  it("the device's open period closed by a push: the asset (named by the stored period) is locked first", async () => {
    const prev = { id: "0193a000-0000-7000-8000-0000000000d2", org_id: ORG, asset_id: ASSET, status: "in_service", from_at: new Date(Date.now() - 3_600_000).toISOString(), to_at: null, minutes: null };
    const seen = await firstStatements("device_status_event", {
      prev,
      next: { ...prev, asset_id: undefined, to_at: new Date().toISOString(), minutes: 60 },
      changed: new Set(["to_at", "minutes"]),
    });
    expect(seen.length).toBeGreaterThan(1);
    expect(isLock(seen[0].text)).toBe(true);
    expect(seen[0].params).toEqual([ASSET, ORG]);
  });
});
