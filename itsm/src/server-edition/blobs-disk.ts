// The server edition's attachment store: files under the blob folder (local disk or a UNC path such as
// \\files\kariz-blobs), <root>/<org>/<sha[0:2]>/<sha256>. A file is written to <root>/.incoming first, checked against
// its hash, scanned by the configured antivirus command (e.g. Microsoft Defender:
// MpCmdRun.exe -Scan -ScanType 3 -File <path> -DisableRemediation) and only then moved into place; an infected file
// goes to the quarantine folder with a note and the upload is refused. Contents are content-addressed, so a stored
// file never changes and is never scanned twice. Downloads are streamed (never loaded into memory).
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createHash, randomUUID } from "node:crypto";
import type { BlobStore, BlobStream } from "@server/blobs";
import { AppError } from "@server/http/errors";
import type { AntivirusConfig } from "./config";

export interface DiskStoreOptions {
  root: string;
  quarantine: string;
  /** largest content accepted (bytes) */
  maxBytes: number;
  antivirus?: AntivirusConfig | null;
  /** scans, infections, failures — for the log and «سلامت سرور» */
  onEvent?(e: { kind: "scanned" | "infected" | "scan_failed" | "stored"; org: string; sha256: string; size: number; detail?: string }): void;
}

const ORG = /^[0-9a-f-]{36}$/i;
const SHA = /^[0-9a-f]{64}$/;

function check(org: string, sha: string) {
  if (!ORG.test(org) || !SHA.test(sha)) throw new AppError(400, "bad_blob", "شناسهٔ محتوا معتبر نیست");
}

export interface ScanResult {
  verdict: "clean" | "infected" | "error";
  code: number | null;
  output: string;
}

/** Run the antivirus command on a file. */
export function scanFile(av: AntivirusConfig, file: string): Promise<ScanResult> {
  return new Promise((resolve) => {
    if (!av.command) return resolve({ verdict: "clean", code: 0, output: "" });
    const args = av.args.map((a) => a.replace(/\{file\}/g, file));
    let output = "";
    let done = false;
    const finish = (r: ScanResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const child = spawn(av.command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const keep = (b: Buffer) => {
      if (output.length < 4000) output += b.toString("utf8");
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    const timer = setTimeout(() => {
      child.kill();
      finish({ verdict: "error", code: null, output: `${output}\n(timeout after ${av.timeout_s}s)`.trim() });
    }, av.timeout_s * 1000);
    child.on("error", (e) => finish({ verdict: "error", code: null, output: String(e.message) }));
    child.on("close", (code) => {
      if (code === 0) finish({ verdict: "clean", code, output });
      else if (code !== null && av.infected_codes.includes(code)) finish({ verdict: "infected", code, output });
      else finish({ verdict: "error", code, output });
    });
  });
}

export function createDiskBlobStore(o: DiskStoreOptions): BlobStore & { pathOf(org: string, sha: string): string } {
  const incoming = join(o.root, ".incoming");
  const pathOf = (org: string, sha: string) => join(o.root, org.toLowerCase(), sha.slice(0, 2), sha);
  const event = (e: Parameters<NonNullable<DiskStoreOptions["onEvent"]>>[0]) => {
    try {
      o.onEvent?.(e);
    } catch {
      /* a logger must not break an upload */
    }
  };

  async function quarantine(org: string, sha: string, tmp: string, scan: ScanResult, size: number) {
    mkdirSync(o.quarantine, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = join(o.quarantine, `${stamp}-${sha}.bin`);
    await rename(tmp, dest).catch(async () => {
      await rm(tmp, { force: true });
    });
    await writeFile(`${dest}.json`, JSON.stringify({ org, sha256: sha, size, at: new Date().toISOString(), exit_code: scan.code, scanner: scan.output.slice(0, 2000) }, null, 2)).catch(() => undefined);
  }

  async function store(org: string, sha: string, data: Uint8Array): Promise<void> {
    check(org, sha);
    const dest = pathOf(org, sha);
    if (existsSync(dest)) return;
    if (data.byteLength > o.maxBytes) throw new AppError(413, "too_large", "حجم پیوست بیش از حد مجاز این سرور است");
    if (createHash("sha256").update(data).digest("hex") !== sha) throw new AppError(400, "bad_blob", "محتوا با شناسه‌اش جور نیست");
    mkdirSync(incoming, { recursive: true });
    const tmp = join(incoming, `${randomUUID()}.tmp`);
    await writeFile(tmp, data);
    try {
      if (o.antivirus?.command) {
        const scan = await scanFile(o.antivirus, tmp);
        if (scan.verdict === "infected") {
          await quarantine(org, sha, tmp, scan, data.byteLength);
          event({ kind: "infected", org, sha256: sha, size: data.byteLength, detail: scan.output.slice(0, 500) });
          throw new AppError(422, "infected", "ضدویروس این فایل را آلوده تشخیص داد؛ فایل پذیرفته نشد و در قرنطینه نگه داشته شد. با واحد امنیت تماس بگیرید");
        }
        if (scan.verdict === "error") {
          event({ kind: "scan_failed", org, sha256: sha, size: data.byteLength, detail: scan.output.slice(0, 500) });
          if (o.antivirus.on_error !== "allow") throw new AppError(503, "scan_failed", "بررسی ضدویروس انجام نشد؛ فایل پذیرفته نشد. کمی بعد دوباره امتحان کنید یا با مدیر سرور تماس بگیرید");
        } else event({ kind: "scanned", org, sha256: sha, size: data.byteLength });
      }
      mkdirSync(join(o.root, org.toLowerCase(), sha.slice(0, 2)), { recursive: true });
      try {
        await rename(tmp, dest);
      } catch (e) {
        // another worker stored the same content at the same moment (or the target is open for reading)
        if (!existsSync(dest)) throw e;
      }
      event({ kind: "stored", org, sha256: sha, size: data.byteLength });
    } finally {
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  return {
    kind: "disk",
    pathOf,
    // outside the write transaction: written, checked and scanned before the organisation's write lock is taken
    prepare: (org, sha, data) => store(org, sha, data),
    // inside a transaction (server code attaching files, e.g. an e-mail's attachments): the same, usually instant
    put: (_q, org, sha, data) => store(org, sha, data),
    async get(_q, org, sha) {
      check(org, sha);
      try {
        return new Uint8Array(await readFile(pathOf(org, sha)));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async open(org, sha): Promise<BlobStream | null> {
      check(org, sha);
      const p = pathOf(org, sha);
      const st = await stat(p).catch(() => null);
      if (!st?.isFile()) return null;
      return { stream: Readable.toWeb(createReadStream(p)) as unknown as ReadableStream<Uint8Array>, size: st.size };
    },
    async has(_q, org, sha) {
      check(org, sha);
      return existsSync(pathOf(org, sha));
    },
    async missing(_q, org, shas) {
      if (!ORG.test(org)) return shas;
      return shas.filter((s) => !SHA.test(s) || !existsSync(pathOf(org, s)));
    },
  };
}
