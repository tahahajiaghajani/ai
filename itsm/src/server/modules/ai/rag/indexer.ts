// The indexer: keeps the AI index of this runtime in step with its records, as the system, outside any write
// transaction (jobs and event subscribers). One record at a time: build its document (registry), skip it when the
// content hash is unchanged (only its version and access anchors move), chunk it, reuse the vectors of unchanged chunks,
// embed the rest with the local embedder and — when one is configured and answers — the organisation's model, then
// replace its chunks in one transaction. A provider failure never loses the record: its chunks are stored with local
// vectors and `rag.embed` adds the provider's later.
//
// Jobs: rag.index (one record), rag.embed (missing provider vectors, also after the model changed), rag.backfill (a
// table or everything, resumable), rag.reconcile (nightly: removes chunks of deleted records, indexes what is missing
// or stale, re-keys moved access anchors, creates ANN indexes; reports drift), rag.sweep (the Windows app, every few
// minutes: catches records the sync pull changed — pulls emit no events).
import { createHash } from "node:crypto";
import type { Ctx, ServerConfig } from "../../../context";
import type { Db } from "../../../db";
import type { TableDef } from "@shared/model/types";
import { cleanText, detectLang, searchForm } from "@shared/ai/text";
import { uuidv7 } from "@shared/id";
import { condEnv, loadReadable, onRecordEvent, orgSchema, systemCtx } from "../../../engine";
import { enqueue, registerJobHandler, type Job, type JobConfig, type JobContext, type JobResult } from "../../../jobs";
import { loadEnv, type AiEnv } from "../chain";
import { chunkDocument, CHUNKER_VERSION, type Chunk } from "./chunker";
import { activeEmbedder, embedTexts, EmbedUnavailableError, type EmbedderInfo } from "./embed";
import { localEmbed } from "./local-embed";
import { buildDocument, isRagTable, ragSource, ragTables } from "./registry";
import { ensureAnnIndexes, parseVector, replaceChunks, setChunkVectors, storeBackend, type ChunkWrite, type StoreBackend } from "./store";

export const RAG_JOBS = { index: "rag.index", embed: "rag.embed", backfill: "rag.backfill", reconcile: "rag.reconcile", sweep: "rag.sweep" } as const;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export interface IndexOutcome {
  status: "indexed" | "unchanged" | "removed" | "empty" | "skipped" | "error";
  chunks: number;
  /** provider vectors still missing (the model was unavailable) */
  pending: boolean;
  error?: string;
}

/** What the indexer shares while working through many records of one organisation. */
export interface IndexSession {
  sys: Ctx;
  env: AiEnv;
  embedder: EmbedderInfo | null;
  backend: StoreBackend;
  /** the model failed during this session: later records keep local vectors only (rag.embed follows) */
  embedDown: EmbedUnavailableError | null;
}

export async function indexSession(cfg: JobConfig | ServerConfig, orgId: string): Promise<IndexSession> {
  const sys = await systemCtx(cfg, orgId);
  const env = await loadEnv(sys);
  return { sys, env, embedder: await activeEmbedder(sys, env), backend: await storeBackend(sys.db), embedDown: null };
}

/** Remove a record from the index. */
export async function removeFromIndex(db: Db, orgId: string, table: string, id: string): Promise<void> {
  await db.tx(async (tx) => {
    await tx.query(`delete from sm_ai_chunks where org_id = $1 and table_key = $2 and record_id = $3`, [orgId, table, id]);
    await tx.query(`delete from sm_ai_rag_docs where org_id = $1 and table_key = $2 and record_id = $3`, [orgId, table, id]);
  });
}

const anchorsOf = (def: TableDef, row: Record<string, unknown>) => ({
  workspace_id: (row[def.scope.workspace ?? "workspace_id"] as string | null) ?? null,
  unit_id: (row[def.scope.unit ?? "unit_id"] as string | null) ?? null,
  domain_id: (row[def.scope.domain ?? "domain_id"] as string | null) ?? null,
});

