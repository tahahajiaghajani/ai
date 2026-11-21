// Backups of the Windows app's data folder that hold neither the local server's thread nor its database, and restores
// that never read a backup into memory (docs/PERFORMANCE_FA.md, the Windows app's database maintenance).
//
// 1.1.3 made a backup with PGlite's dumpDataDir: the whole folder as one tar in memory — two to three copies of it before
// gzip saw a byte — built on the local server's only thread. A 303 MB folder took 3.4 s, 741 MB more memory and one hold
// of the thread of 1.2 s; an owner's 3.38 GB folder needed 8–10 GB of buffers, froze the app for 66 s and failed with
// "RangeError: Array buffer allocation failed" — every six hours from then on. Restoring such a backup read it whole too
// (about 3.3 times the folder in memory), so it could not have been restored either.
//
// Now a backup is PostgreSQL's own online backup, which PGlite supports (wal_level replica): pg_backup_start, then every
// file of the folder read with fs.promises in 1 MB pieces while the app goes on working, written as a ustar archive
// through gzip into `<file>.part` (backpressure all the way, a few megabytes of memory whatever the folder's size),
// pg_backup_stop, and last the backup_label it returns, the log written from the backup's start to its stop, pg_control
// and PG_VERSION. Opening the restored folder, PostgreSQL replays that log from the backup's start: every transaction
// committed before pg_backup_stop is there, nothing torn (full-page writes are forced on during a backup, so a page the
// copy read half-written is put right by its image in the log). The WAL guard (src/server/db/wal.ts `hold`) takes no
// checkpoint meanwhile: one would remove or recycle segments the copy still needs, and the restore would fail. So the
// copy is cut short when it lets more than `maxWalBytes` of log pile up, and it refuses to finish when a segment between
// its start and its stop is missing.
//
// A restore (`extractBackup`) reads the gzip'd tar as a stream and writes each file as it comes, PG_VERSION last: a folder
// left half-written has no PG_VERSION and is never taken for a database. It reads 1.1.3's archives too (PGlite's dumpTar:
// names with a leading "/", PG_VERSION first), and 1.1.3's restore (loadDataDir) reads these.
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, renameSync, rmSync, statfsSync, writeFileSync, writeSync, type Dirent } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { WAL_SEGMENT_BYTES } from "@server/db/wal";
import type { Logger } from "@server/context";

const MB = 1024 * 1024;
const CHUNK = 1 << 20;
const SEGMENT = /^[0-9A-F]{24}$/;

/**
 * What a backup leaves out of the data folder, as pg_basebackup does: the contents of the folders PostgreSQL rebuilds or
 * that only matter to a running server (the log is added at the end, from the backup's start to its stop), the files of a
 * running server, temporary files, and a backup_label of an earlier backup. The folders themselves are kept, empty.
 */
export const BACKUP_SKIP = {
  /** top-level folders whose contents are left out */
  contents: ["pg_wal", "pg_stat_tmp", "pg_replslot", "pg_dynshmem", "pg_notify", "pg_serial", "pg_snapshots", "pg_subtrans"] as readonly string[],
  /** sub-folders of pg_wal kept (empty): PostgreSQL expects them */
  walFolders: ["archive_status", "summaries"] as readonly string[],
  /** files left out wherever they are */
  files: ["postmaster.pid", "postmaster.opts", "backup_label", "backup_label.old", "tablespace_map", "current_logfiles", "postgresql.auto.conf.tmp"] as readonly string[],
  /** names (files and folders) left out by their beginning */
  prefixes: ["pg_internal.init", "pgsql_tmp"] as readonly string[],
};

// ------------------------------------------------------------------------------------------------ the archive's format

/** One ustar header (the one src/desktop/db-template.ts writes; PGlite's tinytar reads it): a relative ASCII name under 100 characters. */
export function ustarHeader(name: string, size: number, mode: number, mtimeMs: number, type: "0" | "5"): Buffer {
  if (!/^[\x21-\x7e]+$/.test(name) || name.length >= 100) throw new Error(`backup: an unexpected path ${name}`);
  if (!Number.isSafeInteger(size) || size < 0 || size >= 8 ** 11) throw new Error(`backup: ${name} is too large for the archive`);
  const h = Buffer.alloc(512, 0);
  const oct = (n: number, len: number) => `${n.toString(8).padStart(len - 1, "0")}\0`;
  h.write(name, 0, 100, "ascii");
  h.write(oct(mode & 0o7777, 8), 100, 8, "ascii");
  h.write(oct(0, 8), 108, 8, "ascii");
  h.write(oct(0, 8), 116, 8, "ascii");
  h.write(oct(size, 12), 124, 12, "ascii");
  h.write(oct(Math.max(0, Math.floor(mtimeMs / 1000)), 12), 136, 12, "ascii");
  h.fill(0x20, 148, 156);
  h.write(type, 156, 1, "ascii");
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return h;
}

