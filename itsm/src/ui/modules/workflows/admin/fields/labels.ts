// Library fields that carry the same label (the owner's click-through of 1.1.5: the demo pack's «واحد مجری» and the
// owner's own «واحد مجری» looked the same in the form designer's palette — «واحد مجری · واحد سازمانی» twice). Where a
// field is picked, its technical name tells it apart from a field with the same label; «فیلد تازه» warns when the
// label it is given is one another library field carries, and saves all the same. No React, no requests: tested in
// tests/workflows-fields-labels-ui.test.ts.
import { normalizeFa } from "../../../../lib/fa";
import type { LibraryEntry } from "./api";

/** A label as people compare it: ی/ي، ک/ك، نیم‌فاصله و فاصله‌ها، حروف لاتین کوچک یکسان. */
export const labelKey = (label: string | null | undefined): string => normalizeFa(String(label ?? ""));

/** The labels (as `labelKey`s) two or more library fields in use share: those fields show their technical names. */
export function sharedLabels(lib: readonly Pick<LibraryEntry, "label" | "status">[]): Set<string> {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const e of lib) {
    if (e.status === "retired") continue;
    const k = labelKey(e.label);
    if (!k) continue;
    if (seen.has(k)) out.add(k);
    seen.add(k);
  }
  return out;
}

/** The library fields in use, other than `self`, that already carry `label` (none for an empty label). */
export function sameLabelFields<T extends Pick<LibraryEntry, "id" | "label" | "status">>(lib: readonly T[], label: string, self: string | null = null): T[] {
  const k = labelKey(label);
  return k ? lib.filter((e) => e.id !== self && e.status !== "retired" && labelKey(e.label) === k) : [];
}
