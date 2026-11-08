// The vector store of the AI index (sm_ai_chunks). The backend is chosen once per database at startup of the index:
// pgvector when the database has it (Supabase: `create extension vector`; the Windows app: PGlite with
// @electric-sql/pglite-pgvector) — vector columns are added and nearest neighbours are found in SQL, exactly, or through
// an HNSW index per embedding model once a model has many chunks — otherwise the portable store: float arrays in the
// table, compared in the server over candidates the full-text search and recency found (the same access filter
// applies to both). The admin page reports which one runs and why.
import type { Db, Queryable } from "../../../db";
import { pgArray } from "../../../db";
import { LOCAL_DIMS } from "./local-embed";

export interface StoreBackend {
  kind: "pgvector" | "portable";
  /** schema the extension lives in (Supabase: often "extensions") */
  schema: string | null;
  version: string | null;
  /** why the portable store runs (no extension, refused…) */
  reason: string | null;
}

const backends = new WeakMap<Db, Promise<StoreBackend>>();
const forced = new WeakMap<Db, StoreBackend["kind"]>();

/** Tests: run a database with the portable store although pgvector is there (desktop-runtime parity). */
export function forceStoreBackend(db: Db, kind: StoreBackend["kind"] | null): void {
  if (kind) forced.set(db, kind);
  else forced.delete(db);
  backends.delete(db);
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** `vector` type name, the cosine operator and functions, qualified with the extension's schema. */
export function vectorSql(b: StoreBackend): { type: string; op: string; ops: string; fn: (name: string) => string } {
  const s = b.schema && b.schema !== "public" ? `${ident(b.schema)}.` : "";
  return { type: `${s}vector`, op: s ? `operator(${s}<=>)` : "<=>", ops: `${s}vector_cosine_ops`, fn: (name) => `${s}${name}` };
}

async function detect(db: Db): Promise<StoreBackend> {
  if (forced.get(db) === "portable") return { kind: "portable", schema: null, version: null, reason: "forced" };
  const find = () => db.one<{ version: string; schema: string }>(`select e.extversion as version, n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'vector'`);
  let ext = await find().catch(() => null);
  let reason: string | null = null;
  if (!ext) {
    try {
      await db.exec(`create extension if not exists vector`);
      ext = await find();
    } catch (e) {
      reason = String((e as Error)?.message ?? e).slice(0, 200);
    }
  }
  if (!ext) return { kind: "portable", schema: null, version: null, reason: reason ?? "pgvector is not installed" };
  const b: StoreBackend = { kind: "pgvector", schema: ext.schema, version: ext.version, reason: null };
  const { type } = vectorSql(b);
  try {
    await db.exec(`alter table sm_ai_chunks add column if not exists lvec_v ${type}(${LOCAL_DIMS}); alter table sm_ai_chunks add column if not exists vec_v ${type};`);
    // rows written by the portable store before (the extension arrived later): moved into the vector columns
    await db.exec(
      `update sm_ai_chunks set lvec_v = lvec::${type}(${LOCAL_DIMS}), lvec = null where lvec is not null and lvec_v is null;
       update sm_ai_chunks set vec_v = vec::${type}, vec = null where vec is not null and vec_v is null;`,
    );
  } catch (e) {
    return { kind: "portable", schema: null, version: null, reason: `vector columns: ${String((e as Error)?.message ?? e).slice(0, 160)}` };
  }
  return b;
}

/** The backend of this database (decided once; `refresh` decides again). */
export function storeBackend(db: Db, opts: { refresh?: boolean } = {}): Promise<StoreBackend> {
  if (opts.refresh) backends.delete(db);
  let p = backends.get(db);
  if (!p) {
    p = detect(db).catch((e) => ({ kind: "portable" as const, schema: null, version: null, reason: String((e as Error)?.message ?? e).slice(0, 200) }));
    backends.set(db, p);
  }
  return p;
}

// ---------------------------------------------------------------- writing

export interface ChunkWrite {
  id: string;
  org_id: string;
  table_key: string;
  record_id: string;
  kind: "chunk" | "parent";
  parent_id: string | null;
  ord: number;
  field: string | null;
  fields: string[];
  groups: string[];
  heading: string | null;
  page: number | null;
  page_end: number | null;
  lang: string | null;
  text: string;
  norm: string;
  hash: string;
  tokens: number;
  version: number | null;
  workspace_id: string | null;
  unit_id: string | null;
  domain_id: string | null;
  lvec: number[] | null;
  vec_key: string | null;
  vec: number[] | null;
}

const vecText = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(",")}]`;
const arrText = (v: number[]) => `{${v.map((x) => (Number.isFinite(x) ? x : 0)).join(",")}}`;

/** Replace every chunk of a record (inside the caller's transaction). */
export async function replaceChunks(q: Queryable, b: StoreBackend, orgId: string, table: string, recordId: string, rows: ChunkWrite[]): Promise<void> {
  await q.query(`delete from sm_ai_chunks where org_id = $1 and table_key = $2 and record_id = $3`, [orgId, table, recordId]);
  const { type } = vectorSql(b);
  const pg = b.kind === "pgvector";
  const cols = `id, org_id, table_key, record_id, kind, parent_id, ord, field, fields, groups, heading, page, page_end, lang, text, norm, hash, tokens, version, workspace_id, unit_id, domain_id, vec_key, ${pg ? "lvec_v, vec_v" : "lvec, vec"}`;
  for (let i = 0; i < rows.length; i += 40) {
    const params: unknown[] = [];
    const values = rows.slice(i, i + 40).map((r) => {
      const p = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      const lv = r.lvec ? (pg ? `${p(vecText(r.lvec))}::${type}(${LOCAL_DIMS})` : `${p(arrText(r.lvec))}::real[]`) : "null";
      const vv = r.vec ? (pg ? `${p(vecText(r.vec))}::${type}` : `${p(arrText(r.vec))}::real[]`) : "null";
      return `(${p(r.id)}::uuid, ${p(r.org_id)}::uuid, ${p(r.table_key)}, ${p(r.record_id)}::uuid, ${p(r.kind)}, ${p(r.parent_id)}::uuid, ${p(r.ord)}::int, ${p(r.field)}, ${p(pgArray(r.fields))}::text[], ${p(pgArray(r.groups))}::text[], ${p(r.heading)}, ${p(r.page)}::int, ${p(r.page_end)}::int, ${p(r.lang)}, ${p(r.text)}, ${p(r.norm)}, ${p(r.hash)}, ${p(r.tokens)}::int, ${p(r.version)}::int, ${p(r.workspace_id)}::uuid, ${p(r.unit_id)}::uuid, ${p(r.domain_id)}::uuid, ${p(r.vec_key)}, ${lv}, ${vv})`;
    });
    await q.query(`insert into sm_ai_chunks (${cols}) values ${values.join(", ")}`, params);
  }
}

/** Store provider vectors of existing chunks. */
export async function setChunkVectors(q: Queryable, b: StoreBackend, key: string, items: { id: string; vec: number[] }[]): Promise<void> {
  const { type } = vectorSql(b);
  for (const it of items) {
    // an empty vector: the model refused this text for good — the key is set so it is not asked again
    if (!it.vec.length) await q.query(`update sm_ai_chunks set vec_key = $2, vec = null${b.kind === "pgvector" ? ", vec_v = null" : ""} where id = $1`, [it.id, key]);
    else if (b.kind === "pgvector") await q.query(`update sm_ai_chunks set vec_key = $2, vec_v = $3::${type}, vec = null where id = $1`, [it.id, key, vecText(it.vec)]);
    else await q.query(`update sm_ai_chunks set vec_key = $2, vec = $3::real[] where id = $1`, [it.id, key, arrText(it.vec)]);
  }
}

/** A vector read back from either store (pgvector text "[…]", a parsed array, or "{…}"). */
export function parseVector(v: unknown): number[] | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(Number);
  const s = String(v).trim();
  if (!s) return null;
  const inner = s.replace(/^[[{]|[\]}]$/g, "");
  return inner ? inner.split(",").map(Number) : [];
}

// ---------------------------------------------------------------- approximate neighbours

/** Chunks of one embedding model (or the local vectors) from which an HNSW index pays off. */
export let ANN_MIN_ROWS = 20_000;
export function setAnnMinRows(n: number): void {
  ANN_MIN_ROWS = n;
}

const annKnown = new WeakMap<Db, Map<string, boolean>>();

/** Name of the HNSW index of an embedding key (or "local"). */
export function annIndexName(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return key === "local" ? "sm_ai_chunks_lvec_hnsw" : `sm_ai_chunks_vec_${(h >>> 0).toString(16)}_hnsw`;
}

/** Dimensions of a provider key (`preset:model:dims`), null when the model's own size is used. */
export function keyDims(key: string): number | null {
  const n = Number(key.split(":").pop());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Create HNSW indexes for the local vectors and for embedding models with many chunks (pgvector, ≤ 2000 dims). */
export async function ensureAnnIndexes(db: Db, b: StoreBackend): Promise<string[]> {
  if (b.kind !== "pgvector") return [];
  const { type, ops, fn } = vectorSql(b);
  const made: string[] = [];
  const local = await db.one<{ n: number }>(`select count(*)::int as n from sm_ai_chunks where lvec_v is not null`);
  if ((local?.n ?? 0) >= ANN_MIN_ROWS) {
    await db.exec(`create index if not exists ${annIndexName("local")} on sm_ai_chunks using hnsw (lvec_v ${ops})`);
    made.push(annIndexName("local"));
  }
  const keys = await db.query<{ key: string; n: number; dims: number | null }>(
    `select vec_key as key, count(*)::int as n, max(${fn("vector_dims")}(vec_v))::int as dims from sm_ai_chunks where vec_v is not null and vec_key is not null group by vec_key`,
  );
  for (const k of keys) {
    const dims = keyDims(k.key) ?? k.dims;
    if (k.n < ANN_MIN_ROWS || !dims || dims > 2000) continue;
    const name = annIndexName(k.key);
    await db.exec(`create index if not exists ${name} on sm_ai_chunks using hnsw ((vec_v::${type}(${dims})) ${ops}) where vec_key = '${k.key.replace(/'/g, "''")}'`);
    made.push(name);
  }
  annKnown.delete(db);
  return made;
}

/** Is there an HNSW index for this key (cached a minute)? */
export async function hasAnnIndex(db: Db, key: string): Promise<boolean> {
  let m = annKnown.get(db);
  if (!m) {
    m = new Map();
    annKnown.set(db, m);
    setTimeout(() => annKnown.delete(db), 60_000).unref?.();
  }
  if (!m.has(key)) {
    const r = await db.one(`select 1 from pg_indexes where indexname = $1`, [annIndexName(key)]).catch(() => null);
    m.set(key, !!r);
  }
  return m.get(key)!;
}