/** A log position ("16/B374D848") as a number of bytes (exact below 2^53: 8 PB of log). */
export function parseLsn(lsn: string): number {
  const m = /^([0-9A-F]{1,8})\/([0-9A-F]{1,8})$/i.exec(String(lsn).trim());
  if (!m) throw new Error(`not a log position: ${lsn}`);
  return parseInt(m[1], 16) * 2 ** 32 + parseInt(m[2], 16);
}

/** The name of log segment `segno` on `timeline` (XLogFileName). */
export function walFileName(segno: number, timeline = 1, segBytes = WAL_SEGMENT_BYTES): string {
  const perId = 2 ** 32 / segBytes;
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(8, "0");
  return hex(timeline) + hex(Math.floor(segno / perId)) + hex(segno % perId);
}

/**
 * The log segments a restore of a backup replays: from the one that holds the backup's start (its checkpoint's redo
 * point, the segment backup_label names) to the one that holds the last byte before its stop (pg_walfile_name of the stop).
 */
export function walFilesBetween(startLsn: string, stopLsn: string, timeline = 1, segBytes = WAL_SEGMENT_BYTES): string[] {
  const start = parseLsn(startLsn);
  const stop = parseLsn(stopLsn);
  if (stop < start) throw new Error(`backup: its stop ${stopLsn} lies before its start ${startLsn}`);
  const first = Math.floor(start / segBytes);
  const last = Math.max(first, Math.floor((stop - 1) / segBytes));
  if (last - first > 100_000) throw new Error("backup: an implausible stretch of log");
  const out: string[] = [];
  for (let s = first; s <= last; s++) out.push(walFileName(s, timeline, segBytes));
  return out;
}

const pad512 = (n: number) => (n % 512 ? Buffer.alloc(512 - (n % 512), 0) : null);
const gone = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT";
const fmtMb = (b: number) => (b >= 1024 * MB ? `${(b / (1024 * MB)).toFixed(2)} GB` : b >= 10 * MB ? `${Math.round(b / MB)} MB` : `${(b / MB).toFixed(1)} MB`);

// ------------------------------------------------------------------------------------------------ the backup

/** Why a backup did not finish (backup.ts turns it into the Persian error a manual backup shows). */
export type BackupFailure = "cut_short" | "missing_wal" | "disk" | "aborted";

export class BackupStopped extends Error {
  constructor(
    readonly reason: BackupFailure,
    message: string,
  ) {
    super(message);
  }
}

/** The database a backup copies: PGlite (its own session runs pg_backup_start/stop), the checkpoint, the WAL guard. */
export interface OnlineBackupDb {
  pg: { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> };
  checkpoint(reason: string): Promise<unknown>;
  wal?: { hold(): () => void } | null;
}

export interface OnlineBackupOptions {
  /** the backup's label (backup_label) */
  label?: string;
  /** gzip's level */
  level?: number;
  /** the copy is cut short when more log than this was written since its start (no checkpoint can run meanwhile) */
  maxWalBytes?: number;
  signal?: AbortSignal;
  /** free bytes the backup's volume must have before it starts */
  minFreeBytes?: number;
  /** free bytes of the volume holding `dir` (tests) */
  freeBytes?: (dir: string) => number;
  /** called after each file of the folder is in the archive (tests: writes and checkpoints during the copy) */
  onFile?: (rel: string) => Promise<void> | void;
}

export interface OnlineBackupResult {
  file: string;
  /** the archive's size */
  size: number;
  /** files in it, and their bytes */
  files: number;
  bytes: number;
  /** log segments added after pg_backup_stop */
  wal_segments: number;
  /** log written during the copy */
  wal_bytes: number;
  start_lsn: string;
  stop_lsn: string;
  ms: number;
}

/** Free bytes of the volume holding `dir` (Infinity when it cannot be told). */
export function freeBytesOf(dir: string): number {
  try {
    const s = statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return Infinity;
  }
}

/**
 * An online backup of the data folder `dataDir` into `file` (gzip'd ustar). Thrown: `BackupStopped` when it was cut short
 * (too much log during the copy), refused (a log segment missing), short of disk or aborted; anything else as it came.
 * Nothing is left behind on failure (the `.part` file is removed, the backup mode ended, the WAL guard released).
 */
