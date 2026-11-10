// «سلامت سرور» of the platform owner's console (GET /api/admin/server): the database (size, connections, cache hit
// ratio, slow statements from pg_stat_statements), free disk space of each folder, the job queue, the worker
// processes and the scheduler leader, the last backup, the certificate and the air-gap policy — with a short list of
// checks (ok / warning / danger) in plain Persian. Organisation records are never read here.
import { statfs } from "node:fs/promises";
import type { Db } from "@server/db";
import { APP_VERSION } from "@shared/constants";
import type { ServerEditionConfig } from "./config";
import type { ClusterMetrics } from "./metrics";
import type { CertInfo } from "./tls";
import { backupRoot, lastBackup, listBackups } from "./backup";
import { nextDaily } from "./scheduler";

export type Tone = "ok" | "warning" | "danger" | "neutral";
export interface Check {
  key: string;
  title: string;
  tone: Tone;
  value: string;
  detail?: string;
}

const fa = (n: number) => Math.round(n).toLocaleString("fa-IR");
const gb = (b: number) => `${(b / 1024 ** 3).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} گیگابایت`;

export async function diskOf(path: string): Promise<{ free: number; total: number } | null> {
  try {
    const s = await statfs(path);
    return { free: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) };
  } catch {
    return null;
  }
}

export interface HealthDeps {
  db: Db;
  config: ServerEditionConfig;
  cluster(): Promise<ClusterMetrics>;
  cert(): CertInfo | null;
}

