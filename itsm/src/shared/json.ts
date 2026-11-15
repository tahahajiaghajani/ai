// JSON values compared as JSON, not as text: PostgreSQL's jsonb keeps no key order (it hands keys back sorted by length,
// then bytes), so a value read back from the database and the same value built in code are equal JSON whose
// `JSON.stringify` texts differ. Comparing those texts called every stored object "changed": a CI's health was written
// again on every check and each write queued the next check, forever (docs/PERFORMANCE_FA.md §20).

/** The value with the keys of every object sorted (what `JSON.stringify` does with it is otherwise unchanged). */
function sortedKeys(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  const toJSON = (v as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === "function") return sortedKeys((toJSON as () => unknown).call(v));
  if (Array.isArray(v)) return v.map(sortedKeys);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v).sort()) out[k] = sortedKeys((v as Record<string, unknown>)[k]);
  return out;
}

/**
 * `JSON.stringify` with the keys of every object in one order: equal texts for equal JSON whatever order the keys were
 * written in. Arrays keep their order; `undefined`, dates and the rest come out as `JSON.stringify` writes them.
 */
export function canonicalJson(v: unknown): string | undefined {
  return JSON.stringify(sortedKeys(v));
}

/** Are two values the same JSON (key order aside)? `undefined` and `null` stay apart, as `JSON.stringify` keeps them. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return canonicalJson(a) === canonicalJson(b);
}
