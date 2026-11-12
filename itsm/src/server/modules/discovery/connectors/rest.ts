// The generic REST/JSON kind (design A §2.2, §6.3): any tool with a JSON API. The kind *is* mapping — the connector's
// `mapping` names a JSON path over each element of the array at `options.items_path` for every field of the record
// (`external_id` at least) — with the paging styles none, offset, page, cursor and next link. Records go to the runner
// as read; the runner normalises every one. Authentication: none, an API key in one header of the fixed list
// (§14.1), or basic.
import { z } from "zod";
import { rest as descriptor, REST_PAGING } from "@shared/discovery/kinds/rest";
import { recordFromElement, sourceValue } from "@shared/discovery/mapping";
import { API_KEY_HEADERS, type Cursor, type DiscoveredRecord, type Page, type TestResult } from "@shared/discovery/types";
import { ConnectorError, CONNECTOR_MESSAGES, type ConnCtx, type ConnectorKind } from "../kind";

const PARAM = /^[A-Za-z_][A-Za-z0-9_.[\]-]{0,63}$/;
const CREDENTIAL = /^(api[-_]?key|apitoken|passhash|token|password|access[-_]?token|secret)$/i;
const param = (fallback: string) => z.string().trim().regex(PARAM).default(fallback);

export const restOptions = z.object({
  path: z.string().trim().min(1).max(500),
  items_path: z.string().trim().max(200).default(""),
  paging: z.enum(REST_PAGING).default("offset"),
  page_size: z.coerce.number().int().min(1).max(1000).default(500),
  offset_param: param("offset"),
  limit_param: param("limit"),
  page_param: param("page"),
  size_param: param("page_size"),
  first_page: z.coerce.number().int().min(0).max(1).default(1),
  cursor_param: param("cursor"),
  cursor_path: z.string().trim().max(200).default(""),
  next_path: z.string().trim().max(200).default("next"),
  total_path: z.string().trim().max(200).default(""),
  query: z
    .record(z.string().regex(PARAM), z.union([z.string().max(500), z.number(), z.boolean()]))
    .default({})
    .refine((q) => !Object.keys(q).some((k) => CREDENTIAL.test(k)), { message: CONNECTOR_MESSAGES.credentialsInUrl }),
  listing_is_contact: z.boolean().default(false),
});
export type RestOptions = z.infer<typeof restOptions>;

/** The header the connector's credentials go in (none, an API key in one header of the fixed list, or basic). */
export function restAuth(c: ConnCtx): Record<string, string> {
  const v = c.connector;
  if (v.auth === "token" && c.secret) {
    const header = v.api_key_header && (API_KEY_HEADERS as readonly string[]).includes(v.api_key_header) ? v.api_key_header : "Authorization";
    return { [header]: header === "Authorization" && !/\s/.test(c.secret) ? `Bearer ${c.secret}` : c.secret };
  }
  if (v.auth === "basic" && c.secret !== null) return { Authorization: `Basic ${Buffer.from(`${v.username ?? ""}:${c.secret}`, "utf8").toString("base64")}` };
  return {};
}

interface RestCursor {
  offset?: number;
  page?: number;
  cursor?: string;
  url?: string;
}

async function page(c: ConnCtx, cursor: Cursor | null, size?: number): Promise<Page> {
  const o = c.options as RestOptions;
  const cur = (cursor && typeof cursor === "object" && !Array.isArray(cursor) ? cursor : {}) as RestCursor;
  const limit = size ?? o.page_size;
  const query: Record<string, string | number | boolean> = { ...o.query };
  let path = o.path;
  switch (o.paging) {
    case "offset":
      query[o.offset_param] = Number(cur.offset ?? 0);
      query[o.limit_param] = limit;
      break;
    case "page":
      query[o.page_param] = Number(cur.page ?? o.first_page);
      query[o.size_param] = limit;
      break;
    case "cursor":
      if (cur.cursor) query[o.cursor_param] = String(cur.cursor);
      query[o.limit_param] = limit;
      break;
    case "next_link":
      // the tool's own link to the next page carries its query (the host stays pinned)
      if (cur.url) {
        path = String(cur.url);
        for (const k of Object.keys(query)) delete query[k];
      } else query[o.limit_param] = limit;
      break;
    case "none":
      break;
  }
  const res = await c.fetchJson<unknown>(path, { query, headers: restAuth(c) });
  const items = o.items_path ? sourceValue(res.body, o.items_path) : res.body;
  if (!Array.isArray(items)) throw new ConnectorError("bad_response", `پاسخ ابزار در مسیر «${o.items_path || "ریشه"}» آرایه نیست؛ «مسیر آرایه در پاسخ» را اصلاح کنید`);
  const records = items.map((el) => recordFromElement(el, c.connector.mapping) as unknown as DiscoveredRecord);
  const totalRaw = o.total_path ? Number(sourceValue(res.body, o.total_path)) : NaN;
  const total = Number.isFinite(totalRaw) && totalRaw >= 0 ? totalRaw : undefined;
  let next: Cursor = null;
  if (o.paging === "offset") {
    const at = Number(cur.offset ?? 0) + items.length;
    next = items.length >= limit && (total === undefined || at < total) ? { offset: at } : null;
  } else if (o.paging === "page") {
    next = items.length >= limit ? { page: Number(cur.page ?? o.first_page) + 1 } : null;
  } else if (o.paging === "cursor") {
    const v = o.cursor_path ? sourceValue(res.body, o.cursor_path) : undefined;
    next = typeof v === "string" || typeof v === "number" ? (String(v) && String(v) !== cur.cursor ? { cursor: String(v) } : null) : null;
  } else if (o.paging === "next_link") {
    const v = sourceValue(res.body, o.next_path);
    next = typeof v === "string" && v.trim() && v !== cur.url ? { url: v.trim() } : null;
  }
  return { records, next: items.length ? next : null, complete: true, ...(total !== undefined ? { total } : {}) };
}

export const connector: ConnectorKind = {
  ...descriptor,
  headers: [...API_KEY_HEADERS],
  optionsSchema: restOptions,
  async test(c: ConnCtx): Promise<TestResult> {
    const first = await page(c, null, 1);
    const warnings: string[] = [];
    if (!first.records.length) warnings.push("ابزار در این مسیر موردی برنگرداند");
    else if (!first.records.some((r) => r.external_id !== undefined && r.external_id !== null && String(r.external_id) !== "")) warnings.push("مسیر شناسهٔ مورد (external_id) در پاسخ ابزار پیدا نشد");
    return { ok: true, warnings };
  },
  pages: (c, cursor) => page(c, cursor),
};
