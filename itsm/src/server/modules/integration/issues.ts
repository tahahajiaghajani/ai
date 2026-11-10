// Jira and GitHub issue sync (catalogue INT-026, INT-028): «ساخت issue» from a record (incidents, problems… — the
// tables a connection names) by someone who works the record, with only what they read; the issue's key, URL and
// state kept on an `external_ref`; the tools' webhooks (signed with the connection's secret) turned into work notes on
// the record and, when the issue closes, an optional state change — as the connection's integration user, never the
// system; and, when asked, the record's comments posted to the issue (public replies only, or every note).
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Ctx, ServerConfig } from "../../context";
import { tableDef } from "@shared/tables";
import { adfDoc, githubEvent, isClosedState, issueText, jiraEvent, noteOf, type IssueEvent, type IssueKind } from "@shared/integration/issues";
import { bad, conflict, forbidden, notFound, unauthorized } from "../../http/errors";
import { demoQuiet } from "../../db/scope";
import { addJournalIn, condEnv, createIn, get, listJournal, onRecordEvent, orgSchema, readable, readSecret, systemCtx, transition, updateIn, type RecordEvent } from "../../engine";
import type { Queryable } from "../../db";
import { pgArray } from "../../db";
import { access } from "../../access/provider";
import { enqueue, registerJobHandler } from "../../jobs";
import { needFeature, hasFeature } from "../admin/common";
import { audit } from "../data/crud";
import { callOut, failText, type OutResult } from "./net";
import { intLog, isUuid, liveRow, liveRows, principalCtx, sysOf, type Row } from "./common";

/** A comment this app posted carries this mark: its echo from the tool's webhook is ignored. */
export const ECHO_MARK = "‏[ITSM]";

interface Conn {
  orgId: string;
  row: Row;
  kind: IssueKind;
  token: string;
  api: string;
}

async function connection(cfg: ServerConfig, sys: Ctx, id: string): Promise<Conn> {
  const row = await liveRow(cfg.db, sys, "issue_connection", id);
  if (!row) throw notFound("اتصال Jira یا GitHub پیدا نشد");
  const token = (await readSecret(cfg.db, sys, tableDef("issue_connection")!, id, "token")) ?? "";
  const kind = row.kind === "jira" ? "jira" : "github";
  const base = String(row.base_url ?? "").replace(/\/+$/, "");
  const api = kind === "github" ? base ? `${base}/api/v3` : "https://api.github.com" : base;
  if (kind === "jira" && !api) throw bad("نشانی Jira تنظیم نشده است");
  if (kind === "github" && !/^[\w.-]+\/[\w.-]+$/.test(String(row.repo ?? ""))) throw bad("مخزن GitHub (owner/name) تنظیم نشده است");
  return { orgId: sys.org.id, row, kind, token, api };
}

