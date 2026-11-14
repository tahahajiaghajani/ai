// The «فایل CSV یا JSON» kind (design A §6.6): a tool's export, CSV or JSON, read whole and handed to the runner page
// by page — from a host-pinned URL (both editions; net.ts: at most 20 MB, the connector's key in its header) or from
// the server edition's drop folder (drop.ts: names, size, links, working/processed/failed). The 1.1 path for ATM
// sources: a row's `terminal_id` and `status.device_status` reach the ATM device path like any record's.
//
// · A snapshot (the default) is the complete picture: its pass is complete, and the runner marks what it no longer
//   lists «دیگر گزارش نمی‌شود» (the mass-drop guard still holds a sudden drop). A delta file only adds and changes:
//   its pass is never complete. A snapshot pass reads one file of the drop folder — the newest waiting, the older ones
//   superseded unread; a delta pass reads the waiting files oldest first, up to 20, those written before it began.
// · A file is parsed once per process and paged from memory (the cursor holds its digest and the next row); a pass
//   resumed in another process reads it again, and a URL whose content changed meanwhile makes the pass incomplete
//   rather than mixing two pictures.
// · One bad row is one rejected record; a file that cannot be read (not JSON, no array at the path, no id) fails a
//   snapshot pass with the reason — a drop-folder file goes to failed/ with it — and a delta pass skips it with a
//   warning.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { csvObjects } from "@shared/cmdb/logic";
import { feed as descriptor, FEED_DELIMITERS, FEED_ENCODINGS, FEED_FORMATS, FEED_MODES, FEED_SOURCES } from "@shared/discovery/kinds/feed";
import { checkMapping, sourceValue, targetField } from "@shared/discovery/mapping";
import { API_KEY_HEADERS, ITEM_KIND_VALUES, type Cursor, type DiscoveredRecord, type ItemKind, type Page, type TestResult } from "@shared/discovery/types";
import { faDigits } from "@shared/format";
import { ConnectorError, CONNECTOR_MESSAGES, type ConnCtx, type ConnectorKind } from "../kind";
import {
  byAge, claimDrop, ensureDropFolder, failClaimed, finishClaimed, isClaimedName, ownName, readClaimed, readDrop, refuseDrop, scanDrop, supersedeDrop,
  sweepDrop, workingFiles, type DropFile, type DropScan,
} from "../drop";
import { restAuth } from "./rest";

/** Files a delta pass reads at most. */
export const MAX_FEED_FILES = 20;

/** What the kind answers (what happened + what to do). */
export const FEED_MESSAGES = {
  folderServerOnly: "پوشهٔ ورودی فقط در نسخهٔ سرور است؛ در نسخهٔ وب نشانی HTTPS فایل را بدهید",
  noFile: (dir: string) => `در پوشهٔ ورودی ${dir} فایلی برای خواندن نیست؛ برون‌بری ابزار را روی همین پوشه تنظیم کنید`,
  settling: (n: number) => `${faDigits(n)} فایل هنوز در حال نوشتن است و در گذر بعدی خوانده می‌شود`,
  badJson: "فایل JSON معتبر نیست؛ برون‌بری ابزار را بررسی کنید",
  notArray: (path: string) => `در مسیر «${path || "ریشه"}» فایل آرایه‌ای نیست؛ «مسیر آرایه در JSON» را اصلاح کنید`,
  noId: "شناسهٔ مورد (external_id) در ردیف‌های فایل پیدا نشد؛ «ستون‌ها» را اصلاح کنید",
  empty: "فایل ردیفی ندارد",
  fileFailed: (name: string, why: string) => `فایل «${name}» خوانده نشد: ${why}`,
  refused: (name: string, why: string) => `فایل «${name}» پذیرفته نشد: ${why}`,
  vanished: (name: string) => `فایل «${name}» در میانهٔ خواندن از پوشه برداشته شد؛ این گذر تصویر کامل نیست`,
  urlTooLarge: "فایل بزرگ‌تر از ۲۰ مگابایت است؛ آن را در چند فایل کوچک‌تر بدهید یا پوشهٔ ورودی سرور را به کار ببرید",
  summary: (format: string, rows: number) => `فایل ${format.toUpperCase()} با ${faDigits(rows)} ردیف`,
} as const;

const columns = z
  .record(z.string(), z.string().trim().min(1).max(300))
  .default({})
  .superRefine((m, ctx) => {
    for (const p of checkMapping(m)) ctx.addIssue({ code: "custom", path: p.key ? [p.key] : [], message: p.message });
  });

