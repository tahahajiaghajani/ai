// karizctl — the administrator's command line of the server edition (bundled as app\karizctl.cjs; karizctl.cmd in the
// installation folder). Run it from an elevated prompt on the server:
//   karizctl status | start | stop | restart [--rolling]
//   karizctl backup | backups | restore <folder> [--yes]
//   karizctl reset-password <email> | rotate-cert --pfx <file> --password <p> (or --cert <crt> --key <key>)
//   karizctl allow list | allow add <host> | allow remove <host>
//   karizctl diagnostics [--out <file.zip>] | setup-token | version
// Installer steps (also safe to run by hand): init, db-init, pg-conf, db-bootstrap, migrate, pg-start, pg-stop,
// wait-ready, purge.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { hostname, release, totalmem, cpus } from "node:os";
import { join, resolve } from "node:path";
import { APP_NAME, APP_VERSION } from "@shared/constants";
import { createPostgresDb } from "@server/db/postgres";
import { migrate, migrationStatus } from "@server/db/migrate";
import { hashPassword, readableCode } from "@server/auth/password";
import { securityEvent } from "@server/modules/platform/security";
import { allowEntryProblem } from "@server/net";
import { databaseUrl, defaultConfigFile, dirsFor, ensureSecrets, loadServerConfig, patchServerConfig, redacted, saveServerConfig, type ServerEditionConfig } from "./config";
import { EDITION } from "./names";
import { bootstrapDatabase, initCluster, pgCtl, thisMachine, tuneInputFor, waitForDb, writePgConfig } from "./pg";
import { backupNow, backupRoot, lastBackup, listBackups, pgBinOf, restoreBackup } from "./backup";
import { issueSetupToken } from "./setup";
import { inspectCredentials, loadCredentials } from "./tls";
import { RESTART_REQUEST, RELOAD_REQUEST } from "./cluster";
import { zip, type ZipEntry } from "./zip";
import type { DiskKind } from "./pgtune";

export interface Args {
  cmd: string;
  positional: string[];
  flags: Record<string, string | true>;
}

/** Flags that never take a value (so `--yes restore …` and `restore … --yes` read the same). */
const BOOL_FLAGS = new Set(["yes", "rolling", "force", "no-restart", "no-safety-backup", "help"]);

/** `karizctl <command> [args] [--flag value | --flag=value | --switch]`; flags may also come before the command. */
export function parseArgs(argv: string[]): Args {
  const flags: Args["flags"] = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      if (v !== undefined) flags[k] = v;
      else if (!BOOL_FLAGS.has(k) && i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
      else flags[k] = true;
    } else positional.push(a);
  }
  return { cmd: positional.shift() ?? "help", positional, flags };
}

const say = (s: string) => process.stdout.write(`${s}\n`);
const warn = (s: string) => process.stderr.write(`${s}\n`);
const isWindows = process.platform === "win32";
const flag = (a: Args, k: string) => (typeof a.flags[k] === "string" ? (a.flags[k] as string) : undefined);

class UsageError extends Error {}

// ----- Windows services ------------------------------------------------------------------------------------------

function scState(name: string): string | null {
  const r = spawnSync("sc.exe", ["query", name], { encoding: "utf8", windowsHide: true });
  const m = /STATE\s*:\s*\d+\s+(\w+)/.exec(r.stdout ?? "");
  return m ? m[1] : null;
}

async function service(action: "start" | "stop", name: string, timeoutMs = 180_000): Promise<void> {
  if (!isWindows) throw new UsageError("مدیریت سرویس‌ها فقط روی ویندوز است (روی این سیستم سرور را با «node server.cjs» اجرا کنید)");
  const want = action === "start" ? "RUNNING" : "STOPPED";
  if (scState(name) === want) return;
  spawnSync("sc.exe", [action, name], { encoding: "utf8", windowsHide: true });
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (scState(name) === want) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`سرویس ${name} در ${Math.round(timeoutMs / 1000)} ثانیه به وضعیت ${want} نرسید`);
}

