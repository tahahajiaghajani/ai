// Contributors compiled onto rows (k_users / k_groups), so that the row rules of the knowledge tables test the row's own
// columns (src/shared/tables/knowledge.ts, CONTRIBUTORS). Two reasons: the engine compiles a dot-walked group test
// (`base_id.k_groups in_my_groups`) of a member without groups to `false` but keeps the parameters of the walk, which
// PostgreSQL refuses ("could not determine data type of parameter $n") — an engine request; and an own column is far
// cheaper than a correlated sub-query, with its own access predicate, on every row of every read.
//
//   kb_category, kb_snippet, kb_decision_tree   the base's contributors
//   kb_article                                  the base's contributors and the managed-by groups of its category chain
//   kb_version, kb_feedback, kb_task,           everyone who works the article: its author, owner and owner group and
//   kb_attestation, kb_ack                      the article's compiled contributors
//
// Rows get their values when they are created or move to another parent (before-write hooks, same transaction).
// Changes flow down with the job `kb.contrib` — a base → its categories, snippets, trees and articles; a category →
// its articles; an article → its children — in bounded batches that queue themselves again until nothing is stale.
import type { Ctx } from "../../context";
import { condEnv, orgSchema, readable, registerHooks, systemCtx, updateIn, type WriteArgs } from "../../engine";
import { enqueue, registerJobHandler } from "../../jobs";
import { ids, isUuid, liveRow, liveRows, sysOf, type Row } from "./common";

export interface Contrib {
  k_users: string[];
  k_groups: string[];
}

/** Tables whose rows belong to an article. */
export const ARTICLE_CHILDREN = ["kb_version", "kb_feedback", "kb_task", "kb_attestation", "kb_ack"] as const;
/** Tables whose rows belong to a base (besides articles). */
export const BASE_CHILDREN = ["kb_category", "kb_snippet", "kb_decision_tree"] as const;

/** Sorted, unique, lower-case ids: the stored form (so that stale rows are found by comparison). */
const norm = (xs: unknown[]): string[] => ids(xs).sort();
const same = (a: unknown, b: string[]) => {
  const x = norm(Array.isArray(a) ? a : []);
  return x.length === b.length && x.every((v, i) => v === b[i]);
};

export const baseContrib = (base: Row | null): Contrib => ({ k_users: norm(base?.k_users ?? []), k_groups: norm(base?.k_groups ?? []) });
export const articleContrib = (base: Row | null, category: Row | null): Contrib => ({
  k_users: norm(base?.k_users ?? []),
  k_groups: norm([...(base?.k_groups ?? []), ...(category?.m_groups ?? [])]),
});
/** Everyone who works an article (for the rows that belong to it). */
export const workersOf = (article: Row | null): Contrib => ({
  k_users: norm([article?.author_id, article?.owner_id, ...(article?.k_users ?? [])]),
  k_groups: norm([article?.owner_group_id, ...(article?.k_groups ?? [])]),
});

const moved = (w: WriteArgs, field: string) => w.op === "create" || w.changed.has(field);

// ---------------------------------------------------------------------------------------------------------------
// before-write: a new row, or a row that moved to another parent, takes its parent's values

async function fromBase(w: WriteArgs): Promise<void> {
  if (w.op === "delete" || !moved(w, "base_id")) return;
  const base = w.next.base_id ? await liveRow(w.tx, sysOf(w.ctx), "kb_base", w.next.base_id) : null;
  Object.assign(w.next, baseContrib(base));
}

async function articleBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete" || !(moved(w, "base_id") || moved(w, "category_id"))) return;
  const sys = sysOf(w.ctx);
  const base = await liveRow(w.tx, sys, "kb_base", w.next.base_id);
  const category = w.next.category_id ? await liveRow(w.tx, sys, "kb_category", w.next.category_id) : null;
  Object.assign(w.next, articleContrib(base, category));
}

async function fromArticle(w: WriteArgs): Promise<void> {
  if (w.op === "delete" || !moved(w, "article_id")) return;
  const article = w.next.article_id ? await liveRow(w.tx, sysOf(w.ctx), "kb_article", w.next.article_id) : null;
  Object.assign(w.next, workersOf(article));
}

// ---------------------------------------------------------------------------------------------------------------
// after-write: a change of who contributes flows down (job)

const later = (w: WriteArgs, payload: Row, key: string) =>
  enqueue(w.tx, { kind: "kb.contrib", orgId: w.ctx.org.id, payload, dedupeKey: `kb.contrib:${key}` });

