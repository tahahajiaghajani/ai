// The bundled PostgreSQL of the server edition: initdb (UTF8, ICU fa-IR collation when available, data checksums,
// SCRAM passwords), postgresql.conf tuned for the machine (pgtune.ts), pg_hba.conf for loopback only, and the
// application's role and database (with pg_stat_statements and pgvector when the build has them). Used by the
// installer through `karizctl db-init` / `db-bootstrap` / `pg-conf`; the KarizDB service (WinSW) then runs postgres.exe.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, totalmem, tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type { ServerEditionConfig } from "./config";
import { connectionsFor, renderTuning, tunePostgres, withIncludes, type DiskKind, type TuneInput } from "./pgtune";
import { workerCount } from "./config";

const isWindows = process.platform === "win32";

/** A PostgreSQL program in `bin` (pg_dump → pg_dump.exe on Windows). */
export const pgExe = (bin: string, name: string) => join(bin, isWindows ? `${name}.exe` : name);

export interface RunResult {
  code: number;
  out: string;
}

/**
 * Run a program and collect its output; rejects with the tail of the output when it fails. Server programs (initdb,
 * pg_ctl, postgres) refuse to run as root on Linux: ITSM_PG_RUNAS=<user> runs them as that user (development only).
 */
export function run(cmd: string, args: string[], opts: { env?: Record<string, string | undefined>; input?: string; timeoutMs?: number; asServer?: boolean; cwd?: string; maxOutput?: number } = {}): Promise<RunResult> {
  let file = cmd;
  let argv = args;
  const runAs = process.env.ITSM_PG_RUNAS;
  if (opts.asServer && runAs && !isWindows && process.getuid?.() === 0) {
    file = "runuser";
    argv = ["-u", runAs, "--", cmd, ...args];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(file, argv, { env: { ...process.env, ...opts.env }, windowsHide: true, cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    const keep = (b: Buffer) => {
      out += b.toString("utf8");
      const max = opts.maxOutput ?? 200_000;
      if (out.length > max) out = out.slice(-Math.floor(max / 2));
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = opts.timeoutMs ? setTimeout(() => child.kill(), opts.timeoutMs) : null;
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`${cmd}: ${e.message}`));
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ code: 0, out });
      else reject(new Error(`${cmd.split(/[\\/]/).pop()} ${args[0] ?? ""} failed (exit ${code}): ${out.trim().split(/\r?\n/).slice(-15).join("\n")}`));
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

export interface InitOptions {
  bin: string;
  dataDir: string;
  superuser: string;
  password: string;
  /** ICU locale of the default collation (falls back to the C locale when the build has no ICU) */
  icuLocale?: string;
}

/** initdb a new cluster (refuses an existing one); returns the collation it got. */
export async function initCluster(o: InitOptions): Promise<{ collation: string }> {
  if (existsSync(join(o.dataDir, "PG_VERSION"))) throw new Error(`a database cluster already exists in ${o.dataDir}`);
  mkdirSync(o.dataDir, { recursive: true });
  const pwfile = join(tmpdir(), `itsm-pw-${randomUUID()}`);
  writeFileSync(pwfile, `${o.password}\n`, { mode: 0o600 });
  const runAs = process.env.ITSM_PG_RUNAS;
  if (runAs && !isWindows && process.getuid?.() === 0) {
    // development as root: the server user must own the folder and read the password file
    await run("chown", ["-R", runAs, o.dataDir]);
    await run("chown", [runAs, pwfile]);
  }
  const base = ["-D", o.dataDir, "-U", o.superuser, `--pwfile=${pwfile}`, "-E", "UTF8", "--auth-local=scram-sha-256", "--auth-host=scram-sha-256", "--data-checksums"];
  try {
    if (o.icuLocale) {
      try {
        await run(pgExe(o.bin, "initdb"), [...base, "--locale-provider=icu", `--icu-locale=${o.icuLocale}`, "--locale=C"], { asServer: true });
        return { collation: `icu:${o.icuLocale}` };
      } catch (e) {
        // no ICU in this build (or the locale is unknown): a clean folder and the C locale
        rmSync(o.dataDir, { recursive: true, force: true });
        mkdirSync(o.dataDir, { recursive: true });
        if (runAs && !isWindows && process.getuid?.() === 0) await run("chown", ["-R", runAs, o.dataDir]);
        if (!/icu/i.test(String((e as Error).message))) throw e;
      }
    }
    await run(pgExe(o.bin, "initdb"), [...base, "--locale=C"], { asServer: true });
    return { collation: "C" };
  } finally {
    rmSync(pwfile, { force: true });
  }
}

/** pg_hba.conf: loopback only, SCRAM passwords, nothing else. */
export function hbaConf(): string {
  return [
    "# Kariz server edition — PostgreSQL accepts connections from this machine only (karizctl rewrites this file).",
    "# TYPE  DATABASE  USER  ADDRESS        METHOD",
    "local   all       all                  scram-sha-256",
    "host    all       all   127.0.0.1/32   scram-sha-256",
    "host    all       all   ::1/128        scram-sha-256",
    "",
  ].join("\n");
}

export interface Machine {
  ramMb: number;
  cpus: number;
  disk: DiskKind;
  os: "windows" | "linux";
}

export function thisMachine(disk: DiskKind = "ssd"): Machine {
  return { ramMb: Math.floor(totalmem() / 1048576), cpus: cpus().length, disk, os: isWindows ? "windows" : "linux" };
}

/** The tuning input for this installation (connections from its workers and pools). */
export function tuneInputFor(c: ServerEditionConfig, m: Machine): TuneInput {
  const workers = workerCount(c, m.cpus);
  return { ...m, connections: Math.max(c.db.max_connections, connectionsFor(workers, c.pool_per_worker || 10, c.db.reserve)), slowMs: Math.max(200, c.log.slow_ms) };
}

/** Write kariz-tuning.conf, include it from postgresql.conf, and write pg_hba.conf. Returns the tuning notes. */
export function writePgConfig(dataDir: string, input: TuneInput, opts: { port?: number } = {}): { notes: string[]; settings: Record<string, string> } {
  const result = tunePostgres(input);
  if (opts.port) result.settings.port = String(opts.port);
  writeFileSync(join(dataDir, "kariz-tuning.conf"), renderTuning(result, input));
  const confPath = join(dataDir, "postgresql.conf");
  const conf = existsSync(confPath) ? readFileSync(confPath, "utf8") : "";
  writeFileSync(confPath, withIncludes(conf));
  if (!existsSync(join(dataDir, "kariz-local.conf"))) writeFileSync(join(dataDir, "kariz-local.conf"), "# Your own PostgreSQL settings (kept on upgrade; applied after kariz-tuning.conf).\n");
  writeFileSync(join(dataDir, "pg_hba.conf"), hbaConf());
  return { notes: result.notes, settings: result.settings };
}

/** pg_ctl start/stop for the installer and development (the service runs postgres directly). */
export async function pgCtl(bin: string, dataDir: string, action: "start" | "stop" | "status", logFile?: string): Promise<RunResult> {
  const args = action === "start" ? ["start", "-D", dataDir, "-w", "-t", "120", ...(logFile ? ["-l", logFile] : [])] : action === "stop" ? ["stop", "-D", dataDir, "-m", "fast", "-w", "-t", "120"] : ["status", "-D", dataDir];
  return run(pgExe(bin, "pg_ctl"), args, { asServer: true, timeoutMs: 180_000 });
}

export interface BootstrapResult {
  created_role: boolean;
  created_database: boolean;
  extensions: Record<string, string>;
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * As the superuser: the application's role (password from the configuration), its database (owned by it, UTF8), and
 * the extensions only a superuser may create (pg_stat_statements; pgvector when this build has it — retrieval
 * falls back to its portable store otherwise). Idempotent: also run on every upgrade.
 */
export async function bootstrapDatabase(c: ServerEditionConfig): Promise<BootstrapResult> {
  const admin = (db: string) =>
    postgres({ host: c.db.host, port: c.db.port, database: db, username: c.db.admin_user, password: c.db.admin_password, max: 1, ssl: c.db.ssl ? "require" : false, onnotice: () => {}, connect_timeout: 15 });
  const out: BootstrapResult = { created_role: false, created_database: false, extensions: {} };
  const root = admin("postgres");
  try {
    const role = await root`select 1 from pg_roles where rolname = ${c.db.user}`;
    if (!role.length) {
      await root.unsafe(`create role ${ident(c.db.user)} login password ${literal(c.db.password)}`);
      out.created_role = true;
    } else await root.unsafe(`alter role ${ident(c.db.user)} login password ${literal(c.db.password)}`);
    // statistics of every statement (pg_stat_statements) for «سلامت سرور»
    await root.unsafe(`grant pg_read_all_stats to ${ident(c.db.user)}`).catch(() => undefined);
    const db = await root`select 1 from pg_database where datname = ${c.db.database}`;
    if (!db.length) {
      await root.unsafe(`create database ${ident(c.db.database)} owner ${ident(c.db.user)} encoding 'UTF8' template template0`);
      out.created_database = true;
    }
  } finally {
    await root.end({ timeout: 5 });
  }
  const app = admin(c.db.database);
  try {
    for (const ext of ["pg_stat_statements", "vector", "pgcrypto"]) {
      try {
        await app.unsafe(`create extension if not exists ${ident(ext)}`);
        const [v] = await app`select extversion from pg_extension where extname = ${ext}`;
        out.extensions[ext] = String(v?.extversion ?? "?");
      } catch (e) {
        out.extensions[ext] = `unavailable: ${String((e as Error).message).slice(0, 120)}`;
      }
    }
    await app.unsafe(`alter schema public owner to ${ident(c.db.user)}`).catch(() => undefined);
  } finally {
    await app.end({ timeout: 5 });
  }
  return out;
}

/** Wait until PostgreSQL accepts connections (the service may still be starting). */
export async function waitForDb(c: ServerEditionConfig, timeoutMs = 120_000, asAdmin = false): Promise<void> {
  const until = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < until) {
    const sql = postgres({ host: c.db.host, port: c.db.port, database: asAdmin ? "postgres" : c.db.database, username: asAdmin ? c.db.admin_user : c.db.user, password: asAdmin ? c.db.admin_password : c.db.password, max: 1, connect_timeout: 5, ssl: c.db.ssl ? "require" : false, onnotice: () => {} });
    try {
      await sql`select 1`;
      await sql.end({ timeout: 2 });
      return;
    } catch (e) {
      last = String((e as Error).message ?? e);
      await sql.end({ timeout: 1 }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`PostgreSQL did not answer within ${Math.round(timeoutMs / 1000)}s: ${last}`);
}