export const feedOptions = z.object({
  source: z.enum(FEED_SOURCES).default("url"),
  path: z.string().trim().max(500).default(""),
  format: z.enum(FEED_FORMATS).default("auto"),
  delimiter: z.enum(FEED_DELIMITERS).default("auto"),
  encoding: z.enum(FEED_ENCODINGS).default("utf-8"),
  items_path: z.string().trim().max(200).default(""),
  columns,
  item_kind: z.enum(ITEM_KIND_VALUES as [ItemKind, ...ItemKind[]]).default("device"),
  mode: z.enum(FEED_MODES).default("snapshot"),
  page_size: z.coerce.number().int().min(1).max(1000).default(500),
  listing_is_contact: z.boolean().default(false),
});
export type FeedOptions = z.infer<typeof feedOptions>;

// ---------------------------------------------------------------------------------------------------------------
// Files → rows → records (pure)

type Format = "csv" | "json";
interface Entry {
  rows: unknown[];
  format: Format;
  /** the content's digest */
  sha: string;
}

/** A file the kind cannot read: its Persian reason. */
class FeedError extends Error {}

/** The text of a file: UTF-16 by its byte-order mark, else UTF-8 (a mark dropped) or the options' Windows-1256. */
export function decodeFeed(bytes: Uint8Array, encoding: FeedOptions["encoding"] = "utf-8"): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  return new TextDecoder(encoding).decode(bytes);
}

