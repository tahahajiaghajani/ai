// «فراخوانی HTTP» (docs/spec/services/flows.md §7): calls go only to an organisation's `flow_connection` — its base
// address plus the hosts it allows (exact or `*.example.com`). The connection's secret (an engine secret field) is
// applied as Bearer, Basic, a header or a query parameter and never reaches a log. https only (the Windows app may
// also use http on its own network); on the web version the platform's SSRF guard resolves the host (public
// addresses only) and refuses redirects. Each call carries `Idempotency-Key: <run>:<step>` (a retried step sends
// the same key) and has a timeout (the step's, at most the connection's, at most 60 s). The answer (≤ 1 MB) is
// parsed as JSON when it is JSON; `map` picks values out of it by path (src/shared/json-path.ts).
import type { Queryable } from "../../db";
import { openSecret } from "../../engine";
import { guardedFetch } from "../ai/net";
import { pickPath } from "@shared/json-path";
import { renderBody } from "@shared/flows";
import { faDigits } from "@shared/format";
import { registerBuiltinStepHandler, type StepContext, type StepOutcome } from "./registry";
import { lanAllowed } from "../../net";
import { demoScopeOrg } from "../../db/scope";

export interface ConnectionRow {
  id: string;
  name: string;
  active: boolean;
  base_url: string;
  hosts: string[] | null;
  auth: "none" | "bearer" | "basic" | "header" | "query";
  auth_name: string | null;
  username: string | null;
  secret: string | null;
  headers: Record<string, unknown> | null;
  timeout: number | null;
  deleted_at: string | null;
}

const MAX_BYTES = 1024 * 1024;
const WITH_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
/** Headers a step may not set (the connection's auth and the transport's own). */
const RESERVED = new Set(["host", "content-length", "connection", "transfer-encoding", "authorization", "cookie", "idempotency-key"]);

export async function loadConnection(q: Queryable, orgId: string, id: string): Promise<ConnectionRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return q.one<ConnectionRow>(`select * from sm_flow_connections where org_id = $1 and id = $2`, [orgId, id.toLowerCase()]);
}

/** Is `host` the connection's own or one of its allowed hosts (`*.example.com` = any subdomain)? */
export function hostAllowed(host: string, conn: Pick<ConnectionRow, "base_url" | "hosts">): boolean {
  const h = host.toLowerCase().replace(/\.+$/, "");
  let base = "";
  try {
    base = new URL(conn.base_url).hostname.toLowerCase().replace(/\.+$/, "");
  } catch {
    return false;
  }
  if (h === base) return true;
  for (const raw of conn.hosts ?? []) {
    const p = String(raw).trim().toLowerCase().replace(/\.+$/, "");
    if (!p) continue;
    if (p.startsWith("*.")) {
      const suffix = p.slice(1);
      if (h.endsWith(suffix) && h.length > suffix.length) return true;
    } else if (h === p) return true;
  }
  return false;
}

/** The request URL: an absolute address, or a path under the connection's base address, plus query parameters. */
export function requestUrl(conn: Pick<ConnectionRow, "base_url">, path: string, query: [string, string][]): URL {
  const p = path.trim();
  const url = /^https?:\/\//i.test(p) ? new URL(p) : new URL(conn.base_url.replace(/\/+$/, "") + (p ? (p.startsWith("/") ? p : `/${p}`) : ""));
  for (const [k, v] of query) url.searchParams.append(k, v);
  return url;
}

function pairs(s: StepContext, key: string): [string, string][] {
  const out: [string, string][] = [];
  for (const kv of Array.isArray(s.node.config[key]) ? (s.node.config[key] as { key?: unknown; value?: unknown }[]) : []) {
    const k = String(kv?.key ?? "").trim();
    if (k) out.push([k, s.text(kv.value)]);
  }
  return out;
}

async function readCapped(res: Response): Promise<{ text: string; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { text: "", truncated: false };
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated };
}

