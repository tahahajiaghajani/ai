// Incident clustering → problem candidates (catalogue AI-045, ANA-033; docs/spec/AI.md §13.4). Daily, per table with a
// problem reference: the records of the last 60 days not linked to a problem (confidential records and secure
// workspaces left out) are embedded locally and clustered; clusters close to an open problem's text are dropped, and so
// are clusters that repeat one a person already dismissed or turned into a problem. A cluster is shown with LATE
// BINDING: a viewer sees only its members they may read, its label words come from those members, and it is listed
// only while at least `MIN_VISIBLE` of its members are readable to them — counts and words of unreadable records never
// reach the screen.
import { uuidv7 } from "@shared/id";
import { STOP_WORDS, words } from "@shared/ai/text";
import type { Ctx } from "../../../context";
import { pgArray } from "../../../db";
import { orgSchema } from "../../../engine";
import { readableIds } from "../../../access/service";
import { localEmbed } from "../rag/local-embed";
import { clusterVectors, dot } from "./core/cluster";
import { readRows, rowText } from "./data";
import type { ClusterSpec } from "./specs";
import { access } from "../../../access/provider";

const DAY = 86_400_000;
/** A viewer sees a cluster when at least this many of its members are readable to them. */
export const MIN_VISIBLE = 3;

export interface ClusterRunResult {
  points: number;
  clusters: number;
  noise: number;
  dropped_covered: number;
}

/** Cluster the unlinked records of a table and store the run's clusters (open ones of the previous run replaced). */
export async function runClusters(sys: Ctx, spec: ClusterSpec): Promise<ClusterRunResult> {
  const schema = await orgSchema(sys);
  const def = schema.def(spec.table);
  if (!def) return { points: 0, clusters: 0, noise: 0, dropped_covered: 0 };
  const since = new Date(Date.now() - 60 * DAY).toISOString();
  const rows = (await readRows(sys, def, spec.text, { where: { f: spec.link, op: "empty" }, training: true, sql: `t.created_at >= $1`, params: [since], limit: 2000, order: "t.created_at, t.id" })).filter(
    (r) => rowText(r, spec.text).length >= 8,
  );
  const vs = rows.map((r) => localEmbed(rowText(r, spec.text)));
  const { clusters, noise } = clusterVectors(vs, { join: 0.42, minSize: 4, cohesion: 0.5 });
  // problems already open cover their clusters
  const problemDef = schema.def("problem");
  const problems = problemDef ? await readRows(sys, problemDef, ["short_description", "description"], { where: { f: "active", op: "eq", v: true }, limit: 2000 }) : [];
  const pv = problems.map((p) => localEmbed(rowText(p, ["short_description", "description"])));
  const past = await sys.db.query<{ members: string[] }>(`select members from sm_ai_clusters where org_id = $1 and table_key = $2 and status in ('dismissed', 'converted') and run_at > now() - interval '90 days'`, [sys.org.id, def.key]);
  const pastSets = past.map((p) => new Set(p.members));
  let dropped = 0;
  const keep = clusters.filter((c) => {
    if (pv.some((v) => dot(v, c.centre) >= 0.6)) {
      dropped++;
      return false;
    }
    const ids = c.members.map((i) => rows[i].id);
    const repeat = pastSets.some((s) => ids.filter((x) => s.has(x)).length >= 0.6 * ids.length);
    if (repeat) dropped++;
    return !repeat;
  });
  await sys.write(
    async (tx) => {
      await tx.query(`delete from sm_ai_clusters where org_id = $1 and table_key = $2 and status = 'open'`, [sys.org.id, def.key]);
      for (const c of keep) {
        await tx.query(`insert into sm_ai_clusters (id, org_id, table_key, size, cohesion, members, sims) values ($1, $2, $3, $4, $5, $6::uuid[], $7::jsonb)`, [
          uuidv7(),
          sys.org.id,
          def.key,
          c.members.length,
          c.cohesion,
          pgArray(c.members.map((i) => rows[i].id)),
          JSON.stringify(c.sims),
        ]);
      }
    },
    { internal: true },
  );
  return { points: rows.length, clusters: keep.length, noise: noise.length, dropped_covered: dropped };
}

