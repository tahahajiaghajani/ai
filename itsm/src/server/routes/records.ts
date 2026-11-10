// /api/o/:org/r/:table/… and /api/o/:org/meta/… — the record engine's generic HTTP API (docs/spec/ENGINE.md
// § HTTP API). Every table of the registry is served here: lists, single records, aggregates, transitions,
// journal, history, links, watchers, attachments, bulk changes, spreadsheet export and import. Inputs are checked
// with zod; errors come back as { error: { code, message (Persian), details } }.
import { z } from "zod";
import { bodyLimit } from "hono/body-limit";
import { router, body, type C } from "../http/hono";
import { AppError, bad } from "../http/errors";
import type { Cond } from "@shared/model/conditions";
import * as records from "../engine/records";
import { aggregate, METRIC_FNS, type MetricFn } from "../engine/aggregate";
import { addJournal, JOURNAL_KINDS, listJournal, type JournalKind } from "../engine/journal";
import { listHistory } from "../engine/history";
import { addLink, listLinks, removeLink } from "../engine/links";
import { watch } from "../engine/watchers";
import { addAttachment, contentDisposition, listAttachments, missingBlobs, openAttachment, putBlob, removeAttachment } from "../engine/attachments";
import { exportRows, importRows } from "../engine/transfer";
import { tableMeta, tablesMeta } from "../engine/meta";

export const recordRoutes = router();

const DATE_UNITS = ["day", "week", "month", "quarter", "year"] as const;

/** A condition from a query string (JSON) or a body; validated against the table by the engine. */
const condSchema = z.any().optional().nullable();

function parseFilter(raw: string | undefined): Cond | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Cond;
  } catch {
    throw bad("پالایه (filter) باید JSON معتبر باشد");
  }
}

const csv = (s: string | undefined) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined);
const num = (s: string | undefined) => (s === undefined || s === "" ? undefined : Number(s));

const listBody = z.object({
  filter: condSchema,
  q: z.string().max(200).optional(),
  sort: z.string().max(200).optional(),
  page: z.number().int().min(1).optional(),
  size: z.number().int().min(1).max(500).optional(),
  fields: z.array(z.string().max(120)).max(80).optional(),
  ids: z.array(z.string()).max(500).optional(),
  view: z.string().uuid().optional(),
  total: z.boolean().optional(),
});

function listQuery(c: C): records.ListParams {
  const q = c.req.query();
  return {
    filter: parseFilter(q.filter),
    q: q.q,
    sort: q.sort,
    page: num(q.page),
    size: num(q.size),
    fields: csv(q.fields),
    ids: csv(q.ids),
    view: q.view || undefined,
    total: q.total === "false" ? false : undefined,
  };
}

