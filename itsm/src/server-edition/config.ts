// Configuration of the server edition: C:\ProgramData\Kariz\kariz.json (another file with ITSM_SERVER_CONFIG), then
// environment overrides (ITSM_*). The installer writes it (generated database password and application secret
// included) and protects it with an ACL (Administrators + the service accounts); the first-run setup and karizctl
// update it. Every number is checked: a hand-edited value outside its range falls back to its default with a warning
// instead of breaking the start.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { availableParallelism } from "node:os";
import { randomBytes } from "node:crypto";
import { CONFIG_ENV, EDITION } from "./names";
import { connectionsFor, planPools, recommendedPool, recommendedWorkers, type PoolPlan } from "./pgtune";
import { allowEntryProblem } from "@server/net";

export interface AntivirusConfig {
  /** scanner executable, e.g. C:\Program Files\Windows Defender\MpCmdRun.exe; null = no scanning */
  command: string | null;
  /** arguments; {file} is replaced by the file to scan */
  args: string[];
  timeout_s: number;
  /** exit codes meaning «infected» (Defender: 2) */
  infected_codes: number[];
  /** a scanner that fails or times out: refuse the file (default) or accept it */
  on_error: "reject" | "allow";
}

export interface ServerEditionConfig {
  /** the address people type, e.g. https://kariz.bank.local */
  public_url: string;
  listen: { address: string; https_port: number; http_port: number; redirect_http: boolean };
  tls: {
    /** PKCS#12 bundle (the bank's certificate) */
    pfx: string | null;
    passphrase: string | null;
    /** or PEM certificate (with its chain) and key */
    cert: string | null;
    key: string | null;
    /** null: plain HTTP behind a TLS-terminating proxy (labs, tests) */
    enabled: boolean;
    hsts_max_age: number;
  };
  db: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    /** the cluster's superuser (bootstrap, extensions, restore); its password never leaves this file */
    admin_user: string;
    admin_password: string;
    ssl: boolean;
    /** PostgreSQL max_connections (0 = automatic: workers × pool + 30, at least 50 — pgtune.ts connectionsFor) */
    max_connections: number;
    reserve: number;
  };
  dirs: { data: string; blobs: string; backups: string; logs: string; pg_data: string; quarantine: string; tls: string };
  /** application worker processes (0 = automatic: a third of the CPU cores, 2 to 12 — pgtune.ts recommendedWorkers) */
  workers: number;
  /** database connections per worker (0 = automatic: 10 on 8+ cores, else 8; see planPools) */
  pool_per_worker: number;
  /**
   * Write transactions of one organisation in the database at once, per worker (write admission, context.ts
   * `admitWrite`; default 3 — PERFORMANCE_FA.md §۱۳). The environment variable ITSM_WRITERS_PER_ORG wins.
   */
  writers_per_org: number;
  /**
   * Serialise every write of an organisation on its lock again (the behaviour before transaction-id sync revisions,
   * context.ts `configureWriteSerialisation`; off by default — PERFORMANCE_FA.md §۱۶): an operational fallback when
   * concurrent writes misbehave, at the cost of write throughput. The environment variable ITSM_SERIALIZE_WRITES wins.
   */
  serialize_writes: boolean;
  network: { air_gapped: boolean; allow: string[] };
  uploads: { max_mb: number; request_max_mb: number };
  antivirus: AntivirusConfig;
  log: { level: "debug" | "info" | "warn" | "error"; max_mb: number; keep: number; slow_ms: number };
  backup: { enabled: boolean; time: string; keep: number; verify: boolean; dir: string | null };
  scheduler: { interval_s: number };
  /** signs sessions and encrypts stored secrets (generated at install) */
  secret: string;
  platform_admins: string[];
  /** bearer token of GET /api/server/metrics for monitoring tools (generated at install) */
  metrics_token: string;
  /**
   * The installation's reverse proxies (IIS with Windows Authentication, a load balancer): IP addresses and CIDR
   * ranges. ONE list for the HTTP front (X-Forwarded-* / X-Real-IP / Forwarded are kept only from these TCP peers and
   * loopback, dropped from everyone else) and for sign-in (cfg.auth.trustedProxies: the client address, HTTPS and a
   * directory source's trusted-proxy SSO header are believed only from them). Empty: clients connect directly.
   */
  trusted_proxies: string[];
  /** sign-in and sessions (cfg.auth of src/server/context.ts; docs/AD_FA.md) */
  auth: {
    /** domain controllers on the bank's network may be reached (through the air-gap allowlist) */
    directory_lan: boolean;
    /** the session cookie's Secure flag: "always" behind HTTPS (the default), "auto" only for labs */
    cookie_secure: "auto" | "always" | "never";
    cookie_samesite: "Lax" | "Strict";
  };
  setup: { token_hash: string | null; expires_at: string | null; completed_at: string | null };
  /** where pg_dump/pg_restore/pg_ctl live (default: <install>\pgsql\bin) */
  pg_bin: string | null;
}