function formatOf(o: FeedOptions, text: string, hint: { name?: string; contentType?: string }): Format {
  if (o.format !== "auto") return o.format;
  if (/\.json$/i.test(hint.name ?? "")) return "json";
  if (/\.csv$/i.test(hint.name ?? "")) return "csv";
  if (/json/i.test(hint.contentType ?? "")) return "json";
  if (/csv/i.test(hint.contentType ?? "")) return "csv";
  return /^\s*[[{]/.test(text.slice(0, 1000)) ? "json" : "csv";
}

/** A file's rows: CSV rows as objects keyed by the header row, or the elements of the JSON array at `items_path`. */
export function parseFeed(text: string, o: FeedOptions, hint: { name?: string; contentType?: string } = {}): { rows: unknown[]; format: Format } {
  const format = formatOf(o, text, hint);
  if (format === "json") {
    let doc: unknown;
    try {
      doc = JSON.parse(text.replace(/^﻿/, ""));
    } catch {
      throw new FeedError(FEED_MESSAGES.badJson);
    }
    const rows = o.items_path ? sourceValue(doc, o.items_path) : doc;
    if (!Array.isArray(rows)) throw new FeedError(FEED_MESSAGES.notArray(o.items_path));
    return { rows, format };
  }
  const delimiter = o.delimiter === "auto" ? undefined : o.delimiter === "tab" ? "\t" : o.delimiter;
  return { rows: csvObjects(text, delimiter), format };
}

const TRUE = /^(true|yes|y|on|1|بله|آری|درست)$/i;
const FALSE = /^(false|no|n|off|0|خیر|نه|نادرست)$/i;
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** A cell's text as the field wants it: lists split, words in lower case, yes and no as booleans. */
function coerce(field: string, v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (!s) return undefined;
  if (field === "ips" || field === "macs") return s.split(/[\s,;|]+/).filter(Boolean);
  if (field === "kind" || field === "status.state") return s.toLowerCase();
  if (field === "status.availability") return TRUE.test(s) ? true : FALSE.test(s) ? false : undefined;
  return s;
}

function put(out: Record<string, unknown>, field: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  const dot = field.indexOf(".");
  if (dot < 0) {
    out[field] = value;
    return;
  }
  const head = field.slice(0, dot);
  const inner = (out[head] && typeof out[head] === "object" ? out[head] : (out[head] = {})) as Record<string, unknown>;
  inner[field.slice(dot + 1)] = value;
}

/** A CSV row's cell by its column's name: exactly, else ignoring case and the spaces at its ends. */
function cell(row: Record<string, unknown>, column: string): unknown {
  const name = column.trim().replace(/^\$\./, "");
  if (own(row, name)) return row[name];
  const lower = name.toLowerCase();
  for (const k of Object.keys(row)) if (k.trim().toLowerCase() === lower) return row[k];
  return undefined;
}

/**
 * The raw record of one row (the runner normalises it like any record): the column map's fields, or without one the
 * CSV columns named after a record field and a JSON element as it is; the kind of item from the options when the row
 * has none.
 */
export function feedRecord(row: unknown, o: Pick<FeedOptions, "columns" | "item_kind">, format: Format): unknown {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  const r = row as Record<string, unknown>;
  let out: Record<string, unknown>;
  const map = Object.entries(o.columns ?? {});
  if (map.length) {
    out = {};
    for (const [target, source] of map) {
      const field = targetField(target);
      if (field) put(out, field, coerce(field, format === "csv" ? cell(r, source) : sourceValue(r, source)));
    }
  } else if (format === "csv") {
    out = {};
    for (const [column, v] of Object.entries(r)) {
      const field = targetField(column.trim().toLowerCase());
      if (field) put(out, field, coerce(field, v));
    }
  } else out = { ...r };
  out.kind = typeof out.kind === "string" && out.kind.trim() ? out.kind.trim().toLowerCase() : o.item_kind;
  return out;
}

const hasId = (rec: unknown) => !!rec && typeof rec === "object" && String((rec as Record<string, unknown>).external_id ?? "").trim() !== "";

/** A file read into rows; a file whose first rows carry no id is refused as a whole (the column map is wrong). */
function entryOf(text: string, o: FeedOptions, hint: { name?: string; contentType?: string }): Entry {
  const parsed = parseFeed(text, o, hint);
  const sample = parsed.rows.slice(0, 50);
  if (sample.length && !sample.some((r) => hasId(feedRecord(r, o, parsed.format)))) throw new FeedError(FEED_MESSAGES.noId);
  return { ...parsed, sha: createHash("sha256").update(text).digest("hex").slice(0, 32) };
}

// ---------------------------------------------------------------------------------------------------------------
// Parsed files of this process (a pass pages through one from memory)

const cache = new Map<string, Entry>();
const CACHE_MAX = 4;

function remember(key: string, entry: Entry): void {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

/** Forget every parsed file (tests: a pass resumed in another process). */
export function forgetFeedFiles(): void {
  cache.clear();
}

const keyOf = (c: ConnCtx, o: FeedOptions, what: string) => [c.connector.id, what, o.format, o.delimiter, o.encoding, o.items_path].join("|");

// ---------------------------------------------------------------------------------------------------------------
// Pages

interface FeedCursor {
  /** the drop-folder file the pass reads (its claimed name) */
  file?: string;
  /** the digest of the content being paged */
  sha?: string;
  /** the next row */
  at: number;
  /** a drop-folder pass: when it began (files written later wait for the next pass) */
  t0?: number;
  /** files the pass took */
  n: number;
  /** the content changed or went away under the pass: not the whole picture */
  partial?: boolean;
}

function cursorOf(c: Cursor | null): FeedCursor | null {
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const x = c as Record<string, Cursor>;
  const t0 = Number(x.t0);
  return {
    ...(isClaimedName(x.file) ? { file: x.file } : {}),
    ...(typeof x.sha === "string" ? { sha: x.sha } : {}),
    at: Math.max(0, Math.floor(Number(x.at) || 0)),
    ...(x.t0 !== undefined && x.t0 !== null && Number.isFinite(t0) ? { t0 } : {}),
    n: Math.max(0, Math.floor(Number(x.n) || 0)),
    ...(x.partial === true ? { partial: true } : {}),
  };
}

const toCursor = (c: Partial<FeedCursor>): Cursor => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined && v !== false)) as Cursor;

function slice(entry: Entry, o: FeedOptions, at: number): { records: DiscoveredRecord[]; raw: unknown[]; end: number } {
  const raw = entry.rows.slice(at, at + o.page_size);
  return { records: raw.map((r) => feedRecord(r, o, entry.format)) as unknown as DiscoveredRecord[], raw, end: at + raw.length };
}

/** The file at the connector's address (or its `path` under it), with the connector's key in its header. */
async function fetchFeed(c: ConnCtx, o: FeedOptions): Promise<{ text: string; hint: { name: string; contentType?: string } }> {
  try {
    const res = await c.fetchText(o.path || c.connector.base_url || "", { headers: restAuth(c) });
    return { text: res.body, hint: { name: new URL(res.url).pathname, contentType: res.headers["content-type"] } };
  } catch (e) {
    if (e instanceof ConnectorError && e.message === CONNECTOR_MESSAGES.tooLarge) throw new ConnectorError("bad_response", FEED_MESSAGES.urlTooLarge);
    throw e;
  }
}

function readable(text: string, o: FeedOptions, hint: { name?: string; contentType?: string }): Entry {
  try {
    return entryOf(text, o, hint);
  } catch (e) {
    if (e instanceof FeedError) throw new ConnectorError("bad_response", e.message);
    throw e;
  }
}

async function urlPage(c: ConnCtx, o: FeedOptions, cur: FeedCursor | null): Promise<Page> {
  const key = keyOf(c, o, "url");
  let entry = cur && !c.preview ? cache.get(key) : undefined;
  if (!entry || entry.sha !== cur?.sha) {
    const got = await fetchFeed(c, o);
    entry = readable(got.text, o, got.hint);
    if (!c.preview) remember(key, entry);
  }
  const partial = !!cur && (!!cur.partial || cur.sha !== entry.sha);
  if (partial && !cur?.partial) c.log("the file changed during the pass: this pass is not the whole picture");
  const page = slice(entry, o, cur?.at ?? 0);
  const done = c.preview || page.end >= entry.rows.length;
  if (done) cache.delete(key);
  return {
    records: page.records, raw: page.raw, total: entry.rows.length,
    next: done ? null : toCursor({ sha: entry.sha, at: page.end, partial }),
    complete: o.mode === "snapshot" && !partial,
  };
}

/** The file a pass would read next, nothing moved (a preview, «آزمودن اتصال»). */
async function peek(dir: string, o: FeedOptions): Promise<{ scan: DropScan; file: DropFile | null }> {
  const scan = await scanDrop(dir);
  const working = await workingFiles(dir);
  const file = o.mode === "delta" ? (working[0] ?? scan.ready[0]) : [...working, ...scan.ready].sort(byAge).pop();
  return { scan, file: file ?? null };
}

async function readPeeked(dir: string, o: FeedOptions, f: DropFile): Promise<Entry> {
  const bytes = await readDrop(f.working ? join(dir, "working", f.name) : join(dir, f.name));
  if (!bytes) throw new FeedError(FEED_MESSAGES.vanished(ownName(f.name)));
  return entryOf(decodeFeed(bytes, o.encoding), o, { name: ownName(f.name) });
}

async function folderPreview(o: FeedOptions, dir: string): Promise<Page> {
  const { file } = await peek(dir, o);
  if (!file) throw new ConnectorError("config", FEED_MESSAGES.noFile(dir));
  let entry: Entry;
  try {
    entry = await readPeeked(dir, o, file);
  } catch (e) {
    if (e instanceof FeedError || e instanceof ConnectorError) throw new ConnectorError("bad_response", FEED_MESSAGES.fileFailed(ownName(file.name), e.message));
    throw e;
  }
  const page = slice(entry, o, 0);
  return { records: page.records, raw: page.raw, next: null, complete: false, total: entry.rows.length };
}

/** The file a pass takes next, claimed into working/: a snapshot's newest (the older to supersede), a delta's oldest. */
async function take(dir: string, o: FeedOptions, ready: DropFile[], t0: number): Promise<{ file: string; older: DropFile[] } | null> {
  const working = await workingFiles(dir);
  if (o.mode === "delta") {
    const next = working[0] ?? ready.find((f) => f.mtimeMs <= t0);
    if (!next) return null;
    const file = next.working ? next.name : await claimDrop(dir, next);
    return file ? { file, older: [] } : null;
  }
  const all = [...working, ...ready].sort(byAge);
  const newest = all.pop();
  if (!newest) return null;
  // a newest file its writer still holds (Windows) waits, and so does everything older
  const file = newest.working ? newest.name : await claimDrop(dir, newest);
  return file ? { file, older: all } : null;
}

/** A claimed file parsed (from memory once this process read it): the entry, why it cannot be read, or null when gone. */
async function loadClaimed(c: ConnCtx, o: FeedOptions, dir: string, name: string): Promise<Entry | string | null> {
  const key = keyOf(c, o, name);
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const bytes = await readClaimed(dir, name);
    if (!bytes) return null;
    const entry = entryOf(decodeFeed(bytes, o.encoding), o, { name: ownName(name) });
    remember(key, entry);
    return entry;
  } catch (e) {
    if (e instanceof FeedError || e instanceof ConnectorError) return e.message;
    throw e;
  }
}

