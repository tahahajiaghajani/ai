// Desktop capabilities exposed to the shared API through ServerConfig.desktop.
import type { Db } from "@server/db";
import type { DesktopBridge, Logger } from "@server/context";
import type { LocalConfig } from "./config";
import { SyncClient } from "./sync-client";
import { BackupError, backupDir, backupNow, backupSpaceNeeded, listBackups, pruneBackups, scheduleRestore } from "./backup";
import { createHeavyLock } from "./heavy";
import { createUpkeep, type Upkeep } from "./upkeep";
import { maintSummary, scheduleCompaction } from "./maintenance";
import { APP_VERSION } from "@shared/constants";
import { hashPassword } from "@server/auth/password";
import { networkInterfaces, hostname } from "node:os";
import type { PgliteDb } from "@server/db/pglite";

export interface Bridge extends DesktopBridge {
  start(url: string): void;
  /** stops the timers, aborts a backup under way and waits for it and for the upkeep's statement under way */
  stop(): Promise<void>;
  sync: SyncClient;
  /**
   * How long no person's request has been in flight (ms; 0 while one is): the window's, or a signed-in browser's of the
   * office network (src/desktop/server.ts). The idle upkeep runs only after a while of it (./upkeep.ts).
   */
  watchPeople(quietMs: () => number): void;
}

/** An automatic backup cut short (too much written during its copy) is tried again this much later. */
export const BACKUP_RETRY_MS = 15 * 60_000;

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  }
  return out;
}

/**
 * Sign-in on this computer through the linked cloud (an account whose password is not kept here): the cloud checks
 * the password; a refusal after a proven password (a disabled account, demo sign-in) comes back with its reason.
 */
export async function cloudLoginVia(sync: SyncClient, db: Pick<Db, "query">, email: string, password: string): Promise<{ ok: boolean; user_id?: string; unreachable?: boolean; limited?: boolean; refused?: string }> {
  const r = await sync.verifyCloudPassword(email, password);
  if (r.status === "refused") return { ok: false, refused: r.message };
  if (r.status !== "ok") return { ok: false, unreachable: r.status === "unreachable", limited: r.status === "limited" };
  // remember the password of this cloud account here, so that the next sign-in works offline
  // (the next change of the account in the cloud replaces or drops it again)
  await db.query(`update sm_users set password_hash = $2 where id = $1 and lower(email) = lower($3)`, [r.user_id, await hashPassword(password), email]);
  return { ok: true, user_id: r.user_id };
}