export async function writeOnlineBackup(db: OnlineBackupDb, dataDir: string, file: string, o: OnlineBackupOptions = {}): Promise<OnlineBackupResult> {
  const t0 = performance.now();
  const maxWal = o.maxWalBytes ?? 64 * MB;
  const signal = o.signal;
  const aborted = () => new BackupStopped("aborted", "backup aborted: the app is closing");
  if (signal?.aborted) throw aborted();
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  if (o.minFreeBytes) {
    const free = (o.freeBytes ?? freeBytesOf)(dir);
    if (free < o.minFreeBytes) throw new BackupStopped("disk", `backup refused: ${fmtMb(free)} free on the backup's disk, ${fmtMb(o.minFreeBytes)} needed`);
  }
  const q = async <T>(sql: string, params?: unknown[]) => (await db.pg.query<T>(sql, params)).rows;
  // the copy then starts from a fresh redo point: little log to replay at a restore
  await db.checkpoint("backup");
  const release = db.wal?.hold() ?? (() => {});
  const part = `${file}.part`;
  const s = { inBackup: false, files: 0, bytes: 0, walSegments: 0, walBytes: 0, startLsn: "", stopLsn: "" };
  try {
    s.startLsn = (await q<{ lsn: string }>(`select pg_backup_start($1, true)::text as lsn`, [o.label ?? "kariz"]))[0].lsn;
    s.inBackup = true;
    const walSince = async () => Number((await q<{ d: number | string }>(`select pg_wal_lsn_diff(pg_current_wal_insert_lsn(), $1::pg_lsn)::float8 as d`, [s.startLsn]))[0]?.d ?? 0);
    const cap = async () => {
      const d = await walSince();
      if (d > maxWal) throw new BackupStopped("cut_short", `backup cut short: ${Math.round(d / MB)} MB of log written during the copy`);
    };

    /** a file of the folder (a vanished one is left out, a shrunk one padded with zeros), or a required one (log, control) */
    async function* fileEntry(rel: string, required: boolean): AsyncGenerator<Buffer> {
      let fh;
      try {
        fh = await open(join(dataDir, rel), "r");
      } catch (e) {
        if (!required && gone(e)) return;
        throw e;
      }
      try {
        const st = await fh.stat();
        const size = st.size;
        yield ustarHeader(rel, size, st.mode, st.mtimeMs, "0");
        let pos = 0;
        let shrunk = false;
        while (pos < size) {
          if (signal?.aborted) throw aborted();
          const len = Math.min(CHUNK, size - pos);
          if (shrunk) {
            yield Buffer.alloc(len, 0);
          } else {
            const buf = Buffer.allocUnsafe(len);
            const { bytesRead } = await fh.read(buf, 0, len, pos);
            if (bytesRead < len) {
              // truncated while it was read: the rest as zeros (the log replay truncates it again)
              if (required) throw new Error(`backup: ${rel} shrank while it was read`);
              buf.fill(0, bytesRead);
              shrunk = true;
            }
            yield buf;
          }
          pos += len;
        }
        const pad = pad512(size);
        if (pad) yield pad;
        s.files++;
        s.bytes += size;
      } finally {
        await fh.close();
      }
    }

    /** the folder's entries, a folder before what it holds, in name order (PG_VERSION and global/pg_control come last) */
    async function* walk(rel: string): AsyncGenerator<{ rel: string; dir: boolean }> {
      let names: Dirent[];
      try {
        names = await readdir(rel ? join(dataDir, rel) : dataDir, { withFileTypes: true });
      } catch (e) {
        if (rel && gone(e)) return;
        throw e;
      }
      names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const d of names) {
        const r = rel ? `${rel}/${d.name}` : d.name;
        if (BACKUP_SKIP.prefixes.some((p) => d.name.startsWith(p))) continue;
        if (d.isDirectory()) {
          yield { rel: r, dir: true };
          if (!rel && BACKUP_SKIP.contents.includes(d.name)) {
            if (d.name === "pg_wal") for (const sub of BACKUP_SKIP.walFolders) if (existsSync(join(dataDir, "pg_wal", sub))) yield { rel: `pg_wal/${sub}`, dir: true };
            continue;
          }
          yield* walk(r);
        } else if (d.isFile()) {
          if (BACKUP_SKIP.files.includes(d.name) || r === "PG_VERSION" || r === "global/pg_control") continue;
          yield { rel: r, dir: false };
        }
      }
    }

    async function* archive(): AsyncGenerator<Buffer> {
      let checked = 0;
      for await (const e of walk("")) {
        if (signal?.aborted) throw aborted();
        if (e.dir) {
          let st;
          try {
            st = await stat(join(dataDir, e.rel));
          } catch (err) {
            if (gone(err)) continue;
            throw err;
          }
          yield ustarHeader(e.rel, 0, st.mode, st.mtimeMs, "5");
          continue;
        }
        yield* fileEntry(e.rel, false);
        await o.onFile?.(e.rel);
        if (s.bytes - checked >= 16 * MB) {
          checked = s.bytes;
          await cap();
        }
      }
      await cap();
      const stop = (await q<{ lsn: string; labelfile: string; f: string }>(`select lsn::text as lsn, labelfile, pg_walfile_name(lsn) as f from pg_backup_stop(false)`))[0];
      s.inBackup = false;
      s.stopLsn = stop.lsn;
      s.walBytes = parseLsn(stop.lsn) - parseLsn(s.startLsn);
      const label = Buffer.from(stop.labelfile, "utf8");
      yield ustarHeader("backup_label", label.length, 0o600, Date.now(), "0");
      yield label;
      const lp = pad512(label.length);
      if (lp) yield lp;
      // the log from the backup's start to its stop, every segment of it (a checkpoint meanwhile would have recycled one)
      const tli = Number(/START TIMELINE: (\d+)/.exec(stop.labelfile)?.[1] ?? 1);
      const named = /START WAL LOCATION: \S+ \(file ([0-9A-F]{24})\)/.exec(stop.labelfile)?.[1];
      const segments = walFilesBetween(s.startLsn, stop.lsn, tli);
      if ((named && segments[0] !== named) || segments.at(-1) !== stop.f) throw new Error(`backup: its log runs from ${named ?? "?"} to ${stop.f}, not ${segments[0]} to ${segments.at(-1)}`);
      for (const name of segments) {
        if (!SEGMENT.test(name) || !existsSync(join(dataDir, "pg_wal", name))) throw new BackupStopped("missing_wal", `backup refused: log segment ${name} between its start and its end is missing`);
      }
      for (const name of segments) {
        if (signal?.aborted) throw aborted();
        yield* fileEntry(`pg_wal/${name}`, true);
        s.walSegments++;
      }
      yield* fileEntry("global/pg_control", true);
      yield* fileEntry("PG_VERSION", true);
      yield Buffer.alloc(1024, 0);
    }

    await pipeline(Readable.from(archive()), createGzip({ level: o.level ?? 6 }), createWriteStream(part), { signal });
    if (signal?.aborted) throw aborted();
    renameSync(part, file);
    const size = (await stat(file)).size;
    return { file, size, files: s.files, bytes: s.bytes, wal_segments: s.walSegments, wal_bytes: s.walBytes, start_lsn: s.startLsn, stop_lsn: s.stopLsn, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    rmSync(part, { force: true });
    if (s.inBackup) await q(`select pg_backup_stop(false)`).catch(() => {});
    if ((e as Error)?.name === "AbortError" || signal?.aborted) throw aborted();
    throw e;
  } finally {
    release();
  }
}