export interface LoadedConfig {
  config: ServerEditionConfig;
  /** the file it came from (written back by setup and karizctl) */
  file: string;
  /** values that were out of range and replaced by defaults */
  warnings: string[];
}

const isWindows = process.platform === "win32";

/** Default data folder: C:\ProgramData\Kariz on Windows, ./.local-data/server elsewhere (development). */
export function defaultDataDir(): string {
  if (process.env.ITSM_DATA_DIR) return resolve(process.env.ITSM_DATA_DIR);
  return isWindows ? EDITION.dataDir : resolve(".local-data/server");
}

export function defaultConfigFile(): string {
  if (process.env[CONFIG_ENV]) return resolve(process.env[CONFIG_ENV]!);
  return join(defaultDataDir(), EDITION.configFile);
}

export function dirsFor(data: string): ServerEditionConfig["dirs"] {
  return {
    data,
    blobs: join(data, "blobs"),
    backups: join(data, "backups"),
    logs: join(data, "logs"),
    pg_data: join(data, "db"),
    quarantine: join(data, "quarantine"),
    tls: join(data, "tls"),
  };
}

export function defaultConfig(data = defaultDataDir()): ServerEditionConfig {
  return {
    public_url: `https://${EDITION.defaultHostName}`,
    listen: { address: "0.0.0.0", https_port: 443, http_port: 80, redirect_http: true },
    tls: { pfx: null, passphrase: null, cert: null, key: null, enabled: true, hsts_max_age: 31536000 },
    db: { host: "127.0.0.1", port: EDITION.database.port, database: EDITION.database.name, user: EDITION.database.appRole, password: "", admin_user: EDITION.database.superuser, admin_password: "", ssl: false, max_connections: 0, reserve: 10 },
    dirs: dirsFor(data),
    workers: 0,
    pool_per_worker: 0,
    writers_per_org: 3,
    serialize_writes: false,
    network: { air_gapped: true, allow: [] },
    uploads: { max_mb: 25, request_max_mb: 10 },
    antivirus: { command: null, args: ["-Scan", "-ScanType", "3", "-File", "{file}", "-DisableRemediation"], timeout_s: 120, infected_codes: [2], on_error: "reject" },
    log: { level: "info", max_mb: 20, keep: 10, slow_ms: 1500 },
    backup: { enabled: true, time: "01:30", keep: 14, verify: true, dir: null },
    scheduler: { interval_s: 5 },
    secret: "",
    platform_admins: [],
    metrics_token: "",
    trusted_proxies: [],
    auth: { directory_lan: true, cookie_secure: "always", cookie_samesite: "Lax" },
    setup: { token_hash: null, expires_at: null, completed_at: null },
    pg_bin: null,
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Deep merge of plain objects (arrays and scalars replace). */
function merge<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined ? base : (patch as T)) ?? base;
  const out: Obj = { ...(base as Obj) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isObj(out[k]) && isObj(v) ? merge(out[k], v) : v;
  }
  return out as T;
}

function numberIn(warn: string[], name: string, v: unknown, min: number, max: number, fallback: number, integer = true): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n))) return n;
  if (v !== undefined && v !== null && v !== "") warn.push(`${name}: «${String(v)}» معتبر نیست؛ ${fallback} به کار رفت`);
  return fallback;
}

const str = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim() : fallback);
const strOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : v === "true" || v === "1" ? true : v === "false" || v === "0" ? false : fallback);
/** An on/off switch: true/false, or the words the environment uses (1/true/on/yes, 0/false/off/no). */
function switchOf(warn: string[], name: string, v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  const t = typeof v === "string" ? v.trim().toLowerCase() : typeof v === "number" ? String(v) : "";
  if (["1", "true", "on", "yes"].includes(t)) return true;
  if (["0", "false", "off", "no"].includes(t)) return false;
  if (v !== undefined && v !== null && t !== "") warn.push(`${name}: «${String(v)}» معتبر نیست (true یا false)؛ ${fallback} به کار رفت`);
  return fallback;
}
const list = (v: unknown) =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;\s]+/) : [])
    .map((s) => String(s).trim())
    .filter(Boolean);