async function folderPage(c: ConnCtx, o: FeedOptions, cur: FeedCursor | null): Promise<Page> {
  if (c.edition !== "server") throw new ConnectorError("config", FEED_MESSAGES.folderServerOnly);
  const dir = await ensureDropFolder(c.connector.id);
  if (c.preview) return folderPreview(o, dir);
  const notes: { message: string }[] = [];
  const delta = o.mode === "delta";
  let state: FeedCursor = cur ?? { at: 0, n: 0 };
  let older: DropFile[] = [];
  if (!state.file) {
    const now = Date.now();
    // the pass's first call keeps the folder: old files out, refused ones to failed/ with their reasons
    if (!cur) await sweepDrop(dir, now);
    const scan = await scanDrop(dir, now);
    for (const r of scan.refused) {
      await refuseDrop(dir, r, now);
      notes.push({ message: FEED_MESSAGES.refused(r.name, r.reason) });
    }
    const t0 = state.t0 ?? now;
    const taken = await take(dir, o, scan.ready, t0);
    // nothing (more) to read: the pass lists nothing new and marks nothing gone
    if (!taken) return { records: [], next: null, complete: false, rejected: notes };
    older = taken.older;
    state = { file: taken.file, at: 0, t0, n: state.n + 1 };
  }
  const file = state.file!;
  const afterFile = (): Cursor => (delta && state.n < MAX_FEED_FILES ? toCursor({ t0: state.t0, n: state.n }) : null);
  const loaded = await loadClaimed(c, o, dir, file);
  if (loaded === null) {
    notes.push({ message: FEED_MESSAGES.vanished(ownName(file)) });
    return { records: [], next: afterFile(), complete: false, rejected: notes };
  }
  if (typeof loaded === "string") {
    await failClaimed(dir, file, loaded);
    const message = FEED_MESSAGES.fileFailed(ownName(file), loaded);
    if (!delta) throw new ConnectorError("bad_response", message);
    notes.push({ message });
    return { records: [], next: afterFile(), complete: false, rejected: notes };
  }
  // the newest snapshot reads well: the older ones it supersedes go to processed/ unread
  for (const f of older) await supersedeDrop(dir, f);
  const partial = !!state.partial || (state.sha !== undefined && state.sha !== loaded.sha);
  const page = slice(loaded, o, state.at);
  const complete = !delta && !partial;
  if (page.end < loaded.rows.length) {
    return { records: page.records, raw: page.raw, total: loaded.rows.length, rejected: notes, complete, next: toCursor({ ...state, sha: loaded.sha, at: page.end, partial }) };
  }
  await finishClaimed(dir, file);
  cache.delete(keyOf(c, o, file));
  return { records: page.records, raw: page.raw, total: loaded.rows.length, rejected: notes, complete, next: afterFile() };
}