// ------------------------------------------------------------------------------------------------ the restore

export interface ExtractResult {
  files: number;
  bytes: number;
  ms: number;
}

const NAME = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/;

/** A path of an archive's entry made safe: relative (a leading "/" of PGlite's dumpTar dropped), no "..", no drive or backslash. */
export function archivePath(raw: string): string {
  const name = raw.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!NAME.test(name) || name.split("/").some((p) => p === "." || p === "..")) throw new Error(`restore: an unexpected path in the backup: ${raw}`);
  return name;
}

/** Reads a ustar stream entry by entry and writes it below `dir` (PG_VERSION kept back for the end). */
class Extractor {
  files = 0;
  bytes = 0;
  version: Buffer | null = null;
  ended = false;
  private head = Buffer.alloc(0);
  private cur: { fd: number | null; parts: Buffer[] | null; left: number; pad: number; name: string } | null = null;
  private made = new Set<string>();

  constructor(private readonly dir: string) {}

  private mkdir(rel: string) {
    if (!rel || this.made.has(rel)) return;
    mkdirSync(join(this.dir, rel), { recursive: true });
    this.made.add(rel);
  }

  push(chunk: Buffer) {
    let off = 0;
    while (off < chunk.length && !this.ended) {
      const cur = this.cur;
      if (cur) {
        if (cur.left > 0) {
          const n = Math.min(cur.left, chunk.length - off);
          const part = chunk.subarray(off, off + n);
          if (cur.fd !== null) writeSync(cur.fd, part);
          else cur.parts!.push(Buffer.from(part));
          off += n;
          cur.left -= n;
          this.bytes += n;
          if (cur.left > 0) return;
        }
        const p = Math.min(cur.pad, chunk.length - off);
        off += p;
        cur.pad -= p;
        if (cur.pad > 0) return;
        this.done();
        continue;
      }
      const take = chunk.subarray(off, off + 512 - this.head.length);
      off += take.length;
      this.head = this.head.length ? Buffer.concat([this.head, take]) : Buffer.from(take);
      if (this.head.length < 512) return;
      const h = this.head;
      this.head = Buffer.alloc(0);
      this.header(h);
    }
  }

