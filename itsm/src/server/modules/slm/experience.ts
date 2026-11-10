// Experience inputs of service level management (SLM-039/040/043/044): survey answers come from whichever module
// collects them, through a small registration hook — `registerExperienceSource` — and the module's default source
// reads the portal's `survey_response` table when it exists in this build (checked at run time, so the module works
// with or without the portal). Every read is as the system and only aggregates leave this file (CSAT, NPS, CES,
// happiness, lost time), suppressed below the organisation's minimum number of answers.
import { tableDef } from "@shared/tables";
import type { ExperienceInput } from "@shared/slm/logic";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { isUuid, liveRows, sysOf } from "./common";

export interface ExperienceQuery {
  /** answers about records of this service */
  service_id?: string | null;
  /** answers about these records (table and ids) */
  table_key?: string | null;
  record_ids?: string[];
  /** ISO instants [from, to) */
  from: string;
  to: string;
}

export interface ExperienceSource {
  name: string;
  /** null: the source has nothing to say for this organisation (its tables are missing) */
  responses(q: Queryable, sys: Ctx, query: ExperienceQuery): Promise<ExperienceInput[] | null>;
  /** the answer about one record (XLA), or null */
  forRecord?(q: Queryable, sys: Ctx, table: string, id: string): Promise<ExperienceInput | null>;
}

const sources: ExperienceSource[] = [];

/** Plug a module's survey answers into experience measures; returns an unregister function. */
export function registerExperienceSource(src: ExperienceSource): () => void {
  sources.push(src);
  return () => {
    const i = sources.indexOf(src);
    if (i >= 0) sources.splice(i, 1);
  };
}

export const experienceSources = (): readonly ExperienceSource[] => sources;

const pick = (r: Record<string, unknown>): ExperienceInput => ({
  csat: r.csat as number | null,
  nps: r.nps as number | null,
  ces: r.ces as number | null,
  happiness: r.happiness as number | null,
  lost_minutes: r.lost_minutes as number | null,
});

/** The default source: the portal's survey responses, when that table is part of this build. */
export const SURVEY_SOURCE: ExperienceSource = {
  name: "survey_response",
  async responses(q, sys, query) {
    if (!tableDef("survey_response")) return null;
    const and: Record<string, unknown>[] = [{ f: "submitted_at", op: "gte", v: query.from }, { f: "submitted_at", op: "lt", v: query.to }];
    if (query.service_id) and.push({ f: "service_id", op: "eq", v: query.service_id });
    if (query.table_key) and.push({ f: "table_key", op: "eq", v: query.table_key });
    if (query.record_ids) {
      const ids = query.record_ids.filter(isUuid);
      if (!ids.length) return [];
      and.push({ f: "record_id", op: "in", v: ids.slice(0, 500) });
    }
    const rows = await liveRows(q, sys, "survey_response", { and } as never, { limit: 5000 });
    return rows.map(pick);
  },
  async forRecord(q, sys, table, id) {
    if (!tableDef("survey_response")) return null;
    const [row] = await liveRows(q, sys, "survey_response", { and: [{ f: "table_key", op: "eq", v: table }, { f: "record_id", op: "eq", v: id }] }, { order: "t.submitted_at desc nulls last", limit: 1 });
    return row ? pick(row) : null;
  },
};

/** Every source's answers for a query (as the system). */
export async function experienceResponses(q: Queryable, ctx: Ctx, query: ExperienceQuery): Promise<{ responses: ExperienceInput[]; available: boolean }> {
  const sys = sysOf(ctx);
  const out: ExperienceInput[] = [];
  let available = false;
  for (const s of sources) {
    const r = await s.responses(q, sys, query).catch(() => null);
    if (r === null) continue;
    available = true;
    out.push(...r);
  }
  return { responses: out, available };
}

/** The first source's answer about one record (XLA). */
export async function recordExperience(q: Queryable, ctx: Ctx, table: string, id: string): Promise<ExperienceInput | null> {
  const sys = sysOf(ctx);
  for (const s of sources) {
    if (!s.forRecord) continue;
    const r = await s.forRecord(q, sys, table, id).catch(() => null);
    if (r) return r;
  }
  return null;
}