/** The most frequent meaningful words of some texts (a cluster's label, from what the viewer may read). */
export function labelWords(texts: readonly string[], k = 4): string[] {
  const df = new Map<string, number>();
  for (const t of texts) for (const w of new Set(words(t).filter((x) => x.length >= 3 && !STOP_WORDS.has(x) && !/\d{3,}/.test(x)))) df.set(w, (df.get(w) ?? 0) + 1);
  return [...df.entries()]
    .filter(([, n]) => n >= Math.max(2, Math.ceil(texts.length * 0.3)))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, k)
    .map(([w]) => w);
}

export interface ClusterView {
  id: string;
  table: string;
  run_at: string;
  status: string;
  problem_id: string | null;
  /** readable members only, closest to the centre first */
  members: { id: string; number: string | null; title: string; sim: number }[];
  /** members the viewer reads (never the cluster's full size) */
  size: number;
  cohesion: number;
  words: string[];
}

/** The open clusters of a table as the viewer may see them (late binding, see the file's head). */
export async function clustersFor(ctx: Ctx, table: string, opts: { status?: string; id?: string } = {}): Promise<ClusterView[]> {
  const def = (await orgSchema(ctx)).def(table);
  if (!def) return [];
  const params: unknown[] = [ctx.org.id, table, opts.status ?? "open"];
  const rows = await ctx.db.query<{ id: string; run_at: string; status: string; problem_id: string | null; members: string[]; sims: number[]; cohesion: string }>(
    `select id, run_at, status, problem_id, members, sims, cohesion from sm_ai_clusters where org_id = $1 and table_key = $2 and status = $3${opts.id ? ` and id = $${params.push(opts.id)}` : ""} order by size desc, run_at desc limit 50`,
    params,
  );
  if (!rows.length) return [];
  const readable = await readableIds(ctx, table, [...new Set(rows.flatMap((r) => r.members))]);
  // the display field only when the viewer sees it (else the number alone)
  const visible = access().visibleFields(ctx, def);
  const title = !visible || visible.has(def.display) ? def.display : null;
  const out: ClusterView[] = [];
  for (const r of rows) {
    const mine = r.members.map((id, i) => ({ id, sim: Number(r.sims[i] ?? 0) })).filter((x) => readable.has(x.id));
    if (mine.length < MIN_VISIBLE) continue;
    const recs = await readRows(ctx, def, [...(title ? [title] : []), ...(def.numbered ? ["number"] : [])], { ids: mine.map((x) => x.id), limit: mine.length });
    const byId = new Map(recs.map((x) => [x.id, x]));
    const members = mine
      .filter((x) => byId.has(x.id))
      .map((x) => ({ id: x.id, number: (byId.get(x.id)!.number as string | null) ?? null, title: title ? String(byId.get(x.id)![title] ?? "") : "", sim: x.sim }));
    if (members.length < MIN_VISIBLE) continue;
    out.push({ id: r.id, table, run_at: r.run_at, status: r.status, problem_id: r.problem_id, members, size: members.length, cohesion: Number(r.cohesion), words: labelWords(members.map((x) => x.title)) });
  }
  return out;
}

/** A person's decision on a cluster: dismissed, or turned into a problem (its id) — an ordinary write. */
export async function decideCluster(ctx: Ctx, id: string, decision: { status: "dismissed" } | { status: "converted"; problem_id: string }): Promise<void> {
  await ctx.write((tx) =>
    tx.query(`update sm_ai_clusters set status = $3, problem_id = $4, decided_by = $5, decided_at = now() where org_id = $1 and id = $2`, [
      ctx.org.id,
      id,
      decision.status,
      decision.status === "converted" ? decision.problem_id : null,
      ctx.user.id,
    ]),
  );
}

/** Does the caller read every member of the cluster (not only the few that make it visible to them)? */
export async function readsWholeCluster(ctx: Ctx, table: string, id: string): Promise<boolean> {
  const r = await ctx.db.one<{ members: string[] }>(`select members from sm_ai_clusters where org_id = $1 and table_key = $2 and id = $3`, [ctx.org.id, table, id]);
  if (!r) return false;
  const members = [...new Set((r.members ?? []).map(String))];
  const readable = await readableIds(ctx, table, members);
  return members.every((m) => readable.has(m));
}
