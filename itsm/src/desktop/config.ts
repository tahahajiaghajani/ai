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
    cloud: { url: null, token: null, org_id: null, email: null, linked_at: null, auto_sync: true },
    client: { server_url: null },
    created_at: new Date().toISOString(),
  };
}

function num(v: unknown, min: number, max: number, fallback: number) {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}
function int(v: unknown, min: number, max: number, fallback: number) {
  const n = num(v, min, max, fallback);
  return Number.isInteger(n) ? n : fallback;
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
      const c: LocalConfig = { ...d, ...raw, lan: { ...d.lan, ...raw.lan }, backups: { ...d.backups, ...raw.backups }, cloud: { ...d.cloud, ...raw.cloud }, client: { ...d.client, ...raw.client } };
      // numbers typed in a text box («4000») or edited by hand must not break the start
      // (a port "abc" would make the server listen on a named pipe; "4000" + 1 is "40001")
      c.port = int(c.port, 1, 65535, d.port);
      c.lan.port = int(c.lan.port, 1, 65535, d.lan.port);
      c.lan.enabled = c.lan.enabled === true;
      c.backups.keep = int(c.backups.keep, 1, 1000, d.backups.keep);
      c.backups.every_hours = num(c.backups.every_hours, 1, 24 * 7, d.backups.every_hours);
      return c;
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
