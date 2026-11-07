// The SQL form of the access policy (docs/spec/ACCESS.md § SQL generation): the same rule as the in-memory evaluator
// (@shared/access evaluate.ts), term by term, compiled into one parameterised predicate on the row aliased `alias`,
// so counts, pages, sorts, aggregates, exports, search and sync pulls are exact. Subject constants travel as
// parameters ($n): member group ids as uuid[] (`= any($n::uuid[])`), the caller as uuid or — for jsonb arrays of
// users — text (`?`). tests/access-parity.test.ts proves SQL == JS on random organisations.
import type { TableDef } from "@shared/model/types";
import {
  grantIn, restrictedOutside, scopeColumns, secureOutside, type Scope, type ScopeColumns, type Subject,
} from "@shared/access";
import { pgArray } from "../db";

/**
 * A module's extra participants of a record (e.g. the approvers of a pending approval): a SQL predicate on the row
 * aliased `alias` that holds when `userId` takes part in it, or null when the source does not apply to the table.
 * Participants read the record like its own people do (subject to the domain and confidentiality rules).
 */
export interface ParticipantSource {
  name: string;
  sql(def: TableDef, alias: string, params: unknown[], userId: string): string | null;
}

const sources: ParticipantSource[] = [];

/** Register a participant source (an approvals module: `exists (select 1 from sm_approvals a where …)`). */
export function registerParticipantSource(src: ParticipantSource): () => void {
  sources.push(src);
  return () => {
    const i = sources.indexOf(src);
    if (i >= 0) sources.splice(i, 1);
  };
}

export const participantSources = (): readonly ParticipantSource[] => sources;

class Builder {
  private me: { uuid?: string; text?: string } = {};
  constructor(
    readonly s: Subject,
    readonly c: ScopeColumns,
    readonly alias: string,
    readonly params: unknown[],
  ) {}

  p(v: unknown): string {
    this.params.push(v);
    return `$${this.params.length}`;
  }
  col(name: string): string {
    return `${this.alias}.${name}`;
  }
  /** the caller as a uuid parameter (pushed once) */
  meUuid(): string {
    return (this.me.uuid ??= `${this.p(this.s.userId)}::uuid`);
  }
  /** the caller as a text parameter for jsonb `?` (pushed once) */
  meText(): string {
    return (this.me.text ??= `${this.p(this.s.userId)}::text`);
  }
  /** column (a uuid, or a jsonb array of uuids when `array`) holds the caller */
  holdsMe(name: string, array: boolean): string {
    return array ? `coalesce(${this.col(name)} ? ${this.meText()}, false)` : `coalesce(${this.col(name)} = ${this.meUuid()}, false)`;
  }
  /** column holds one of `ids` */
  holdsAny(name: string, array: boolean, ids: readonly string[]): string {
    if (!ids.length) return "false";
    const list = this.p(pgArray([...ids]));
    return array ? `coalesce(${this.col(name)} ?| ${list}::text[], false)` : `coalesce(${this.col(name)} = any(${list}::uuid[]), false)`;
  }
  /** column is null or not one of `ids` */
  noneOf(name: string, ids: readonly string[]): string {
    if (!ids.length) return "true";
    return `(${this.col(name)} is null or ${this.col(name)} <> all(${this.p(pgArray([...ids]))}::uuid[]))`;
  }
  /** column is null or one of `ids` */
  nullOrAny(name: string, ids: readonly string[]): string {
    if (!ids.length) return `${this.col(name)} is null`;
    return `(${this.col(name)} is null or ${this.col(name)} = any(${this.p(pgArray([...ids]))}::uuid[]))`;
  }

  domain(): string {
    if (!this.s.domainSeparation || this.s.eff.domainsAll) return "true";
    return this.nullOrAny(this.c.domain, this.s.domainTree);
  }

  confidential(hasGroup: boolean): string {
    const c = this.c;
    if (!c.confidential || hasGroup) return "true";
    const allow = [
      c.group ? this.holdsAny(c.group, false, this.s.groups) : "false",
      ...[...c.assignee, ...c.requester].map((f) => this.holdsMe(f.name, f.array)),
      c.accessList ? this.holdsMe(c.accessList, true) : "false",
    ].filter((x) => x !== "false");
    return `(not coalesce(${this.col("confidential")}, false)${allow.length ? ` or ${allow.join(" or ")}` : ""})`;
  }

  own(def: TableDef): string {
    const c = this.c;
    const terms = c.own.map((f) => this.holdsMe(f.name, f.array));
    if (c.watchers) terms.push(this.holdsMe(c.watchers, true));
    for (const f of c.assignee) {
      const t = this.holdsAny(f.name, f.array, this.s.delegators);
      if (t !== "false") terms.push(t);
    }
    for (const src of sources) {
      const t = src.sql(def, this.alias, this.params, this.s.userId);
      if (t) terms.push(`(${t})`);
    }
    return or(terms);
  }

