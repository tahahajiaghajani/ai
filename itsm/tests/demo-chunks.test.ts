// Every step of the demo load that writes hundreds of records (a medium or large pack) does it in transactions of a few
// dozen and stops at its deadline, so the job hands the queue back and carries on at its cursor. Found by the bank
// simulation (docs/qa/BANK_SIM_FA.md): a medium pack's 900 requests in one transaction ran for more than half an hour on
// the Windows server (each write bumps the organisation's sync revision row, and a transaction that updates one row
// thousands of times slows down with every update) and the whole job queue waited for it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inChunks, newMemo, type StepArgs } from "@server/modules/demo/load";

const fakeSys = (log: number[][]) =>
  ({
    write: async (fn: (tx: unknown) => Promise<void>) => {
      log.push([]);
      await fn({});
    },
  }) as never;

describe("the demo load's long steps work in chunks up to their deadline", () => {
  it("writes chunk after chunk in their own transactions, stops at the deadline and resumes at the cursor", async () => {
    const memo = newMemo("medium");
    const txs: number[][] = [];
    const a = { cfg: {} as never, orgId: "o", memo, deadline: Date.now() + 40 } as StepArgs;
    const body = async (_tx: unknown, i: number) => {
      txs[txs.length - 1].push(i);
      if (i === 0) await new Promise((r) => setTimeout(r, 60));
    };
    expect(await inChunks(a, fakeSys(txs), 100, 40, body)).toBe(false);
    expect(txs).toEqual([Array.from({ length: 40 }, (_, k) => k)]);
    expect(memo.cursor).toBe(40);
    // the next run of the job carries on at the cursor and finishes
    a.deadline = Date.now() + 60_000;
    expect(await inChunks(a, fakeSys(txs), 100, 40, body)).toBe(true);
    expect(txs.slice(1).map((t) => [t[0], t.length])).toEqual([[40, 40], [80, 20]]);
    // a deadline already passed writes nothing
    const b = { ...a, memo: newMemo("medium"), deadline: Date.now() - 1 } as StepArgs;
    const none: number[][] = [];
    expect(await inChunks(b, fakeSys(none), 100, 40, body)).toBe(false);
    expect(none).toEqual([]);
  });

  it("the steps sized by the pack (problems, changes, requests, field visits, incidents, assets, ITAM flows, people) are chunked", () => {
    const src = readFileSync(join(__dirname, "../src/server/modules/demo/load.ts"), "utf8");
    for (const fn of ["stepProblems", "stepChanges", "stepRequests", "stepField"]) {
      const body = src.slice(src.indexOf(`async function ${fn}(`), src.indexOf("\n}\n", src.indexOf(`async function ${fn}(`)));
      expect(body, fn).toContain("inChunks(a, sys, size.");
      expect(body, fn).not.toMatch(/for \(let i = 0; i < size\./);
    }
    for (const fn of ["stepIncidents", "stepPeople", "seedItamFleet", "stepItamFlows"]) {
      const body = src.slice(src.indexOf(`async function ${fn}(`), src.indexOf("\n}\n", src.indexOf(`async function ${fn}(`)));
      expect(body, fn).toMatch(/Date\.now\(\) < a\.deadline/);
    }
  });
});