export async function serverHealth(d: HealthDeps) {
  const c = d.config;
  const q = <T>(sql: string, params: unknown[] = []) => d.db.query<T>(sql, params).catch(() => [] as T[]);
  const one = async <T>(sql: string, params: unknown[] = []) => (await q<T>(sql, params))[0] ?? null;

  const [version, size, conns, maxConn, cache, exts, queue, kinds, cluster] = await Promise.all([
    one<{ v: string }>(`select current_setting('server_version') as v`),
    one<{ bytes: string }>(`select pg_database_size(current_database())::text as bytes`),
    q<{ state: string | null; n: number }>(`select state, count(*)::int as n from pg_stat_activity where datname = current_database() group by state`),
    one<{ n: string }>(`select current_setting('max_connections') as n`),
    one<{ hit: number | null; deadlocks: string; temp: string }>(
      `select case when blks_hit + blks_read = 0 then null else round(100.0 * blks_hit / (blks_hit + blks_read), 2)::float end as hit, deadlocks::text, temp_bytes::text as temp from pg_stat_database where datname = current_database()`,
    ),
    q<{ name: string; version: string }>(`select extname as name, extversion as version from pg_extension order by extname`),
    one<{ due: number; later: number; running: number; failed: number; oldest: number | null }>(
      `select count(*) filter (where status = 'queued' and run_at <= now())::int as due,
              count(*) filter (where status = 'queued' and run_at > now())::int as later,
              count(*) filter (where status = 'running')::int as running,
              count(*) filter (where status = 'failed' and done_at > now() - interval '24 hours')::int as failed,
              extract(epoch from now() - min(run_at) filter (where status = 'queued' and run_at <= now()))::float as oldest
       from sm_jobs`,
    ),
    q<{ kind: string; n: number }>(`select kind, count(*)::int as n from sm_jobs where status = 'queued' and run_at <= now() group by kind order by n desc limit 5`),
    d.cluster().catch(() => null),
  ]);

  let slow: { query: string; calls: number; mean_ms: number; total_ms: number; rows: number }[] = [];
  let slowNote: string | null = null;
  try {
    slow = await d.db.query(
      `select left(regexp_replace(query, '\\s+', ' ', 'g'), 400) as query, calls::float as calls, round(mean_exec_time::numeric, 1)::float as mean_ms,
              round(total_exec_time::numeric)::float as total_ms, rows::float as rows
       from pg_stat_statements where dbid = (select oid from pg_database where datname = current_database())
       order by mean_exec_time desc limit 10`,
    );
  } catch (e) {
    slowNote = `pg_stat_statements در دسترس نیست (${String((e as Error).message).slice(0, 120)})`;
  }

  const folders: [string, string][] = [
    ["data", c.dirs.data],
    ["blobs", c.dirs.blobs],
    ["backups", backupRoot(c)],
    ["logs", c.dirs.logs],
  ];
  const disks = await Promise.all(folders.map(async ([key, path]) => ({ key, path, ...(await diskOf(path)) })));
  const last = lastBackup(c);
  const backups = listBackups(backupRoot(c));
  const cert = d.cert();
  const total = conns.reduce((s, r) => s + r.n, 0);
  const max = Number(maxConn?.n ?? 0);
  const workers = cluster?.workers ?? [];
  const leader = workers.find((w) => w.leader) ?? null;
  const refused = workers.flatMap((w) => w.refused.recent).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);

  const checks: Check[] = [];
  const add = (x: Check) => checks.push(x);
  add(workers.length >= (cluster?.expected_workers ?? 1) ? { key: "workers", title: "فرایندهای سرور", tone: "ok", value: `${fa(workers.length)} فرایند فعال` } : { key: "workers", title: "فرایندهای سرور", tone: "danger", value: `${fa(workers.length)} از ${fa(cluster?.expected_workers ?? 0)}`, detail: "فرایندی از کار افتاده و در حال راه‌اندازی دوباره است؛ گزارش logs را ببینید" });
  add(leader ? { key: "scheduler", title: "زمان‌بند کارهای پس‌زمینه", tone: "ok", value: `فرایند ${fa(leader.worker)}` } : { key: "scheduler", title: "زمان‌بند کارهای پس‌زمینه", tone: "warning", value: "هنوز انتخاب نشده", detail: "تا چند ثانیه پس از راه‌اندازی یکی از فرایندها زمان‌بند می‌شود" });
  const lag = Math.max(0, ...workers.map((w) => w.loop_lag_ms.p99));
  if (workers.length) add({ key: "lag", title: "تأخیر پردازش", tone: lag > 500 ? "danger" : lag > 150 ? "warning" : "ok", value: `${fa(lag)} میلی‌ثانیه (صدک ۹۹)` });
  if (max) add({ key: "connections", title: "اتصال‌های پایگاه داده", tone: total / max > 0.85 ? "danger" : total / max > 0.7 ? "warning" : "ok", value: `${fa(total)} از ${fa(max)}` });
  if (cache?.hit !== null && cache?.hit !== undefined) add({ key: "cache", title: "نرخ برخورد حافظهٔ نهان", tone: cache.hit < 90 ? "warning" : "ok", value: `${cache.hit.toLocaleString("fa-IR")}٪`, detail: cache.hit < 90 ? "حافظهٔ پایگاه داده کم است؛ shared_buffers یا RAM سرور را افزایش دهید" : undefined });
  for (const dk of disks) {
    if (!dk.total) continue;
    const share = dk.free! / dk.total;
    add({ key: `disk_${dk.key}`, title: `فضای دیسک (${dk.key === "data" ? "داده" : dk.key === "blobs" ? "پیوست‌ها" : dk.key === "backups" ? "پشتیبان‌ها" : "گزارش‌ها"})`, tone: share < 0.1 ? "danger" : share < 0.2 ? "warning" : "ok", value: `${gb(dk.free!)} آزاد از ${gb(dk.total)}` });
  }
  const ageH = last ? (Date.now() - Date.parse(last.at)) / 3600_000 : null;
  if (!c.backup.enabled) add({ key: "backup", title: "پشتیبان‌گیری", tone: "warning", value: "خاموش", detail: "پشتیبان‌گیری خودکار در kariz.json خاموش است" });
  else if (!last) add({ key: "backup", title: "آخرین پشتیبان", tone: "warning", value: "هنوز گرفته نشده", detail: `نخستین پشتیبان خودکار ساعت ${c.backup.time} گرفته می‌شود؛ یا «karizctl backup» را اجرا کنید` });
  else if (!last.ok) add({ key: "backup", title: "آخرین پشتیبان", tone: "danger", value: "ناموفق", detail: last.error ?? undefined });
  else add({ key: "backup", title: "آخرین پشتیبان", tone: ageH! > 36 ? "danger" : !last.verified && c.backup.verify ? "warning" : "ok", value: `${fa(ageH!)} ساعت پیش${last.verified ? "، بررسی‌شده" : ""}` });
  if (cert) {
    add({
      key: "certificate",
      title: "گواهی HTTPS",
      tone: cert.self_signed ? "warning" : cert.days_left < 14 ? "danger" : cert.days_left < 30 ? "warning" : "ok",
      value: cert.self_signed ? "خودامضا (موقت)" : `${fa(cert.days_left)} روز تا انقضا`,
      detail: cert.self_signed ? "گواهی صادرشده از CA بانک را با «karizctl rotate-cert» یا راه‌اندازی نخست نصب کنید" : undefined,
    });
  }
  add(queue && queue.failed > 0 ? { key: "jobs", title: "کارهای پس‌زمینه", tone: "warning", value: `${fa(queue.failed)} کار ناموفق در ۲۴ ساعت`, detail: "«کارها و پشتیبان‌ها» را ببینید" } : { key: "jobs", title: "کارهای پس‌زمینه", tone: (queue?.oldest ?? 0) > 300 ? "warning" : "ok", value: `${fa(queue?.due ?? 0)} کار در صف` });
  add(c.network.air_gapped ? { key: "network", title: "شبکهٔ بسته", tone: "ok", value: `روشن؛ ${fa(c.network.allow.length)} میزبان مجاز` } : { key: "network", title: "شبکهٔ بسته", tone: "warning", value: "خاموش", detail: "سرور می‌تواند به هر نشانی وصل شود؛ در شبکهٔ بانک network.air_gapped را روشن کنید" });

  return {
    ok: checks.every((x) => x.tone === "ok" || x.tone === "neutral"),
    checked_at: new Date().toISOString(),
    checks,
    versions: { app: APP_VERSION, node: process.version, postgres: version?.v ?? null },
    db: {
      bytes: Number(size?.bytes ?? 0),
      connections: { total, max, by_state: Object.fromEntries(conns.map((r) => [r.state ?? "unknown", r.n])) },
      cache_hit_ratio: cache?.hit ?? null,
      deadlocks: Number(cache?.deadlocks ?? 0),
      temp_bytes: Number(cache?.temp ?? 0),
      extensions: exts,
      slow_statements: slow,
      slow_note: slowNote,
    },
    disks,
    queue: { due: queue?.due ?? 0, scheduled: queue?.later ?? 0, running: queue?.running ?? 0, failed_24h: queue?.failed ?? 0, oldest_due_s: queue?.oldest ?? null, top_kinds: kinds },
    workers,
    expected_workers: cluster?.expected_workers ?? null,
    restarts: cluster?.restarts ?? 0,
    backup: { enabled: c.backup.enabled, dir: backupRoot(c), time: c.backup.time, keep: c.backup.keep, next: c.backup.enabled ? nextDaily(c.backup.time).toISOString() : null, last, count: backups.length, recent: backups.slice(0, 5) },
    certificate: cert,
    network: { air_gapped: c.network.air_gapped, allow: c.network.allow, refused },
    public_url: c.public_url,
  };
}

export type ServerHealth = Awaited<ReturnType<typeof serverHealth>>;