const PROXY_ENTRY = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f:]*:[0-9a-f:.]*)(\/\d{1,3})?$/i;

/** The trusted proxies (IP addresses and CIDR ranges; host names are refused: a proxy is judged by its TCP peer). */
function proxiesOf(w: string[], c: Obj): string[] {
  const out: string[] = [];
  for (const e of list(c.trusted_proxies)) {
    if (PROXY_ENTRY.test(e)) out.push(e.toLowerCase());
    else w.push(`trusted_proxies: «${e}» نشانی IP یا بازهٔ CIDR نیست؛ کنار گذاشته شد`);
  }
  // the earlier boolean trusted every peer's X-Forwarded-*; it is replaced by the list
  if (c.trust_proxy === true && !out.length) w.push("trust_proxy دیگر به کار نمی‌رود؛ نشانی پراکسی معکوس را در trusted_proxies بنویسید (تا آن زمان X-Forwarded-* فقط از خود سرور پذیرفته می‌شود)");
  return [...new Set(out)];
}

/** Check and normalise a raw configuration object (from the file, merged with the environment). */
export function normalize(raw: unknown, warnings: string[] = []): ServerEditionConfig {
  const r = isObj(raw) ? raw : {};
  const dataDir = str((r.dirs as Obj | undefined)?.data, defaultDataDir());
  const d = defaultConfig(dataDir);
  const c = merge(d, r);
  const w = warnings;
  let publicUrl = str(c.public_url, d.public_url).replace(/\/+$/, "");
  try {
    const u = new URL(publicUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    publicUrl = `${u.protocol}//${u.host}`;
  } catch {
    w.push(`public_url: «${publicUrl}» معتبر نیست؛ ${d.public_url} به کار رفت`);
    publicUrl = d.public_url;
  }
  const dirs = { ...dirsFor(dataDir), ...(isObj(c.dirs) ? c.dirs : {}) } as ServerEditionConfig["dirs"];
  for (const k of Object.keys(dirs) as (keyof typeof dirs)[]) dirs[k] = isAbsolute(String(dirs[k])) ? String(dirs[k]) : resolve(dataDir, String(dirs[k]));
  const level = ["debug", "info", "warn", "error"].includes(String(c.log?.level)) ? (c.log.level as ServerEditionConfig["log"]["level"]) : "info";
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(c.backup?.time)) ? String(c.backup.time) : d.backup.time;
  if (c.backup?.time && time !== c.backup.time) w.push(`backup.time: «${String(c.backup.time)}» معتبر نیست (ساعت:دقیقه)؛ ${time} به کار رفت`);
  return {
    public_url: publicUrl,
    listen: {
      address: str(c.listen?.address, d.listen.address),
      https_port: numberIn(w, "listen.https_port", c.listen?.https_port, 0, 65535, d.listen.https_port),
      http_port: numberIn(w, "listen.http_port", c.listen?.http_port, 0, 65535, d.listen.http_port),
      redirect_http: bool(c.listen?.redirect_http, true),
    },
    tls: {
      pfx: strOrNull(c.tls?.pfx),
      passphrase: typeof c.tls?.passphrase === "string" ? c.tls.passphrase : null,
      cert: strOrNull(c.tls?.cert),
      key: strOrNull(c.tls?.key),
      enabled: bool(c.tls?.enabled, true),
      hsts_max_age: numberIn(w, "tls.hsts_max_age", c.tls?.hsts_max_age, 0, 63072000, d.tls.hsts_max_age),
    },
    db: {
      host: str(c.db?.host, d.db.host),
      port: numberIn(w, "db.port", c.db?.port, 1, 65535, d.db.port),
      database: str(c.db?.database, d.db.database),
      user: str(c.db?.user, d.db.user),
      password: typeof c.db?.password === "string" ? c.db.password : "",
      admin_user: str(c.db?.admin_user, d.db.admin_user),
      admin_password: typeof c.db?.admin_password === "string" ? c.db.admin_password : "",
      ssl: bool(c.db?.ssl, false),
      max_connections: c.db?.max_connections === 0 ? 0 : numberIn(w, "db.max_connections", c.db?.max_connections, 20, 10000, d.db.max_connections),
      reserve: numberIn(w, "db.reserve", c.db?.reserve, 3, 1000, d.db.reserve),
    },
    dirs,
    workers: numberIn(w, "workers", c.workers, 0, 64, 0),
    pool_per_worker: numberIn(w, "pool_per_worker", c.pool_per_worker, 0, 200, 0),
    writers_per_org: numberIn(w, "writers_per_org", c.writers_per_org, 1, 64, d.writers_per_org),
    serialize_writes: switchOf(w, "serialize_writes", c.serialize_writes, d.serialize_writes),
    network: { air_gapped: bool(c.network?.air_gapped, true), allow: [...new Set(list(c.network?.allow).map((h) => h.toLowerCase()))] },
    uploads: {
      max_mb: numberIn(w, "uploads.max_mb", c.uploads?.max_mb, 1, 100, d.uploads.max_mb),
      request_max_mb: numberIn(w, "uploads.request_max_mb", c.uploads?.request_max_mb, 1, 100, d.uploads.request_max_mb),
    },
    antivirus: {
      command: strOrNull(c.antivirus?.command),
      args: Array.isArray(c.antivirus?.args) && c.antivirus.args.length ? c.antivirus.args.map(String) : d.antivirus.args,
      timeout_s: numberIn(w, "antivirus.timeout_s", c.antivirus?.timeout_s, 5, 3600, d.antivirus.timeout_s),
      infected_codes: Array.isArray(c.antivirus?.infected_codes) ? c.antivirus.infected_codes.map(Number).filter((n: number) => Number.isInteger(n)) : d.antivirus.infected_codes,
      on_error: c.antivirus?.on_error === "allow" ? "allow" : "reject",
    },
    log: {
      level,
      max_mb: numberIn(w, "log.max_mb", c.log?.max_mb, 1, 1024, d.log.max_mb),
      keep: numberIn(w, "log.keep", c.log?.keep, 1, 100, d.log.keep),
      slow_ms: numberIn(w, "log.slow_ms", c.log?.slow_ms, 50, 600000, d.log.slow_ms),
    },
    backup: {
      enabled: bool(c.backup?.enabled, true),
      time,
      keep: numberIn(w, "backup.keep", c.backup?.keep, 1, 365, d.backup.keep),
      verify: bool(c.backup?.verify, true),
      dir: strOrNull(c.backup?.dir),
    },
    scheduler: { interval_s: numberIn(w, "scheduler.interval_s", c.scheduler?.interval_s, 1, 300, d.scheduler.interval_s) },
    secret: typeof c.secret === "string" ? c.secret : "",
    platform_admins: [...new Set(list(c.platform_admins).map((e) => e.toLowerCase()))],
    metrics_token: typeof c.metrics_token === "string" ? c.metrics_token : "",
    trusted_proxies: proxiesOf(w, c as unknown as Obj),
    auth: {
      directory_lan: bool(c.auth?.directory_lan, d.auth.directory_lan),
      cookie_secure: ["auto", "always", "never"].includes(String(c.auth?.cookie_secure)) ? (c.auth.cookie_secure as ServerEditionConfig["auth"]["cookie_secure"]) : d.auth.cookie_secure,
      cookie_samesite: String(c.auth?.cookie_samesite).toLowerCase() === "strict" ? "Strict" : "Lax",
    },
    setup: {
      token_hash: strOrNull(c.setup?.token_hash),
      expires_at: strOrNull(c.setup?.expires_at),
      completed_at: strOrNull(c.setup?.completed_at),
    },
    pg_bin: strOrNull(c.pg_bin),
  };
}