// ---------------------------------------------------------------------------------------------------------------
// The kind

async function test(c: ConnCtx): Promise<TestResult> {
  const o = c.options as FeedOptions;
  if (o.source === "folder") {
    if (c.edition !== "server") return { ok: false, warnings: [], message: FEED_MESSAGES.folderServerOnly };
    const dir = await ensureDropFolder(c.connector.id);
    const { scan, file } = await peek(dir, o);
    const warnings = scan.refused.slice(0, 5).map((r) => FEED_MESSAGES.refused(r.name, r.reason));
    if (scan.settling.length) warnings.push(FEED_MESSAGES.settling(scan.settling.length));
    if (!file) return { ok: true, identity: dir, warnings: [...warnings, FEED_MESSAGES.noFile(dir)] };
    try {
      const entry = await readPeeked(dir, o, file);
      return { ok: true, identity: dir, warnings: entry.rows.length ? warnings : [...warnings, FEED_MESSAGES.empty] };
    } catch (e) {
      if (e instanceof FeedError || e instanceof ConnectorError) return { ok: false, identity: dir, warnings, message: FEED_MESSAGES.fileFailed(ownName(file.name), e.message) };
      throw e;
    }
  }
  const got = await fetchFeed(c, o);
  try {
    const entry = entryOf(got.text, o, got.hint);
    return { ok: true, identity: FEED_MESSAGES.summary(entry.format, entry.rows.length), warnings: entry.rows.length ? [] : [FEED_MESSAGES.empty] };
  } catch (e) {
    if (e instanceof FeedError) return { ok: false, warnings: [], message: e.message };
    throw e;
  }
}

export const connector: ConnectorKind = {
  ...descriptor,
  headers: [...API_KEY_HEADERS],
  optionsSchema: feedOptions,
  local: (options) => options.source === "folder",
  test,
  pages(c, cursor) {
    const o = c.options as FeedOptions;
    const cur = cursorOf(cursor);
    return o.source === "folder" ? folderPage(c, o, cur) : urlPage(c, o, cur);
  },
};