async function baseAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "update" && (w.changed.has("k_users") || w.changed.has("k_groups"))) await later(w, { base_id: w.row.id }, w.row.id);
}
async function categoryAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if ((w.op === "update" || w.op === "transition") && w.changed.has("m_groups")) await later(w, { category_id: w.row.id }, w.row.id);
}
async function articleAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if ((w.op === "update" || w.op === "transition") && ["k_users", "k_groups", "author_id", "owner_id", "owner_group_id"].some((f) => w.changed.has(f))) {
    await later(w, { article_id: w.row.id }, w.row.id);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// the job

const BATCH = 200;

/** Bring the rows of `table` under `parentField = parentId` to their wanted values (a batch); true when more remain. */
async function syncRows(sys: Ctx, table: string, parentField: string, parentId: string, wantOf: (r: Row) => Contrib, cols: string[] = []): Promise<boolean> {
  const schema = await orgSchema(sys);
  const def = schema.def(table);
  if (!def) return false;
  const env = await condEnv(sys);
  const params: unknown[] = [];
  const where = [readable(sys, def, "t", params, env)];
  params.push(parentId);
  where.push(`t.${parentField} = $${params.length}::uuid`);
  const rows = await sys.db.query<Row>(`select t.id, t.k_users, t.k_groups${cols.map((c) => `, t.${c}`).join("")} from ${def.table} t where ${where.join(" and ")} order by t.id limit 20000`, params);
  const todo = rows.map((r) => ({ id: String(r.id), want: wantOf(r), r })).filter((x) => !same(x.r.k_users, x.want.k_users) || !same(x.r.k_groups, x.want.k_groups));
  if (!todo.length) return false;
  const batch = todo.slice(0, BATCH);
  await sys.write(async (tx) => {
    for (const x of batch) await updateIn(tx, sys, table, x.id, { ...x.want }, { trusted: true, keepVersion: true, allowLocked: true });
  });
  return todo.length > batch.length;
}

/** One round of propagation from a base, a category or an article; true when another round is needed. */
export async function propagateContrib(sys: Ctx, p: { base_id?: string; category_id?: string; article_id?: string }): Promise<boolean> {
  let more = false;
  if (isUuid(p.base_id)) {
    const base = await liveRow(sys.db, sys, "kb_base", p.base_id);
    if (base) {
      for (const t of BASE_CHILDREN) more = (await syncRows(sys, t, "base_id", base.id, () => baseContrib(base))) || more;
      const cats = new Map((await liveRows(sys.db, sys, "kb_category", { f: "base_id", op: "eq", v: base.id }, { limit: 5000 })).map((c) => [String(c.id), c]));
      more = (await syncRows(sys, "kb_article", "base_id", base.id, (r) => articleContrib(base, r.category_id ? cats.get(String(r.category_id)) ?? null : null), ["category_id"])) || more;
    }
  }
  if (isUuid(p.category_id)) {
    const category = await liveRow(sys.db, sys, "kb_category", p.category_id);
    const base = category ? await liveRow(sys.db, sys, "kb_base", category.base_id) : null;
    if (category && base) more = (await syncRows(sys, "kb_article", "category_id", category.id, () => articleContrib(base, category))) || more;
  }
  if (isUuid(p.article_id)) {
    const article = await liveRow(sys.db, sys, "kb_article", p.article_id);
    if (article) for (const t of ARTICLE_CHILDREN) more = (await syncRows(sys, t, "article_id", article.id, () => workersOf(article))) || more;
  }
  return more;
}

let installed = false;

export function installContributors(): void {
  if (installed) return;
  installed = true;
  registerHooks("kb_base", { afterWrite: baseAfter });
  registerHooks("kb_category", { beforeWrite: fromBase, afterWrite: categoryAfter });
  registerHooks("kb_article", { beforeWrite: articleBefore, afterWrite: articleAfter });
  for (const t of ["kb_snippet", "kb_decision_tree"]) registerHooks(t, { beforeWrite: fromBase });
  for (const t of ARTICLE_CHILDREN) registerHooks(t, { beforeWrite: fromArticle });
  registerJobHandler("kb.contrib", async (job, jctx) => {
    if (!job.org_id) return;
    const sys = await systemCtx(jctx.cfg, job.org_id);
    const more = await propagateContrib(sys, (job.payload ?? {}) as { base_id?: string; category_id?: string; article_id?: string });
    return more ? { again: 0 } : undefined;
  });
}
