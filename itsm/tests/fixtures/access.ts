// A stand-in ITSM table for the access tests: an incident-like task in area "incident" with confidential rows,
// field-group protected fields (financial, internal, hr) and the task scope (caller, requested-for, opener,
// assignee, watchers, assignment group). Import it at the top of a test file, before the first server is made.
import { registerTable } from "@shared/tables";
import type { TableDef } from "@shared/model/types";

export const TICKET: TableDef = registerTable({
  key: "acc_ticket",
  table: "sm_acc_tickets",
  label: "تیکت",
  plural: "تیکت‌ها",
  icon: "ticket",
  module: "test",
  area: "incident",
  extends: "task",
  numbered: { prefix: "TKT", pad: 5 },
  display: "short_description",
  fields: [
    { name: "cost", label: "هزینه", type: "money", group: "financial", list: true },
    { name: "diagnosis", label: "تشخیص", type: "string", group: "internal", list: true, filter: true },
    { name: "salary_note", label: "یادداشت حقوق", type: "string", group: "hr" },
  ],
  scope: {},
  features: { confidential: true },
  list: { columns: ["number", "short_description", "state", "assigned_to", "cost", "diagnosis"], order: "-updated_at" },
});

/** A random generator with a seed (mulberry32): property tests replay exactly. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    chance: (p: number) => next() < p,
    pick<T>(xs: readonly T[]): T {
      return xs[Math.floor(next() * xs.length)];
    },
    maybe<T>(xs: readonly T[], p = 0.5): T | null {
      return next() < p && xs.length ? xs[Math.floor(next() * xs.length)] : null;
    },
    some<T>(xs: readonly T[], p = 0.3): T[] {
      return xs.filter(() => next() < p);
    },
  };
}
