// Backups of the server edition: `pg_dump -Fc` of the database plus the attachment files. Each backup is a folder
// <backups>\itsm-<label>-<stamp>\ with db.dump and manifest.json; attachment files are content-addressed and never
// change, so they are mirrored once into <backups>\blobs\ (only new files are copied). A backup is verified
// (pg_restore --list reads the whole archive; the mirror holds every content the database refers to), the result is
// kept in <data>\last-backup.json for «سلامت سرور», and automatic backups beyond `keep` are pruned. Restore goes into a
// new database that replaces the current one only when it fully succeeded (the old one is kept, renamed).
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import postgres from "postgres";
import type { Logger } from "@server/context";
import { APP_VERSION } from "@shared/constants";
import { SCHEMA_VERSION } from "@server/db/migrations";
import type { ServerEditionConfig } from "./config";
import { pgExe, run } from "./pg";

export type BackupLabel = "auto" | "manual" | "pre-upgrade" | "pre-restore";

export interface BackupManifest {
  format: "itsm-server-backup";
  version: 1;
  label: BackupLabel;
  created_at: string;
  app_version: string;
  schema: string;
  database: string;
  dump: { file: string; size: number; sha256: string };
  blobs: { files: number; bytes: number; copied: number; missing: number };
  verified: boolean;
  verify_detail: string;
  ms: number;
}

export interface BackupStatus {
  ok: boolean;
  at: string;
  folder: string | null;
  label: BackupLabel;
  size: number;
  verified: boolean;
  error: string | null;
  ms: number;
}

const LAST_FILE = "last-backup.json";
const FOLDER = /^itsm-(auto|manual|pre-upgrade|pre-restore)-(\d{8}-\d{6})$/;

export const backupRoot = (c: ServerEditionConfig) => c.backup.dir ?? c.dirs.backups;
export const pgBinOf = (c: ServerEditionConfig) => c.pg_bin ?? join(process.env.ITSM_INSTALL_DIR ?? process.cwd(), "pgsql", "bin");

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const dbEnv = (password: string): NodeJS.ProcessEnv => ({ PGPASSWORD: password, PGCONNECT_TIMEOUT: "15", PGAPPNAME: "itsm-backup" });
const conn = (c: ServerEditionConfig, admin = false) => ["-h", c.db.host, "-p", String(c.db.port), "-U", admin ? c.db.admin_user : c.db.user];

