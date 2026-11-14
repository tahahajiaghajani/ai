// Every step of the demo load that writes hundreds of records (a medium or large pack) does it in transactions of a few
// dozen and stops at its deadline, so the job hands the queue back and carries on at its cursor. Found by the bank
// simulation (docs/qa/BANK_SIM_FA.md): a medium pack's 900 requests in one transaction ran for more than half an hour on
// the Windows server (each write bumps the organisation's sync revision row, and a transaction that updates one row
// thousands of times slows down with every update) and the whole job queue waited for it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { batchRng, inChunks, newMemo, type LoadMemo, type StepArgs } from "@server/modules/demo/load";
import { Rng } from "@server/modules/demo/bank";

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
    /** The body of `fn` in `text` — a step that moved away fails here instead of being checked as an empty string. */
    const bodyOf = (text: string, fn: string) => {
      const at = text.indexOf(`async function ${fn}(`);
      expect(at, `${fn} is where this test looks`).toBeGreaterThan(-1);
      return text.slice(at, text.indexOf("\n}\n", at));
    };
    const src = readFileSync(join(__dirname, "../src/server/modules/demo/load.ts"), "utf8");
    for (const fn of ["stepProblems", "stepChanges", "stepRequests"]) {
      const body = bodyOf(src, fn);
      expect(body, fn).toContain("inChunks(a, sys, size.");
      expect(body, fn).not.toMatch(/for \(let i = 0; i < size\./);
    }
    for (const fn of ["stepIncidents", "stepPeople", "seedItamFleet", "stepItamFlows"]) {
      expect(bodyOf(src, fn), fn).toMatch(/Date\.now\(\) < a\.deadline/);
    }
    // the field visits are the «orders» phase of the field service step (modules.ts): a few work orders per transaction,
    // and at the deadline the position is kept in the memo for the next invocation
    const field = bodyOf(readFileSync(join(__dirname, "../src/server/modules/demo/modules.ts"), "utf8"), "stepField");
    expect(field).toMatch(/for \(let i = Number\(memo\.units\["field:at"\] \?\? 0\); i < size\.visits; i \+= 8\)/);
    expect(field).toMatch(/if \(Date\.now\(\) > a\.deadline\) \{\s+memo\.units\["field:at"\] = String\(i\);/);
    expect(field).toContain("j < Math.min(size.visits, i + 8)");
    expect(field).not.toMatch(/for \(let i = 0; i < size\./);
  });

  // A step that works in batches (people, the ITAM fleet) and is resumed by the next job invocation continues its random
  // sequence where its last batch left it. It used to start again from the step's seed, so an interrupted load (20 s
  // demo ticks on the web, a loaded server edition) replayed the first draws: duplicate serials and terminal ids, and
  // one of the seven asset categories missing.
  it("a batched step resumed by another job invocation draws the same sequence as an uninterrupted one", () => {
    const SEED = 1405 + 13;
    /** the batch loop of stepPeople / seedItamFleet: draws per item, memo saved after each batch, `limit` batches per run */
    const run = (memo: LoadMemo, items: number, limit: number, out: number[]): boolean => {
      const rng = batchRng(memo, SEED);
      if (memo.cursor === 0) {
        out.push(rng.next());
        memo.cursor = 1;
      }
      let i = memo.cursor - 1;
      let batches = 0;
      while (i < items && batches < limit) {
        const n = Math.min(40, items - i);
        for (let k = 0; k < n; k++) out.push(rng.next());
        i += n;
        batches++;
        memo.cursor = i + 1;
        memo.rng = rng.state;
      }
      if (i < items) return false;
      memo.cursor = 0;
      delete memo.rng;
      return true;
    };
    const whole: number[] = [];
    expect(run(newMemo("medium"), 150, Infinity, whole)).toBe(true);
    // the same step cut after every batch, each invocation a new Rng from the memo
    const memo = newMemo("medium");
    const pieces: number[] = [];
    let runs = 0;
    while (!run(memo, 150, 1, pieces)) runs++;
    expect(runs).toBe(3);
    expect(pieces).toEqual(whole);
    expect(new Set(pieces).size).toBe(pieces.length);
    expect(memo.rng).toBeUndefined();
    // what the step did before: a new sequence from the seed at every invocation replays the first draws
    const replayed: number[] = [];
    const old = newMemo("medium");
    for (;;) {
      delete old.rng;
      if (run(old, 150, 1, replayed)) break;
    }
    expect(replayed.length).toBe(whole.length);
    expect(new Set(replayed).size).toBeLessThan(replayed.length);
    // a fresh step (cursor 0) never takes a stale position left in the memo
    const stale = newMemo("medium");
    stale.rng = 12345;
    expect(batchRng(stale, SEED).next()).toBe(new Rng(SEED).next());
  });

  it("the people and fleet steps keep their random position across invocations", () => {
    const src = readFileSync(join(__dirname, "../src/server/modules/demo/load.ts"), "utf8");
    for (const [fn, seed] of [["stepPeople", "memo.seed + 7"], ["seedItamFleet", "memo.seed + 13"]]) {
      const body = src.slice(src.indexOf(`async function ${fn}(`), src.indexOf("\n}\n", src.indexOf(`async function ${fn}(`)));
      expect(body, fn).toContain(`batchRng(memo, ${seed})`);
      expect(body, fn).not.toMatch(/new Rng\(/);
      expect(body, fn).toContain("memo.rng = rng.state;");
      expect(body, fn).toContain("delete memo.rng;");
    }
  });
});

