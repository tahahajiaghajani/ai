// Backups of the server edition: `pg_dump -Fc` of the database plus the attachment files. Each backup is a folder
// <backups>\itsm-<label>-<stamp>\ with db.dump and manifest.json; attachment files are content-addressed and never
// change, so they are mirrored once into <backups>\blobs\ (only new files are copied). A backup is verified
// (pg_restore --list reads the whole archive; the mirror holds every content the live store holds for the database's
// attachments — rows whose content never reached the server, e.g. a refused upload, are reported apart as orphaned and
// never fail a backup), the result is kept in <data>\last-backup.json for «سلامت سرور», and automatic backups beyond
// `keep` are pruned. A failed automatic backup is retried after a growing pause (1, 2, 4, 8… hours, at the latest at
// the next daily time), never back to back. Restore goes into a new database that replaces the current one only when
// it fully succeeded (the old one is kept, renamed).
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
  /** missing: contents the live store holds that the mirror lacks (fails verification); orphaned: attachment rows whose
   * content is in neither (never uploaded, refused or quarantined) — a warning, not a backup failure */
  blobs: { files: number; bytes: number; copied: number; missing: number; orphaned: number };
  verified: boolean;
  verify_detail: string;
  ms: number;
  /** which application key sealed the stored secrets (SMTP and directory passwords, AI keys…): a fingerprint, never
   * the key — a restore onto a server with another kariz.json `secret` says so (docs/BANK_INSTALL_FA.md §7) */
  secret_id?: string;
}

/** A fingerprint of the application key (kariz.json `secret`), safe to keep next to the data it sealed. */
export const secretId = (secret: string): string => createHash("sha256").update(`kariz-secret-id:${secret}`).digest("hex").slice(0, 16);

export interface BackupStatus {
  ok: boolean;
  at: string;
  folder: string | null;
  label: BackupLabel;
  size: number;
  verified: boolean;
  error: string | null;
  ms: number;
  /** attachment rows without content anywhere (a warning for «سلامت سرور») */
  orphaned?: number;
  /** consecutive failed automatic backups (the retry pause grows with it) */
  failures?: number;
}

const LAST_FILE = "last-backup.json";
const FOLDER = /^itsm-(auto|manual|pre-upgrade|pre-restore)-(\d{8}-\d{6})$/;

export const backupRoot = (c: ServerEditionConfig) => c.backup.dir ?? c.dirs.backups;
export const pgBinOf = (c: ServerEditionConfig) => c.pg_bin ?? join(process.env.ITSM_INSTALL_DIR ?? process.cwd(), "pgsql", "bin");

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const dbEnv = (password: string): Record<string, string> => ({ PGPASSWORD: password, PGCONNECT_TIMEOUT: "15", PGAPPNAME: "itsm-backup" });
const conn = (c: ServerEditionConfig, admin = false) => ["-h", c.db.host, "-p", String(c.db.port), "-U", admin ? c.db.admin_user : c.db.user];