async function saveState(db: Db, s: { orgId: string; table: string; id: string; version: number | null; hash: string | null; title: string | null; chunks: number; status: string; error: string | null; vecKey: string | null; pending: boolean; anchors: ReturnType<typeof anchorsOf> }) {
  await db.query(
    `insert into sm_ai_rag_docs (id, org_id, table_key, record_id, version, hash, title, chunks, status, error, vec_key, vec_pending, workspace_id, unit_id, domain_id, indexed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
     on conflict (org_id, table_key, record_id) do update set version = excluded.version, hash = coalesce(excluded.hash, sm_ai_rag_docs.hash), title = excluded.title,
       chunks = excluded.chunks, status = excluded.status, error = excluded.error, vec_key = excluded.vec_key, vec_pending = excluded.vec_pending,
       workspace_id = excluded.workspace_id, unit_id = excluded.unit_id, domain_id = excluded.domain_id, indexed_at = now()`,
    [uuidv7(), s.orgId, s.table, s.id, s.version, s.hash, s.title?.slice(0, 300) ?? null, s.chunks, s.status, s.error?.slice(0, 500) ?? null, s.vecKey, s.pending, s.anchors.workspace_id, s.anchors.unit_id, s.anchors.domain_id],
  );
}

/** Queue rag.embed (deduplicated) to add provider vectors once the model can answer. */
export async function scheduleEmbed(db: Db, orgId: string, delayMs = 0): Promise<void> {
  await enqueue(db, { kind: RAG_JOBS.embed, orgId, payload: {}, delayMs: Math.max(0, Math.round(delayMs)), dedupeKey: RAG_JOBS.embed, maxAttempts: 20 }).catch(() => undefined);
}

/** Provider vectors for these texts, or null (the model is unavailable: the session remembers it). */
async function providerVectors(s: IndexSession, texts: string[]): Promise<number[][] | null> {
  if (!s.embedder || s.embedDown || !texts.length) return s.embedder && texts.length ? null : [];
  try {
    return await embedTexts(s.sys, s.embedder, texts, "document", { env: s.env });
  } catch (e) {
    if (e instanceof EmbedUnavailableError) {
      s.embedDown = e;
      return null;
    }
    throw e;
  }
}

/**
 * Index one record (or remove it when it is gone or no longer a RAG table). Never throws for a model failure;
 * a builder that throws leaves the old chunks (stale versions are not retrievable) and records the error.
 */
