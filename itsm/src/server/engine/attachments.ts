// Attachments of records: metadata in sm_attachments (a synchronised root), contents in sm_blobs — deduplicated per
// organisation by sha256, so the same screenshot attached to ten tickets is stored once. Whoever may read a record
// may attach a file to it (a requester adds a screenshot to their ticket); removing needs write access or being the
// uploader. Uploads are limited by the organisation's setting `attachment_max_mb` (default 10 MB; the web
// version's platform also caps request bodies at about 4.5 MB). Names are made safe (no paths, control or
// direction-override characters, no reserved Windows names); the content type is sniffed from the bytes, and only
// raster images are ever served inline (never SVG or HTML).
//
// Adding and removing emit `record.attachment_added` / `record.attachment_removed` (data: attachment_id, name, mime)
// in the same transaction — the AI index re-reads the text of a table with `ai.attachments`.
//
// The Windows app receives attachment metadata through sync and fetches a content the first time it is opened
// (`DesktopBridge.fetchBlob`, an authenticated request to the cloud's content route); contents of attachments
// added offline are uploaded after the push (PUT /o/:org/blobs/:sha256).
import { createHash } from "node:crypto";
import { uuidv7 } from "@shared/id";
import type { TableDef } from "@shared/model/types";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { pgArray } from "../db";
import { blobStore, type BlobStream } from "../blobs";
import { AppError, bad, forbidden, notFound } from "../http/errors";
import { access } from "../access/provider";
import { actorId, condEnv, isSystemCtx } from "./env";
import { defFor } from "./schema";
import { RefSet, resolveDisplay } from "./display";
import { requireReadable, type Row } from "./read";
import { checkSide, filterSide } from "./hooks";
import { emitEvent } from "./events";

export const DEFAULT_ATTACHMENT_MB = 10;
const HARD_MAX_MB = 100;

export interface UploadFile {
  name: string;
  type?: string | null;
  data: Uint8Array;
}

export interface AttachmentView {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  uploaded_by: string | null;
  created_at: string;
  /** a raster image the UI may show inline */
  previewable: boolean;
}

/** Content types the browser may render inline from our origin (raster images only). */
export const PREVIEWABLE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** The organisation's upload limit in bytes. */
export function maxAttachmentBytes(ctx: Ctx): number {
  const mb = Number(ctx.org.settings?.attachment_max_mb);
  const v = Number.isFinite(mb) && mb > 0 ? Math.min(mb, HARD_MAX_MB) : DEFAULT_ATTACHMENT_MB;
  return Math.round(v * 1024 * 1024);
}

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** A file name safe to store and to send back in Content-Disposition. */
export function safeFileName(raw: string | null | undefined): string {
  let s = String(raw ?? "").normalize("NFC");
  s = s.split(/[\\/]/).pop() ?? "";
  s = s.replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069<>:"|?*]/g, "").replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "");
  if (RESERVED.test(s)) s = `_${s}`;
  if (s.length > 180) {
    const dot = s.lastIndexOf(".");
    const ext = dot > 0 && s.length - dot <= 12 ? s.slice(dot) : "";
    s = s.slice(0, 180 - ext.length) + ext;
  }
  return s || "پیوست";
}

const EXT_TYPES: Record<string, string> = {
  txt: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  json: "application/json",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  eml: "message/rfc822",
  msg: "application/vnd.ms-outlook",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
};

const startsWith = (d: Uint8Array, bytes: number[], at = 0) => bytes.every((b, i) => d[at + i] === b);
const ascii = (d: Uint8Array, from: number, len: number) => String.fromCharCode(...d.slice(from, from + len));

/** The content type from the bytes (images, PDF, Office/ZIP), else from a known extension, else octet-stream. */
export function sniffMime(data: Uint8Array, name: string): string {
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(data, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(data, 0, 6) === "GIF87a" || ascii(data, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 4) === "WEBP") return "image/webp";
  if (ascii(data, 0, 5) === "%PDF-") return "application/pdf";
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (startsWith(data, [0x50, 0x4b, 0x03, 0x04])) return ["docx", "xlsx", "pptx"].includes(ext) ? EXT_TYPES[ext] : "application/zip";
  return EXT_TYPES[ext] ?? "application/octet-stream";
}