/** Environment variables (a plain record, so tests and karizctl pass their own without Next.js' ProcessEnv typing). */
export type Env = Record<string, string | undefined>;

/** Environment overrides (ITSM_*), applied over the file. */
export function envOverrides(env: Env = process.env): Obj {
  const o: Obj = {};
  const set = (path: string, v: unknown) => {
    if (v === undefined || v === "") return;
    const keys = path.split(".");
    let at: Obj = o;
    for (const k of keys.slice(0, -1)) at = (at[k] = isObj(at[k]) ? at[k] : {}) as Obj;
    at[keys[keys.length - 1]] = v;
  };
  set("public_url", env.ITSM_PUBLIC_URL);
  set("listen.address", env.ITSM_LISTEN_ADDRESS);
  set("listen.https_port", env.ITSM_HTTPS_PORT);
  set("listen.http_port", env.ITSM_HTTP_PORT);
  if (env.ITSM_TLS !== undefined) set("tls.enabled", env.ITSM_TLS);
  set("db.host", env.ITSM_DB_HOST);
  set("db.port", env.ITSM_DB_PORT);
  set("db.database", env.ITSM_DB_NAME);
  set("db.user", env.ITSM_DB_USER);
  set("db.password", env.ITSM_DB_PASSWORD);
  set("workers", env.ITSM_WORKERS);
  set("pool_per_worker", env.ITSM_POOL_PER_WORKER);
  set("writers_per_org", env.ITSM_WRITERS_PER_ORG);
  set("serialize_writes", env.ITSM_SERIALIZE_WRITES?.trim().toLowerCase());
  if (env.ITSM_AIR_GAPPED !== undefined) set("network.air_gapped", env.ITSM_AIR_GAPPED);
  if (env.ITSM_ALLOW_HOSTS !== undefined) set("network.allow", env.ITSM_ALLOW_HOSTS);
  set("log.level", env.ITSM_LOG_LEVEL);
  set("pg_bin", env.ITSM_PG_BIN);
  // sign-in (the same variables the other runtimes read: src/server/auth/session.ts, modules/integration/directory.ts)
  if (env.ITSM_TRUSTED_PROXIES !== undefined) set("trusted_proxies", env.ITSM_TRUSTED_PROXIES);
  if (env.ITSM_DIRECTORY_LAN !== undefined) set("auth.directory_lan", env.ITSM_DIRECTORY_LAN);
  set("auth.cookie_secure", env.ITSM_COOKIE_SECURE?.toLowerCase());
  set("auth.cookie_samesite", env.ITSM_COOKIE_SAMESITE);
  return o;
}