export function createBridge(o: { dataDir: string; db: Db & Partial<Pick<PgliteDb, "pg" | "checkpoint" | "wal">>; config: LocalConfig; log: Logger; save: () => void; memory?: boolean }): Bridge {
  const sync = new SyncClient({ db: o.db, config: o.config, save: o.save, log: o.log });
  let backupTimer: NodeJS.Timeout | null = null;
  let firstBackup: NodeJS.Timeout | null = null;
  let retryBackup: NodeJS.Timeout | null = null;
  let localUrl = "";
  let stopped = false;
  // a backup and the idle upkeep's statements take turns (./heavy.ts)
  const lock = createHeavyLock();
  let people: () => number = () => 0;
  let upkeep: Upkeep | null = null;
  /** the backup under way (stop() aborts it and waits for it) */
  let backupCtl: AbortController | null = null;
  let backupRun: Promise<unknown> | null = null;

  const doBackup = (label = "auto") => {
    if (!o.db.pg || !o.db.checkpoint) return Promise.reject(new BackupError("failed", "پشتیبان‌گیری فقط برای پایگاه داده‌ی محلی ممکن است", "backup failed: no local database"));
    const run = lock.run("backup", async () => {
      if (stopped) throw new BackupError("aborted", "پشتیبان‌گیری متوقف شد، چون برنامه در حال بسته شدن است.", "backup aborted: the app is closing");
      const ctl = new AbortController();
      backupCtl = ctl;
      try {
        const dir = backupDir(o.dataDir, o.config.backups.dir);
        const r = await backupNow(o.db as Pick<PgliteDb, "pg" | "checkpoint" | "wal">, dir, label, { signal: ctl.signal, log: o.log, minFreeBytes: backupSpaceNeeded(dir) });
        pruneBackups(dir, o.config.backups.keep);
        await o.db.query(`insert into sm_kv (key, value) values ('backup.last', $1::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify({ at: new Date().toISOString(), file: r.file, size: r.size })]);
        return r;
      } finally {
        if (backupCtl === ctl) backupCtl = null;
      }
    });
    backupRun = run.catch(() => {});
    return run;
  };
  /** an automatic backup: failures go to app.log; one cut short is tried again in BACKUP_RETRY_MS */
  const autoBackup = () =>
    void doBackup("auto").catch((e) => {
      if (stopped) return;
      if (e instanceof BackupError && e.reason === "cut_short") {
        o.log.warn(`${e.logged}; retried in ${Math.round(BACKUP_RETRY_MS / 60_000)} minutes`);
        if (retryBackup) clearTimeout(retryBackup);
        retryBackup = setTimeout(autoBackup, BACKUP_RETRY_MS);
        retryBackup.unref?.();
        return;
      }
      o.log.warn("backup failed", e instanceof BackupError ? e.logged : String((e as Error)?.message ?? e));
    });

  const bridge: Bridge = {
    sync,
    start(url: string) {
      localUrl = url;
      sync.start();
      if (o.config.backups.auto) {
        const every = Math.max(1, o.config.backups.every_hours) * 3600000;
        backupTimer = setInterval(autoBackup, every);
        // a backup shortly after every start
        firstBackup = setTimeout(autoBackup, 120000);
      }
      // VACUUM and ANALYZE while nobody uses the app (PGlite has no autovacuum): ./upkeep.ts
      upkeep = createUpkeep({ db: o.db, log: o.log, quietMs: () => people(), lock, dataDir: o.dataDir, memory: o.memory });
      upkeep.start();
    },
    watchPeople(quietMs: () => number) {
      people = quietMs;
    },
    async stop() {
      stopped = true;
      if (backupTimer) clearInterval(backupTimer);
      if (firstBackup) clearTimeout(firstBackup);
      if (retryBackup) clearTimeout(retryBackup);
      // before the database closes: a backup under way ends its backup mode and lets the log's checkpoints run again
      backupCtl?.abort();
      await upkeep?.stop();
      await backupRun;
      await sync.stop();
    },
    async info() {
      const last = await o.db.one<{ value: unknown }>(`select value from sm_kv where key = 'backup.last'`).catch(() => null);
      return {
        version: APP_VERSION,
        data_dir: o.dataDir,
        device_id: o.config.device_id,
        computer: hostname(),
        local_url: localUrl,
        lan: { ...o.config.lan, addresses: lanAddresses() },
        cloud: { linked: sync.state.linked, url: o.config.cloud.url, org_id: o.config.cloud.org_id, email: o.config.cloud.email, linked_at: o.config.cloud.linked_at, auto_sync: o.config.cloud.auto_sync, edition: o.config.cloud.edition ?? null },
        sync: sync.state,
        backups: { dir: backupDir(o.dataDir, o.config.backups.dir), auto: o.config.backups.auto, keep: o.config.backups.keep, last: last?.value ?? null },
        database: o.db.kind === "pglite" && o.db.wal ? await maintSummary(o.db, o.dataDir).catch(() => null) : null,
      };
    },
    async scheduleCompaction() {
      scheduleCompaction(o.dataDir);
    },
    async backupNow() {
      const r = await doBackup("manual");
      return { file: r.file };
    },
    async listBackups() {
      return listBackups(backupDir(o.dataDir, o.config.backups.dir)).map((b) => ({ file: b.file, size: b.size, at: b.at }));
    },
    async restoreBackup(file: string) {
      await doBackup("before-restore").catch(() => {});
      scheduleRestore(o.dataDir, file);
    },
    async getSettings() {
      return { lan: o.config.lan, backups: o.config.backups, cloud: { url: o.config.cloud.url, auto_sync: o.config.cloud.auto_sync } };
    },
    async setSettings(patch: Record<string, unknown>) {
      const p = patch as Partial<LocalConfig> & { cloud?: Partial<LocalConfig["cloud"]> };
      if (p.lan) o.config.lan = { ...o.config.lan, ...p.lan };
      if (p.backups) o.config.backups = { ...o.config.backups, ...p.backups };
      if (p.cloud) o.config.cloud = { ...o.config.cloud, ...(p.cloud.auto_sync !== undefined ? { auto_sync: !!p.cloud.auto_sync } : {}) };
      o.save();
      return bridge.getSettings();
    },
    async syncStatus() {
      await sync.refreshPending().catch(() => {});
      return sync.state as unknown as Record<string, unknown>;
    },
    async syncNow() {
      return (await sync.syncNow()) as unknown as Record<string, unknown>;
    },
    async link(input) {
      return sync.link(input);
    },
    async unlink() {
      await sync.unlink();
    },
    async cloudOrgs(input) {
      return sync.cloudOrgs(input.url, input.email, input.password);
    },
    cloudLogin(email: string, password: string) {
      return cloudLoginVia(sync, o.db, email, password);
    },
    notifyLocalWrite() {
      sync.nudge();
    },
    fetchBlob(orgId: string, attachmentId: string) {
      return sync.fetchBlob(orgId, attachmentId);
    },
  };
  return bridge;
}
