// The feed kind's drop folder (design A §6.6) on the server edition: `<data dir>/discovery/drop/<connector id>/`, where
// a bank's scheduled export writes its CSV or JSON files. The path is the server's, never a person's: the server
// edition installs the root at start-up and a connector's folder is named by its id.
//
// · Names `^[\w.-]{1,120}\.(csv|json)$` (the extension in either case), at most 50 MB a file. A file with a .csv or
//   .json name that breaks a rule — a symbolic link, not a regular file, a second hard link (a file reaching outside
//   the folder), a wrong name, too large — is refused: moved to failed/ with a .txt reason. Other names stay where
//   they are (an export's temporary file).
// · A file changed in the last 30 s is still being written: it waits for the next pass (on Windows a file its writer
//   still holds cannot be moved either, and waits too).
// · A pass claims its file into working/ — a rename, so the export can write the next file under the same name —
//   reads it there and moves it to processed/ once read (kept 7 days), or to failed/ with a .txt reason (kept 30
//   days). Names there carry the claim time (`20261114T103000123Z-atm.csv`).
// · working/, processed/ and failed/ are Kariz's own and live outside the folder the export writes, in
//   `<data dir>/discovery/kept/<connector id>/`: an export account that may write its folder cannot swap one of them
//   for a link to elsewhere, where the housekeeping would delete. The housekeeping removes only names Kariz gave.
// · A file Kariz cannot claim (another program holds it, or the service account may not move it) waits, and the pass
//   says why.
// · A preview and «آزمودن اتصال» read without moving anything.
// Node built-ins only; no database.
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { ConnectorError } from "./kind";