export async function indexRecord(s: IndexSession, table: string, id: string, opts: { force?: boolean } = {}): Promise<IndexOutcome> {
  const { sys } = s;
  const db = sys.db;
  const orgId = sys.org.id;
  if (!s.env.settings.rag.enabled) return { status: "skipped", chunks: 0, pending: false };
  const schema = await orgSchema(sys);
  const def = schema.def(table);
  if (!isRagTable(def)) {
    await removeFromIndex(db, orgId, table, id);
    return { status: "removed", chunks: 0, pending: false };
  }
  const env = await condEnv(sys);
  const row = await loadReadable(db, sys, def, id, env);
  if (!row) {
    await removeFromIndex(db, orgId, table, id);
    return { status: "removed", chunks: 0, pending: false };
  }
  const version = row.version === null || row.version === undefined ? null : Number(row.version);
  const anchors = anchorsOf(def, row);
  let doc;
  try {
    doc = await buildDocument({ ctx: sys, q: db, def, row });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    await saveState(db, { orgId, table, id, version: null, hash: null, title: null, chunks: 0, status: "error", error: msg, vecKey: null, pending: false, anchors });
    return { status: "error", chunks: 0, pending: false, error: msg };
  }
  if (!doc) {
    await db.tx(async (tx) => {
      await tx.query(`delete from sm_ai_chunks where org_id = $1 and table_key = $2 and record_id = $3`, [orgId, table, id]);
    });
    await saveState(db, { orgId, table, id, version, hash: null, title: null, chunks: 0, status: "empty", error: null, vecKey: null, pending: false, anchors });
    return { status: "empty", chunks: 0, pending: false };
  }
  const hash = sha(JSON.stringify([CHUNKER_VERSION, ragSource(table)?.version ?? "", doc]));
  // the title line every chunk was embedded with (rag.embed embeds missing vectors with the same line)
  const titleLine = cleanText(doc.title).replace(/\s+/g, " ").slice(0, 300);
  const head = titleLine ? `${titleLine}${doc.number ? ` (${doc.number})` : ""}` : (doc.number ?? "");
  const prev = await db.one<{ hash: string | null; vec_key: string | null; vec_pending: boolean; chunks: number; status: string }>(
    `select hash, vec_key, vec_pending, chunks, status from sm_ai_rag_docs where org_id = $1 and table_key = $2 and record_id = $3`,
    [orgId, table, id],
  );
  const key = s.embedder?.key ?? null;

  // unchanged content: only the version and the access anchors move (and missing provider vectors are added)
  if (prev && prev.hash === hash && prev.status === "ok" && !opts.force) {
    await db.query(
      `update sm_ai_chunks set version = $4, workspace_id = $5, unit_id = $6, domain_id = $7 where org_id = $1 and table_key = $2 and record_id = $3`,
      [orgId, table, id, version, anchors.workspace_id, anchors.unit_id, anchors.domain_id],
    );
    let pending = prev.vec_pending || (!!key && prev.vec_key !== key);
    if (pending && key) pending = !(await embedMissing(s, { table, id }));
    await saveState(db, { orgId, table, id, version, hash, title: head, chunks: prev.chunks, status: "ok", error: null, vecKey: pending ? prev.vec_key : key, pending, anchors });
    if (pending) await scheduleEmbed(db, orgId, s.embedDown?.retryInMs ?? 60_000);
    return { status: "unchanged", chunks: prev.chunks, pending };
  }

  const chunks = chunkDocument(doc);
  const ids = new Map<number, string>(chunks.map((c) => [c.ord, uuidv7()]));
  const hashes = chunks.map((c) => sha(c.embedText));
  // provider vectors of chunks whose text did not change
  const reuse = new Map<string, number[]>();
  if (key) {
    const cols = s.backend.kind === "pgvector" ? `vec_v::text as v` : `vec as v`;
    const old = await db.query<{ hash: string; v: unknown }>(
      `select hash, ${cols} from sm_ai_chunks where org_id = $1 and table_key = $2 and record_id = $3 and vec_key = $4`,
      [orgId, table, id, key],
    );
    for (const o of old) {
      const v = parseVector(o.v);
      if (v?.length) reuse.set(o.hash, v);
    }
  }
  const children = chunks.map((c, i) => ({ c, i })).filter((x) => x.c.kind === "chunk");
  const need = key ? children.filter((x) => !reuse.has(hashes[x.i])) : [];
  const fresh = need.length ? await providerVectors(s, need.map((x) => x.c.embedText)) : [];
  const pending = !!key && fresh === null;
  if (fresh) need.forEach((x, k) => reuse.set(hashes[x.i], fresh[k]));

  const writes: ChunkWrite[] = chunks.map((c: Chunk, i) => {
    const child = c.kind === "chunk";
    const got = child && key ? reuse.get(hashes[i]) : undefined;
    // an empty vector: the model refused this text for good (it keeps the key, without a vector)
    const vec = got?.length ? got : null;
    return {
      id: ids.get(c.ord)!,
      org_id: orgId,
      table_key: table,
      record_id: id,
      kind: c.kind,
      parent_id: c.parent === null ? null : (ids.get(c.parent) ?? null),
      ord: c.ord,
      field: c.field,
      fields: c.fields,
      groups: c.groups,
      heading: c.heading,
      page: c.page,
      page_end: c.pageEnd,
      lang: detectLang(c.text),
      text: c.text,
      norm: child ? searchForm(c.embedText) : "",
      hash: hashes[i],
      tokens: c.tokens,
      version,
      ...anchors,
      lvec: child ? localEmbed(c.embedText) : null,
      vec_key: got ? key : null,
      vec,
    };
  });
  await db.tx((tx) => replaceChunks(tx, s.backend, orgId, table, id, writes));
  await saveState(db, { orgId, table, id, version, hash, title: head, chunks: children.length, status: "ok", error: null, vecKey: pending ? null : key, pending, anchors });
  if (pending) await scheduleEmbed(db, orgId, s.embedDown?.retryInMs ?? 60_000);
  return { status: "indexed", chunks: children.length, pending };
}