async function sha256File(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

/** Copy blob files that the mirror lacks (content-addressed: an existing file is identical). */
async function mirrorBlobs(src: string, dest: string): Promise<{ files: number; bytes: number; copied: number }> {
  const out = { files: 0, bytes: 0, copied: 0 };
  if (!existsSync(src)) return out;
  const walk = async (rel: string): Promise<void> => {
    for (const e of await readdir(join(src, rel), { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const r = join(rel, e.name);
      if (e.isDirectory()) await walk(r);
      else if (e.isFile()) {
        const st = await stat(join(src, r));
        out.files++;
        out.bytes += st.size;
        if (!existsSync(join(dest, r))) {
          await mkdir(join(dest, rel), { recursive: true });
          await copyFile(join(src, r), join(dest, `${r}.part`));
          await rename(join(dest, `${r}.part`), join(dest, r));
          out.copied++;
        }
      }
    }
  };
  await walk("");
  return out;
}

/** Contents the database refers to that the mirror does not hold. */
async function missingInMirror(c: ServerEditionConfig, mirror: string): Promise<number> {
  const sql = postgres({ host: c.db.host, port: c.db.port, database: c.db.database, username: c.db.user, password: c.db.password, max: 1, ssl: c.db.ssl ? "require" : false, onnotice: () => {} });
  try {
    const rows = await sql<{ org_id: string; sha256: string }[]>`select distinct org_id::text as org_id, sha256 from sm_attachments where deleted_at is null`;
    return rows.filter((r) => !existsSync(join(mirror, r.org_id, r.sha256.slice(0, 2), r.sha256))).length;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

export interface BackupOptions {
  config: ServerEditionConfig;
  label?: BackupLabel;
  log?: Logger;
  /** where pg_dump lives (default: the configuration's pg_bin) */
  bin?: string;
}

/** Take a backup now: dump, blob mirror, verification, status file, pruning. */
export async function backupNow(o: BackupOptions): Promise<BackupManifest & { folder: string }> {
  const c = o.config;
  const label = o.label ?? "manual";
  const bin = o.bin ?? pgBinOf(c);
  const root = backupRoot(c);
  const t0 = Date.now();
  const folder = join(root, `itsm-${label}-${stamp()}`);
  await mkdir(folder, { recursive: true });
  const status = async (s: Partial<BackupStatus>) => {
    const st: BackupStatus = { ok: false, at: new Date().toISOString(), folder, label, size: 0, verified: false, error: null, ms: Date.now() - t0, ...s };
    await writeFile(join(c.dirs.data, LAST_FILE), JSON.stringify(st, null, 2)).catch(() => undefined);
  };
  try {
    const dump = join(folder, "db.dump");
    o.log?.info("backup: pg_dump", { folder });
    await run(pgExe(bin, "pg_dump"), [...conn(c), "-d", c.db.database, "-Fc", "-Z", "6", "-f", `${dump}.part`], { env: dbEnv(c.db.password), timeoutMs: 6 * 3600_000 });
    await rename(`${dump}.part`, dump);
    const size = statSync(dump).size;
    const mirror = join(root, "blobs");
    const blobs = await mirrorBlobs(c.dirs.blobs, mirror);
    let verified = false;
    let detail = "verification off";
    let missing = 0;
    if (c.backup.verify) {
      const list = await run(pgExe(bin, "pg_restore"), ["--list", dump], { timeoutMs: 3600_000, maxOutput: 64 * 1048576 });
      const entries = list.out.split(/\r?\n/).filter((l) => /^\d+;/.test(l)).length;
      const tables = list.out.split(/\r?\n/).filter((l) => / TABLE DATA /.test(l)).length;
      missing = await missingInMirror(c, mirror).catch(() => -1);
      verified = entries > 0 && tables > 0 && missing === 0;
      detail = `${entries} archive entries, ${tables} tables; ${missing < 0 ? "blob check skipped" : `${missing} attachment contents missing`}`;
    }
    const manifest: BackupManifest = {
      format: "itsm-server-backup",
      version: 1,
      label,
      created_at: new Date().toISOString(),
      app_version: APP_VERSION,
      schema: SCHEMA_VERSION,
      database: c.db.database,
      dump: { file: "db.dump", size, sha256: await sha256File(dump) },
      blobs: { files: blobs.files, bytes: blobs.bytes, copied: blobs.copied, missing: Math.max(0, missing) },
      verified,
      verify_detail: detail,
      ms: Date.now() - t0,
    };
    await writeFile(join(folder, "manifest.json"), JSON.stringify(manifest, null, 2));
    await status({ ok: true, size, verified, error: c.backup.verify && !verified ? `verification failed: ${detail}` : null });
    const pruned = await pruneBackups(root, c.backup.keep);
    o.log?.info("backup: done", { folder, size, verified, blobs: blobs.files, copied: blobs.copied, pruned, ms: manifest.ms });
    return { ...manifest, folder };
  } catch (e) {
    const error = String((e as Error).message ?? e).slice(0, 2000);
    await status({ ok: false, error });
    o.log?.error("backup: failed", { folder, error });
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    throw e;
  }
}

export interface BackupEntry {
  folder: string;
  name: string;
  label: BackupLabel;
  at: string;
  size: number;
  verified: boolean | null;
}

export function listBackups(root: string): BackupEntry[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((name) => ({ name, m: FOLDER.exec(name) }))
    .filter((x): x is { name: string; m: RegExpExecArray } => !!x.m && existsSync(join(root, x.name, "db.dump")))
    .map(({ name, m }) => {
      let manifest: Partial<BackupManifest> = {};
      try {
        manifest = JSON.parse(readFileSync(join(root, name, "manifest.json"), "utf8"));
      } catch {
        /* an older or partial backup */
      }
      return { folder: join(root, name), name, label: m[1] as BackupLabel, at: manifest.created_at ?? m[2], size: manifest.dump?.size ?? statSync(join(root, name, "db.dump")).size, verified: manifest.verified ?? null };
    })
    .sort((a, b) => b.name.slice(-15).localeCompare(a.name.slice(-15)));
}

/** Keep the newest `keep` automatic backups (manual and upgrade backups are removed by hand). */
export async function pruneBackups(root: string, keep: number): Promise<number> {
  const autos = listBackups(root).filter((b) => b.label === "auto");
  const k = Number.isFinite(keep) ? Math.max(1, Math.floor(keep)) : 14;
  let n = 0;
  for (const b of autos.slice(k)) {
    await rm(b.folder, { recursive: true, force: true }).catch(() => undefined);
    n++;
  }
  return n;
}

export function lastBackup(c: ServerEditionConfig): BackupStatus | null {
  try {
    return JSON.parse(readFileSync(join(c.dirs.data, LAST_FILE), "utf8")) as BackupStatus;
  } catch {
    return null;
  }
}

/** Is an automatic backup due (the daily time has passed and none ran since)? */
export function backupDue(c: ServerEditionConfig, now = new Date()): boolean {
  if (!c.backup.enabled) return false;
  const [h, m] = c.backup.time.split(":").map(Number);
  const today = new Date(now);
  today.setHours(h, m, 0, 0);
  if (now < today) return false;
  const last = listBackups(backupRoot(c)).find((b) => b.label === "auto");
  return !last || new Date(last.at) < today;
}

export interface RestoreOptions {
  config: ServerEditionConfig;
  /** a backup folder (with db.dump) or a .dump file */
  from: string;
  log?: Logger;
  bin?: string;
}

export interface RestoreResult {
  database: string;
  previous: string | null;
  blobs_copied: number;
  ms: number;
}

/**
 * Restore a backup: pg_restore into a new database; only when it fully succeeded the current database is renamed
 * aside (kept) and the restored one takes its name; then missing attachment files are copied back. The application
 * must be stopped (karizctl restore stops and starts the KarizApp service).
 */
export async function restoreBackup(o: RestoreOptions): Promise<RestoreResult> {
  const c = o.config;
  const bin = o.bin ?? pgBinOf(c);
  const t0 = Date.now();
  const dump = o.from.endsWith(".dump") ? o.from : join(o.from, "db.dump");
  if (!existsSync(dump)) throw new Error(`فایل پشتیبان پیدا نشد: ${dump}`);
  const s = stamp();
  const temp = `${c.db.database}_restore_${s.replace("-", "_")}`;
  const aside = `${c.db.database}_before_restore_${s.replace("-", "_")}`;
  const admin = postgres({ host: c.db.host, port: c.db.port, database: "postgres", username: c.db.admin_user, password: c.db.admin_password, max: 1, ssl: c.db.ssl ? "require" : false, onnotice: () => {} });
  const ident = (x: string) => `"${x.replace(/"/g, '""')}"`;
  let previous: string | null = null;
  try {
    await admin.unsafe(`create database ${ident(temp)} owner ${ident(c.db.user)} encoding 'UTF8' template template0`);
    o.log?.info("restore: pg_restore", { dump, into: temp });
    try {
      await run(pgExe(bin, "pg_restore"), [...conn(c, true), "-d", temp, "--exit-on-error", "-j", "4", dump], { env: dbEnv(c.db.admin_password), timeoutMs: 12 * 3600_000 });
    } catch (e) {
      await admin.unsafe(`drop database if exists ${ident(temp)} with (force)`).catch(() => undefined);
      throw e;
    }
    const exists = await admin`select 1 from pg_database where datname = ${c.db.database}`;
    if (exists.length) {
      await admin`select pg_terminate_backend(pid) from pg_stat_activity where datname = ${c.db.database} and pid <> pg_backend_pid()`;
      await admin.unsafe(`alter database ${ident(c.db.database)} rename to ${ident(aside)}`);
      previous = aside;
    }
    await admin.unsafe(`alter database ${ident(temp)} rename to ${ident(c.db.database)}`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  // attachment files the live folder lacks come back from the mirror next to the backup
  const mirror = join(o.from.endsWith(".dump") ? join(o.from, "..", "..") : join(o.from, ".."), "blobs");
  const copied = existsSync(mirror) ? (await mirrorBlobs(mirror, c.dirs.blobs)).copied : 0;
  o.log?.info("restore: done", { database: c.db.database, previous, blobs_copied: copied });
  return { database: c.db.database, previous, blobs_copied: copied, ms: Date.now() - t0 };
}
