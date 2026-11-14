// The Windows app's first start from a database made at build time (docs/PERFORMANCE_FA.md §17).
//
// A new installation used to run PGlite's initdb and every migration before its first window: 19–25 s on a Windows
// runner (desktop-e2e), the same work on every computer. The build (scripts/build-desktop.mjs runs
// scripts/desktop-db-template.mts) does it once: a data folder migrated exactly as a first start migrates one (desktop
// mode, the write-ahead log's limits of ../server/db/wal.ts), closed cleanly, and packed as db-template.tar.br next to
// the app (a tar, Brotli-compressed: 5 MB) — without the log's recycled segments, only the one that holds the shutdown
// checkpoint (48 MB less to write on the first start). The local server's first start (./server.ts) checks it, writes its
// files (several at a time, PG_VERSION last), opens the folder and runs `migrate` as every start does: nothing left to
// do when the template is this build's, the missing steps when it is older. The template carries no secret and nothing
// of an installation: the device id, the session secret and the configuration live in config.json, made at the first
// start. A template that does not load is set aside and the start falls back to initdb and the migrations.
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { writeFile as writeFileAsync } from "node:fs/promises";
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
 * A closed data folder as a Brotli-compressed tar (paths relative to the folder, a directory before what it holds; the
 * format PGlite's `loadDataDir` reads too). PG_VERSION comes last and is written last: a folder without it is no
 * database to PGlite, so a first start cut short while unpacking leaves a folder the next start unpacks again, never a
 * half database it would try to open. `skip` leaves files out (the recycled log segments).
 */
export function packDataDir(dir: string, skip: (rel: string) => boolean = () => false): Buffer {
  const entries: { name: string; dir?: boolean; data?: Buffer; mode: number; mtimeMs: number }[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      const st = statSync(join(dir, r));
      if (st.isDirectory()) {
        entries.push({ name: r, dir: true, mode: st.mode, mtimeMs: st.mtimeMs });
        walk(r);
      } else if (st.isFile() && r !== "PG_VERSION" && !skip(r)) entries.push({ name: r, data: readFileSync(join(dir, r)), mode: st.mode, mtimeMs: st.mtimeMs });
    }
  };
  walk("");
  const v = statSync(join(dir, "PG_VERSION"));
  entries.push({ name: "PG_VERSION", data: readFileSync(join(dir, "PG_VERSION")), mode: v.mode, mtimeMs: v.mtimeMs });
  return packEntries(entries);
}

/** Entries as a Brotli-compressed ustar archive, in the order given. */
export function packEntries(entries: { name: string; dir?: boolean; data?: Buffer; mode?: number; mtimeMs?: number }[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const data = e.dir ? Buffer.alloc(0) : (e.data ?? Buffer.alloc(0));
    parts.push(tarHeader(e.name, data.length, e.mode ?? (e.dir ? 0o755 : 0o600), e.mtimeMs ?? 0, e.dir ? "5" : "0"));
    if (data.length) parts.push(data);
    if (data.length % 512) parts.push(Buffer.alloc(512 - (data.length % 512), 0));
  }
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

/** One entry of the template's tar: a folder, or a file with its bytes (a view into the tar). */
export interface TemplateEntry {
  name: string;
  dir: boolean;
  data: Buffer;
}

/**
 * The template's entries, checked before anything is written: decompressed, walked header by header — checksums, sizes
 * within the tar, plain relative paths (no `..`, no absolute or drive paths) — and PG_VERSION the last file. Throws on
 * anything else.
 */
export function templateEntries(template: Buffer): TemplateEntry[] {
  const tar = brotliDecompressSync(template);
  const out: TemplateEntry[] = [];
  for (let off = 0; off + 512 <= tar.length; ) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const field = (a: number, b: number) => h.subarray(a, b).toString("ascii").replace(/\0.*$/s, "").trim();
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
    if (parseInt(field(148, 156), 8) !== sum) throw new Error("database template: a damaged entry");
    const size = parseInt(field(124, 136) || "0", 8);
    if (!Number.isFinite(size) || size < 0 || off + 512 + size > tar.length) throw new Error("database template: a truncated entry");
    const name = field(0, 100);
    if (!/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/.test(name) || name.split("/").some((part) => part === "." || part === "..")) throw new Error(`database template: an unexpected path ${name}`);
    out.push({ name, dir: field(156, 157) === "5", data: tar.subarray(off + 512, off + 512 + size) });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  if (out.filter((e) => !e.dir).at(-1)?.name !== "PG_VERSION") throw new Error("database template: incomplete");
  return out;
}

/**
 * Writes the template's folders, then its files, several at a time (plain writes: PGlite's own loadDataDir opened every
 * file three times through its virtual file system — 2.9 to 4.3 s against 1.0 to 1.5 s on the development machine), and
 * PG_VERSION last, once everything else is on disk: a folder without it is never taken for a database.
 */
export async function unpackTemplate(entries: TemplateEntry[], dir: string, parallel = 8): Promise<void> {
  mkdirSync(dir, { recursive: true });
  for (const e of entries) if (e.dir) mkdirSync(join(dir, e.name), { recursive: true });
  const files = entries.filter((e) => !e.dir && e.name !== "PG_VERSION");
  let next = 0;
  const one = async () => {
    while (next < files.length) {
      const e = files[next++];
      await writeFileAsync(join(dir, e.name), e.data);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, parallel) }, one));
  writeFileSync(join(dir, "PG_VERSION"), entries.find((e) => e.name === "PG_VERSION")!.data);
}

/** Opens a data folder from a template: checked, unpacked, then opened by PGlite like any data folder. */
export async function openFromTemplate(dataDir: string, template: Buffer, log?: Pick<Logger, "info" | "warn">): Promise<PgliteDb> {
  await unpackTemplate(templateEntries(template), dataDir);
  return createPgliteDb({ dataDir, desktop: true, log });
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
