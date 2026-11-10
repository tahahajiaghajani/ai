// The ITSM access provider (docs/spec/ACCESS.md): the engine's single decision point for who reads, creates, changes
// and deletes which rows and fields of every table — lists, records, aggregates, exports, journal, history,
// attachments, links, display values and sync pulls build their SQL with `readWhere`; writes ask canCreate /
// canWrite / canDelete / writableFields / canTransition, evaluated on the stored row in JS with the same rule.
// Installed for every server by src/server/access/index.ts (tests may still swap in a fake with setAccessProvider).
import type { TableDef } from "@shared/model/types";
import {
  canReadRow, canTransitionRow, grantIn, hasGroup, hiddenFields, scopeColumns, writeMode, type Subject,
} from "@shared/access";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import type { AccessProvider } from "./provider";
import { participantSources, readSql, type ParticipantSource } from "./predicate";
import { prepareSubject, preparedOf, subjectOf } from "./subject";
import { physicalTables } from "@shared/tables";

/** Per request: the tables a member takes part in through `grant` participant sources (one query per source). */
const participationCache = new WeakMap<Ctx, Promise<ReadonlySet<string>>>();
/** Per request and source: the tables its `tables()` names for the member (one cheap query per source and request). */
const sourceTables = new WeakMap<Ctx, Map<ParticipantSource, Promise<ReadonlySet<string>>>>();
/** Per request and table: the participant sources that name none of its rows for the member (prepareRead). */
const absentSources = new WeakMap<Ctx, Map<string, ReadonlySet<ParticipantSource>>>();

function tablesOf(ctx: Ctx, q: Queryable, src: ParticipantSource, orgId: string, userId: string): Promise<ReadonlySet<string>> {
  let m = sourceTables.get(ctx);
  if (!m) sourceTables.set(ctx, (m = new Map()));
  let p = m.get(src);
  if (!p) {
    p = src.tables!(q, orgId, userId).then((keys) => new Set(keys));
    m.set(src, p);
    p.catch(() => m!.delete(src));
  }
  return p;
}

async function participationsOf(ctx: Ctx, q: Queryable): Promise<ReadonlySet<string>> {
  const s = subjectOf(ctx);
  if (s.kind !== "user") return new Set();
  const out = new Set<string>();
  for (const src of participantSources()) {
    if ((src.reach ?? "scoped") !== "grant") continue;
    const applies = physicalTables().filter((d) => src.sql(d, "t", [], s.userId) !== null);
    if (!applies.length) continue;
    const named = src.tables ? await tablesOf(ctx, q, src, s.orgId, s.userId) : null;
    for (const d of applies) if (!named || named.has(d.key)) out.add(d.key);
  }
  return out;
}

/**
 * Before lists, aggregates and record reads of `def` (the engine's canOpenRecords): which participant sources name
 * no row of the table for this member right now — per request, from each source's own `tables()` query. Their terms
 * are left out of `readWhere` for this request: they would select nothing, and an OR term that no index answers (a
 * correlated subquery) would turn every list into a scan of the table. Sources without `tables()` always stay.
 */
async function prepareReadOf(ctx: Ctx, def: TableDef, q: Queryable): Promise<void> {
  const s = subjectOf(ctx);
  if (s.kind !== "user" || def.virtual) return;
  let m = absentSources.get(ctx);
  if (m?.has(def.key)) return;
  const absent = new Set<ParticipantSource>();
  for (const src of participantSources()) {
    if (!src.tables || src.sql(def, "t", [], s.userId) === null) continue;
    if (!(await tablesOf(ctx, q, src, s.orgId, s.userId)).has(def.key)) absent.add(src);
  }
  if (!m) absentSources.set(ctx, (m = new Map()));
  m.set(def.key, absent);
}

const visibleCache = new WeakMap<Subject, Map<TableDef, ReadonlySet<string> | null>>();

/** Fields of `def` the subject sees (null = all). */
function visible(s: Subject, def: TableDef): ReadonlySet<string> | null {
  let m = visibleCache.get(s);
  if (!m) visibleCache.set(s, (m = new Map()));
  if (m.has(def)) return m.get(def)!;
  const hidden = new Set(hiddenFields(s, def));
  const out = hidden.size ? new Set(def.fields.filter((f) => !hidden.has(f.name)).map((f) => f.name)) : null;
  m.set(def, out);
  return out;
}

export const itsmProvider: AccessProvider = {
  name: "itsm",
  readWhere(ctx, def, alias, params) {
    return readSql(subjectOf(ctx), def, alias, params, { absent: absentSources.get(ctx)?.get(def.key) });
  },
  prepareRead(ctx, def, q) {
    return prepareReadOf(ctx, def, q);
  },
  canReadTable(ctx, def) {
    const s = subjectOf(ctx);
    if (s.kind === "system" || def.virtual) return true;
    return grantIn(s.eff, def.area).read !== "none";
  },
  canCreate(ctx, def) {
    const s = subjectOf(ctx);
    if (s.kind === "system") return true;
    if (def.virtual) return false;
    return grantIn(s.eff, def.area).create;
  },
  canWrite(ctx, def, row) {
    return writeMode(subjectOf(ctx), def, row) !== null;
  },
  writeMode(ctx, def, row) {
    return writeMode(subjectOf(ctx), def, row);
  },
  canDelete(ctx, def, row) {
    return writeMode(subjectOf(ctx), def, row, "delete") === "full";
  },
  visibleFields(ctx, def) {
    return visible(subjectOf(ctx), def);
  },
  writableFields(ctx, def, row) {
    const s = subjectOf(ctx);
    const seen = visible(s, def);
    if (row && writeMode(s, def, row) === "requester") {
      const allowed = scopeColumns(def).requesterWritable ?? [];
      return new Set(allowed.filter((n) => !seen || seen.has(n)));
    }
    return seen;
  },
  hasFieldGroup(ctx, group) {
    return hasGroup(subjectOf(ctx), group);
  },
  canTransition(ctx, def, row, t) {
    return canTransitionRow(subjectOf(ctx), def, row, t);
  },
  participations(ctx, q) {
    let p = participationCache.get(ctx);
    if (!p) participationCache.set(ctx, (p = participationsOf(ctx, q)));
    return p;
  },
  async env(ctx) {
    const b = preparedOf(ctx) ?? (await prepareSubject(ctx));
    return { ...b.env };
  },
  async prepare(ctx, q) {
    await prepareSubject(ctx, q);
  },
};

/** May the subject read this row (JS form; the SQL form is `readWhere`)? */
export const rowReadable = (s: Subject, def: TableDef, row: Record<string, unknown>) => canReadRow(s, def, row);
