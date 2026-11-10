// Structured logs of the server edition: one JSON object per line in <logs>\kariz-app.log, rotated by size
// (kariz-app.1.log … kariz-app.<keep>.log). Workers send their lines to the supervisor over the cluster channel and the
// supervisor is the only writer, so lines never interleave; warnings and errors are also printed for the service
// wrapper's own log. Nothing secret is ever logged (passwords, keys, tokens, cookies).
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "@server/context";

export type Level = "debug" | "info" | "warn" | "error";
const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogLine {
  t: string;
  level: Level;
  pid: number;
  /** worker number (0 = supervisor) */
  w: number;
  msg: string;
  data?: unknown;
}

const SECRET_KEY = /pass(word)?|secret|token|cookie|authorization|api[_-]?key|private/i;

/** Copy of `data` with secret-looking fields replaced (keys only; values are never inspected). */
export function scrub(data: unknown, depth = 0): unknown {
  if (data === null || data === undefined || depth > 4) return data;
  if (data instanceof Error) return { name: data.name, message: data.message, code: (data as NodeJS.ErrnoException).code };
  if (Array.isArray(data)) return data.slice(0, 50).map((x) => scrub(x, depth + 1));
  if (typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) out[k] = SECRET_KEY.test(k) ? "(hidden)" : scrub(v, depth + 1);
    return out;
  }
  if (typeof data === "string" && data.length > 4000) return `${data.slice(0, 4000)}…`;
  return data;
}

export function formatLine(level: Level, msg: string, data: unknown, worker: number): string {
  const line: LogLine = { t: new Date().toISOString(), level, pid: process.pid, w: worker, msg };
  if (data !== undefined && data !== "") line.data = scrub(data);
  return JSON.stringify(line);
}

/** A size-rotated log file with a single writer. */
export class RotatingFile {
  private fd: number | null = null;
  private size = 0;
  constructor(private dir: string, private name: string, private maxBytes: number, private keep: number) {}

  private path(i = 0) {
    return join(this.dir, i ? this.name.replace(/\.log$/, `.${i}.log`) : this.name);
  }

  private open() {
    mkdirSync(this.dir, { recursive: true });
    this.fd = openSync(this.path(), "a");
    this.size = fstatSync(this.fd).size;
  }

  private rotate() {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
    const last = this.path(this.keep);
    if (existsSync(last)) rmSync(last, { force: true });
    for (let i = this.keep - 1; i >= 1; i--) if (existsSync(this.path(i))) renameSync(this.path(i), this.path(i + 1));
    if (existsSync(this.path())) renameSync(this.path(), this.path(1));
    this.open();
  }

  write(line: string) {
    try {
      if (this.fd === null) this.open();
      const buf = Buffer.from(`${line}\n`, "utf8");
      if (this.size > 0 && this.size + buf.length > this.maxBytes) this.rotate();
      writeSync(this.fd!, buf);
      this.size += buf.length;
    } catch (e) {
      // a full or unreachable log disk must never stop the server
      process.stderr.write(`log write failed: ${(e as Error).message}\n`);
    }
  }

  close() {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
  }
}

export interface ServerLogger extends Logger {
  debug(msg: string, data?: unknown): void;
  /** the level in effect (changed when the configuration is reloaded) */
  setLevel(level: Level): void;
}

/** A logger handing formatted lines to `sink` (the file in the supervisor; the cluster channel in a worker). */
export function createLogger(sink: (line: string, level: Level) => void, opts: { level: Level; worker: number }): ServerLogger {
  let min = RANK[opts.level];
  const emit = (level: Level) => (msg: string, data?: unknown) => {
    if (RANK[level] < min) return;
    sink(formatLine(level, msg, data, opts.worker), level);
  };
  return { debug: emit("debug"), info: emit("info"), warn: emit("warn"), error: emit("error"), setLevel: (l) => (min = RANK[l]) };
}

/** Print warnings and errors for the service wrapper's own log (WinSW keeps it rolling). */
export function echo(line: string, level: Level) {
  if (level === "warn" || level === "error") process.stderr.write(`${line}\n`);
  else if (process.env.ITSM_LOG_STDOUT === "1") process.stdout.write(`${line}\n`);
}
