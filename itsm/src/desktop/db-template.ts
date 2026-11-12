// The Windows app's first start from a database made at build time (docs/PERFORMANCE_FA.md §17).
//
// A new installation used to run PGlite's initdb and every migration before its first window: 19–25 s on a Windows
// runner (desktop-e2e), the same work on every computer. The build (scripts/build-desktop.mjs runs
// scripts/desktop-db-template.mts) does it once: a data folder migrated exactly as a first start migrates one (desktop
// mode, the write-ahead log's limits of ../server/db/wal.ts), closed cleanly, and packed as db-template.tar.br next to
// the app (a tar, Brotli-compressed: 5 MB) — without the log's recycled segments, only the one that holds the shutdown
// checkpoint (48 MB less to write on the first start). The local server's first start (./server.ts) loads it through PGlite's
// `loadDataDir` and then runs `migrate` as every start does: nothing left to do when the template is this build's, the
// missing steps when it is older. The template carries no secret and nothing of an installation: the device id, the
// session secret and the configuration live in config.json, made at the first start. A template that does not load is
// set aside and the start falls back to initdb and the migrations.
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createPgliteDb, type PgliteDb } from "@server/db/pglite";
import { migrate, schemaProgress } from "@server/db/migrate";
import type { Logger } from "@server/context";

/** The template's name next to the app's files (desktop/app). */
export const DB_TEMPLATE_FILE = "db-template.tar.br";

const SEGMENT = /^[0-9A-F]{24}$/;

/** One ustar header (names are relative ASCII paths below 100 characters: a PostgreSQL data folder's are). */
function tarHeader(name: string, size: number, mode: number, mtimeMs: number, type: "0" | "5"): Buffer {
  if (!/^[\x20-\x7e]+$/.test(name) || name.length >= 100) throw new Error(`database template: unexpected path ${name}`);
  const h = Buffer.alloc(512, 0);
  const oct = (n: number, len: number) => `${n.toString(8).padStart(len - 1, "0")}\0`;
  h.write(name, 0, 100, "ascii");
  h.write(oct(mode & 0o7777, 8), 100, 8, "ascii");
  h.write(oct(0, 8), 108, 8, "ascii");
  h.write(oct(0, 8), 116, 8, "ascii");
  h.write(oct(size, 12), 124, 12, "ascii");
  h.write(oct(Math.floor(mtimeMs / 1000), 12), 136, 12, "ascii");
  h.fill(0x20, 148, 156);
  h.write(type, 156, 1, "ascii");
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return h;
}

/**
 * A closed data folder as a Brotli-compressed tar that PGlite's `loadDataDir` reads once decompressed (paths relative to the folder, a directory
 * before what it holds). PG_VERSION comes last: PGlite unpacks in this order, and a folder without it is no database to
 * PGlite — a first start cut short while unpacking leaves a folder the next start unpacks again, never a half database
 * it would try to open. `skip` leaves files out (the recycled log segments).
 */
export function packDataDir(dir: string, skip: (rel: string) => boolean = () => false): Buffer {
  const parts: Buffer[] = [];
  const file = (r: string) => {
    const st = statSync(join(dir, r));
    const data = readFileSync(join(dir, r));
    parts.push(tarHeader(r, data.length, st.mode, st.mtimeMs, "0"), data);
    if (data.length % 512) parts.push(Buffer.alloc(512 - (data.length % 512), 0));
  };
  const walk = (rel: string) => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      const st = statSync(join(dir, r));
      if (st.isDirectory()) {
        parts.push(tarHeader(r, 0, st.mode, st.mtimeMs, "5"));
        walk(r);
      } else if (st.isFile() && r !== "PG_VERSION" && !skip(r)) file(r);
    }
  };
  walk("");
  file("PG_VERSION");
  parts.push(Buffer.alloc(1024, 0));
  const tar = Buffer.concat(parts);
  // quality 9 with a 16 MB window: 104 MB of tar in 5.2 MB, decompressed in about 0.2 s (gzip: 8.5 MB; quality 11: 4.5 MB
  // but 25 times slower to build)
  return brotliCompressSync(tar, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: tar.length } });
}

