// Desktop capabilities exposed to the shared API through ServerConfig.desktop.
import type { Db } from "@server/db";
import type { DesktopBridge, Logger } from "@server/context";
import type { LocalConfig } from "./config";
import { SyncClient } from "./sync-client";
import { backupDir, backupNow, listBackups, pruneBackups, scheduleRestore } from "./backup";
import { APP_VERSION } from "@shared/constants";
import { hashPassword } from "@server/auth/password";
import { networkInterfaces, hostname } from "node:os";
import type { PGlite } from "@electric-sql/pglite";

export interface Bridge extends DesktopBridge {
  start(url: string): void;
  stop(): Promise<void>;
  sync: SyncClient;
}

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  }
  return out;
}

export function createBridge(o: { dataDir: string; db: Db & { pg?: PGlite }; config: LocalConfig; log: Logger; save: () => void }): Bridge {
  const sync = new SyncClient({ db: o.db, config: o.config, save: o.save, log: o.log });
  let backupTimer: NodeJS.Timeout | null = null;
  let firstBackup: NodeJS.Timeout | null = null;
  let localUrl = "";

  const doBackup = async (label = "auto") => {
    if (!o.db.pg) throw new Error("پشتیبان‌گیری فقط برای پایگاه داده‌ی محلی ممکن است");
    const dir = backupDir(o.dataDir, o.config.backups.dir);
    const r = await backupNow(o.db.pg, dir, label);
    pruneBackups(dir, o.config.backups.keep);
    await o.db.query(`insert into sm_kv (key, value) values ('backup.last', $1::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify({ at: new Date().toISOString(), file: r.file, size: r.size })]);
    return r;
  };

  const bridge: Bridge = {
    sync,
    start(url: string) {
      localUrl = url;
      sync.start();
      if (o.config.backups.auto) {
        const every = Math.max(1, o.config.backups.every_hours) * 3600000;
        backupTimer = setInterval(() => void doBackup("auto").catch((e) => o.log.warn("backup failed", String(e))), every);
        // a backup shortly after every start
        firstBackup = setTimeout(() => void doBackup("auto").catch((e) => o.log.warn("backup failed", String(e))), 120000);
      }
    },
    async stop() {
      if (backupTimer) clearInterval(backupTimer);
      if (firstBackup) clearTimeout(firstBackup);
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
        cloud: { linked: sync.state.linked, url: o.config.cloud.url, org_id: o.config.cloud.org_id, email: o.config.cloud.email, linked_at: o.config.cloud.linked_at, auto_sync: o.config.cloud.auto_sync },
        sync: sync.state,
        backups: { dir: backupDir(o.dataDir, o.config.backups.dir), auto: o.config.backups.auto, keep: o.config.backups.keep, last: last?.value ?? null },
      };
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
    async cloudLogin(email: string, password: string) {
      const r = await sync.verifyCloudPassword(email, password);
      if (r.status !== "ok") return { ok: false, unreachable: r.status === "unreachable", limited: r.status === "limited" };
      // remember the password of this cloud account here, so that the next sign-in works offline
      // (the next change of the account in the cloud replaces or drops it again)
      await o.db.query(`update sm_users set password_hash = $2 where id = $1 and lower(email) = lower($3)`, [r.user_id, await hashPassword(password), email]);
      return { ok: true, user_id: r.user_id };
    },
    notifyLocalWrite() {
      sync.nudge();
    },
  };
  return bridge;
}
