// Insight cards: storage and THE VISIBILITY RULE (docs/spec/AI.md §16.2). Insights are computed once per period for
// the whole organisation (as the system), so a card is shown to a member only when they could have computed it
// themselves:
//   1. they read the card's table and see every field it grouped or measured by;
//   2. they read EVERY record of the card's condition — the engine's count of those records with their access equals
//      the count without access (live rows; checked when they look, so a record that became confidential or moved to
//      another group since hides the card);
//   3. they read every record the card names (services, groups, SLA definitions of its drivers).
// Otherwise the card is not shown — not even its title; the page says how many of the period's cards are not theirs.
// Narratives are written from the card's numbers only; a model's narrative is cached on the card for everyone who passes
// the same rule.
import { uuidv7 } from "@shared/id";
import { dateISOIn, formatJalaliDateTime } from "@shared/jalali";
import { pgArray } from "../../../db";
import type { Cond } from "@shared/model/conditions";
import { INSIGHT_KINDS, type InsightView } from "@shared/ai/insights";
import type { Ctx } from "../../../context";
import { access } from "../../../access/provider";
import { readableIds } from "../../../access/service";
import { aggregate, orgSchema, systemCtx } from "../../../engine";
import type { InsightDraft, Period } from "./compute";

export interface InsightRow {
  id: string;
  period: "daily" | "weekly";
  period_key: string;
  kind: string;
  table_key: string;
  subject: string;
  scope: { table: string; cond: Cond; label?: string };
  fields: string[];
  refs: { table: string; ids: string[] }[];
  severity: InsightView["severity"];
  score: number;
  title: string;
  numbers: InsightView["numbers"];
  drivers: InsightView["drivers"] & { field?: string }[];
  narrative: string | null;
  narrative_ai: boolean;
  notified_at: string | null;
  created_at: string;
}

const RUN = "_run";
const COLS = `id, period, period_key, kind, table_key, subject, scope, fields, refs, severity, score::float8 as score, title, numbers, drivers, narrative, narrative_ai, notified_at, created_at`;

const INSERT_COLS = `(id, org_id, period, period_key, kind, table_key, subject, scope, fields, refs, severity, score, title, numbers, drivers, narrative)
  values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::text[], $10::jsonb, $11, $12, $13, $14::jsonb, $15::jsonb, $16)`;

const draftParams = (sys: Ctx, period: string, key: string, label: string, d: InsightDraft): unknown[] => [
  uuidv7(),
  sys.org.id,
  period,
  key,
  d.kind,
  d.table,
  d.subject,
  JSON.stringify({ ...d.scope, label }),
  `{${d.fields.join(",")}}`,
  JSON.stringify(d.refs),
  d.severity,
  d.score,
  d.title,
  JSON.stringify(d.numbers),
  JSON.stringify(d.drivers.map((x) => ({ ...x, field: d.driver_field }))),
  d.narrative,
];

/**
 * Store a period's cards and its run marker. A card computed again («محاسبه اکنون») is the same card — updated in place
 * by its key (period, kind, table, subject), keeping its id, its announcement (`notified_at`: never announced twice) and
 * a model's narrative; cards the new run no longer finds go. Alert storms are the hourly check's (`saveStorms`).
 */
