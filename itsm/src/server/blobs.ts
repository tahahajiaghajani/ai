// Where attachment contents live. Metadata is always in sm_attachments (a synchronised root); the contents —
// deduplicated per organisation by sha256 — go to a BlobStore:
// - the database store (sm_blobs): the web version and the Windows app (the default);
// - the disk store of the server edition (src/server-edition/blobs-disk.ts): files under the blob folder (or a UNC
//   path), streamed on download, with an optional antivirus scan before a file is accepted.
// The store comes from the server config (`cfg.blobs`), or the one a runtime installed for the whole process
// (`installBlobStore`, for code that has no config at hand), else the database store.
import type { Queryable } from "./db";
import { pgArray } from "./db";

export interface BlobStream {
  stream: ReadableStream<Uint8Array>;
  size: number;
}

export interface BlobStore {
  readonly kind: "db" | "disk";
  /**
   * Store a content (inside the caller's transaction for the database store). A refused content (infected, too large)
   * throws an AppError with a Persian message.
   */
  put(q: Queryable, orgId: string, sha256: string, data: Uint8Array): Promise<void>;
  /**
   * Optional: do the slow part outside the write transaction (write the file and scan it), so `put` inside the
   * organisation's write lock is instant. Throws like `put`.
   */
  prepare?(orgId: string, sha256: string, data: Uint8Array): Promise<void>;
  get(q: Queryable, orgId: string, sha256: string): Promise<Uint8Array | null>;
  /** Optional: a stream of the content (served without loading it into memory); null when absent. */
  open?(orgId: string, sha256: string): Promise<BlobStream | null>;
  has(q: Queryable, orgId: string, sha256: string): Promise<boolean>;
  /** Of these contents, the ones not stored. */
  missing(q: Queryable, orgId: string, shas: string[]): Promise<string[]>;
}

/** The database store (sm_blobs). */
export const dbBlobStore: BlobStore = {
  kind: "db",
  async put(q, orgId, sha, data) {
    await q.query(
      `insert into sm_blobs (org_id, sha256, size, data) values ($1, $2, $3, decode($4, 'base64')) on conflict (org_id, sha256) do nothing`,
      [orgId, sha, data.byteLength, Buffer.from(data).toString("base64")],
    );
  },
  async get(q, orgId, sha) {
    const r = await q.one<{ b64: string }>(`select encode(data, 'base64') as b64 from sm_blobs where org_id = $1 and sha256 = $2`, [orgId, sha]);
    return r ? new Uint8Array(Buffer.from(r.b64, "base64")) : null;
  },
  async has(q, orgId, sha) {
    return !!(await q.one(`select 1 from sm_blobs where org_id = $1 and sha256 = $2`, [orgId, sha]));
  },
  async missing(q, orgId, shas) {
    if (!shas.length) return [];
    const have = await q.query<{ sha256: string }>(`select sha256 from sm_blobs where org_id = $1 and sha256 = any($2::text[])`, [orgId, pgArray(shas)]);
    const set = new Set(have.map((r) => r.sha256));
    return shas.filter((s) => !set.has(s));
  },
};

let installed: BlobStore | null = null;

/** The process-wide store of a runtime that keeps contents elsewhere (the server edition); null restores the default. */
export function installBlobStore(store: BlobStore | null): void {
  installed = store;
}

/** The store for this configuration. */
export function blobStore(cfg?: { blobs?: BlobStore | null } | null): BlobStore {
  return cfg?.blobs ?? installed ?? dbBlobStore;
}