function headers(c: Conn): Record<string, string> {
  if (c.kind === "github") return { authorization: `Bearer ${c.token}`, accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": "ITSM-Issue-Sync", "x-github-api-version": "2022-11-28" };
  const basic = Buffer.from(`${c.row.auth_user ?? ""}:${c.token}`).toString("base64");
  return { authorization: `Basic ${basic}`, accept: "application/json", "content-type": "application/json" };
}

const label = (c: Conn) => (c.kind === "github" ? "GitHub" : "Jira");

async function call(cfg: ServerConfig, c: Conn, method: string, path: string, body?: unknown): Promise<OutResult & { json: any }> {
  const r = await callOut(cfg, `${c.api}${path}`, { method, headers: headers(c), body: body === undefined ? undefined : JSON.stringify(body) }, label(c));
  let json: any = null;
  try {
    json = r.text ? JSON.parse(r.text) : null;
  } catch {
    json = null;
  }
  await intLog(cfg.db, { org_id: c.orgId, kind: "issue", ref_id: String(c.row.id), method, target: `${label(c)} ${path.split("?")[0]}`, status: r.status || null, ok: r.ok, latency_ms: r.ms, error: r.ok ? null : failText(label(c), r) });
  return { ...r, json };
}

interface Remote {
  key: string;
  id: string;
  url: string;
  state: string;
  closed: boolean;
}

function remoteOf(c: Conn, j: any): Remote {
  if (c.kind === "github") return { key: `#${j.number}`, id: String(j.id), url: String(j.html_url ?? ""), state: String(j.state ?? ""), closed: isClosedState("github", j.state) };
  const st = j.fields?.status;
  return { key: String(j.key), id: String(j.id), url: `${c.api}/browse/${j.key}`, state: String(st?.name ?? ""), closed: isClosedState("jira", st?.name, st?.statusCategory?.key) };
}

async function fetchIssue(cfg: ServerConfig, c: Conn, key: string): Promise<Remote> {
  const path = c.kind === "github" ? `/repos/${c.row.repo}/issues/${key.replace(/^#/, "")}` : `/rest/api/3/issue/${encodeURIComponent(key)}?fields=status,summary`;
  const r = await call(cfg, c, "GET", path);
  if (!r.ok || !r.json) throw bad(failText(label(c), r));
  return remoteOf(c, r.json);
}

/** «ساخت issue» or «پیوند به issue موجود» from a record the caller works. */
export async function linkIssue(ctx: Ctx, input: { connection_id: string; table: string; record_id: string; remote_key?: string | null }): Promise<Row> {
  await needFeature(ctx, "issue_sync");
  const sys = sysOf(ctx);
  const c = await connection(ctx.cfg, sys, input.connection_id);
  if (c.row.active === false) throw bad("این اتصال غیرفعال است");
  const tables = Array.isArray(c.row.tables) ? (c.row.tables as string[]) : [];
  if (tables.length && !tables.includes(input.table)) throw bad("این اتصال برای این جدول تعریف نشده است");
  const def = tableDef(input.table);
  if (!def) throw notFound(`جدول «${input.table}» وجود ندارد`);
  // the record as the caller reads it: only what they see leaves the system, and only if they work it
  const rec = await get(ctx, input.table, input.record_id);
  // a demo record never leaves the system (docs/DEMO_FA.md), whoever links it
  if (await demoQuiet(ctx.db, ctx.org.id, input.record_id)) throw conflict("داده‌های نمایشی: رکورد نمایشی به سامانهٔ بیرونی فرستاده نمی‌شود");
  if (!rec.meta.canWrite || access().writeMode?.(ctx, def, rec.row) === "requester") throw forbidden("فقط کسی که روی این رکورد کار می‌کند می‌تواند issue بسازد");
  const existing = await liveRows(ctx.db, sys, "external_ref", { and: [{ f: "connection_id", op: "eq", v: c.row.id }, { f: "record_id", op: "eq", v: input.record_id }, { f: "sync_state", op: "ne", v: "unlinked" }] }, { limit: 1 });
  if (existing.length) throw bad(`این رکورد پیش‌تر به ${existing[0].remote_key} پیوند خورده است`);
  let remote: Remote;
  if (input.remote_key?.trim()) {
    remote = await fetchIssue(ctx.cfg, c, input.remote_key.trim());
  } else {
    const title = String(rec.row[def.display] ?? rec.row.short_description ?? rec.row.title ?? "");
    const text = issueText({ number: (rec.row.number as string) ?? null, title, description: typeof rec.row.description === "string" ? rec.row.description : null, url: `/${ctx.org.id}/r/${input.table}/${input.record_id}`, table_label: def.label });
    const r =
      c.kind === "github"
        ? await call(ctx.cfg, c, "POST", `/repos/${c.row.repo}/issues`, { title: text.title, body: `${text.body}\n\n${ECHO_MARK}` })
        : await call(ctx.cfg, c, "POST", "/rest/api/3/issue", { fields: { project: { key: c.row.project_key }, summary: text.title, issuetype: { name: c.row.issue_type || "Task" }, description: adfDoc(text.body) } });
    if (!r.ok || !r.json) throw bad(failText(label(c), r));
    remote = c.kind === "github" ? remoteOf(c, r.json) : { key: String(r.json.key), id: String(r.json.id), url: `${c.api}/browse/${r.json.key}`, state: "", closed: false };
  }
  // the record's number only (its title stays with the record), shown to readers of the record (redactRefs)
  const recLabel = String(rec.row.number ?? "").slice(0, 250) || null;
  const ref = await ctx.write(async (tx) => {
    const row = await createIn(
      tx,
      sys,
      "external_ref",
      { remote_key: remote.key, connection_id: c.row.id, table_key: input.table, record_id: input.record_id, record_label: recLabel, remote_id: remote.id, remote_url: remote.url || null, remote_state: remote.state || null, sync_state: "in_sync", last_synced_at: new Date().toISOString() },
      { trusted: true },
    );
    if (def.features?.journal) {
      await addJournalIn(tx, ctx, def, rec.row, { kind: "work_note", body: `${input.remote_key ? "پیوند به" : "ساخت"} issue ${remote.key} در ${label(c)}${remote.url ? `: ${remote.url}` : ""}`, data: { origin: "issue_sync", ref: row.id } });
    }
    // the audit names the record by table and id, never by its title (the platform's console reads every audit)
    await audit(tx, ctx, "issue_link", "external_ref", String(row.id), `${remote.key} در ${label(c)} ← ${def.label} ${input.record_id}`);
    return row;
  });
  await markConnection(ctx.cfg, sys, String(c.row.id), { health: "ok", last_error: null });
  return ref;
}

async function markConnection(cfg: ServerConfig, sys: Ctx, id: string, patch: Record<string, unknown>): Promise<void> {
  await sys.write((tx) => updateIn(tx, sys, "issue_connection", id, patch, { trusted: true, keepVersion: true })).catch(() => undefined);
}

/**
 * Rows of `external_ref` (redactRows): the linked record's label only for readers of that record — the hub's table
 * is readable across the integrations area, the records it links are not (a confidential incident, a secure case).
 */
export async function redactRefs(q: Queryable, ctx: Ctx, _def: unknown, rows: Row[]): Promise<void> {
  const shown = rows.filter((r) => r.record_label !== undefined && r.record_label !== null && isUuid(r.id));
  if (!shown.length) return;
  const keys = await q.query<{ id: string; table_key: string; record_id: string }>(`select id, table_key, record_id from sm_external_refs where id = any($1::uuid[])`, [pgArray(shown.map((r) => String(r.id)))]);
  const byId = new Map(keys.map((k) => [k.id, k]));
  const tables = new Map<string, string[]>();
  for (const k of keys) if (isUuid(k.record_id)) tables.set(k.table_key, [...(tables.get(k.table_key) ?? []), k.record_id]);
  const readableSet = new Set<string>();
  const schema = await orgSchema(ctx, q);
  const env = await condEnv(ctx);
  for (const [table, ids] of tables) {
    const def = schema.def(table) ?? tableDef(table);
    if (!def || def.virtual) continue;
    const params: unknown[] = [pgArray(ids)];
    const where = readable(ctx, def, "t", params, env);
    for (const r of await q.query<{ id: string }>(`select t.id from ${def.table} t where t.id = any($1::uuid[]) and ${where}`, params)) readableSet.add(`${table}:${r.id}`);
  }
  for (const r of shown) {
    const k = byId.get(String(r.id));
    if (!k || !readableSet.has(`${k.table_key}:${k.record_id}`)) r.record_label = null;
  }
}

/** The external refs of a record (for whoever reads the record). */
export async function refsOf(ctx: Ctx, table: string, id: string): Promise<Row[]> {
  await get(ctx, table, id); // 404 for a record the caller may not read
  return liveRows(ctx.db, sysOf(ctx), "external_ref", { and: [{ f: "table_key", op: "eq", v: table }, { f: "record_id", op: "eq", v: id }] }, { order: "t.created_at" });
}

/** Read the issue's state again. */
export async function refreshRef(ctx: Ctx, refId: string): Promise<Row> {
  const sys = sysOf(ctx);
  const ref = await liveRow(ctx.db, sys, "external_ref", refId);
  if (!ref) throw notFound("پیوند پیدا نشد");
  await get(ctx, String(ref.table_key), String(ref.record_id));
  if (await demoQuiet(ctx.db, ctx.org.id, String(ref.record_id))) throw conflict("داده‌های نمایشی: رکورد نمایشی به سامانهٔ بیرونی فرستاده نمی‌شود");
  const c = await connection(ctx.cfg, sys, String(ref.connection_id));
  try {
    const remote = await fetchIssue(ctx.cfg, c, String(ref.remote_key));
    return await sys.write((tx) => updateIn(tx, sys, "external_ref", refId, { remote_state: remote.state, sync_state: "in_sync", error: null, last_synced_at: new Date().toISOString() }, { trusted: true }));
  } catch (e) {
    return sys.write((tx) => updateIn(tx, sys, "external_ref", refId, { sync_state: "error", error: String((e as Error).message ?? e).slice(0, 2000) }, { trusted: true }));
  }
}

// ---------------------------------------------------------------- webhooks of the tools

const verifyHmac = (secret: string, raw: string, given: string | undefined) => {
  if (!given) return false;
  const want = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const got = given.trim().replace(/^sha256=/i, "").toLowerCase();
  const a = Buffer.from(want);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** A webhook of the tool: verified with the connection's secret, applied as its integration user. */
export async function receiveIssueHook(cfg: ServerConfig, connectionId: string, raw: string, header: (h: string) => string | undefined, query: (q: string) => string | undefined): Promise<{ ok: boolean; action: string; message?: string }> {
  if (!isUuid(connectionId)) throw notFound("اتصال پیدا نشد");
  const org = await cfg.db.one<{ org_id: string }>(`select org_id from sm_issue_connections where id = $1 and deleted_at is null`, [connectionId]);
  if (!org) throw notFound("اتصال پیدا نشد");
  const sys = await systemCtx(cfg, org.org_id);
  const c = await connection(cfg, sys, connectionId);
  const secret = await readSecret(cfg.db, sys, tableDef("issue_connection")!, connectionId, "webhook_secret");
  if (!secret) throw unauthorized("راز وب‌هوک این اتصال تنظیم نشده است");
  const ok = c.kind === "github" ? verifyHmac(secret, raw, header("x-hub-signature-256")) : verifyHmac(secret, raw, header("x-hub-signature")) || query("secret") === secret;
  if (!ok) throw unauthorized("امضای درخواست معتبر نیست");
  if (!(await hasFeature(cfg.db, org.org_id, "issue_sync", cfg.mode))) return { ok: false, action: "ignored", message: "پیوند Jira و GitHub خاموش است" };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw bad("بدنهٔ درخواست JSON نیست");
  }
  const ev: IssueEvent = c.kind === "github" ? githubEvent(header("x-github-event") ?? "", body) : jiraEvent(body);
  if (ev.action === "ignored" || !ev.remote_key) return { ok: true, action: "ignored" };
  if (c.kind === "github" && ev.repo && ev.repo.toLowerCase() !== String(c.row.repo).toLowerCase()) return { ok: true, action: "ignored" };
  if (ev.comment?.body.includes(ECHO_MARK)) return { ok: true, action: "echo" };
  const [ref] = await liveRows(cfg.db, sys, "external_ref", { and: [{ f: "connection_id", op: "eq", v: connectionId }, { f: "remote_key", op: "eq", v: ev.remote_key }] }, { limit: 1 });
  if (!ref) return { ok: true, action: "unlinked" };
  await sys.write((tx) => updateIn(tx, sys, "external_ref", String(ref.id), { remote_state: ev.state ?? ref.remote_state ?? null, last_synced_at: new Date().toISOString(), sync_state: "in_sync" }, { trusted: true }));
  await markConnection(cfg, sys, connectionId, { last_event_at: new Date().toISOString(), health: "ok" });
  const note = noteOf(c.kind, ev);
  if (!note) return { ok: true, action: ev.action };
  // as the connection's integration user: it must work the record to note on it or move it
  let actor: Ctx;
  try {
    actor = (await principalCtx(cfg, org.org_id, c.row.principal_id ? String(c.row.principal_id) : null)).ctx;
  } catch (e) {
    await markConnection(cfg, sys, connectionId, { health: "failing", last_error: String((e as Error).message ?? e).slice(0, 2000) });
    return { ok: false, action: ev.action, message: String((e as Error).message ?? e) };
  }
  const table = String(ref.table_key);
  const def = tableDef(table)!;
  try {
    const rec = await get(actor, table, String(ref.record_id));
    if (def.features?.journal) await actor.write((tx) => addJournalIn(tx, actor, def, rec.row, { kind: "work_note", body: note, data: { origin: "issue_sync", remote: ev.remote_key } }));
    if (ev.action === "closed" && c.row.state_on_close && rec.meta.transitions?.some((t: { to: string }) => t.to === c.row.state_on_close)) {
      await transition(actor, table, String(ref.record_id), String(c.row.state_on_close), { close_notes: note, close_code: "solved" }, { version: Number(rec.row.version) }).catch(() => undefined);
    }
  } catch (e) {
    await markConnection(cfg, sys, connectionId, { health: "failing", last_error: String((e as Error).message ?? e).slice(0, 2000) });
    return { ok: false, action: ev.action, message: String((e as Error).message ?? e) };
  }
  return { ok: true, action: ev.action };
}

// ---------------------------------------------------------------- the record's comments to the issue

async function onComment(e: RecordEvent, cfg: ServerConfig): Promise<void> {
  if (e.via === "sync" || !e.entry) return;
  if (await demoQuiet(cfg.db, e.org_id, e.id)) return;
  const hasRefs = await cfg.db.one(`select 1 from sm_external_refs where org_id = $1 and table_key = $2 and record_id = $3 and deleted_at is null and sync_state <> 'unlinked' limit 1`, [e.org_id, e.table, e.id]);
  if (!hasRefs) return;
  await cfg.db.tx((tx) => enqueue(tx, { kind: "integration.issue.comment", orgId: e.org_id, payload: { table: e.table, id: e.id, entry: e.entry!.id }, maxAttempts: 5 }));
}

async function pushComment(cfg: ServerConfig, orgId: string, p: { table: string; id: string; entry: string }): Promise<void> {
  if (await demoQuiet(cfg.db, orgId, p.id)) return;
  const sys = await systemCtx(cfg, orgId);
  const refs = await liveRows(cfg.db, sys, "external_ref", { and: [{ f: "table_key", op: "eq", v: p.table }, { f: "record_id", op: "eq", v: p.id }, { f: "sync_state", op: "ne", v: "unlinked" }] });
  for (const ref of refs) {
    const c = await connection(cfg, sys, String(ref.connection_id));
    const mode = String(c.row.sync_comments ?? "none");
    if (mode === "none" || c.row.active === false) continue;
    // read the note as the integration user: an internal note it may not read never leaves
    const { ctx } = await principalCtx(cfg, orgId, c.row.principal_id ? String(c.row.principal_id) : null);
    const j = await listJournal(ctx, p.table, p.id, { limit: 100 }).catch(() => null);
    const entry = j?.entries.find((x) => x.id === p.entry);
    if (!entry || (entry.data as Record<string, unknown> | null)?.origin === "issue_sync") continue;
    if (mode === "public" && entry.visibility !== "public") continue;
    const author = j!.display[entry.author ?? ""] ?? "";
    const body = `${author ? `${author}: ` : ""}${entry.body}\n\n${ECHO_MARK}`;
    const key = String(ref.remote_key);
    const r = c.kind === "github" ? await call(cfg, c, "POST", `/repos/${c.row.repo}/issues/${key.replace(/^#/, "")}/comments`, { body }) : await call(cfg, c, "POST", `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { body: adfDoc(body) });
    if (!r.ok) throw new Error(failText(label(c), r));
  }
}

let installed = false;
export function installIssueSync(): void {
  if (installed) return;
  installed = true;
  onRecordEvent("integration.issues", (e, jctx) => onComment(e, jctx.cfg as ServerConfig), { kinds: ["record.commented"] });
  registerJobHandler("integration.issue.comment", async (job, jctx) => {
    if (!job.org_id) return;
    await pushComment(jctx.cfg as ServerConfig, job.org_id, job.payload as { table: string; id: string; entry: string });
  });
}
