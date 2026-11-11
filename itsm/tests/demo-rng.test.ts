// The demo pack's random sequence survives a step being split over job invocations (src/server/modules/demo/load.ts
// stepRng/keepRng): on a slow machine or for a larger pack a step runs in several chunks, and it must make the same bank
// as one that ran at once — never a replay of the sequence its first chunk already used. (The PGlite proof once found a
// device class and the branch officer's assets missing: the fleet's second chunk had replayed the first one's draws.)
import { describe, expect, it } from "vitest";
import { Rng } from "@server/modules/demo/bank";
import { keepRng, newMemo, stepRng } from "@server/modules/demo/load";

/** A chunked step drawing `n` values in chunks of `size`: each chunk a fresh invocation with its own generator. */
function chunked(n: number, size: number): number[] {
  const memo = newMemo("small");
  const out: number[] = [];
  for (let at = 0; at < n; at += size) {
    const rng = stepRng(memo, "fleet", memo.seed + 13);
    for (let k = at; k < Math.min(n, at + size); k++) out.push(rng.int(0, 1_000_000));
    keepRng(memo, "fleet", rng);
  }
  // the step is done: nothing of it stays in the memo
  keepRng(memo, "fleet", null);
  expect(memo.rng).toEqual({});
  return out;
}

describe("the demo pack's random sequence across job invocations", () => {
  it("a resumed generator continues the saved sequence", () => {
    const a = new Rng(1405);
    for (let i = 0; i < 7; i++) a.next();
    const b = Rng.resume(a.state);
    for (let i = 0; i < 20; i++) expect(b.next()).toBe(a.next());
  });

  it("a step split into chunks makes the same values as one run at once (and as before: the seed's own sequence)", () => {
    const once = chunked(120, 120);
    const plain = new Rng(newMemo("small").seed + 13);
    expect(once).toEqual(Array.from({ length: 120 }, () => plain.int(0, 1_000_000)));
    expect(chunked(120, 60)).toEqual(once);
    expect(chunked(120, 7)).toEqual(once);
    // never the old behaviour: every chunk starting the sequence anew
    expect(chunked(120, 60)).not.toEqual([...once.slice(0, 60), ...once.slice(0, 60)]);
  });
});