/**
 * Add the active model's vectors to chunks that lack them (one record, or a batch across the organisation).
 * Returns true when nothing is left for that scope.
 */
export async function embedMissing(s: IndexSession, scope: { table: string; id: string } | { limit: number }): Promise<boolean> {
  if (!s.embedder || s.embedDown) return !s.embedder;
  const key = s.embedder.key;
  const db = s.sys.db;
  const params: unknown[] = [s.sys.org.id, key];
  let where = `org_id = $1 and kind = 'chunk' and (vec_key is null or vec_key <> $2)`;
  if ("table" in scope) {
    params.push(scope.table, scope.id);
    where += ` and table_key = $3 and record_id = $4`;
  }
  const limit = "limit" in scope ? scope.limit : 2000;
  const rows = await db.query<{ id: string; text: string; heading: string | null; table_key: string; record_id: string }>(
    `select c.id, c.text, c.heading, c.table_key, c.record_id from sm_ai_chunks c where ${where} order by c.record_id, c.ord limit ${limit}`,
    params,
  );
  if (!rows.length) return true;
  // the same text the indexer embeds: the title line (kept in the record's state), the heading and the chunk
  const titles = new Map<string, string>();
  for (const t of await db.query<{ table_key: string; record_id: string; title: string | null }>(
    `select table_key, record_id, title from sm_ai_rag_docs where org_id = $1 and record_id = any($2::uuid[])`,
    [s.sys.org.id, `{${[...new Set(rows.map((r) => r.record_id))].join(",")}}`],
  )) titles.set(`${t.table_key}:${t.record_id}`, t.title ?? "");
  const texts = rows.map((r) => [titles.get(`${r.table_key}:${r.record_id}`), r.heading, r.text].filter(Boolean).join("\n"));
  const vecs = await providerVectors(s, texts);
  if (!vecs) return false;
  await db.tx((tx) => setChunkVectors(tx, s.backend, key, rows.map((r, i) => ({ id: r.id, vec: vecs[i] }))));
  // records whose chunks all carry the key now
  await db.query(
    `update sm_ai_rag_docs d set vec_key = $2, vec_pending = false
     where d.org_id = $1 and d.record_id = any($3::uuid[])
       and not exists (select 1 from sm_ai_chunks c where c.org_id = d.org_id and c.table_key = d.table_key and c.record_id = d.record_id and c.kind = 'chunk' and (c.vec_key is null or c.vec_key <> $2))`,
    [s.sys.org.id, key, `{${[...new Set(rows.map((r) => r.record_id))].join(",")}}`],
  );
  return rows.length < limit;
}

// ---------------------------------------------------------------- runs (admin page)

export async function startRun(db: Db, orgId: string, kind: string): Promise<string> {
  const id = uuidv7();
  await db.query(`insert into sm_ai_rag_runs (id, org_id, kind) values ($1, $2, $3)`, [id, orgId, kind]);
  await db.query(`delete from sm_ai_rag_runs where org_id = $1 and id not in (select id from sm_ai_rag_runs where org_id = $1 order by started_at desc limit 50)`, [orgId]);
  return id;
}

export async function finishRun(db: Db, runId: string, stats: Record<string, number>, error: string | null = null, done = true): Promise<void> {
  await db.query(`update sm_ai_rag_runs set stats = $2::jsonb, error = $3, finished_at = case when $4 then now() else finished_at end where id = $1`, [runId, JSON.stringify(stats), error?.slice(0, 500) ?? null, done]);
}

// ---------------------------------------------------------------- jobs

const addStats = (a: Record<string, number>, b: Record<string, number>) => {
  for (const [k, v] of Object.entries(b)) a[k] = (a[k] ?? 0) + v;
  return a;
};

