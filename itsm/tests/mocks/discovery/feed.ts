// A tool's CSV or JSON export for the discovery tests (design A §6.6, §17): served at a URL (an API key in X-API-Key,
// a wrong one → 401; a file it does not have → 404), or written into a drop folder with a change time in the past (a
// fresh one is still being written). Rows of servers named after the record's fields, and of ATMs as a switch exports
// them (its own column names and status words); CSV with RFC 4180 quoting.
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const FEED_HOST = "feed.mock.test";
export const FEED_TOKEN = "feed-secret-token";

export type FeedRow = Record<string, string | number | boolean | null | undefined>;

/** n servers as rows whose columns are named after the record's fields. */
export function serverRows(n: number, opts: { from?: number; prefix?: string } = {}): FeedRow[] {
  const from = opts.from ?? 1;
  return Array.from({ length: n }, (_, i) => {
    const id = from + i;
    return {
      external_id: `S${id}`, name: `${opts.prefix ?? "fsrv"}-${id}`, serial_number: `FS${String(id).padStart(6, "0")}`,
      ip_address: `10.20.${(id >> 8) & 255}.${(id & 255) || 1}`, manufacturer: "HPE", "status.state": "up",
    };
  });
}

/** The switch's terminal-status words. */
export const ATM_STATES = ["IN_SERVICE", "OUT_OF_SERVICE", "CASH_OUT", "COMMS_DOWN"] as const;

/** n ATMs as the switch exports them. */
export function atmRows(n: number, opts: { from?: number; state?: (typeof ATM_STATES)[number] } = {}): FeedRow[] {
  const from = opts.from ?? 1;
  return Array.from({ length: n }, (_, i) => {
    const id = from + i;
    return { TerminalID: `T${String(id).padStart(5, "0")}`, "Serial No": `ATM-SN-${id}`, Branch: `شعبهٔ ${id}`, State: opts.state ?? ATM_STATES[id % ATM_STATES.length], Model: "NCR SelfServ 22" };
  });
}

/** The column map of the switch's export. */
export const ATM_COLUMNS = {
  external_id: "TerminalID", terminal_id: "TerminalID", name: "TerminalID", serial_number: "Serial No", model: "Model", "reported.site": "Branch",
  "status.device_status": "State",
};

export function toCsv(rows: FeedRow[], delimiter = ","): string {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const q = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",;|\t\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map(q).join(delimiter), ...rows.map((r) => cols.map((c) => q(r[c])).join(delimiter))].join("\r\n") + "\r\n";
}

/** A web server with the tool's export files. */
export class FeedMock {
  files: Record<string, { body: string | Uint8Array; type: string }> = {};
  token: string | null = FEED_TOKEN;
  requests: string[] = [];

  put(path: string, body: string | Uint8Array, type = path.endsWith(".json") ? "application/json" : "text/csv; charset=utf-8"): void {
    this.files[path] = { body, type };
  }

  handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    this.requests.push(url.pathname);
    if (this.token && req.headers.get("x-api-key") !== this.token) return new Response("unauthorized", { status: 401 });
    const f = this.files[url.pathname];
    return f ? new Response(typeof f.body === "string" ? f.body : Buffer.from(f.body), { status: 200, headers: { "content-type": f.type } }) : new Response("not found", { status: 404 });
  };
}

/** Write a file into a drop folder, changed `ageMs` ago (a minute by default: settled). */
export async function dropFile(dir: string, name: string, body: string | Uint8Array, ageMs = 60_000): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, body);
  const at = new Date(Date.now() - ageMs);
  await utimes(path, at, at);
  return path;
}