/**
 * The PostgreSQL superuser's credentials live apart from kariz.json, in kariz-admin.json next to it, readable by
 * administrators and SYSTEM only: karizctl (run by an administrator) needs them for bootstrap and restore, the
 * application never does.
 */
export function adminFileOf(file: string): string {
  return join(dirname(file), "kariz-admin.json");
}

function readAdmin(file: string): { admin_user?: string; admin_password?: string } | null {
  try {
    const raw = JSON.parse(readFileSync(adminFileOf(file), "utf8").replace(/^\uFEFF/, ""));
    return isObj(raw) ? (raw as { admin_user?: string; admin_password?: string }) : null;
  } catch {
    // absent, or not readable by this account (the application's)
    return null;
  }
}

/** Read the configuration file (a broken file is an error: the installer wrote it, a guess would be worse). */
export function loadServerConfig(file = defaultConfigFile(), env: Env = process.env): LoadedConfig {
  const warnings: string[] = [];
  let raw: unknown = {};
  if (existsSync(file)) {
    const text = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new Error(`فایل پیکربندی ${file} JSON معتبر نیست: ${(e as Error).message}`);
    }
  }
  const base = isObj(raw) ? raw : {};
  const admin = readAdmin(file);
  if (admin) {
    const db = isObj(base.db) ? base.db : {};
    base.db = { ...db, ...(admin.admin_user ? { admin_user: admin.admin_user } : {}), ...(admin.admin_password ? { admin_password: admin.admin_password } : {}) };
  }
  const merged = merge(base, envOverrides(env));
  const config = normalize(merged, warnings);
  return { config, file, warnings };
}

/** Write the configuration atomically (a temporary file renamed over the old one keeps its ACL on Windows). */
export function saveServerConfig(file: string, config: ServerEditionConfig): void {
  mkdirSync(dirname(file), { recursive: true });
  const write = (path: string, value: unknown) => {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, path);
  };
  // the superuser's password never goes into kariz.json; it is (re)written only by a process that knows it
  write(file, { ...config, db: { ...config.db, admin_password: "" } });
  if (config.db.admin_password) {
    const current = readAdmin(file);
    if (!current || current.admin_password !== config.db.admin_password || current.admin_user !== config.db.admin_user) {
      write(adminFileOf(file), { admin_user: config.db.admin_user, admin_password: config.db.admin_password });
    }
  }
}