  private header(h: Buffer) {
    if (h.every((b) => b === 0)) {
      this.ended = true;
      return;
    }
    const field = (a: number, b: number) => h.subarray(a, b).toString("latin1").replace(/\0.*$/s, "").trim();
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
    if (parseInt(field(148, 156), 8) !== sum) throw new Error("restore: a damaged entry in the backup");
    // POSIX ustar ("ustar\0"): a long name's beginning may be in the prefix field (old GNU tar keeps other data there)
    const prefix = h.subarray(257, 263).toString("latin1") === "ustar\0" ? field(345, 500) : "";
    const name = archivePath(prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    const type = field(156, 157) || "0";
    const size = parseInt(field(124, 136) || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`restore: a damaged entry in the backup (${name})`);
    if (type === "5") {
      this.mkdir(name);
      return;
    }
    if (type !== "0") throw new Error(`restore: an unexpected kind of entry in the backup (${name})`);
    const at = name.lastIndexOf("/");
    if (at > 0) this.mkdir(name.slice(0, at));
    const version = name === "PG_VERSION";
    this.cur = { fd: version ? null : openSync(join(this.dir, name), "w", 0o600), parts: version ? [] : null, left: size, pad: (512 - (size % 512)) % 512, name };
    if (!size) this.done();
  }

  private done() {
    const cur = this.cur!;
    this.cur = null;
    if (cur.fd !== null) closeSync(cur.fd);
    else this.version = Buffer.concat(cur.parts!);
    this.files++;
  }

  /** the archive ended: anything cut off in the middle is an error */
  finish() {
    if (this.cur) {
      const name = this.cur.name;
      this.abort();
      throw new Error(`restore: the backup ends inside ${name}`);
    }
    if (this.head.length) throw new Error("restore: the backup ends inside an entry's header");
    if (!this.version) throw new Error("restore: the backup holds no database (no PG_VERSION)");
  }

  abort() {
    if (this.cur?.fd != null) {
      try {
        closeSync(this.cur.fd);
      } catch {
        /* already closed */
      }
    }
    this.cur = null;
  }
}

/**
 * Restores the backup `file` (a gzip'd tar of a data folder: this module's or 1.1.3's) into `dbDir`, which must not hold
 * a database: read as a stream (never whole in memory), every entry's checksum and path checked, PG_VERSION written last.
 * Throws on anything damaged, truncated or unexpected; what it wrote then has no PG_VERSION (the caller removes it and
 * puts the previous database back).
 */
export async function extractBackup(file: string, dbDir: string, log?: Pick<Logger, "info">): Promise<ExtractResult> {
  const t0 = performance.now();
  if (existsSync(join(dbDir, "PG_VERSION"))) throw new Error("restore: the database folder already holds a database");
  mkdirSync(dbDir, { recursive: true });
  const x = new Extractor(dbDir);
  try {
    await pipeline(
      createReadStream(file, { highWaterMark: CHUNK }),
      createGunzip({ chunkSize: 256 * 1024 }),
      new Writable({
        write(chunk: Buffer, _enc, cb) {
          try {
            x.push(chunk);
            cb();
          } catch (e) {
            cb(e as Error);
          }
        },
      }),
    );
    x.finish();
  } catch (e) {
    x.abort();
    throw e;
  }
  writeFileSync(join(dbDir, "PG_VERSION"), x.version!);
  const r = { files: x.files, bytes: x.bytes, ms: Math.round(performance.now() - t0) };
  log?.info(`restoring database from backup: ${r.files} files (${fmtMb(r.bytes)}) extracted in ${(r.ms / 1000).toFixed(1)} s`);
  return r;
}