/** Ids of a table's live records after `after` (id order), for backfills. */
async function recordIds(db: Db, def: TableDef, orgId: string, after: string | null, limit: number): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    `select id from ${def.table} where org_id = $1 and deleted_at is null ${after ? "and id > $2" : ""} order by id limit ${limit}`,
    after ? [orgId, after] : [orgId],
  );
  return rows.map((r) => r.id);
}

/** rag.backfill { table?, run?, cursor? }: index every record (of one table or all RAG tables), resumable. */
async function runBackfill(job: Job, jctx: JobContext): Promise<JobResult> {
  const orgId = job.org_id!;
  const p = job.payload as { table?: string | null; force?: boolean; run?: string; tables?: string[]; at?: number; cursor?: string | null; stats?: Record<string, number> };
  const s = await indexSession(jctx.cfg, orgId);
  const tables = p.tables ?? (p.table ? [p.table] : ragTables().map((d) => d.key));
  const run = p.run ?? (await startRun(jctx.db, orgId, p.table ? `backfill:${p.table}` : "backfill"));
  const stats = p.stats ?? {};
  let at = p.at ?? 0;
  let cursor = p.cursor ?? null;
  const schema = await orgSchema(s.sys);
  while (at < tables.length) {
    const def = schema.def(tables[at]);
    if (!def || !isRagTable(def)) {
      at++;
      cursor = null;
      continue;
    }
    const ids = await recordIds(jctx.db, def, orgId, cursor, 50);
    for (const id of ids) {
      const r = await indexRecord(s, def.key, id, { force: p.force });
      addStats(stats, { [r.status]: 1, chunks: r.chunks });
      cursor = id;
      if (Date.now() > jctx.deadline - 500) break;
    }
    if (ids.length < 50 && (!ids.length || cursor === ids[ids.length - 1])) {
      at++;
      cursor = null;
    }
    if (Date.now() > jctx.deadline - 500 && at < tables.length) {
      await jctx.save({ ...p, tables, run, at, cursor, stats });
      await finishRun(jctx.db, run, stats, null, false);
      return { again: 0 };
    }
  }
  await finishRun(jctx.db, run, stats);
  if (s.embedDown) await scheduleEmbed(jctx.db, orgId, s.embedDown.retryInMs ?? 60_000);
  else await ensureAnnIndexes(jctx.db, s.backend).catch((e) => jctx.log.warn("ai index: ann index failed", String((e as Error)?.message ?? e)));
  return;
}

/** rag.embed: add the active model's vectors where they are missing, batch by batch until done or the model fails. */
async function runEmbed(job: Job, jctx: JobContext): Promise<JobResult> {
  const orgId = job.org_id!;
  const s = await indexSession(jctx.cfg, orgId);
  if (!s.embedder) return;
  for (;;) {
    const done = await embedMissing(s, { limit: 200 });
    if (s.embedDown) return { again: Math.max(15_000, s.embedDown.retryInMs ?? 120_000) };
    if (done) break;
    if (Date.now() > jctx.deadline - 500) return { again: 0 };
  }
  await ensureAnnIndexes(jctx.db, s.backend).catch(() => undefined);
}

/** Records whose index is missing or behind their version (and index entries whose record is gone). */
async function driftOf(db: Db, def: TableDef, orgId: string, limit: number): Promise<{ stale: string[]; orphans: string[] }> {
  const stale = await db.query<{ id: string }>(
    `select t.id from ${def.table} t left join sm_ai_rag_docs d on d.org_id = t.org_id and d.table_key = $2 and d.record_id = t.id
     where t.org_id = $1 and t.deleted_at is null and (d.record_id is null or d.version is distinct from t.version or d.status = 'error')
     order by t.updated_at desc limit ${limit}`,
    [orgId, def.key],
  );
  const orphans = await db.query<{ record_id: string }>(
    `select d.record_id from sm_ai_rag_docs d left join ${def.table} t on t.id = d.record_id and t.org_id = d.org_id and t.deleted_at is null
     where d.org_id = $1 and d.table_key = $2 and t.id is null limit ${limit}`,
    [orgId, def.key],
  );
  return { stale: stale.map((r) => r.id), orphans: orphans.map((r) => r.record_id) };
}