async function sha256File(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

/** The store's layout, level by level: <org id>\<sha256[0:2]>\<sha256>. Nothing else is ever copied. */
const LAYOUT = [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, /^[0-9a-f]{2}$/i, /^[0-9a-f]{64}$/i];

/**
 * Copy blob files that the mirror lacks (content-addressed: an existing file is identical). Only entries of the
 * store's own layout are read or written, never links: run as SYSTEM (the pre-upgrade backup, the nightly task) or an
 * administrator (restore), a folder named in kariz.json can neither make it copy other files out nor plant files
 * with names of its choosing.
 */
export async function mirrorBlobs(src: string, dest: string): Promise<{ files: number; bytes: number; copied: number }> {
  const out = { files: 0, bytes: 0, copied: 0 };
  if (!existsSync(src)) return out;
  const walk = async (rel: string, depth: number): Promise<void> => {
    for (const e of await readdir(join(src, rel), { withFileTypes: true })) {
      if (!LAYOUT[depth].test(e.name)) continue;
      const r = join(rel, e.name);
      if (depth < 2) {
        if (e.isDirectory()) await walk(r, depth + 1);
      } else if (e.isFile()) {
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
  await walk("", 0);
  return out;
}

const blobPath = (root: string, org: string, sha: string) => join(root, org.toLowerCase(), sha.slice(0, 2), sha);

/**
 * The mirror judged against the live store, for the contents the database's attachments refer to: `missing` — the live
 * store has the file and the mirror does not (the backup lacks something that exists: verification fails);
 * `orphaned` — neither has it (the Windows app synced the row but its upload was refused, quarantined or never sent:
 * no backup can hold it, so it is reported, never counted against the backup).
 */
export function mirrorAudit(rows: { org_id: string; sha256: string }[], live: string, mirror: string): { missing: number; orphaned: number } {
  let missing = 0;
  let orphaned = 0;
  for (const r of rows) {
    if (existsSync(blobPath(mirror, r.org_id, r.sha256))) continue;
    if (existsSync(blobPath(live, r.org_id, r.sha256))) missing++;
    else orphaned++;
  }
  return { missing, orphaned };
}

/** The attachments the database refers to (live rows, one per content). */
async function attachmentContents(c: ServerEditionConfig): Promise<{ org_id: string; sha256: string }[]> {
  const sql = postgres({ host: c.db.host, port: c.db.port, database: c.db.database, username: c.db.user, password: c.db.password, max: 1, ssl: c.db.ssl ? "require" : false, onnotice: () => {} });
  try {
    return [...(await sql<{ org_id: string; sha256: string }[]>`select distinct org_id::text as org_id, sha256 from sm_attachments where deleted_at is null`)];
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Attachment rows whose content is in neither the live store nor the mirror (`karizctl orphans`). */
export async function orphanedAttachments(c: ServerEditionConfig): Promise<{ id: string; org_id: string; table_key: string; record_id: string; name: string; sha256: string; created_at: string }[]> {
  const sql = postgres({ host: c.db.host, port: c.db.port, database: c.db.database, username: c.db.user, password: c.db.password, max: 1, ssl: c.db.ssl ? "require" : false, onnotice: () => {} });
  const mirror = join(backupRoot(c), "blobs");
  try {
    const rows = await sql<{ id: string; org_id: string; table_key: string; record_id: string; name: string; sha256: string; created_at: string }[]>`
      select id::text as id, org_id::text as org_id, table_key, record_id::text as record_id, name, sha256, created_at::text as created_at
      from sm_attachments where deleted_at is null order by created_at`;
    return rows.filter((r) => !existsSync(blobPath(mirror, r.org_id, r.sha256)) && !existsSync(blobPath(c.dirs.blobs, r.org_id, r.sha256)));
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
  const previous = lastBackup(c);
  const status = async (s: Partial<BackupStatus>) => {
    const st: BackupStatus = { ok: false, at: new Date().toISOString(), folder, label, size: 0, verified: false, error: null, ms: Date.now() - t0, ...s };
    await writeFile(join(c.dirs.data, LAST_FILE), JSON.stringify(st, null, 2)).catch(() => undefined);
  };
  try {
    // inside the try: an unreachable backup folder is a failed attempt too (recorded, retried after a pause)
    await mkdir(folder, { recursive: true });
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
    let orphaned = 0;
    if (c.backup.verify) {
      const list = await run(pgExe(bin, "pg_restore"), ["--list", dump], { timeoutMs: 3600_000, maxOutput: 64 * 1048576 });
      const entries = list.out.split(/\r?\n/).filter((l) => /^\d+;/.test(l)).length;
      const tables = list.out.split(/\r?\n/).filter((l) => / TABLE DATA /.test(l)).length;
      const audit = await attachmentContents(c)
        .then((rows) => mirrorAudit(rows, c.dirs.blobs, mirror))
        .catch(() => null);
      missing = audit ? audit.missing : -1;
      orphaned = audit?.orphaned ?? 0;
      verified = entries > 0 && tables > 0 && missing === 0;
      detail = `${entries} archive entries, ${tables} tables; ${missing < 0 ? "blob check skipped" : `${missing} attachment contents missing`}${orphaned ? `; ${orphaned} attachment rows without content (karizctl orphans)` : ""}`;
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
      blobs: { files: blobs.files, bytes: blobs.bytes, copied: blobs.copied, missing: Math.max(0, missing), orphaned },
      verified,
      verify_detail: detail,
      ms: Date.now() - t0,
      secret_id: secretId(c.secret),
    };
    await writeFile(join(folder, "manifest.json"), JSON.stringify(manifest, null, 2));
    await status({ ok: true, size, verified, error: c.backup.verify && !verified ? `verification failed: ${detail}` : null, orphaned, failures: 0 });
    const pruned = await pruneBackups(root, c.backup.keep);
    if (orphaned) o.log?.warn(`backup: ${orphaned} attachment rows have no content anywhere (never uploaded or refused); list them with karizctl orphans`);
    o.log?.info("backup: done", { folder, size, verified, blobs: blobs.files, copied: blobs.copied, orphaned, pruned, ms: manifest.ms });
    return { ...manifest, folder };
  } catch (e) {
    const error = String((e as Error).message ?? e).slice(0, 2000);
    // consecutive failed automatic backups: the next try waits longer (backupDue)
    const failures = label === "auto" ? (previous && !previous.ok && previous.label === "auto" ? Math.max(1, previous.failures ?? 1) + 1 : 1) : previous?.failures;
    o.log?.error("backup: failed", { folder, error });
    // the partial folder goes first: a dump that filled the disk must not keep the status file from being written
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    await status({ ok: false, error, failures });
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

/** The pause after `failures` consecutive failed automatic backups: 1, 2, 4, 8, 16 hours. */
export const retryPauseMs = (failures: number) => Math.min(2 ** (Math.max(1, failures) - 1), 16) * 3600_000;

/**
 * Is an automatic backup due (the daily time has passed and none ran since)? A failed attempt since the daily time
 * holds the next one back by a growing pause (retryPauseMs), so a failing backup (a full disk, an unreadable file) is
 * retried a few times a day, never back to back; the next daily time always gets its try.
 */
export function backupDue(c: ServerEditionConfig, now = new Date()): boolean {
  if (!c.backup.enabled) return false;
  const [h, m] = c.backup.time.split(":").map(Number);
  const today = new Date(now);
  today.setHours(h, m, 0, 0);
  if (now < today) return false;
  const last = listBackups(backupRoot(c)).find((b) => b.label === "auto");
  if (last && new Date(last.at) >= today) return false;
  const st = lastBackup(c);
  if (st && !st.ok && st.label === "auto") {
    const at = Date.parse(st.at);
    if (Number.isFinite(at) && at >= today.getTime() && now.getTime() - at < retryPauseMs(st.failures ?? 1)) return false;
  }
  return true;
}

/** When a failed automatic backup is tried again (null: no failure pending). */
export function nextBackupRetry(c: ServerEditionConfig): string | null {
  const st = lastBackup(c);
  if (!st || st.ok || st.label !== "auto") return null;
  const at = Date.parse(st.at);
  return Number.isFinite(at) ? new Date(at + retryPauseMs(st.failures ?? 1)).toISOString() : null;
}

export interface RestoreOptions {
  config: ServerEditionConfig;
  /** a backup folder (with db.dump) or a .dump file */
  from: string;
  log?: Logger;
  bin?: string;
}

/** Were the secrets of the backup at `from` (a folder or its .dump) sealed with another key than `secret`? */
export function keyMismatch(from: string, secret: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(from.endsWith(".dump") ? join(from, "..") : from, "manifest.json"), "utf8")) as Partial<BackupManifest>;
    return !!manifest.secret_id && manifest.secret_id !== secretId(secret);
  } catch {
    // a bare .dump, or a backup older than the fingerprint: nothing to compare
    return false;
  }
}

export interface RestoreResult {
  database: string;
  previous: string | null;
  blobs_copied: number;
  ms: number;
  /** the backup's stored secrets were sealed with another application key (a rebuilt server with a new kariz.json):
   * they do not open until that key is back in kariz.json or the passwords are entered again */
  key_mismatch: boolean;
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
  const key_mismatch = keyMismatch(o.from, c.secret);
  if (key_mismatch) o.log?.warn("restore: the backup's secrets were sealed with another application key (kariz.json secret)");
  return { database: c.db.database, previous, blobs_copied: copied, ms: Date.now() - t0, key_mismatch };
}