export async function saveInsights(sys: Ctx, p: Period, drafts: readonly InsightDraft[]): Promise<number> {
  await sys.write(
    async (tx) => {
      for (const d of drafts) {
        await tx.query(
          `insert into sm_ai_insights ${INSERT_COLS}
           on conflict (org_id, period, period_key, kind, table_key, subject) do update set
             scope = excluded.scope, fields = excluded.fields, refs = excluded.refs, severity = excluded.severity, score = excluded.score,
             title = excluded.title, numbers = excluded.numbers, drivers = excluded.drivers,
             narrative = case when sm_ai_insights.narrative_ai then sm_ai_insights.narrative else excluded.narrative end`,
          draftParams(sys, p.kind, p.key, p.label, d),
        );
      }
      const keep = drafts.map((d) => `${d.kind}|${d.table}|${d.subject}`);
      await tx.query(
        `delete from sm_ai_insights where org_id = $1 and period = $2 and period_key = $3 and kind not in ('alert_storm', $4) and not ((kind || '|' || table_key || '|' || subject) = any($5::text[]))`,
        [sys.org.id, p.kind, p.key, RUN, pgArray(keep)],
      );
      await tx.query(
        `insert into sm_ai_insights (id, org_id, period, period_key, kind, table_key, title) values ($1, $2, $3, $4, $5, '', '') on conflict (org_id, period, period_key, kind, table_key, subject) do nothing`,
        [uuidv7(), sys.org.id, p.kind, p.key, RUN],
      );
    },
    { internal: true },
  );
  return drafts.length;
}

/** Store the hourly check's alert storms under the day of their hour (one card per table and hour, never again). */
export async function saveStorms(sys: Ctx, drafts: readonly InsightDraft[], tz: string): Promise<number> {
  if (!drafts.length) return 0;
  let n = 0;
  await sys.write(
    async (tx) => {
      for (const d of drafts) {
        const hour = Date.parse(`${d.subject}:00:00.000Z`);
        const day = Number.isNaN(hour) ? new Date().toISOString().slice(0, 10) : dateISOIn(hour, tz);
        const label = Number.isNaN(hour) ? d.subject : formatJalaliDateTime(new Date(hour).toISOString(), tz);
        const r = await tx.query(`insert into sm_ai_insights ${INSERT_COLS} on conflict (org_id, period, period_key, kind, table_key, subject) do nothing returning id`, draftParams(sys, "daily", day, label, d));
        n += r.length;
      }
    },
    { internal: true },
  );
  return n;
}

/** Was the period already computed on this runtime? */
export async function computed(sys: Ctx, p: Pick<Period, "kind" | "key">): Promise<boolean> {
  return !!(await sys.db.one(`select 1 from sm_ai_insights where org_id = $1 and period = $2 and period_key = $3 and kind = $4`, [sys.org.id, p.kind, p.key, RUN]));
}

export async function insightRows(ctx: Ctx, opts: { period?: string; key?: string; id?: string; limit?: number; since?: string } = {}): Promise<InsightRow[]> {
  const params: unknown[] = [ctx.org.id, RUN];
  let where = `org_id = $1 and kind <> $2`;
  if (opts.period) where += ` and period = $${params.push(opts.period)}`;
  if (opts.key) where += ` and period_key = $${params.push(opts.key)}`;
  if (opts.id) where += ` and id = $${params.push(opts.id)}`;
  if (opts.since) where += ` and created_at >= $${params.push(opts.since)}`;
  return ctx.db.query<InsightRow>(`select ${COLS} from sm_ai_insights where ${where} order by created_at desc, score desc limit ${Math.max(1, Math.min(500, opts.limit ?? 100))}`, params);
}

/** A per-request memory of the rule's counts (the same condition is checked once). */
export class VisibilityCache {
  private counts = new Map<string, Promise<number>>();
  constructor(private ctx: Ctx) {}
  private sys: Promise<Ctx> | null = null;
  async total(table: string, cond: Cond): Promise<number> {
    this.sys ??= systemCtx(this.ctx.cfg, this.ctx.org.id);
    return this.memo(`s:${table}:${JSON.stringify(cond)}`, async () => countOf(await this.sys!, table, cond));
  }
  async mine(table: string, cond: Cond): Promise<number> {
    return this.memo(`m:${table}:${JSON.stringify(cond)}`, () => countOf(this.ctx, table, cond));
  }
  private memo(k: string, fn: () => Promise<number>): Promise<number> {
    let p = this.counts.get(k);
    if (!p) {
      p = fn();
      this.counts.set(k, p);
    }
    return p;
  }
}