/** Bring the index in step with the records: orphans removed, missing/stale records indexed, anchors re-keyed. */
export async function reconcile(s: IndexSession, opts: { deadline: number; limit?: number }): Promise<{ stats: Record<string, number>; more: boolean }> {
  const db = s.sys.db;
  const orgId = s.sys.org.id;
  const stats: Record<string, number> = { checked: 0, removed: 0, indexed: 0, rekeyed: 0, unknown: 0 };
  const schema = await orgSchema(s.sys);
  const tables = ragTables().map((d) => schema.def(d.key)).filter(isRagTable);
  const keys = new Set(tables.map((d) => d.key));
  // chunks of tables that are no longer indexed (a module removed, a builder gone): fail closed — removed
  const unknown = await db.query<{ table_key: string }>(`select distinct table_key from sm_ai_rag_docs where org_id = $1`, [orgId]);
  for (const u of unknown) {
    if (keys.has(u.table_key)) continue;
    await db.query(`delete from sm_ai_chunks where org_id = $1 and table_key = $2`, [orgId, u.table_key]);
    const r = await db.query(`delete from sm_ai_rag_docs where org_id = $1 and table_key = $2 returning 1`, [orgId, u.table_key]);
    stats.unknown += r.length;
  }
  let more = false;
  for (const def of tables) {
    // access anchors that moved without a re-index (e.g. a requester's unit changed): re-keyed in place
    const anchor = (k: "workspace" | "unit" | "domain") => def.scope[k] ?? `${k}_id`;
    const moved = await db.query(
      `update sm_ai_chunks c set workspace_id = t.${anchor("workspace")}, unit_id = t.${anchor("unit")}, domain_id = t.${anchor("domain")}
       from ${def.table} t where c.org_id = $1 and c.table_key = $2 and t.id = c.record_id and t.org_id = c.org_id
         and (c.workspace_id is distinct from t.${anchor("workspace")} or c.unit_id is distinct from t.${anchor("unit")} or c.domain_id is distinct from t.${anchor("domain")})
       returning 1`,
      [orgId, def.key],
    );
    stats.rekeyed += moved.length;
    const { stale, orphans } = await driftOf(db, def, orgId, opts.limit ?? 200);
    stats.checked += stale.length + orphans.length;
    for (const id of orphans) {
      await removeFromIndex(db, orgId, def.key, id);
      stats.removed++;
    }
    for (const id of stale) {
      if (Date.now() > opts.deadline) {
        more = true;
        break;
      }
      const r = await indexRecord(s, def.key, id);
      if (r.status === "indexed" || r.status === "unchanged" || r.status === "empty") stats.indexed++;
    }
    if (stale.length >= (opts.limit ?? 200)) more = true;
    if (Date.now() > opts.deadline) {
      more = true;
      break;
    }
  }
  return { stats, more };
}

/** Milliseconds until the next 02:30 in the organisation's time zone. */
export function msUntilNight(tz: string, now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  let mins = 2 * 60 + 30 - (h * 60 + m);
  if (mins <= 5) mins += 24 * 60;
  return mins * 60_000;
}

/** rag.reconcile: nightly (and on demand from the admin page). */
async function runReconcile(job: Job, jctx: JobContext): Promise<JobResult> {
  const orgId = job.org_id!;
  const s = await indexSession(jctx.cfg, orgId);
  const p = job.payload as { run?: string; stats?: Record<string, number> };
  const run = p.run ?? (await startRun(jctx.db, orgId, "reconcile"));
  const { stats, more } = await reconcile(s, { deadline: jctx.deadline - 500 });
  const total = addStats(p.stats ?? {}, stats);
  if (more) {
    await jctx.save({ run, stats: total });
    await finishRun(jctx.db, run, total, null, false);
    return { again: 0 };
  }
  await finishRun(jctx.db, run, total);
  await jctx.save({});
  if (s.embedDown) await scheduleEmbed(jctx.db, orgId, s.embedDown.retryInMs ?? 60_000);
  else if (s.embedder) await scheduleEmbed(jctx.db, orgId, 0);
  await ensureAnnIndexes(jctx.db, s.backend).catch(() => undefined);
  // the nightly job queues itself again; a run asked for from the admin page ends here
  if (job.dedupe_key !== RAG_JOBS.reconcile) return;
  const tz = (s.sys.org.settings?.timezone as string | undefined) || "Asia/Tehran";
  return { again: msUntilNight(tz) };
}