export const sha256Hex = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/** Content-Disposition with an ASCII fallback and the UTF-8 name (RFC 6266 / RFC 5987). */
export function contentDisposition(name: string, inline = false): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_").trim() || "file";
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function view(r: Row): AttachmentView {
  return {
    id: r.id,
    name: r.name,
    mime: r.mime,
    size: Number(r.size),
    sha256: r.sha256,
    uploaded_by: r.uploaded_by ?? null,
    created_at: r.created_at,
    previewable: PREVIEWABLE.has(r.mime),
  };
}

function needAttachments(def: TableDef) {
  if (!def.features?.attachments) throw bad(`«${def.plural}» پیوست ندارد`);
}

// contents go to the runtime's blob store (src/server/blobs.ts: sm_blobs, or the server edition's disk)
async function storeBlob(cfg: Ctx["cfg"], q: Queryable, orgId: string, sha: string, data: Uint8Array): Promise<void> {
  await blobStore(cfg).put(q, orgId, sha, data);
}

/** Attach a file to a record the caller may read. */
export async function addAttachment(ctx: Ctx, table: string, id: string, file: UploadFile): Promise<AttachmentView> {
  const { def } = await defFor(ctx, table);
  needAttachments(def);
  checkUpload(ctx, file);
  const env = await condEnv(ctx);
  // a store that writes and scans files does it before the write lock is taken
  await blobStore(ctx.cfg).prepare?.(ctx.org.id, sha256Hex(file.data), file.data);
  return ctx.write(async (tx) => {
    const record = await requireReadable(ctx, def, id, env, tx);
    await checkSide({ tx, ctx, def, record, kind: "attachment" });
    return addAttachmentIn(tx, ctx, def, String(record.id), file);
  });
}

function checkUpload(ctx: Ctx, file: UploadFile): void {
  const max = maxAttachmentBytes(ctx);
  if (file.data.byteLength > max) throw new AppError(413, "too_large", `حجم پیوست بیش از ${Math.round(max / 1024 / 1024).toLocaleString("fa-IR")} مگابایت است`);
  if (!file.data.byteLength) throw bad("فایل خالی است");
}

/**
 * Attach a file inside the caller's transaction to a record the caller already checked (server code: e.g. the
 * attachments of an e-mail that becomes a record, written together with it).
 */