  scope(scope: Scope, write: boolean): string {
    const c = this.c;
    switch (scope) {
      case "group":
        return c.group ? this.holdsAny(c.group, false, write ? this.s.writeGroups : this.s.groups) : "false";
      case "unit":
        return this.s.unitId ? `coalesce(${this.col(c.unit)} = ${this.p(this.s.unitId)}::uuid, false)` : "false";
      case "unit_tree":
        return this.holdsAny(c.unit, false, this.s.unitTree);
      case "domain":
        return this.s.domainSeparation ? this.nullOrAny(c.domain, this.s.domainTree) : "true";
      case "all":
        return "true";
      default:
        return "false";
    }
  }

  workspace(): string {
    const ws = this.c.workspace;
    if (this.s.eff.workspacesAll) return this.noneOf(ws, secureOutside(this.s));
    return this.nullOrAny(ws, this.s.workspaces);
  }

  secure(): string {
    return this.noneOf(this.c.workspace, secureOutside(this.s));
  }

  restricted(): string {
    return this.c.group ? this.noneOf(this.c.group, restrictedOutside(this.s)) : "true";
  }

  requesterSide(): string {
    const c = this.c;
    if (!c.requester.length) return "false";
    const terms = [this.holdsAny(c.unit, false, this.s.managedTree), ...c.requester.map((f) => this.holdsAny(f.name, f.array, this.s.reportees))];
    return or(terms);
  }

  assigneeOwn(): string {
    return or(this.c.assignee.flatMap((f) => [this.holdsMe(f.name, f.array), this.holdsAny(f.name, f.array, this.s.delegators)]));
  }

  requesterOwn(): string {
    return or(this.c.requester.map((f) => this.holdsMe(f.name, f.array)));
  }
}

function or(terms: string[]): string {
  const t = terms.filter((x) => x !== "false");
  if (t.includes("true")) return "true";
  if (!t.length) return "false";
  return t.length === 1 ? t[0] : `(${t.join(" or ")})`;
}

function and(terms: string[]): string {
  const t = terms.filter((x) => x !== "true");
  if (t.includes("false")) return "false";
  if (!t.length) return "true";
  return t.length === 1 ? t[0] : `(${t.join(" and ")})`;
}

const hasGroup = (s: Subject, g: string) => s.kind !== "user" || s.eff.fieldGroups.includes(g as never);

const PLACEHOLDER = /\$(\d+)/g;

/**
 * Terms folded away (an `all` scope makes the whole OR true…) may have pushed parameters the final SQL no longer
 * names: drop them and renumber this predicate's own placeholders (those after `start`; the caller's stay).
 */
function compact(sql: string, params: unknown[], start: number): string {
  const used = new Set<number>();
  for (const m of sql.matchAll(PLACEHOLDER)) if (Number(m[1]) > start) used.add(Number(m[1]));
  if (used.size === params.length - start) return sql;
  const map = new Map<number, number>();
  const kept: unknown[] = [];
  for (let k = start + 1; k <= params.length; k++) {
    if (!used.has(k)) continue;
    kept.push(params[k - 1]);
    map.set(k, start + kept.length);
  }
  params.splice(start, params.length - start, ...kept);
  return sql.replace(PLACEHOLDER, (m, d: string) => (Number(d) > start ? `$${map.get(Number(d))}` : m));
}

/** The rows of `def` (aliased `alias`) the subject may read — tenant isolation included, deleted rows not filtered. */
export function readSql(s: Subject, def: TableDef, alias: string, params: unknown[]): string {
  const start = params.length;
  return compact(readTerms(s, def, alias, params), params, start);
}

function readTerms(s: Subject, def: TableDef, alias: string, params: unknown[]): string {
  params.push(s.orgId);
  const org = `${alias}.org_id = $${params.length}`;
  if (s.kind === "system" || def.virtual) return org;
  const g = grantIn(s.eff, def.area);
  if (g.read === "none") return "false";
  const c = scopeColumns(def);
  if (c.public) return org;
  const b = new Builder(s, c, alias, params);
  const restricted = b.restricted();
  const terms = [b.own(def), and([b.scope(g.read, false), b.workspace(), restricted]), and([b.requesterSide(), b.secure(), restricted])];
  return and([org, b.domain(), b.confidential(hasGroup(s, c.confidentialGroup)), or(terms)]);
}

/**
 * The rows of `def` the subject may change (`op: "write"`) or delete — the SQL form of `writeMode(...) !== null`
 * (resp. `=== "full"` for delete); used for bulk operations and the parity tests.
 */
export function writeSql(s: Subject, def: TableDef, alias: string, params: unknown[], op: "write" | "delete" = "write"): string {
  const start = params.length;
  return compact(writeTerms(s, def, alias, params, op), params, start);
}

function writeTerms(s: Subject, def: TableDef, alias: string, params: unknown[], op: "write" | "delete"): string {
  params.push(s.orgId);
  const org = `${alias}.org_id = $${params.length}`;
  if (s.kind === "system") return org;
  if (def.virtual) return "false";
  const g = grantIn(s.eff, def.area);
  const scope = op === "write" ? g.write : g.delete;
  if (scope === "none") return "false";
  const c = scopeColumns(def);
  const b = new Builder(s, c, alias, params);
  const terms = [b.assigneeOwn(), and([b.scope(scope, true), b.workspace(), b.restricted()])];
  if (op === "write" || !c.requesterWritable) terms.push(b.requesterOwn());
  return and([org, b.domain(), b.confidential(hasGroup(s, c.confidentialGroup)), or(terms)]);
}
