// What a case's values show by (release 1.1.5; the rule is @shared/process/display): the names of what the values name
// — people, groups, units, organisational roles and locations by name, the case's files by name, a record a «رکورد»
// field names by its number only (its title is for those who may read it) — read in one query per kind, and the
// organisation's money unit. The title, «تعیین مقدار», «اعلان» and the printable view use it, so a value reads the
// same in each of them as on the case page.
import type { FieldDef } from "@shared/model/types";
import { FIELD_TYPES, refTarget } from "@shared/model/types";
import { attachmentIds } from "@shared/forms/validators";
import type { MoneyUnit } from "@shared/financial/logic";
import type { FlowData, PillText } from "@shared/flows";
import { CASE_ROOT } from "@shared/process/graph";
import { casePillKey, caseValueText, type DisplayEnv } from "@shared/process/display";
import { tableDef } from "@shared/tables";
import { pgArray, type Queryable } from "../../../db";
import { isId, peopleNames } from "./store";

/** The organisation's structure, named by its rows' names (every member reads it). */
const NAMED = ["org_unit", "group", "position", "location"] as const;

/** The case keys beside the values that name people and the unit. */
const META_REFS: Record<string, string> = { requested_by: "user", requested_for: "user", unit_id: "org_unit" };

const ids = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).filter(isId).map((x) => x.toLowerCase());

/** The organisation's money unit (financial settings «نمایش مبلغ‌ها»; Rials when none is set). */
export async function orgMoneyUnit(q: Queryable, orgId: string): Promise<MoneyUnit> {
  const def = tableDef("financial_config");
  if (!def) return "rial";
  const row = await q.one<{ unit: string | null }>(`select currency_display as unit from ${def.table} where org_id = $1 and deleted_at is null order by created_at limit 1`, [orgId]);
  return row?.unit === "toman" ? "toman" : "rial";
}

/**
 * The names `values` need, by id (lower case): what each value names by its field in `fields` (and the requester,
 * «برای چه کسی» and the unit beside them). `keys` limits it to the values a text uses (default: all of them).
 */
export async function caseNames(q: Queryable, orgId: string, fields: ReadonlyMap<string, FieldDef>, values: Readonly<Record<string, unknown>>, keys?: Iterable<string>): Promise<Map<string, string>> {
  const byTarget = new Map<string, Set<string>>();
  const files = new Set<string>();
  const add = (target: string | null, v: unknown) => {
    if (!target) return;
    const set = byTarget.get(target) ?? new Set<string>();
    for (const id of ids(v)) set.add(id);
    if (set.size) byTarget.set(target, set);
  };
  for (const key of keys ?? Object.keys(values)) {
    const v = values[key];
    if (v === null || v === undefined || v === "") continue;
    if (key in META_REFS) {
      add(META_REFS[key], v);
      continue;
    }
    const f = fields.get(key);
    if (!f) continue;
    if (f.check === "attachments") for (const id of attachmentIds(f, v).ids ?? []) files.add(id);
    else if (FIELD_TYPES[f.type]?.family === "ref") add(refTarget(f), v);
  }
  const names = new Map<string, string>();
  const people = byTarget.get("user");
  if (people?.size) for (const [id, name] of await peopleNames(q, [...people])) names.set(id.toLowerCase(), name);
  for (const [target, set] of byTarget) {
    if (target === "user" || !set.size) continue;
    const def = tableDef(target);
    if (!def) continue;
    const list = pgArray([...set]);
    if ((NAMED as readonly string[]).includes(target)) {
      for (const r of await q.query<{ id: string; name: string | null }>(`select id::text as id, name from ${def.table} where org_id = $1 and id = any($2::uuid[])`, [orgId, list])) {
        if (r.name) names.set(r.id.toLowerCase(), String(r.name));
      }
    } else if (def.numbered) {
      for (const r of await q.query<{ id: string; number: string | null }>(`select id::text as id, number from ${def.table} where org_id = $1 and id = any($2::uuid[])`, [orgId, list])) {
        if (r.number) names.set(r.id.toLowerCase(), String(r.number));
      }
    }
  }
  if (files.size) {
    for (const r of await q.query<{ id: string; name: string }>(`select id::text as id, name from sm_attachments where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`, [orgId, pgArray([...files])])) {
      names.set(r.id.toLowerCase(), String(r.name));
    }
  }
  return names;
}

export interface CaseDisplay {
  env: DisplayEnv;
  /** the display text of a case key («» when there is nothing to show) */
  text(key: string): string;
  /**
   * The case pills of a text people read, for `renderText`: `{{case.<key>}}` as its display text; any other pill
   * (the clock, a step's output) null, for the caller's own rule.
   */
  pill: PillText;
}

/**
 * The display of a case's values (`values`: what `{{case.…}}` reads — the values by field name, the number, the title,
 * the people and the unit; `keys`: the keys a text uses, to read only the names those need).
 */
export async function caseDisplay(
  q: Queryable,
  orgId: string,
  opts: { fields: ReadonlyMap<string, FieldDef>; values: Readonly<Record<string, unknown>>; tz: string; keys?: Iterable<string> },
): Promise<CaseDisplay> {
  const keys = opts.keys ? [...opts.keys] : undefined;
  const money = [...(keys ?? Object.keys(opts.values))].some((k) => opts.fields.get(k)?.type === "money" && opts.values[k] !== null && opts.values[k] !== undefined && opts.values[k] !== "");
  const env: DisplayEnv = { names: await caseNames(q, orgId, opts.fields, opts.values, keys), tz: opts.tz, money: money ? await orgMoneyUnit(q, orgId) : "rial" };
  const text = (key: string) => caseValueText(key, opts.values, opts.fields, env);
  return {
    env,
    text,
    pill: (expr) => {
      const key = casePillKey(expr);
      return key === null ? null : text(key);
    },
  };
}

/** The case keys the `{{case.…}}` pills of `texts` name. */
export function casePillKeys(...texts: unknown[]): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown, depth = 0) => {
    if (depth > 20) return;
    if (typeof v === "string") {
      for (const m of v.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
        const key = casePillKey(m[1]);
        if (key) out.add(key);
      }
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach((x) => walk(x, depth + 1));
  };
  texts.forEach((t) => walk(t));
  return out;
}

/** The case values a run's pills read (`{{case.…}}`, the run kind's context): `data.case`. */
export const runCaseValues = (data: Readonly<FlowData>): Record<string, unknown> => {
  const c = data[CASE_ROOT];
  return c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : {};
};
