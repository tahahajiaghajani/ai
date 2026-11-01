// Local configuration of a Windows installation: kept next to the database in the data folder.
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { uuidv7 } from "@shared/id";

export interface LocalConfig {
  device_id: string;
  secret: string;
  port: number;
  lan: { enabled: boolean; port: number };
  backups: { dir: string | null; auto: boolean; keep: number; every_hours: number };
  cloud: {
    url: string | null;
    token: string | null;
    org_id: string | null;
    email: string | null;
    linked_at: string | null;
    auto_sync: boolean;
    prices_via_cloud: boolean;
  };
  client: { server_url: string | null };
  created_at: string;
}

export function defaultConfig(): LocalConfig {
  return {
    device_id: uuidv7(),
    secret: randomBytes(32).toString("hex"),
    port: 3939,
    lan: { enabled: false, port: 3939 },
    backups: { dir: null, auto: true, keep: 30, every_hours: 6 },
    cloud: { url: null, token: null, org_id: null, email: null, linked_at: null, auto_sync: true, prices_via_cloud: false },
    client: { server_url: null },
    created_at: new Date().toISOString(),
  };
}

export function configPath(dataDir: string) {
  return join(dataDir, "config.json");
}

export function loadConfig(dataDir: string): LocalConfig {
  mkdirSync(dataDir, { recursive: true });
  const p = configPath(dataDir);
  if (existsSync(p)) {
    try {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      const d = defaultConfig();
      return { ...d, ...raw, lan: { ...d.lan, ...raw.lan }, backups: { ...d.backups, ...raw.backups }, cloud: { ...d.cloud, ...raw.cloud }, client: { ...d.client, ...raw.client } };
    } catch {
      // a broken file is kept aside and replaced
      renameSync(p, `${p}.broken-${Date.now()}`);
    }
  }
  const c = defaultConfig();
  saveConfig(dataDir, c);
  return c;
}

export function saveConfig(dataDir: string, c: LocalConfig) {
  const p = configPath(dataDir);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(c, null, 2), "utf8");
  renameSync(tmp, p);
}