/** The version the caller read: body.version, or an If-Match header. */
function versionOf(c: C, data?: Record<string, unknown>): number | undefined {
  const v = data?.version ?? c.req.header("if-match")?.replace(/"/g, "") ?? c.req.query("version");
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw bad("نسخهٔ رکورد (version) معتبر نیست");
  return n;
}

const record = z.record(z.string(), z.unknown());

// --- meta ---------------------------------------------------------------------------------------------------------

recordRoutes.get("/meta/tables", async (c) => c.json(await tablesMeta(c.get("ctx"))));
recordRoutes.get("/meta/tables/:key", async (c) => c.json(await tableMeta(c.get("ctx"), c.req.param("key"))));

// --- collection ---------------------------------------------------------------------------------------------------

recordRoutes.get("/r/:table", async (c) => c.json(await records.list(c.get("ctx"), c.req.param("table"), listQuery(c))));

recordRoutes.post("/r/:table/query", async (c) => {
  const p = await body(c, listBody);
  return c.json(await records.list(c.get("ctx"), c.req.param("table"), p));
});

recordRoutes.post("/r/:table", async (c) => {
  const data = await body(c, record);
  return c.json(await records.create(c.get("ctx"), c.req.param("table"), data));
});

recordRoutes.post("/r/:table/agg", async (c) => {
  const p = await body(
    c,
    z.object({
      filter: condSchema,
      q: z.string().max(200).optional(),
      groupBy: z.array(z.union([z.string().max(120), z.object({ field: z.string().max(120), bucket: z.enum(DATE_UNITS).optional() })])).max(3).optional(),
      metrics: z.array(z.object({ fn: z.enum(METRIC_FNS as [MetricFn, ...MetricFn[]]), field: z.string().max(120).optional() })).max(10).optional(),
      limit: z.number().int().min(1).max(5000).optional(),
    }),
  );
  return c.json(await aggregate(c.get("ctx"), c.req.param("table"), p));
});

recordRoutes.post("/r/:table/bulk", async (c) => {
  const p = await body(
    c,
    z.object({
      ids: z.array(z.string()).max(500).optional(),
      filter: condSchema,
      data: record.optional(),
      transition: z.string().max(60).optional(),
      delete: z.boolean().optional(),
    }),
  );
  return c.json(await records.bulkUpdate(c.get("ctx"), c.req.param("table"), p));
});

recordRoutes.get("/r/:table/export", async (c) => {
  const p = listQuery(c);
  return c.json(await exportRows(c.get("ctx"), c.req.param("table"), { filter: p.filter, q: p.q, sort: p.sort, fields: p.fields, view: p.view, limit: num(c.req.query("limit")) }));
});

recordRoutes.post("/r/:table/export", async (c) => {
  const p = await body(c, listBody.extend({ limit: z.number().int().min(1).max(10000).optional() }));
  return c.json(await exportRows(c.get("ctx"), c.req.param("table"), p));
});

recordRoutes.post("/r/:table/import", async (c) => {
  const p = await body(
    c,
    z.object({
      rows: z.array(record).max(1000, "در هر بار حداکثر ۱۰۰۰ ردیف"),
      mapping: z.record(z.string(), z.string()).optional(),
      key: z.string().max(60).optional(),
      dry_run: z.boolean().optional(),
    }),
  );
  return c.json(await importRows(c.get("ctx"), c.req.param("table"), { rows: p.rows, mapping: p.mapping, key: p.key, dryRun: p.dry_run }));
});

// --- one record ---------------------------------------------------------------------------------------------------

recordRoutes.get("/r/:table/:id", async (c) => c.json(await records.get(c.get("ctx"), c.req.param("table"), c.req.param("id"))));

recordRoutes.patch("/r/:table/:id", async (c) => {
  const data = await body(c, record);
  return c.json(await records.update(c.get("ctx"), c.req.param("table"), c.req.param("id"), data, { version: versionOf(c, data) }));
});

recordRoutes.delete("/r/:table/:id", async (c) => c.json(await records.remove(c.get("ctx"), c.req.param("table"), c.req.param("id"), { version: versionOf(c) })));

recordRoutes.post("/r/:table/:id/transition", async (c) => {
  const p = await body(c, z.object({ to: z.string().min(1).max(60), data: record.optional(), version: z.number().int().optional() }));
  return c.json(await records.transition(c.get("ctx"), c.req.param("table"), c.req.param("id"), p.to, p.data ?? {}, { version: versionOf(c, p) }));
});

recordRoutes.get("/r/:table/:id/journal", async (c) => {
  const kinds = csv(c.req.query("kinds"))?.filter((k): k is JournalKind => k in JOURNAL_KINDS);
  return c.json(await listJournal(c.get("ctx"), c.req.param("table"), c.req.param("id"), { kinds, limit: num(c.req.query("limit")), before: c.req.query("before") || undefined }));
});

recordRoutes.post("/r/:table/:id/journal", async (c) => {
  const p = await body(c, z.object({ kind: z.enum(["comment", "work_note"]).optional(), body: z.string().min(1, "متن یادداشت خالی است").max(100_000), attachments: z.array(z.string().uuid()).max(50).optional() }));
  return c.json(await addJournal(c.get("ctx"), c.req.param("table"), c.req.param("id"), p));
});

recordRoutes.get("/r/:table/:id/history", async (c) => c.json(await listHistory(c.get("ctx"), c.req.param("table"), c.req.param("id"), { limit: num(c.req.query("limit")), before: c.req.query("before") || undefined })));

recordRoutes.get("/r/:table/:id/links", async (c) => c.json(await listLinks(c.get("ctx"), c.req.param("table"), c.req.param("id"))));

recordRoutes.post("/r/:table/:id/links", async (c) => {
  const p = await body(c, z.object({ kind: z.string().min(1).max(40), table: z.string().min(1).max(60), id: z.string().uuid(), note: z.string().max(500).optional().nullable() }));
  return c.json({ link: await addLink(c.get("ctx"), c.req.param("table"), c.req.param("id"), p) });
});

recordRoutes.delete("/r/:table/:id/links/:linkId", async (c) => c.json(await removeLink(c.get("ctx"), c.req.param("table"), c.req.param("id"), c.req.param("linkId"))));

recordRoutes.post("/r/:table/:id/watch", async (c) => {
  const p = await body(c, z.object({ user_id: z.string().uuid().optional() }));
  return c.json(await watch(c.get("ctx"), c.req.param("table"), c.req.param("id"), true, p.user_id));
});

recordRoutes.delete("/r/:table/:id/watch", async (c) => c.json(await watch(c.get("ctx"), c.req.param("table"), c.req.param("id"), false, c.req.query("user_id") || undefined)));

recordRoutes.get("/r/:table/:id/attachments", async (c) => c.json(await listAttachments(c.get("ctx"), c.req.param("table"), c.req.param("id"))));

const UPLOAD_LIMIT = 101 * 1024 * 1024;
const tooLarge = () => {
  throw new AppError(413, "too_large", "حجم پیوست بیش از حد مجاز است");
};

recordRoutes.post("/r/:table/:id/attachments", bodyLimit({ maxSize: UPLOAD_LIMIT, onError: tooLarge }), async (c) => {
  const form = await c.req.parseBody().catch(() => {
    throw bad("فایل پیوست دریافت نشد (multipart/form-data با فیلد file)");
  });
  const file = form.file;
  if (!file || typeof file === "string") throw bad("فایل پیوست دریافت نشد (multipart/form-data با فیلد file)");
  const data = new Uint8Array(await file.arrayBuffer());
  const attachment = await addAttachment(c.get("ctx"), c.req.param("table"), c.req.param("id"), { name: file.name, type: file.type, data });
  return c.json({ attachment });
});

recordRoutes.delete("/r/:table/:id/attachments/:attachmentId", async (c) =>
  c.json(await removeAttachment(c.get("ctx"), c.req.param("table"), c.req.param("id"), c.req.param("attachmentId"))),
);

/** An attachment's content: `attachment` unless ?inline=1 for a raster image; never sniffed, never scripted. */
recordRoutes.get("/attachments/:id/content", async (c) => {
  // a stream when the blob store serves files (the server edition), else the bytes
  const { meta, data, stream } = await openAttachment(c.get("ctx"), c.req.param("id"));
  const inline = c.req.query("inline") === "1" && meta.previewable;
  return new Response(stream ? stream.stream : Buffer.from(data), {
    status: 200,
    headers: {
      "content-type": inline || meta.mime !== "text/html" ? meta.mime : "application/octet-stream",
      "content-length": String(stream ? stream.size : data.byteLength),
      "content-disposition": contentDisposition(meta.name, inline),
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      "cache-control": "private, max-age=3600",
      etag: `"${meta.sha256}"`,
    },
  });
});

// --- attachment contents of the Windows app (uploaded after a push) ---------------------------------------------

recordRoutes.post("/blobs/missing", async (c) => {
  const p = await body(c, z.object({ sha256: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(1000) }));
  return c.json({ missing: await missingBlobs(c.get("ctx"), p.sha256) });
});

recordRoutes.put("/blobs/:sha256", bodyLimit({ maxSize: UPLOAD_LIMIT, onError: tooLarge }), async (c) => {
  const data = new Uint8Array(await c.req.arrayBuffer());
  return c.json(await putBlob(c.get("ctx"), c.req.param("sha256"), data));
});