// ----- local HTTP probe ----------------------------------------------------------------------------------------------

export function probe(c: ServerEditionConfig, path: string, timeoutMs = 5000): Promise<{ status: number; body: string }> {
  return new Promise((resolveP) => {
    const tlsOn = c.tls.enabled;
    const port = tlsOn ? c.listen.https_port : c.listen.http_port;
    const req = (tlsOn ? httpsRequest : httpRequest)(
      // a loopback probe of this very server: its certificate names the public host, not 127.0.0.1
      { host: "127.0.0.1", port, path, method: "GET", timeout: timeoutMs, rejectUnauthorized: false, headers: { host: new URL(c.public_url).host } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (d: string) => (body += d));
        res.on("end", () => resolveP({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolveP({ status: 0, body: String(e.message) }));
    req.end();
  });
}

// ----- commands --------------------------------------------------------------------------------------------------

function configFile(a: Args) {
  return resolve(flag(a, "config") ?? defaultConfigFile());
}

function load(a: Args): ServerEditionConfig {
  const file = configFile(a);
  if (!existsSync(file)) throw new UsageError(`فایل پیکربندی ${file} نیست؛ نخست «karizctl init» را اجرا کنید`);
  return loadServerConfig(file).config;
}

async function withDb<T>(c: ServerEditionConfig, fn: (db: ReturnType<typeof createPostgresDb>) => Promise<T>): Promise<T> {
  const db = createPostgresDb({ url: databaseUrl(c), max: 2, ssl: c.db.ssl });
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

async function cmdInit(a: Args) {
  const file = configFile(a);
  const existing = existsSync(file);
  const c = existing ? loadServerConfig(file, {}).config : loadServerConfig(join(resolve(flag(a, "data-dir") ?? "."), "__none__.json"), {}).config;
  const dataDir = flag(a, "data-dir");
  if (dataDir && (!existing || resolve(dataDir) !== c.dirs.data)) c.dirs = dirsFor(resolve(dataDir));
  const publicUrl = flag(a, "public-url") ?? (flag(a, "host") ? `https://${flag(a, "host")}` : undefined);
  if (publicUrl) c.public_url = new URL(publicUrl).origin;
  const num = (k: string) => (flag(a, k) !== undefined ? Number(flag(a, k)) : undefined);
  if (num("https-port") !== undefined) c.listen.https_port = num("https-port")!;
  if (num("http-port") !== undefined) c.listen.http_port = num("http-port")!;
  if (num("pg-port") !== undefined) c.db.port = num("pg-port")!;
  if (num("workers") !== undefined) c.workers = num("workers")!;
  if (flag(a, "air-gapped") !== undefined) c.network.air_gapped = flag(a, "air-gapped") !== "false";
  if (flag(a, "allow")) c.network.allow = [...new Set([...c.network.allow, ...flag(a, "allow")!.split(/[,;\s]+/).filter(Boolean).map((h) => h.toLowerCase())])];
  if (flag(a, "trusted-proxies")) c.trusted_proxies = [...new Set(flag(a, "trusted-proxies")!.split(/[,;\s]+/).filter(Boolean).map((h) => h.toLowerCase()))];
  if (flag(a, "install-dir")) c.pg_bin = join(resolve(flag(a, "install-dir")!), "pgsql", "bin");
  if (flag(a, "pg-bin")) c.pg_bin = resolve(flag(a, "pg-bin")!);
  if (flag(a, "tls") === "false") c.tls.enabled = false;
  const changed = ensureSecrets(c);
  for (const d of Object.values(c.dirs)) mkdirSync(d, { recursive: true });
  saveServerConfig(file, c);
  say(JSON.stringify({ ok: true, config: file, created: !existing, secrets_generated: changed, public_url: c.public_url, data: c.dirs.data, https_port: c.listen.https_port, pg_port: c.db.port }, null, 2));
}

async function cmdDbInit(a: Args) {
  const c = load(a);
  if (existsSync(join(c.dirs.pg_data, "PG_VERSION"))) {
    say(`پایگاه دادهٔ موجود در ${c.dirs.pg_data} نگه داشته شد (نصب دوباره یا ارتقا)`);
    return;
  }
  const r = await initCluster({ bin: pgBinOf(c), dataDir: c.dirs.pg_data, superuser: c.db.admin_user, password: c.db.admin_password, icuLocale: flag(a, "icu-locale") ?? "fa-IR" });
  const t = writePgConfig(c.dirs.pg_data, tuneInputFor(c, thisMachine((flag(a, "disk") as DiskKind) ?? "ssd")), { port: c.db.port });
  say(`پایگاه داده ساخته شد: ${c.dirs.pg_data} (ترتیب‌بندی ${r.collation})`);
  for (const n of t.notes) say(`  ! ${n}`);
}

async function cmdPgConf(a: Args) {
  const c = load(a);
  const disk = (flag(a, "disk") as DiskKind) ?? "ssd";
  if (!["ssd", "hdd", "san"].includes(disk)) throw new UsageError("--disk باید ssd، hdd یا san باشد");
  const t = writePgConfig(c.dirs.pg_data, tuneInputFor(c, thisMachine(disk)), { port: c.db.port });
  say(`kariz-tuning.conf نوشته شد (shared_buffers=${t.settings.shared_buffers}, max_connections=${t.settings.max_connections}, work_mem=${t.settings.work_mem}); برای اعمال، سرویس ${EDITION.services.db.name} را دوباره راه‌اندازی کنید`);
  for (const n of t.notes) say(`  ! ${n}`);
}

async function cmdDbBootstrap(a: Args) {
  const c = load(a);
  await waitForDb(c, Number(flag(a, "timeout") ?? 180) * 1000, true);
  const r = await bootstrapDatabase(c);
  say(JSON.stringify(r, null, 2));
}

async function cmdMigrate(a: Args) {
  const c = load(a);
  await waitForDb(c, Number(flag(a, "timeout") ?? 180) * 1000);
  await withDb(c, async (db) => {
    const ran = await migrate(db, (m) => say(`  ${m}`));
    const st = await migrationStatus(db);
    say(`ساختار پایگاه داده به‌روز است (${ran.length} مرحلهٔ تازه؛ آخرین: ${st.current})`);
  });
}

async function cmdWaitReady(a: Args) {
  const c = load(a);
  const until = Date.now() + Number(flag(a, "timeout") ?? 300) * 1000;
  let last = "";
  while (Date.now() < until) {
    const r = await probe(c, "/api/ready");
    if (r.status === 200) {
      say(`آماده است: ${c.public_url}`);
      return;
    }
    if (r.body !== last) say(`  در انتظار… (${r.status || "بدون پاسخ"}) ${r.body.slice(0, 200)}`);
    last = r.body;
    await new Promise((r2) => setTimeout(r2, 2000));
  }
  throw new Error(`سرور در زمان تعیین‌شده آماده نشد: ${last.slice(0, 300)}`);
}

async function cmdStatus(a: Args) {
  const c = load(a);
  if (isWindows) for (const s of [EDITION.services.db.name, EDITION.services.app.name]) say(`${s}: ${scState(s) ?? "نصب نشده"}`);
  const ready = await probe(c, "/api/ready");
  say(`آمادگی: ${ready.status === 200 ? "آماده" : `آماده نیست (${ready.status || "بدون پاسخ"})`} — ${c.public_url}`);
  const health = await probe(c, "/api/health");
  if (health.status === 200) say(`نسخه: ${JSON.parse(health.body).version}`);
  const last = lastBackup(c);
  say(last ? `آخرین پشتیبان: ${last.at} ${last.ok ? (last.verified ? "(بررسی‌شده)" : "") : `ناموفق: ${last.error}`}` : "هنوز پشتیبانی گرفته نشده است");
  try {
    const creds = loadCredentials(c);
    say(`گواهی: ${creds.info.subject} — ${creds.info.self_signed ? "خودامضا" : `${creds.info.days_left} روز تا انقضا`}`);
  } catch (e) {
    say(`گواهی: خوانده نشد (${(e as Error).message})`);
  }
  say(`شبکهٔ بسته: ${c.network.air_gapped ? `روشن (${c.network.allow.length} میزبان مجاز)` : "خاموش"}`);
}

async function cmdBackup(a: Args) {
  const c = load(a);
  const label = (flag(a, "label") as "manual" | "pre-upgrade" | undefined) ?? "manual";
  const r = await backupNow({ config: c, label, log: { info: (m, d) => say(`  ${m} ${d ? JSON.stringify(d) : ""}`), warn: (m) => warn(m), error: (m, d) => warn(`${m} ${d ? JSON.stringify(d) : ""}`) } });
  say(`پشتیبان گرفته شد: ${r.folder} (${Math.round(r.dump.size / 1024)} KB، ${r.blobs.files} فایل پیوست${r.verified ? "، بررسی‌شده" : ""})`);
  if (c.backup.verify && !r.verified) throw new Error(`بررسی پشتیبان ناموفق بود: ${r.verify_detail}`);
}

async function cmdBackups(a: Args) {
  const c = load(a);
  const list = listBackups(backupRoot(c));
  if (!list.length) say("پشتیبانی نیست");
  for (const b of list) say(`${b.name}\t${b.at}\t${Math.round(b.size / 1024)} KB\t${b.verified ? "بررسی‌شده" : b.verified === false ? "بررسی‌نشده" : ""}`);
}

async function cmdRestore(a: Args) {
  const c = load(a);
  const from = a.positional[0];
  if (!from) throw new UsageError("پوشهٔ پشتیبان را بدهید: karizctl restore <پوشه>");
  if (!a.flags.yes) throw new UsageError("بازگردانی دادهٔ کنونی را جایگزین می‌کند (پایگاه دادهٔ کنونی با نام دیگری نگه داشته می‌شود). برای ادامه --yes را بیفزایید");
  const log = { info: (m: string, d?: unknown) => say(`  ${m} ${d ? JSON.stringify(d) : ""}`), warn: (m: string) => warn(m), error: (m: string, d?: unknown) => warn(`${m} ${d ? JSON.stringify(d) : ""}`) };
  if (!a.flags["no-safety-backup"]) {
    say("پشتیبان ایمنی پیش از بازگردانی…");
    await backupNow({ config: c, label: "pre-restore", log });
  }
  const app = EDITION.services.app.name;
  if (isWindows) {
    say(`توقف ${app}…`);
    await service("stop", app);
  }
  try {
    const r = await restoreBackup({ config: c, from: resolve(from), log });
    say(`بازگردانی شد. پایگاه دادهٔ پیشین: ${r.previous ?? "—"} (پس از اطمینان، با psql حذفش کنید)؛ ${r.blobs_copied} فایل پیوست بازگشت`);
  } finally {
    if (isWindows) {
      say(`راه‌اندازی ${app}…`);
      await service("start", app);
    }
  }
}

async function cmdResetPassword(a: Args) {
  const c = load(a);
  const email = a.positional[0]?.trim().toLowerCase();
  if (!email) throw new UsageError("ایمیل حساب را بدهید: karizctl reset-password <ایمیل>");
  const pw = flag(a, "password") ?? readableCode(3, 4);
  await withDb(c, async (db) => {
    const u = await db.one<{ id: string; disabled: boolean }>(`select id, disabled from sm_users where lower(email) = $1`, [email]);
    if (!u) throw new Error(`حسابی با ایمیل ${email} نیست`);
    const hash = await hashPassword(pw);
    await db.tx(async (tx) => {
      await tx.query(`update sm_users set password_hash = $2 where id = $1`, [u.id, hash]);
      await tx.query(`update sm_sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, [u.id]);
    });
    await securityEvent(db, { kind: "password_reset", user_id: u.id, email, data: { scope: "server", by: "karizctl", host: hostname() } }).catch(() => undefined);
    say(`رمز موقت ${email}: ${pw}`);
    say("همهٔ نشست‌های این حساب بسته شد؛ پس از ورود، رمز را از «حساب من» عوض کنید.");
    if (u.disabled) warn("این حساب غیرفعال است؛ از «مدیریت سامانه ← کاربران» فعالش کنید");
  });
}

async function cmdRotateCert(a: Args) {
  const file = configFile(a);
  const c = load(a);
  const pfx = flag(a, "pfx");
  const certF = flag(a, "cert");
  const keyF = flag(a, "key");
  if (!pfx && !(certF && keyF)) throw new UsageError("--pfx <فایل> --password <رمز> یا --cert <crt> --key <key> بدهید");
  const creds = inspectCredentials(pfx ? { pfx: readFileSync(pfx), passphrase: flag(a, "password") ?? "" } : { cert: readFileSync(certF!, "utf8"), key: readFileSync(keyF!, "utf8") });
  mkdirSync(c.dirs.tls, { recursive: true });
  patchServerConfig(file, (x) => {
    if (pfx) {
      const dest = join(x.dirs.tls, "server.pfx");
      copyFileSync(pfx, dest);
      x.tls = { ...x.tls, pfx: dest, passphrase: flag(a, "password") ?? "", cert: null, key: null };
    } else {
      const cd = join(x.dirs.tls, "server.crt");
      const kd = join(x.dirs.tls, "server.key");
      copyFileSync(certF!, cd);
      copyFileSync(keyF!, kd);
      x.tls = { ...x.tls, pfx: null, passphrase: null, cert: cd, key: kd };
    }
  });
  say(`گواهی نصب شد: ${creds.info.subject} — تا ${creds.info.valid_to.slice(0, 10)} (${creds.info.names.join(", ")})`);
  if (!a.flags["no-restart"]) {
    writeFileSync(join(c.dirs.data, RESTART_REQUEST), new Date().toISOString());
    say("فرایندهای سرور یکی‌یکی با گواهی تازه راه‌اندازی می‌شوند (بدون قطعی)");
  }
}

async function cmdAllow(a: Args) {
  const file = configFile(a);
  const [sub, host] = a.positional;
  const c = load(a);
  if (!sub || sub === "list") {
    say(c.network.air_gapped ? "شبکهٔ بسته: روشن" : "شبکهٔ بسته: خاموش (همهٔ نشانی‌ها مجازند)");
    for (const h of c.network.allow) say(`  ${h}`);
    return;
  }
  if (!host) throw new UsageError("میزبان را بدهید: karizctl allow add ollama.bank.local");
  const problem = allowEntryProblem(host);
  if (problem) throw new UsageError(`«${host}»: ${problem}`);
  patchServerConfig(file, (x) => {
    const h = host.toLowerCase();
    x.network.allow = sub === "remove" ? x.network.allow.filter((e) => e !== h) : [...new Set([...x.network.allow, h])];
  });
  writeFileSync(join(c.dirs.data, RELOAD_REQUEST), new Date().toISOString());
  say(sub === "remove" ? `«${host}» از فهرست مجاز برداشته شد` : `«${host}» به فهرست مجاز افزوده شد`);
}

function tail(file: string, max: number): string | null {
  try {
    const st = statSync(file);
    const buf = readFileSync(file);
    return buf.subarray(Math.max(0, st.size - max)).toString("utf8");
  } catch {
    return null;
  }
}

async function cmdDiagnostics(a: Args) {
  const c = load(a);
  const entries: ZipEntry[] = [];
  const add = (name: string, data: unknown) => entries.push({ name, data: typeof data === "string" ? data : JSON.stringify(data, null, 2) });
  add("config.json", redacted(c));
  add("versions.json", { app: APP_NAME, version: APP_VERSION, node: process.version, os: `${process.platform} ${release()}`, host: hostname(), cpus: cpus().length, ram_mb: Math.round(totalmem() / 1048576), at: new Date().toISOString() });
  add("ready.json", await probe(c, "/api/ready"));
  add("backups.json", { last: lastBackup(c), list: listBackups(backupRoot(c)).slice(0, 30) });
  try {
    add("certificate.json", loadCredentials(c).info);
  } catch (e) {
    add("certificate.json", { error: (e as Error).message });
  }
  try {
    await withDb(c, async (db) => {
      add("migrations.json", await migrationStatus(db));
      add("pg_settings.json", await db.query(`select name, setting, unit, source from pg_settings where source not in ('default', 'override') order by name`));
      add("pg_activity.json", await db.query(`select state, wait_event_type, count(*)::int as n from pg_stat_activity group by 1, 2 order by 3 desc`));
      add("jobs.json", await db.query(`select status, kind, count(*)::int as n from sm_jobs group by 1, 2 order by 3 desc limit 100`));
    });
  } catch (e) {
    add("database.json", { error: String((e as Error).message ?? e) });
  }
  if (isWindows) add("services.txt", [EDITION.services.db.name, EDITION.services.app.name].map((s) => `${s}: ${scState(s) ?? "not installed"}`).join("\r\n"));
  // logs: the application's (already without secrets), the service wrappers', PostgreSQL's (no statement values)
  for (const dir of [c.dirs.logs, join(c.dirs.logs, "service"), join(c.dirs.pg_data, "log")]) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir)
      .filter((f) => /\.(log|err|out|wrapper\.log)$/i.test(f))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((x, y) => y.t - x.t)
      .slice(0, 6);
    for (const { f } of files) {
      const text = tail(join(dir, f), 2 * 1024 * 1024);
      if (text !== null) entries.push({ name: `logs/${dir === c.dirs.logs ? "" : dir.endsWith("service") ? "service/" : "postgresql/"}${f}`, data: text.replace(/(password|passphrase|secret|token)(["'=:\s]+)[^\s",']+/gi, "$1$2(hidden)") });
    }
  }
  const out = resolve(flag(a, "out") ?? join(c.dirs.data, `diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`));
  writeFileSync(out, zip(entries));
  say(`بستهٔ عیب‌یابی (بدون رمز و کلید): ${out}`);
}

async function cmdSetupToken(a: Args) {
  const file = configFile(a);
  const c = load(a);
  if (!a.flags.force) {
    const hasUsers = await withDb(c, async (db) => ((await db.one<{ n: number }>(`select count(*)::int as n from sm_users`).catch(() => null))?.n ?? 0) > 0).catch(() => false);
    if (hasUsers) throw new UsageError("راه‌اندازی نخست پیش‌تر انجام شده است (حساب‌ها ساخته شده‌اند); برای ورود از «karizctl reset-password» استفاده کنید");
  }
  const t = issueSetupToken(file);
  say(`نشانی راه‌اندازی نخست (یک‌بارمصرف، تا ${t.expires_at.slice(0, 10)}):`);
  say(t.url);
}

async function cmdPurge(a: Args) {
  const c = load(a);
  if (!a.flags.yes) throw new UsageError("همهٔ داده‌ها (پایگاه داده، پیوست‌ها، پشتیبان‌های داخل پوشهٔ داده، گزارش‌ها) پاک می‌شود. برای ادامه --yes را بیفزایید");
  if (isWindows) for (const s of [EDITION.services.app.name, EDITION.services.db.name]) if (scState(s)) await service("stop", s).catch(() => undefined);
  rmSync(c.dirs.data, { recursive: true, force: true });
  say(`پوشهٔ داده پاک شد: ${c.dirs.data}`);
}

const HELP = `karizctl — ${EDITION.product} (${APP_NAME} ${APP_VERSION})
  status                         services, readiness, last backup, certificate
  start | stop | restart         the ${EDITION.services.app.name} and ${EDITION.services.db.name} services (restart --rolling: no downtime)
  backup                         back up now (pg_dump + attachment files, verified)
  backups                        list backups
  restore <folder> --yes         restore a backup (a safety backup is taken first)
  reset-password <email>         temporary password for an account (sessions are closed)
  rotate-cert --pfx <f> --password <p> | --cert <crt> --key <key>
  allow list | add <host> | remove <host>     air-gap allowlist (hosts, *.suffix, IP, CIDR)
  diagnostics [--out <zip>]      diagnostics bundle without secrets
  setup-token                    a new one-time first-run setup URL
  version
  installer steps: init, db-init, pg-conf [--disk ssd|hdd|san], db-bootstrap, migrate, pg-start, pg-stop, wait-ready, purge --yes
  every command: --config <kariz.json>`;

export async function main(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  try {
    switch (a.cmd) {
      case "init":
        await cmdInit(a);
        break;
      case "db-init":
        await cmdDbInit(a);
        break;
      case "pg-conf":
        await cmdPgConf(a);
        break;
      case "db-bootstrap":
        await cmdDbBootstrap(a);
        break;
      case "migrate":
        await cmdMigrate(a);
        break;
      case "pg-start": {
        const c = load(a);
        // the log file sits in the data folder: the database server account can write there
        await pgCtl(pgBinOf(c), c.dirs.pg_data, "start", join(c.dirs.pg_data, "pg_ctl.log"));
        say("PostgreSQL started");
        break;
      }
      case "pg-stop": {
        const c = load(a);
        await pgCtl(pgBinOf(c), c.dirs.pg_data, "stop");
        say("PostgreSQL stopped");
        break;
      }
      case "wait-ready":
        await cmdWaitReady(a);
        break;
      case "status":
        await cmdStatus(a);
        break;
      case "start":
        await service("start", EDITION.services.db.name);
        await service("start", EDITION.services.app.name);
        say("سرویس‌ها روشن شدند");
        break;
      case "stop":
        await service("stop", EDITION.services.app.name);
        await service("stop", EDITION.services.db.name);
        say("سرویس‌ها خاموش شدند");
        break;
      case "restart":
        if (a.flags.rolling) {
          const c = load(a);
          writeFileSync(join(c.dirs.data, RESTART_REQUEST), new Date().toISOString());
          say("فرایندهای سرور یکی‌یکی دوباره راه‌اندازی می‌شوند");
        } else {
          await service("stop", EDITION.services.app.name);
          await service("start", EDITION.services.app.name);
          say("سرویس برنامه دوباره راه‌اندازی شد");
        }
        break;
      case "backup":
        await cmdBackup(a);
        break;
      case "backups":
        await cmdBackups(a);
        break;
      case "restore":
        await cmdRestore(a);
        break;
      case "reset-password":
        await cmdResetPassword(a);
        break;
      case "rotate-cert":
        await cmdRotateCert(a);
        break;
      case "allow":
        await cmdAllow(a);
        break;
      case "diagnostics":
        await cmdDiagnostics(a);
        break;
      case "setup-token":
        await cmdSetupToken(a);
        break;
      case "purge":
        await cmdPurge(a);
        break;
      case "version":
        say(`${APP_NAME} ${APP_VERSION} (${EDITION.product})`);
        break;
      case "help":
      case "--help":
      case "-h":
        say(HELP);
        break;
      default:
        warn(`فرمان ناشناخته: ${a.cmd}\n`);
        say(HELP);
        return 2;
    }
    return 0;
  } catch (e) {
    warn(`خطا: ${(e as Error).message}`);
    return e instanceof UsageError ? 2 : 1;
  }
}

/** Run when this module is the program (the bundled karizctl.cjs), not when a test imports it. */
export function runCli() {
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}