/** Update a few values of the stored file (setup, karizctl): the file is re-read so concurrent edits are kept. */
export function patchServerConfig(file: string, patch: (c: ServerEditionConfig) => void): ServerEditionConfig {
  const { config } = loadServerConfig(file, {});
  patch(config);
  saveServerConfig(file, config);
  return config;
}

/**
 * Add or remove air-gap allowlist entries in the file (the web console's and karizctl's one path): every entry is
 * checked first (allowEntryProblem) and a bad one refuses the whole change with a Persian message. Answers the list.
 */
export function changeAllowlist(file: string, change: { add?: string[]; remove?: string[] }): string[] {
  const add = (change.add ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean);
  const remove = new Set((change.remove ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean));
  for (const h of add) {
    const problem = allowEntryProblem(h);
    if (problem) throw new AllowlistError(`«${h}»: ${problem}`);
  }
  return patchServerConfig(file, (x) => {
    x.network.allow = [...new Set([...x.network.allow.filter((e) => !remove.has(e)), ...add])];
  }).network.allow;
}

export class AllowlistError extends Error {}

export const newSecret = (bytes = 32) => randomBytes(bytes).toString("hex");

/** A password safe in connection strings and pgpass files (letters and digits only). */
export function newPassword(length = 32): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(length * 2);
  let out = "";
  for (let i = 0; i < bytes.length && out.length < length; i++) if (bytes[i] < 232) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Fill generated secrets a new installation lacks; returns whether anything changed. */
export function ensureSecrets(c: ServerEditionConfig): boolean {
  let changed = false;
  if (!c.secret || c.secret.length < 32) {
    c.secret = newSecret();
    changed = true;
  }
  if (!c.metrics_token) {
    c.metrics_token = newSecret(24);
    changed = true;
  }
  if (!c.db.password) {
    c.db.password = newPassword();
    changed = true;
  }
  if (!c.db.admin_password) {
    c.db.admin_password = newPassword();
    changed = true;
  }
  return changed;
}

/** Worker processes: the configured count, or a third of the cores (2 to 12; pgtune.ts recommendedWorkers). */
export function workerCount(c: ServerEditionConfig, cores = availableParallelism()): number {
  return c.workers > 0 ? c.workers : recommendedWorkers(cores);
}

/**
 * PostgreSQL max_connections of this installation: the configured value (never below what the workers' pools need),
 * or automatic (0) workers × pool + 30, at least 50 (pgtune.ts connectionsFor).
 */
export function maxConnectionsFor(c: ServerEditionConfig, cores = availableParallelism()): number {
  const need = connectionsFor(workerCount(c, cores), c.pool_per_worker || recommendedPool(cores), c.db.reserve);
  return c.db.max_connections > 0 ? Math.max(c.db.max_connections, need) : need;
}

/** Pool size of each worker for this configuration. */
export function poolFor(c: ServerEditionConfig, cores = availableParallelism()): PoolPlan {
  // an explicit max_connections is what PostgreSQL was told (kariz-local.conf may lower it): plan inside it
  const max = c.db.max_connections > 0 ? c.db.max_connections : maxConnectionsFor(c, cores);
  return planPools({ workers: workerCount(c, cores), requested: c.pool_per_worker, auto: recommendedPool(cores), maxConnections: max, reserve: c.db.reserve });
}

/** postgres:// URL of the application's database (password encoded). */
export function databaseUrl(c: ServerEditionConfig, user = c.db.user, password = c.db.password): string {
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${c.db.host.includes(":") ? `[${c.db.host}]` : c.db.host}:${c.db.port}/${encodeURIComponent(c.db.database)}`;
}

/** Host name of the public URL (the certificate's name). */
export const publicHost = (c: ServerEditionConfig) => new URL(c.public_url).hostname;

/** The configuration without secrets (diagnostics bundle, «سلامت سرور»). */
export function redacted(c: ServerEditionConfig): Obj {
  const copy = JSON.parse(JSON.stringify(c)) as Obj & ServerEditionConfig;
  copy.secret = c.secret ? "(set)" : "";
  copy.metrics_token = c.metrics_token ? "(set)" : "";
  copy.db.password = c.db.password ? "(set)" : "";
  copy.db.admin_password = c.db.admin_password ? "(set)" : "";
  copy.tls.passphrase = c.tls.passphrase ? "(set)" : null;
  copy.setup.token_hash = c.setup.token_hash ? "(set)" : null;
  return copy;
}