async function countOf(ctx: Ctx, table: string, cond: Cond): Promise<number> {
  const r = await aggregate(ctx, table, { filter: cond, metrics: [{ fn: "count" }] });
  return Number(r.totals.count ?? 0) || 0;
}

/** The visibility rule of one card for one member (see the file's head). */
export async function canSee(ctx: Ctx, row: Pick<InsightRow, "scope" | "fields" | "refs" | "table_key">, cache = new VisibilityCache(ctx)): Promise<boolean> {
  if (ctx.actor === "system") return true;
  const schema = await orgSchema(ctx);
  const table = row.scope?.table || row.table_key;
  const def = schema.def(table);
  if (!def || def.virtual || !access().canReadTable(ctx, def)) return false;
  const visible = access().visibleFields(ctx, def);
  if (visible && row.fields.some((f) => !visible.has(f) && !["created_at", "updated_at", "id"].includes(f))) return false;
  try {
    const [all, mine] = await Promise.all([cache.total(table, row.scope.cond), cache.mine(table, row.scope.cond)]);
    if (mine !== all) return false;
  } catch {
    return false;
  }
  for (const r of row.refs ?? []) {
    if (!r.ids?.length) continue;
    const ok = await readableIds(ctx, r.table, r.ids).catch(() => new Set<string>());
    if (ok.size !== new Set(r.ids.map((x) => x.toLowerCase())).size) return false;
  }
  return true;
}

/** A card as the UI shows it. */
export async function viewOf(ctx: Ctx, r: InsightRow): Promise<InsightView> {
  const schema = await orgSchema(ctx);
  const def = schema.def(r.table_key);
  const drivers = (r.drivers ?? []) as (InsightView["drivers"][number] & { field?: string | null })[];
  return {
    id: r.id,
    period: r.period,
    period_key: r.period_key,
    period_label: r.scope?.label ?? r.period_key,
    kind: r.kind,
    kind_label: INSIGHT_KINDS[r.kind] ?? r.kind,
    table: r.table_key,
    table_label: def?.plural ?? r.table_key,
    severity: r.severity,
    anomaly: ["volume_spike", "alert_storm"].includes(r.kind) || (r.kind === "reopen" && r.severity !== "info"),
    score: Number(r.score),
    title: r.title,
    numbers: r.numbers,
    drivers: drivers.map(({ field: _f, ...d }) => d),
    driver_field: drivers[0]?.field ?? null,
    narrative: r.narrative,
    narrative_ai: r.narrative_ai,
    created_at: r.created_at,
  };
}

/** The cards a member may see (the rule above), with the count of those they may not. */
export async function visibleInsights(ctx: Ctx, rows: readonly InsightRow[]): Promise<{ views: InsightView[]; hidden: number }> {
  const cache = new VisibilityCache(ctx);
  const schema = await orgSchema(ctx);
  const views: InsightView[] = [];
  let hidden = 0;
  for (const r of rows) {
    if (await canSee(ctx, r, cache)) views.push(await viewOf(ctx, r));
    else {
      // counted only on tables of which the member reads some record: a table wholly closed to them (a secure
      // workspace's security incidents) does not even show as a number
      const table = r.scope?.table || r.table_key;
      const def = schema.def(table);
      if (def && !def.virtual && access().canReadTable(ctx, def) && (await cache.mine(table, { and: [] }).catch(() => 0)) > 0) hidden++;
    }
  }
  return { views, hidden };
}

/** Cache a model's narrative on a card (written from the card's numbers only). */
export async function storeNarrative(ctx: Ctx, id: string, text: string): Promise<void> {
  await ctx.write((tx) => tx.query(`update sm_ai_insights set narrative = $3, narrative_ai = true where org_id = $1 and id = $2`, [ctx.org.id, id, text.slice(0, 2000)]), { internal: true });
}