/**
 * The write-ahead log segments a cleanly closed folder can do without: all but the newest — the segment the shutdown
 * checkpoint was written to (recycled ones ahead of it keep the time they were last written; a clean start needs only
 * the checkpoint's record, and PostgreSQL makes new segments as it goes). The build checks the result opens.
 */
export function spareSegments(dataDir: string): string[] {
  const wal = join(dataDir, "pg_wal");
  const segs = readdirSync(wal)
    .filter((f) => SEGMENT.test(f))
    .map((f) => ({ f, t: statSync(join(wal, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t || b.f.localeCompare(a.f));
  return segs.slice(1).map((s) => `pg_wal/${s.f}`);
}

/**
 * The template's tar, checked before PGlite sees it: decompressed here (and handed to PGlite as a plain tar: its own
 * web-stream gunzip leaves an unhandled rejection behind on a damaged file, which would end the local server's process)
 * and walked header by header: checksums, sizes within the file, PG_VERSION the last file. Throws on anything else.
 */
export function templateTar(template: Buffer): Buffer {
  const tar = brotliDecompressSync(template);
  let last = "";
  let off = 0;
  for (; off + 512 <= tar.length; ) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const field = (a: number, b: number) => h.subarray(a, b).toString("ascii").replace(/\0.*$/s, "").trim();
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
    if (parseInt(field(148, 156), 8) !== sum) throw new Error("database template: a damaged entry");
    const size = parseInt(field(124, 136) || "0", 8);
    if (!Number.isFinite(size) || size < 0 || off + 512 + size > tar.length) throw new Error("database template: a truncated entry");
    if (field(156, 157) !== "5") last = field(0, 100);
    off += 512 + Math.ceil(size / 512) * 512;
  }
  if (last !== "PG_VERSION") throw new Error("database template: incomplete");
  return tar;
}

/** Opens a data folder from a template (PGlite unpacks the checked tar, then starts on it). */
export function openFromTemplate(dataDir: string, template: Buffer, log?: Pick<Logger, "info" | "warn">): Promise<PgliteDb> {
  const tar = templateTar(template);
  // (zlib's output is a Buffer over an ArrayBuffer of its own)
  return createPgliteDb({ dataDir, desktop: true, log, loadDataDir: new Blob([tar as Uint8Array<ArrayBuffer>]) });
}

export interface TemplateInfo {
  file: string;
  bytes: number;
  migrate_ms: number;
  steps: number;
  segments_dropped: number;
}

/**
 * Builds db-template.tar.br: a data folder migrated the way the app's first start migrates one, closed, packed without
 * its spare log segments, then opened again from the package to prove it starts and needs no migration.
 */
export async function buildDbTemplate(file: string, log?: Pick<Logger, "info" | "warn">): Promise<TemplateInfo> {
  const work = mkdtempSync(join(tmpdir(), "kariz-db-template-"));
  try {
    const dir = join(work, "db");
    const db = await createPgliteDb({ dataDir: dir, desktop: true, log, wal: false });
    const t = performance.now();
    const steps = (await migrate(db)).length;
    const migrateMs = Math.round(performance.now() - t);
    await db.close();
    const drop = new Set(spareSegments(dir));
    const tar = packDataDir(dir, (rel) => drop.has(rel));
    // the proof: the package opens on its own and its schema is complete
    const check = await openFromTemplate(join(work, "check"), tar);
    try {
      const p = await schemaProgress(check);
      if (!p.complete) throw new Error(`database template: the schema is not complete (${p.done}/${p.total})`);
      if ((await migrate(check)).length) throw new Error("database template: a migration was still pending after loading it");
    } finally {
      await check.close();
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, tar);
    return { file, bytes: tar.length, migrate_ms: migrateMs, steps, segments_dropped: drop.size };
  } finally {
    // a temporary folder (Windows may hold a file a moment longer after PGlite closes): never a failed build for it
    try {
      rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* left in the temporary folder */
    }
  }
}

/** The template a first start may use: a file next to the app (none in development or in the tests' memory mode). */
export function templateFor(path: string | undefined): Buffer | null {
  if (!path || !existsSync(path)) return null;
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}