export const DROP_NAME = /^[\w.-]{1,120}\.(csv|json)$/i;
/** A name the folder rules judge (other names are left alone). */
const FEED_LIKE = /\.(csv|json)$/i;
/** A claimed file's name: the claim time, then the file's own name. */
const CLAIMED = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-([\w.-]{1,120}\.(?:csv|json))$/i;
/** A name Kariz gives in processed/ or failed/: the claim time, a .csv or .json name (a refused one's may be any), a reason's .txt. */
const KEPT = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-[^/\\]+\.(?:csv|json)(?:\.txt)?$/i;
export const DROP_MAX_BYTES = 50 * 1024 * 1024;
/** A file changed more recently than this is still being written. */
export const SETTLE_MS = 30_000;
export const PROCESSED_KEEP_DAYS = 7;
export const FAILED_KEEP_DAYS = 30;
const DAY = 86_400_000;
const SUBDIRS = ["working", "processed", "failed"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A rename refused: another program holds the file (Windows), or the service account may not move it. */
const HELD = new Set(["EBUSY", "EAGAIN"]);
const DENIED = new Set(["EPERM", "EACCES"]);

/** What the folder rules answer (what happened + what to do). */
export const DROP_MESSAGES = {
  noRoot: "پوشهٔ ورودی روی این سرور آماده نیست؛ سرویس کاریز را دوباره راه‌اندازی کنید",
  broken: (dir: string) => `پوشهٔ ${dir} پوشهٔ معمولی درون پوشهٔ دادهٔ کاریز نیست؛ آن را بردارید تا کاریز دوباره بسازدش`,
  badName: "نام فایل باید فقط حرف و رقم لاتین، خط تیره، زیرخط و نقطه داشته باشد، حداکثر ۱۲۰ نویسه، و به ‎.csv یا ‎.json ختم شود",
  tooLarge: "فایل بزرگ‌تر از ۵۰ مگابایت است؛ آن را در چند فایل کوچک‌تر بدهید",
  symlink: "پیوند نمادین پذیرفته نیست؛ خود فایل را در پوشه بگذارید",
  notAFile: "این مورد فایل معمولی نیست؛ خود فایل را در پوشه بگذارید",
  hardLink: "فایلی که پیوند دیگری بیرون از پوشه دارد پذیرفته نیست؛ رونوشت خود فایل را در پوشه بگذارید",
} as const;

let root: string | null = null;

/** The server edition's drop root (`<data dir>/discovery/drop`), installed at start-up; null elsewhere. */
export function installDropRoot(dir: string | null): void {
  root = dir ? resolve(dir) : null;
}

export function dropRoot(): string | null {
  return root;
}

const inside = (parent: string, child: string) => {
  const r = relative(parent, child);
  return r !== "" && !r.startsWith("..") && !isAbsolute(r);
};
const code = (e: unknown) => (e as NodeJS.ErrnoException)?.code ?? "";

/** A connector's drop folder: where the export writes (`dir`), and where Kariz keeps working/, processed/, failed/ (`kept`). */
export interface DropFolder {
  dir: string;
  kept: string;
}

/** `<base>/<id>`, made when missing: its real path; one that is a link, or not under `base`, is refused. */
async function ownDir(base: string, id: string): Promise<string> {
  const dir = join(/*turbopackIgnore: true*/ base, id);
  await mkdir(dir, { recursive: true });
  const st = await lstat(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new ConnectorError("refused", DROP_MESSAGES.broken(dir));
  const real = await realpath(dir);
  if (!inside(await realpath(base), real)) throw new ConnectorError("refused", DROP_MESSAGES.broken(dir));
  return real;
}

/**
 * The connector's folder and Kariz's own beside the drop root (`kept/<id>/` with working/, processed/ and failed/),
 * made when missing: their real paths. A folder that is a link, or not under its root, is refused.
 */
export async function ensureDropFolder(connectorId: string): Promise<DropFolder> {
  if (!root || !UUID.test(connectorId)) throw new ConnectorError("config", DROP_MESSAGES.noRoot);
  const id = connectorId.toLowerCase();
  const dir = await ownDir(root, id);
  const kept = await ownDir(join(/*turbopackIgnore: true*/ dirname(root), "kept"), id);
  for (const sub of SUBDIRS) {
    const path = join(/*turbopackIgnore: true*/ kept, sub);
    await mkdir(path).catch((e) => {
      if (code(e) !== "EEXIST") throw e;
    });
    const s = await lstat(path);
    if (s.isSymbolicLink() || !s.isDirectory()) throw new ConnectorError("refused", DROP_MESSAGES.broken(path));
  }
  return { dir, kept };
}

export interface DropFile {
  name: string;
  size: number;
  mtimeMs: number;
  /** already claimed by an earlier pass that did not finish (in working/) */
  working?: boolean;
}

export interface Refusal {
  name: string;
  reason: string;
}

export interface DropScan {
  /** files a pass may read, oldest first */
  ready: DropFile[];
  refused: Refusal[];
  /** files still being written */
  settling: string[];
}

/** Oldest first: the file's change time, then its name. */
export const byAge = (a: DropFile, b: DropFile) => a.mtimeMs - b.mtimeMs || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** The folder's files as the rules judge them (nothing is moved). */
export async function scanDrop(dir: string, now = Date.now()): Promise<DropScan> {
  const out: DropScan = { ready: [], refused: [], settling: [] };
  for (const name of await readdir(dir)) {
    if (!FEED_LIKE.test(name)) continue;
    const st = await lstat(join(/*turbopackIgnore: true*/ dir, name)).catch(() => null);
    if (!st || st.isDirectory()) continue;
    if (st.isSymbolicLink()) out.refused.push({ name, reason: DROP_MESSAGES.symlink });
    else if (!st.isFile()) out.refused.push({ name, reason: DROP_MESSAGES.notAFile });
    else if (!DROP_NAME.test(name)) out.refused.push({ name, reason: DROP_MESSAGES.badName });
    else if (st.nlink > 1) out.refused.push({ name, reason: DROP_MESSAGES.hardLink });
    else if (st.size > DROP_MAX_BYTES) out.refused.push({ name, reason: DROP_MESSAGES.tooLarge });
    else if (now - st.mtimeMs < SETTLE_MS) out.settling.push(name);
    else out.ready.push({ name, size: st.size, mtimeMs: st.mtimeMs });
  }
  out.ready.sort(byAge);
  return out;
}

/** Files an earlier pass claimed and did not finish (working/), oldest first. */
export async function workingFiles(d: DropFolder): Promise<DropFile[]> {
  const out: DropFile[] = [];
  for (const name of await readdir(join(/*turbopackIgnore: true*/ d.kept, "working"))) {
    if (!CLAIMED.test(name)) continue;
    const st = await lstat(join(/*turbopackIgnore: true*/ d.kept, "working", name)).catch(() => null);
    if (st?.isFile()) out.push({ name, size: st.size, mtimeMs: st.mtimeMs, working: true });
  }
  return out.sort(byAge);
}

/** The file's own name (a claimed name without its claim time). */
export const ownName = (name: string) => CLAIMED.exec(name)?.[8] ?? name;

/** Is this a claimed name (the only names a pass's cursor may carry)? */
export const isClaimedName = (name: unknown): name is string => typeof name === "string" && CLAIMED.test(name);

const stamp = (at: number) => new Date(at).toISOString().replace(/[-:.]/g, "");

/** `<claim time>-<name>`, free in Kariz's `sub`. */
async function freeName(d: DropFolder, sub: string, name: string, now: number): Promise<string> {
  for (let i = 0; ; i++) {
    const candidate = `${stamp(now + i)}-${name}`;
    const taken = await lstat(join(/*turbopackIgnore: true*/ d.kept, sub, candidate)).then(() => true, () => false);
    if (!taken) return candidate;
  }
}

/** The reason beside a failed file (`<name>.txt`), never through an existing path. */
async function note(path: string, reason: string): Promise<void> {
  await writeFile(`${path}.txt`, `${reason}\n${new Date().toISOString()}\n`, { flag: "wx" }).catch(() => undefined);
}

/** A refused file of the folder goes to failed/ with its reason (a link is moved, never followed). */
export async function refuseDrop(d: DropFolder, r: Refusal, now = Date.now()): Promise<void> {
  const target = join(/*turbopackIgnore: true*/ d.kept, "failed", await freeName(d, "failed", r.name, now));
  try {
    await rename(join(/*turbopackIgnore: true*/ d.dir, r.name), target);
  } catch {
    return;
  }
  await note(target, r.reason);
}

/** Why a file of the folder could not be claimed: another program holds it, or the service account may not move it. */
export interface ClaimRefused {
  refused: "busy" | "denied";
}

/** Claim a file of the folder into working/ for a pass: its claimed name, why it waits, or null when it is gone. */
export async function claimDrop(d: DropFolder, f: DropFile, now = Date.now()): Promise<string | ClaimRefused | null> {
  const st = await lstat(join(/*turbopackIgnore: true*/ d.dir, f.name)).catch(() => null);
  if (!st?.isFile() || st.nlink > 1 || st.size > DROP_MAX_BYTES) return null;
  const name = await freeName(d, "working", f.name, now);
  try {
    await rename(join(/*turbopackIgnore: true*/ d.dir, f.name), join(/*turbopackIgnore: true*/ d.kept, "working", name));
  } catch (e) {
    if (code(e) === "ENOENT") return null;
    if (HELD.has(code(e))) return { refused: "busy" };
    if (DENIED.has(code(e))) return { refused: "denied" };
    throw e;
  }
  return name;
}

/** Read a file of the folder: a regular file with one link, at most 50 MB, never through a link (null: not there). */
export async function readDrop(path: string): Promise<Buffer | null> {
  const st = await lstat(path).catch(() => null);
  if (!st) return null;
  if (st.isSymbolicLink()) throw new ConnectorError("refused", DROP_MESSAGES.symlink);
  if (!st.isFile()) throw new ConnectorError("refused", DROP_MESSAGES.notAFile);
  if (st.nlink > 1) throw new ConnectorError("refused", DROP_MESSAGES.hardLink);
  if (st.size > DROP_MAX_BYTES) throw new ConnectorError("refused", DROP_MESSAGES.tooLarge);
  const fh = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch((e) => {
    if (code(e) === "ENOENT") return null;
    if (code(e) === "ELOOP") throw new ConnectorError("refused", DROP_MESSAGES.symlink);
    throw e;
  });
  if (!fh) return null;
  try {
    const fst = await fh.stat();
    // the path changed between the look and the open (a file swapped for a link): refused
    if (!fst.isFile() || fst.ino !== st.ino || fst.dev !== st.dev) throw new ConnectorError("refused", DROP_MESSAGES.symlink);
    const buf = Buffer.alloc(Math.min(fst.size, DROP_MAX_BYTES) + 1);
    let size = 0;
    for (;;) {
      const { bytesRead } = await fh.read(buf, size, buf.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
      if (size >= buf.length) break;
    }
    if (size > DROP_MAX_BYTES) throw new ConnectorError("refused", DROP_MESSAGES.tooLarge);
    return buf.subarray(0, Math.min(size, fst.size));
  } finally {
    await fh.close();
  }
}

/** A claimed file's bytes: in working/, or in processed/ when a pass died after moving it; null when in neither. */
export async function readClaimed(d: DropFolder, name: string): Promise<Buffer | null> {
  if (!isClaimedName(name)) return null;
  for (const sub of ["working", "processed"] as const) {
    const bytes = await readDrop(join(/*turbopackIgnore: true*/ d.kept, sub, name));
    if (bytes) return bytes;
  }
  return null;
}

/** A file read to its end goes to processed/ (already there: nothing to do). */
export async function finishClaimed(d: DropFolder, name: string): Promise<void> {
  if (!isClaimedName(name)) return;
  await rename(join(/*turbopackIgnore: true*/ d.kept, "working", name), join(/*turbopackIgnore: true*/ d.kept, "processed", name)).catch((e) => {
    if (code(e) !== "ENOENT") throw e;
  });
}

/** A file of the folder another one superseded goes to processed/ without being read (a snapshot reads the newest). */
export async function supersedeDrop(d: DropFolder, f: DropFile, now = Date.now()): Promise<void> {
  if (f.working) return finishClaimed(d, f.name);
  const name = await freeName(d, "processed", f.name, now);
  await rename(join(/*turbopackIgnore: true*/ d.dir, f.name), join(/*turbopackIgnore: true*/ d.kept, "processed", name)).catch(() => undefined);
}

/** A claimed file that could not be read goes to failed/ with a .txt reason. */
export async function failClaimed(d: DropFolder, name: string, reason: string): Promise<void> {
  if (!isClaimedName(name)) return;
  for (const sub of ["working", "processed"] as const) {
    try {
      await rename(join(/*turbopackIgnore: true*/ d.kept, sub, name), join(/*turbopackIgnore: true*/ d.kept, "failed", name));
    } catch (e) {
      if (code(e) === "ENOENT") continue;
      throw e;
    }
    await note(join(/*turbopackIgnore: true*/ d.kept, "failed", name), reason);
    return;
  }
}

/**
 * Remove processed files older than 7 days and failed ones (with their reasons) older than 30, by their claim time;
 * how many went. Only names Kariz gave, only in its own folders (never through a link): anything else is left alone.
 */
export async function sweepDrop(d: DropFolder, now = Date.now()): Promise<number> {
  let removed = 0;
  for (const [sub, days] of [["processed", PROCESSED_KEEP_DAYS], ["failed", FAILED_KEEP_DAYS]] as const) {
    const folder = join(/*turbopackIgnore: true*/ d.kept, sub);
    if (!(await lstat(folder).catch(() => null))?.isDirectory()) continue;
    for (const name of await readdir(folder).catch(() => [] as string[])) {
      const m = KEPT.exec(name);
      if (!m || now - Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) <= days * DAY) continue;
      const path = join(/*turbopackIgnore: true*/ folder, name);
      const st = await lstat(path).catch(() => null);
      if (!st || st.isDirectory()) continue;
      await rm(path, { force: true }).catch(() => undefined);
      removed++;
    }
  }
  return removed;
}