export async function callHttp(s: StepContext): Promise<StepOutcome> {
  const c = s.node.config;
  const conn = await loadConnection(s.cfg.db, s.orgId, String(s.render(c.connection) ?? ""));
  if (!conn || conn.deleted_at) return { error: "اتصال این گام پیدا نشد" };
  if (!conn.active) return { error: `اتصال «${conn.name}» غیرفعال است` };
  const method = String(c.method ?? "GET").toUpperCase();
  if (!METHODS.has(method)) return { error: `روش «${method}» پشتیبانی نمی‌شود` };
  let url: URL;
  try {
    url = requestUrl(conn, s.text(c.path ?? ""), pairs(s, "query"));
  } catch {
    return { error: "نشانی درخواست معتبر نیست" };
  }
  // the Windows app and the server edition reach their own network (http:// servers included)
  const desktop = lanAllowed(s.cfg);
  if (url.protocol !== "https:" && !(desktop && url.protocol === "http:")) return { error: "فقط نشانی‌های https:// مجازند" };
  if (url.username || url.password) return { error: "نام کاربری و گذرواژه در نشانی مجاز نیست؛ آن‌ها را در اتصال ثبت کنید" };
  if (!hostAllowed(url.hostname, conn)) return { error: `میزبان «${url.hostname}» در فهرست مجاز اتصال «${conn.name}» نیست` };

  const headers: Record<string, string> = { accept: "application/json, text/plain;q=0.9, */*;q=0.5", "user-agent": "ITSM-Flows/1", "idempotency-key": `${s.run.id}:${s.stepKey}` };
  for (const [k, v] of Object.entries(conn.headers && typeof conn.headers === "object" ? conn.headers : {})) {
    if (!RESERVED.has(k.toLowerCase()) && /^[A-Za-z0-9_.-]{1,80}$/.test(k)) headers[k.toLowerCase()] = String(v);
  }
  for (const [k, v] of pairs(s, "headers")) if (!RESERVED.has(k.toLowerCase())) headers[k.toLowerCase()] = v;
  let secret: string | null = null;
  try {
    secret = conn.secret ? openSecret(s.cfg.secret, s.orgId, "flow_connection", "secret", conn.id, conn.secret) : null;
  } catch {
    return { error: `کلید اتصال «${conn.name}» خوانده نشد؛ آن را دوباره ثبت کنید` };
  }
  if (conn.auth !== "none" && !secret) return { error: `کلید یا گذرواژهٔ اتصال «${conn.name}» ثبت نشده است` };
  if (conn.auth === "bearer") headers.authorization = `Bearer ${secret}`;
  else if (conn.auth === "basic") headers.authorization = `Basic ${Buffer.from(`${conn.username ?? ""}:${secret}`).toString("base64")}`;
  else if (conn.auth === "header" && conn.auth_name) headers[conn.auth_name.toLowerCase()] = secret!;
  else if (conn.auth === "query" && conn.auth_name) url.searchParams.set(conn.auth_name, secret!);

  let body: string | undefined;
  if (WITH_BODY.has(method) && typeof c.body === "string" && c.body.trim()) {
    const b = renderBody(c.body, s.data, { tz: s.tz });
    body = b.text;
    headers["content-type"] ??= b.json ? "application/json; charset=utf-8" : "text/plain; charset=utf-8";
  }
  const seconds = Math.min(Math.max(Number(c.timeout ?? conn.timeout ?? 15) || 15, 1), Math.min(conn.timeout ?? 60, 60), 60);
  // a flow run of demo work calls nothing outside the system (docs/DEMO_FA.md)
  if (demoScopeOrg()) return { error: "داده‌های نمایشی: فراخوانی بیرونی در کار نمایشی انجام نمی‌شود" };
  const fetcher = desktop ? s.cfg.fetch : guardedFetch(s.cfg.fetch);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), seconds * 1000);
  const started = Date.now();
  let res: Response;
  try {
    res = await fetcher(url.href, { method, headers, body, signal: ac.signal, redirect: "manual" });
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error)?.name === "AbortError") return { error: `«${conn.name}» در ${faDigits(seconds)} ثانیه پاسخ نداد` };
    const m = String((e as Error)?.message ?? "");
    return { error: /[؀-ۿ]/.test(m) ? m : `اتصال به «${conn.name}» برقرار نشد` };
  }
  let read: { text: string; truncated: boolean };
  try {
    read = await readCapped(res);
  } catch {
    read = { text: "", truncated: true };
  } finally {
    clearTimeout(timer);
  }
  let parsed: unknown = undefined;
  const type = res.headers.get("content-type") ?? "";
  if (!read.truncated && (type.includes("json") || /^\s*[[{]/.test(read.text))) {
    try {
      parsed = JSON.parse(read.text);
    } catch {
      parsed = undefined;
    }
  }
  const output: Record<string, unknown> = {
    status: res.status,
    ok: res.ok,
    body: parsed !== undefined ? parsed : read.text.slice(0, 64 * 1024),
    content_type: type,
    duration_ms: Date.now() - started,
    ...(read.truncated ? { truncated: true } : {}),
  };
  for (const m of Array.isArray(c.map) ? (c.map as { name?: unknown; path?: unknown }[]) : []) {
    const name = String(m?.name ?? "").trim();
    if (name && !(name in output)) output[name] = parsed !== undefined ? pickPath(parsed, String(m.path ?? "")) ?? null : null;
  }
  if (res.status >= 300 && res.status < 400) return { error: `«${conn.name}» به نشانی دیگری ارجاع داد (HTTP ${res.status})؛ نشانی دقیق را به کار ببرید`, output };
  if (!res.ok) return { error: `«${conn.name}» با کد ${res.status} پاسخ داد`, output };
  return { output };
}

registerBuiltinStepHandler("call_http", { run: callHttp });
