// The demo pack's random sequence survives a step being split over job invocations: on a slow machine or for a larger
// pack a step runs in several invocations, and it must make the same bank as one that ran at once — never a replay of
// the sequence its first part already used. (The PGlite proof once found a device class and the branch officer's assets
// missing: the fleet's second batch had replayed the first one's draws.) The batched steps (people, the fleet) keep
// `Rng.state` in `memo.rng` after each batch (load.ts `batchRng`); the incidents and the rest of the bank's phased steps
// restore it at any cursor (`resumeRng`, modules.ts `phased`), since their first phase draws too.
import { describe, expect, it } from "vitest";
import { Rng } from "@server/modules/demo/bank";
import { newMemo, resumeRng, type LoadMemo, type StepArgs } from "@server/modules/demo/load";
import { phased } from "@server/modules/demo/modules";

const PHASES = ["skills", "people", "rosters", "absences", "oncall"];

/**
 * A phased step drawing `per` values in each phase, run over job invocations that each get through `perInvocation`
 * phases (the deadline passes then); its third phase works in chunks of four draws and stops between chunks when the
 * deadline passes, as the CSM cases and field orders do. `rngOf` makes the step's generator at each invocation.
 */
async function phasedDraws(perInvocation: number, rngOf: (memo: LoadMemo, seed: number) => Rng = resumeRng): Promise<number[]> {
  const memo = newMemo("small");
  const out: number[] = [];
  for (let invocation = 0; invocation < 40; invocation++) {
    const a: StepArgs = { cfg: null as never, orgId: "org", memo, deadline: Date.now() + 60_000 };
    const rng = rngOf(memo, memo.seed + 53);
    let phases = 0;
    const done = await phased(a, "workforce", PHASES, async (phase) => {
      if (phase === "rosters") {
        for (let at = Number(memo.units["test:at"] ?? 0); at < 12; at += 4) {
          if (Date.now() > a.deadline) {
            memo.units["test:at"] = String(at);
            return false;
          }
          for (let k = 0; k < 4; k++) out.push(rng.int(0, 1_000_000));
          memo.rng = rng.state;
          // the deadline passes after each chunk when invocations get through less than a phase
          if (perInvocation === 0) a.deadline = 0;
        }
        delete memo.units["test:at"];
      } else for (let k = 0; k < 5; k++) out.push(rng.int(0, 1_000_000));
      if (perInvocation > 0 && ++phases >= perInvocation) a.deadline = 0;
    }, rng);
    if (done) {
      // the step is done: nothing of its sequence stays in the memo (the next step starts from its own seed)
      expect(memo.rng).toBeUndefined();
      return out;
    }
  }
  throw new Error("the step never ended");
}

describe("the demo pack's random sequence across job invocations", () => {
  it("a generator set to a saved state continues the sequence", () => {
    const a = new Rng(1405);
    for (let i = 0; i < 7; i++) a.next();
    const b = new Rng(0);
    b.state = a.state;
    for (let i = 0; i < 20; i++) expect(b.next()).toBe(a.next());
  });

  it("a phased step split over invocations makes the same values as one run at once (and as before: the seed's own sequence)", async () => {
    const once = await phasedDraws(PHASES.length);
    const plain = new Rng(newMemo("small").seed + 53);
    expect(once).toEqual(Array.from({ length: once.length }, () => plain.int(0, 1_000_000)));
    // one phase per invocation (its second phase resumes at cursor 1), two, and a chunked phase stopped between chunks
    expect(await phasedDraws(1)).toEqual(once);
    expect(await phasedDraws(2)).toEqual(once);
    expect(await phasedDraws(0)).toEqual(once);
  });

  it("never replays: neither a fresh generator per invocation nor one restored only past the first batch", async () => {
    const once = await phasedDraws(PHASES.length);
    expect(await phasedDraws(1, (_memo, seed) => new Rng(seed))).not.toEqual(once);
    // a batched step's rule (load.ts batchRng: its cursor-0 part draws nothing) would restart a phased step's sequence
    // at its second phase
    const pastFirstBatch = (memo: LoadMemo, seed: number) => {
      const rng = new Rng(seed);
      if (memo.cursor > 1 && typeof memo.rng === "number") rng.state = memo.rng;
      return rng;
    };
    expect(await phasedDraws(1, pastFirstBatch)).not.toEqual(once);
  });
});