/** rag.sweep (Windows app): records the sync pull changed are indexed within minutes. */
async function runSweep(job: Job, jctx: JobContext): Promise<JobResult> {
  const orgId = job.org_id!;
  const s = await indexSession(jctx.cfg, orgId);
  await reconcile(s, { deadline: Math.min(jctx.deadline - 500, Date.now() + 3000), limit: 100 });
  return { again: 3 * 60_000 };
}

const scheduled = new WeakMap<Db, Set<string>>();

/** Make sure the organisation's nightly reconciliation (and, on the Windows app, the sweep) is queued. */
export async function ensureSchedules(db: Db, mode: string | undefined, orgId: string): Promise<void> {
  let set = scheduled.get(db);
  if (!set) scheduled.set(db, (set = new Set()));
  if (set.has(orgId)) return;
  set.add(orgId);
  await enqueue(db, { kind: RAG_JOBS.reconcile, orgId, payload: {}, delayMs: 60_000, dedupeKey: RAG_JOBS.reconcile, maxAttempts: 5 }).catch(() => undefined);
  if (mode === "desktop") await enqueue(db, { kind: RAG_JOBS.sweep, orgId, payload: {}, delayMs: 30_000, dedupeKey: RAG_JOBS.sweep, maxAttempts: 5 }).catch(() => undefined);
}

/** Queue a full re-index (or one table); `force` rebuilds chunks even when the text did not change. */
export async function queueBackfill(db: Db, orgId: string, opts: { table?: string | null; force?: boolean } = {}): Promise<string> {
  return enqueue(db, { kind: RAG_JOBS.backfill, orgId, payload: { table: opts.table ?? null, force: !!opts.force }, dedupeKey: `${RAG_JOBS.backfill}:${opts.table ?? "*"}`, maxAttempts: 5 });
}

export async function queueReconcile(db: Db, orgId: string): Promise<string> {
  return enqueue(db, { kind: RAG_JOBS.reconcile, orgId, payload: {}, dedupeKey: `${RAG_JOBS.reconcile}:now`, maxAttempts: 3 });
}

let installed = false;

/** Jobs and the record-event subscriber of the indexer (idempotent). */
export function installIndexer(): void {
  if (installed) return;
  installed = true;
  registerJobHandler(RAG_JOBS.index, async (job, jctx) => {
    const p = job.payload as { table: string; id: string; force?: boolean };
    const s = await indexSession(jctx.cfg, job.org_id!);
    await indexRecord(s, p.table, p.id, { force: p.force });
  });
  registerJobHandler(RAG_JOBS.backfill, runBackfill);
  registerJobHandler(RAG_JOBS.embed, runEmbed);
  registerJobHandler(RAG_JOBS.reconcile, runReconcile);
  registerJobHandler(RAG_JOBS.sweep, runSweep);
  // every write of an indexed table (the web version also for rows a Windows app pushed)
  onRecordEvent(
    "ai.rag",
    async (e, jctx) => {
      if (!isRagTable(ragTables().find((d) => d.key === e.table))) return;
      const s = await indexSession(jctx.cfg, e.org_id);
      if (e.kind === "record.deleted") await removeFromIndex(jctx.db, e.org_id, e.table, e.id);
      else await indexRecord(s, e.table, e.id);
      await ensureSchedules(jctx.db, jctx.cfg.mode, e.org_id);
    },
    { kinds: ["record.created", "record.updated", "record.deleted"] },
  );
}

/** Index text right away (tests and the admin page's «بازسازی» of one record). */
export async function indexNow(cfg: JobConfig | ServerConfig, orgId: string, table: string, id: string, opts: { force?: boolean } = {}): Promise<IndexOutcome> {
  return indexRecord(await indexSession(cfg, orgId), table, id, opts);
}

