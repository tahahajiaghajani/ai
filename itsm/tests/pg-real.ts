// A real PostgreSQL for the suites that need several connections at once (concurrency, snapshots), gated like
// tests/server-edition-pg.test.ts:
// - ITSM_PG_URL: a server to create a scratch database on (CI's postgres:17 service), dropped afterwards;
// - ITSM_PG_BIN: a PostgreSQL bin folder — a throwaway cluster (initdb, fsync off) in .local-data on ITSM_PG_TEST_PORT
//   (default 55434), stopped and deleted afterwards. As root the server runs as ITSM_PG_RUNAS (default nobody).
// Neither set: the suite is skipped.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import postgres from "postgres";

export interface RealPg {
  url: string;
  stop(): Promise<void>;
}

export const realPgAvailable = (): boolean => !!(process.env.ITSM_PG_URL || process.env.ITSM_PG_BIN);

export async function realPg(name: string): Promise<RealPg> {
  const tag = `${name}_${randomBytes(3).toString("hex")}`;
  const url = process.env.ITSM_PG_URL;
  if (url) {
    const db = `itsm_${tag}`;
    const admin = postgres(url, { max: 1, onnotice: () => {} });
    try {
      await admin.unsafe(`create database ${db}`);
    } finally {
      await admin.end({ timeout: 5 });
    }
    const u = new URL(url);
    u.pathname = `/${db}`;
    return {
      url: u.toString(),
      async stop() {
        const a = postgres(url, { max: 1, onnotice: () => {} });
        try {
          await a.unsafe(`drop database if exists ${db} with (force)`);
        } finally {
          await a.end({ timeout: 5 });
        }
      },
    };
  }
  const bin = process.env.ITSM_PG_BIN;
  if (!bin) throw new Error("ITSM_PG_URL or ITSM_PG_BIN is needed");
  const root = process.getuid?.() === 0;
  const runAs = root ? (process.env.ITSM_PG_RUNAS || "nobody") : null;
  const dir = join(__dirname, "..", ".local-data", `pg-${tag}`);
  mkdirSync(dir, { recursive: true });
  const exec = (cmd: string, args: string[]) =>
    runAs ? execFileSync("runuser", ["-u", runAs, "--", join(bin, cmd), ...args], { stdio: "pipe" }) : execFileSync(join(bin, cmd), args, { stdio: "pipe" });
  if (runAs) execFileSync("chown", ["-R", runAs, dir]);
  const data = join(dir, "data");
  exec("initdb", ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-locale"]);
  const port = Number(process.env.ITSM_PG_TEST_PORT ?? 55434);
  const opts = `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${dir} -c max_connections=80 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c shared_buffers=64MB -c deadlock_timeout=200ms`;
  exec("pg_ctl", ["-D", data, "-o", opts, "-l", join(dir, "server.log"), "-w", "-t", "60", "start"]);
  return {
    url: `postgres://postgres@127.0.0.1:${port}/postgres`,
    async stop() {
      try {
        exec("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
      } catch {
        // already stopped
      }
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    },
  };
}