export async function addAttachmentIn(tx: Queryable, ctx: Ctx, def: TableDef, recordId: string, file: UploadFile): Promise<AttachmentView> {
  needAttachments(def);
  checkUpload(ctx, file);
  const name = safeFileName(file.name);
  const mime = sniffMime(file.data, name);
  const sha = sha256Hex(file.data);
  await storeBlob(ctx.cfg, tx, ctx.org.id, sha, file.data);
  const row = await tx.one<Row>(
    `insert into sm_attachments (id, org_id, table_key, record_id, name, mime, size, sha256, uploaded_by, origin)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
    [uuidv7(), ctx.org.id, def.key, recordId, name, mime, file.data.byteLength, sha, actorId(ctx), ctx.cfg.origin ?? null],
  );
  await emitEvent(tx, ctx, { kind: "record.attachment_added", table: def.key, id: recordId, data: { attachment_id: row!.id, name, mime } });
  return view(row!);
}

/**
 * Move attachments of one record to another inside `tx` (server code: a knowledge draft's images go to its article
 * when the draft is published). Their ids stay, so text that references them keeps working.
 */
export async function moveAttachmentsIn(tx: Queryable, ctx: Ctx, from: { table: string; id: string }, to: { table: string; id: string }, ids: string[]): Promise<number> {
  const list = [...new Set(ids)].filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!list.length) return 0;
  const rows = await tx.query<{ id: string }>(
    `update sm_attachments set table_key = $3, record_id = $4, updated_at = now()
     where org_id = $1 and table_key = $2 and record_id = $5 and id = any($6::uuid[]) and deleted_at is null returning id`,
    [ctx.org.id, from.table, to.table, to.id, from.id, pgArray(list)],
  );
  return rows.length;
}

/**
 * Attachments of a record the caller may read, newest last — an archived record's too (read-only: they stay keyed by
 * the record id, and the archive's read rule is the same as the hot table's).
 */
export async function listAttachments(ctx: Ctx, table: string, id: string): Promise<{ attachments: AttachmentView[]; display: Record<string, string> }> {
  const { def, schema } = await defFor(ctx, table);
  needAttachments(def);
  const env = await condEnv(ctx);
  const record = await requireReadable(ctx, def, id, env, ctx.db, { archived: true });
  const all = await ctx.db.query<Row>(
    `select * from sm_attachments where org_id = $1 and table_key = $2 and record_id = $3 and deleted_at is null order by created_at, id`,
    [ctx.org.id, def.key, id],
  );
  const rows = await filterSide({ q: ctx.db, ctx, def, record, kind: "attachment", rows: all });
  const refs = new RefSet();
  for (const r of rows) refs.add("user", r.uploaded_by);
  return { attachments: rows.map(view), display: await resolveDisplay(ctx.db, ctx, env, schema, refs) };
}

/** Remove an attachment (write access to the record, or the uploader). Its content stays while others use it. */
export async function removeAttachment(ctx: Ctx, table: string, id: string, attachmentId: string): Promise<{ ok: true }> {
  const { def } = await defFor(ctx, table);
  needAttachments(def);
  const env = await condEnv(ctx);
  await ctx.write(async (tx) => {
    const record = await requireReadable(ctx, def, id, env, tx);
    const att = await tx.one<Row>(`select * from sm_attachments where id = $1 and org_id = $2 and table_key = $3 and record_id = $4 and deleted_at is null`, [attachmentId, ctx.org.id, def.key, record.id]);
    if (!att) throw notFound("پیوست پیدا نشد");
    const mine = att.uploaded_by && att.uploaded_by === ctx.user.id;
    if (!mine && !isSystemCtx(ctx) && (!access().canWrite(ctx, def, record) || record.$writable === false)) throw forbidden("اجازهٔ حذف این پیوست را ندارید");
    await tx.query(`update sm_attachments set deleted_at = now(), updated_at = now() where id = $1`, [att.id]);
    await emitEvent(tx, ctx, { kind: "record.attachment_removed", table: def.key, id: String(record.id), data: { attachment_id: att.id, name: att.name, mime: att.mime } });
  });
  return { ok: true };
}

/**
 * The attachment row, if the caller may read its record — an archived record included (downloads stay possible,
 * read-only, from the same blob store under the same read rule).
 */
async function readableAttachment(ctx: Ctx, attachmentId: string): Promise<Row> {
  if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) throw notFound("پیوست پیدا نشد");
  const att = await ctx.db.one<Row>(`select * from sm_attachments where id = $1 and org_id = $2 and deleted_at is null`, [attachmentId, ctx.org.id]);
  if (!att) throw notFound("پیوست پیدا نشد");
  const { def } = await defFor(ctx, att.table_key).catch(() => {
    throw notFound("پیوست پیدا نشد");
  });
  const env = await condEnv(ctx);
  const record = await requireReadable(ctx, def, att.record_id, env, ctx.db, { archived: true }).catch(() => {
    throw notFound("پیوست پیدا نشد");
  });
  if (!(await filterSide({ q: ctx.db, ctx, def, record, kind: "attachment", rows: [att] })).length) throw notFound("پیوست پیدا نشد");
  return att;
}

const blobMissing = () => new AppError(404, "blob_missing", "محتوای این پیوست هنوز به این‌جا نرسیده است؛ پس از همگام‌سازی دوباره امتحان کنید");

/** An attachment's metadata and content, if the caller may read its record (fetched from the cloud on the desktop). */
export async function readAttachment(ctx: Ctx, attachmentId: string): Promise<{ meta: AttachmentView; data: Uint8Array }> {
  const att = await readableAttachment(ctx, attachmentId);
  const store = blobStore(ctx.cfg);
  const data = await store.get(ctx.db, ctx.org.id, att.sha256);
  if (data) return { meta: view(att), data };
  if (ctx.cfg.desktop?.fetchBlob) {
    const fetched = await ctx.cfg.desktop.fetchBlob(ctx.org.id, att.id).catch(() => null);
    if (fetched && sha256Hex(fetched) === att.sha256) {
      await storeBlob(ctx.cfg, ctx.db, ctx.org.id, att.sha256, fetched);
      return { meta: view(att), data: fetched };
    }
  }
  throw blobMissing();
}

/**
 * An attachment's content for the download route: a stream when the store can serve one (the server edition's files,
 * never loaded into memory), else the bytes.
 */
export async function openAttachment(ctx: Ctx, attachmentId: string): Promise<{ meta: AttachmentView } & ({ stream: BlobStream; data?: undefined } | { data: Uint8Array; stream?: undefined })> {
  const store = blobStore(ctx.cfg);
  if (!store.open) return readAttachment(ctx, attachmentId);
  const att = await readableAttachment(ctx, attachmentId);
  const stream = await store.open(ctx.org.id, att.sha256);
  if (!stream) throw blobMissing();
  return { meta: view(att), stream };
}

/** Of these contents, the ones attachments of the organisation use but this database lacks. */
export async function missingBlobs(ctx: Ctx, shas: string[]): Promise<string[]> {
  const clean = [...new Set(shas.filter((s) => /^[0-9a-f]{64}$/.test(s)))].slice(0, 1000);
  if (!clean.length) return [];
  const rows = await ctx.db.query<{ sha256: string }>(
    `select distinct a.sha256 from sm_attachments a where a.org_id = $1 and a.sha256 = any($2::text[]) and a.deleted_at is null`,
    [ctx.org.id, pgArray(clean)],
  );
  return blobStore(ctx.cfg).missing(ctx.db, ctx.org.id, rows.map((r) => r.sha256));
}

/** Store a content an attachment of a record the caller may read refers to (the Windows app's offline uploads). */
export async function putBlob(ctx: Ctx, sha: string, data: Uint8Array): Promise<{ ok: true; stored: boolean }> {
  if (!/^[0-9a-f]{64}$/.test(sha)) throw bad("شناسهٔ محتوا معتبر نیست");
  if (data.byteLength > maxAttachmentBytes(ctx)) throw new AppError(413, "too_large", "حجم پیوست بیش از حد مجاز است");
  if (sha256Hex(data) !== sha) throw bad("محتوا با شناسه‌اش جور نیست");
  const atts = await ctx.db.query<Row>(`select table_key, record_id from sm_attachments where org_id = $1 and sha256 = $2 and deleted_at is null limit 20`, [ctx.org.id, sha]);
  const env = await condEnv(ctx);
  let allowed = false;
  for (const a of atts) {
    const def = (await defFor(ctx, a.table_key).catch(() => null))?.def;
    if (!def) continue;
    const ok = await requireReadable(ctx, def, a.record_id, env).then(() => true, () => false);
    if (ok) {
      allowed = true;
      break;
    }
  }
  if (!allowed) throw notFound("پیوستی با این محتوا پیدا نشد");
  const store = blobStore(ctx.cfg);
  const had = await store.has(ctx.db, ctx.org.id, sha);
  if (!had) {
    await store.prepare?.(ctx.org.id, sha, data);
    await ctx.write((tx) => storeBlob(ctx.cfg, tx, ctx.org.id, sha, data), { internal: true });
  }
  return { ok: true, stored: !had };
}
