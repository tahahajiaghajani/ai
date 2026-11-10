// Logical backups of one organisation (catalogue ADM-022, ADM-023), made by the platform owner from «پشتیبان‌گیری»:
// every record table of the registry, the notes, history, links and attachments of the records (with the files), the
// organisation and its members — as gzip JSON with its SHA-256, kept on the runtime that made it. A backup restores
// into a NEW organisation (a sandbox to inspect or recover from): every id is remapped, references follow, sealed
// secrets are left out (they are bound to the original records), and only the platform owner who restores is a member.
// Reading the tables here is the platform's own act on a whole organisation (not a member's read) and goes around the
// access provider on purpose; nothing of it is ever returned to a member.
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { AuthUser, ServerConfig } from "../../context";
import type { Queryable, Tx } from "../../db";
import { lockOrg } from "../../context";
import { uuidv7 } from "@shared/id";
import { APP_VERSION } from "@shared/constants";
import { physicalTables } from "@shared/tables";
import { FIELD_TYPES } from "@shared/model/types";
import { bad, conflict, notFound } from "../../http/errors";
import { enqueue, registerJobHandler, PermanentJobError } from "../../jobs";
import { platformAudit } from "../platform/audit";
import { securityEvent } from "../platform/security";

/** The largest backup kept (compressed JSON); larger organisations use the database's own backups. */
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
/** Backups kept per organisation (older ones are removed when a new one finishes). */
export const KEEP_BACKUPS = 10;

const SIDE_TABLES = ["sm_journal", "sm_history", "sm_links", "sm_attachments"] as const;

export interface BackupFile {
  format: "itsm-backup";
  version: 1;
  app_version: string;
  created_at: string;
  org: Record<string, unknown>;
  members: Record<string, unknown>[];
  tables: Record<string, Record<string, unknown>[]>;
  side: Record<string, Record<string, unknown>[]>;
  blobs: { sha256: string; size: number; data: string }[];
}

export interface BackupRow {
  id: string;
  org_id: string;
  org_name: string | null;
  kind: string;
  status: string;
  tables: number;
  rows: number;
  bytes: number;
  sha256: string | null;
  note: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export async function listBackups(q: Queryable, orgId?: string | null): Promise<BackupRow[]> {
  return q.query<BackupRow>(
    `select b.id, b.org_id, o.name as org_name, b.kind, b.status, b.tables, b.rows, b.bytes::bigint::float8 as bytes, b.sha256, b.note, b.error, b.created_at, b.finished_at
     from sm_backups b left join sm_orgs o on o.id = b.org_id ${orgId ? "where b.org_id = $1" : ""} order by b.created_at desc limit 300`,
    orgId ? [orgId] : [],
  );
}

export async function createBackup(cfg: ServerConfig, admin: AuthUser, orgId: string, note: string | null): Promise<BackupRow> {
  const org = await cfg.db.one<{ name: string }>(`select name from sm_orgs where id = $1 and deleted_at is null`, [orgId]);
  if (!org) throw notFound("سازمان پیدا نشد");
  const running = await cfg.db.one(`select 1 from sm_backups where org_id = $1 and status in ('queued', 'running')`, [orgId]);
  if (running) throw conflict("پشتیبان دیگری از این سازمان در حال ساخت است");
  const id = uuidv7();
  await cfg.db.tx(async (tx) => {
    await tx.query(`insert into sm_backups (id, org_id, kind, status, note, created_by) values ($1, $2, 'manual', 'queued', $3, $4)`, [id, orgId, note, admin.id]);
    await enqueue(tx, { kind: "admin.backup", orgId, payload: { id }, maxAttempts: 2 });
    await platformAudit(tx, cfg, admin, { org_id: orgId, action: "backup_create", entity: "backup", entity_id: id, summary: `پشتیبان‌گیری از «${org.name}»` });
  });
  return (await listBackups(cfg.db, orgId)).find((b) => b.id === id)!;
}

const plain = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : Buffer.isBuffer(v) || v instanceof Uint8Array ? Buffer.from(v as Uint8Array).toString("base64") : v);
const plainRow = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)]));

/** Build the backup file of an organisation. */
export async function buildBackup(q: Queryable, orgId: string): Promise<BackupFile> {
  const org = await q.one<Record<string, unknown>>(`select * from sm_orgs where id = $1`, [orgId]);
  if (!org) throw notFound("سازمان پیدا نشد");
  const members = await q.query<Record<string, unknown>>(
    `select m.user_id, m.role, m.title, m.is_active, u.email, u.full_name from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1 and m.deleted_at is null`,
    [orgId],
  );
  const tables: BackupFile["tables"] = {};
  for (const def of physicalTables()) {
    const rows = await q.query<Record<string, unknown>>(`select * from ${def.table} where org_id = $1 and deleted_at is null`, [orgId]);
    if (rows.length) tables[def.key] = rows.map(plainRow);
  }
  const side: BackupFile["side"] = {};
  for (const t of SIDE_TABLES) side[t] = (await q.query<Record<string, unknown>>(`select * from ${t} where org_id = $1 and deleted_at is null`, [orgId])).map(plainRow);
  const blobs = (await q.query<{ sha256: string; size: string | number; data: Uint8Array }>(
    `select b.sha256, b.size, b.data from sm_blobs b where b.org_id = $1 and exists (select 1 from sm_attachments a where a.org_id = b.org_id and a.sha256 = b.sha256 and a.deleted_at is null)`,
    [orgId],
  )).map((b) => ({ sha256: b.sha256, size: Number(b.size), data: Buffer.from(b.data).toString("base64") }));
  return { format: "itsm-backup", version: 1, app_version: APP_VERSION, created_at: new Date().toISOString(), org: plainRow(org), members: members.map(plainRow), tables, side, blobs };
}

async function runBackup(cfg: ServerConfig, id: string): Promise<void> {
  const b = await cfg.db.one<{ org_id: string; status: string }>(`select org_id, status from sm_backups where id = $1`, [id]);
  if (!b || b.status === "done") return;
  await cfg.db.query(`update sm_backups set status = 'running' where id = $1`, [id]);
  try {
    const file = await buildBackup(cfg.db, b.org_id);
    const json = Buffer.from(JSON.stringify(file), "utf8");
    const gz = gzipSync(json, { level: 6 });
    if (gz.length > MAX_BACKUP_BYTES) throw new PermanentJobError("حجم پشتیبان از سقف پشتیبان منطقی بیشتر است؛ از پشتیبان پایگاه داده استفاده کنید");
    const rows = Object.values(file.tables).reduce((a, r) => a + r.length, 0);
    await cfg.db.query(
      `update sm_backups set status = 'done', content = decode($2, 'base64'), bytes = $3, sha256 = $4, tables = $5, rows = $6, finished_at = now(), error = null where id = $1`,
      [id, gz.toString("base64"), gz.length, createHash("sha256").update(gz).digest("hex"), Object.keys(file.tables).length, rows],
    );
    // keep the newest ones
    await cfg.db.query(
      `delete from sm_backups where org_id = $1 and status = 'done' and id not in (select id from sm_backups where org_id = $1 and status = 'done' order by created_at desc limit ${KEEP_BACKUPS})`,
      [b.org_id],
    );
  } catch (e) {
    await cfg.db.query(`update sm_backups set status = 'failed', error = $2, finished_at = now() where id = $1`, [id, String((e as Error).message ?? e).slice(0, 1000)]);
    throw e;
  }
}

export async function backupContent(q: Queryable, id: string): Promise<{ data: Uint8Array; name: string; sha256: string; org_id: string }> {
  const b = await q.one<{ content: Uint8Array | null; sha256: string | null; org_id: string; created_at: string | Date; org_name: string | null }>(
    `select b.content, b.sha256, b.org_id, b.created_at, o.name as org_name from sm_backups b left join sm_orgs o on o.id = b.org_id where b.id = $1 and b.status = 'done'`,
    [id],
  );
  if (!b?.content) throw notFound("پشتیبان آماده‌ای با این شناسه نیست");
  const day = new Date(b.created_at).toISOString().slice(0, 10);
  return { data: new Uint8Array(b.content), name: `backup-${b.org_id.slice(0, 8)}-${day}.json.gz`, sha256: b.sha256 ?? "", org_id: b.org_id };
}

/**
 * A platform administrator takes a backup's file (the whole organisation: its records, journals and attachments, HR
 * and security included): every download is recorded in the platform's audit (the organisation's audit view shows
 * it) and in the organisation's security log — who, when, from where.
 */
export async function downloadBackup(cfg: ServerConfig, admin: AuthUser, id: string, meta: { ip?: string | null; user_agent?: string | null } = {}): Promise<{ data: Uint8Array; name: string; sha256: string; org_id: string }> {
  const f = await backupContent(cfg.db, id);
  await platformAudit(cfg.db, cfg, admin, { org_id: f.org_id, action: "backup_download", entity: "backup", entity_id: id, summary: "دریافت فایل پشتیبان", data: { ip: meta.ip ?? null } });
  await securityEvent(cfg.db, { kind: "backup_download", org_id: f.org_id, user_id: admin.id, email: admin.email, ip: meta.ip ?? null, user_agent: meta.user_agent ?? null, data: { backup: id, by_name: admin.full_name ?? null } });
  return f;
}

/** «بررسی پشتیبان» by a platform administrator: it reads the whole file, so it is recorded like a download. */
export async function verifyBackupAs(cfg: ServerConfig, admin: AuthUser, id: string, meta: { ip?: string | null; user_agent?: string | null } = {}) {
  const r = await verifyBackup(cfg.db, id);
  const b = await cfg.db.one<{ org_id: string }>(`select org_id from sm_backups where id = $1`, [id]);
  await platformAudit(cfg.db, cfg, admin, { org_id: b?.org_id ?? null, action: "backup_verify", entity: "backup", entity_id: id, summary: r.ok ? "بررسی فایل پشتیبان: سالم" : "بررسی فایل پشتیبان: ناسالم", data: { ip: meta.ip ?? null } });
  await securityEvent(cfg.db, { kind: "backup_verify", org_id: b?.org_id ?? null, user_id: admin.id, email: admin.email, ip: meta.ip ?? null, user_agent: meta.user_agent ?? null, data: { backup: id, ok: r.ok } });
  return r;
}

/** Check a stored backup: its hash and that it reads as a backup file. */
export async function verifyBackup(q: Queryable, id: string): Promise<{ ok: boolean; sha256: boolean; tables: number; rows: number; message: string }> {
  const { data, sha256 } = await backupContent(q, id);
  const hashOk = createHash("sha256").update(data).digest("hex") === sha256;
  try {
    const file = JSON.parse(gunzipSync(data).toString("utf8")) as BackupFile;
    const ok = file.format === "itsm-backup" && hashOk;
    const rows = Object.values(file.tables ?? {}).reduce((a, r) => a + r.length, 0);
    return { ok, sha256: hashOk, tables: Object.keys(file.tables ?? {}).length, rows, message: ok ? "پشتیبان سالم است" : "چکیدهٔ پشتیبان با محتوا نمی‌خواند" };
  } catch {
    return { ok: false, sha256: hashOk, tables: 0, rows: 0, message: "محتوای پشتیبان خوانده نشد" };
  }
}

export async function deleteBackup(cfg: ServerConfig, admin: AuthUser, id: string): Promise<void> {
  const r = await cfg.db.one<{ org_id: string }>(`delete from sm_backups where id = $1 and status in ('done', 'failed') returning org_id`, [id]);
  if (!r) throw notFound("پشتیبان پیدا نشد یا هنوز در حال ساخت است");
  await platformAudit(cfg.db, cfg, admin, { org_id: r.org_id, action: "backup_delete", entity: "backup", entity_id: id, summary: "حذف پشتیبان" });
}

// ---------------------------------------------------------------- restore into a new organisation

interface Column {
  name: string;
  type: string;
  generated: boolean;
}

async function columnsOf(q: Queryable, table: string): Promise<Column[]> {
  const rows = await q.query<{ column_name: string; data_type: string; udt_name: string; is_generated: string }>(
    `select column_name, data_type, udt_name, is_generated from information_schema.columns where table_schema = current_schema() and table_name = $1`,
    [table],
  );
  return rows.map((r) => ({ name: r.column_name, type: r.data_type === "ARRAY" ? `${r.udt_name.replace(/^_/, "")}[]` : r.udt_name, generated: r.is_generated === "ALWAYS" }));
}

function cast(col: Column, v: unknown): { sql: string; value: unknown } {
  if (v === null || v === undefined) return { sql: "null", value: undefined };
  if (col.type === "jsonb" || col.type === "json") return { sql: "::jsonb", value: JSON.stringify(v) };
  if (col.type.endsWith("[]")) return { sql: `::${col.type}`, value: `{${(Array.isArray(v) ? v : []).map((x) => `"${String(x).replace(/(["\\])/g, "\\$1")}"`).join(",")}}` };
  if (col.type === "bytea") return { sql: "decode", value: String(v) };
  return { sql: "", value: v };
}

async function insertRows(tx: Tx, table: string, cols: Column[], rows: Record<string, unknown>[]): Promise<void> {
  const usable = cols.filter((c) => !c.generated && c.name !== "rev");
  for (const r of rows) {
    const names: string[] = [];
    const exprs: string[] = [];
    const params: unknown[] = [];
    for (const c of usable) {
      if (!(c.name in r)) continue;
      const { sql, value } = cast(c, r[c.name]);
      names.push(c.name);
      if (sql === "null") exprs.push("null");
      else if (sql === "decode") {
        params.push(value);
        exprs.push(`decode($${params.length}, 'base64')`);
      } else {
        params.push(value);
        exprs.push(`$${params.length}${sql}`);
      }
    }
    await tx.query(`insert into ${table} (${names.join(", ")}) values (${exprs.join(", ")})`, params);
  }
}

/** Restore a backup into a new organisation owned by the restoring platform owner. Returns the new organisation. */
export async function restoreBackup(cfg: ServerConfig, admin: AuthUser, id: string): Promise<{ org_id: string; name: string; rows: number; secrets_dropped: number }> {
  const { data } = await backupContent(cfg.db, id);
  const file = JSON.parse(gunzipSync(data).toString("utf8")) as BackupFile;
  if (file.format !== "itsm-backup" || file.version !== 1) throw bad("این فایل پشتیبان شناخته نیست");
  const newOrg = uuidv7();
  const map = new Map<string, string>();
  const remap = (v: unknown) => (typeof v === "string" && map.has(v.toLowerCase()) ? map.get(v.toLowerCase())! : v);
  for (const rows of Object.values(file.tables)) for (const r of rows) map.set(String(r.id).toLowerCase(), uuidv7());
  for (const rows of Object.values(file.side)) for (const r of rows) if (r.id) map.set(String(r.id).toLowerCase(), uuidv7());
  const name = `${String(file.org.name ?? "سازمان")} (بازیابی ${new Date().toISOString().slice(0, 10)})`.slice(0, 160);
  let secrets = 0;
  let count = 0;
  await cfg.db.tx(async (tx) => {
    await lockOrg(tx, newOrg);
    await tx.query(
      `insert into sm_orgs (id, name, legal_name, modules, settings, created_by, origin) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
      [newOrg, name, file.org.legal_name ?? null, JSON.stringify(file.org.modules ?? []), JSON.stringify(file.org.settings ?? {}), admin.id, cfg.origin],
    );
    await tx.query(`insert into sm_org_members (id, org_id, user_id, role, origin) values ($1, $2, $3, 'owner', $4)`, [uuidv7(), newOrg, admin.id, cfg.origin]);
    for (const def of physicalTables()) {
      const rows = file.tables[def.key];
      if (!rows?.length) continue;
      const cols = await columnsOf(tx, def.table);
      const refFields = def.fields.filter((f) => FIELD_TYPES[f.type]?.family === "ref" && f.type !== "user" && f.type !== "users");
      const secretFields = def.fields.filter((f) => f.type === "secret");
      const out = rows.map((r) => {
        const x: Record<string, unknown> = { ...r, id: remap(r.id), org_id: newOrg };
        for (const base of ["workspace_id", "domain_id", "unit_id"]) if (base in x) x[base] = remap(x[base]);
        for (const f of refFields) {
          const v = x[f.name];
          x[f.name] = Array.isArray(v) ? v.map(remap) : remap(v);
        }
        for (const f of secretFields) {
          if (x[f.name] !== null && x[f.name] !== undefined) secrets++;
          x[f.name] = null;
        }
        return x;
      });
      await insertRows(tx, def.table, cols, out);
      count += out.length;
      const max = Math.max(0, ...rows.map((r) => Number(r.no ?? 0)).filter(Number.isFinite));
      if (def.numbered && max > 0) await tx.query(`insert into sm_numbers (org_id, table_key, last) values ($1, $2, $3) on conflict (org_id, table_key) do update set last = greatest(sm_numbers.last, excluded.last)`, [newOrg, def.key, max]);
    }
    for (const t of SIDE_TABLES) {
      const rows = file.side[t] ?? [];
      if (!rows.length) continue;
      const cols = await columnsOf(tx, t);
      const out = rows
        .map((r) => {
          const x: Record<string, unknown> = { ...r, id: remap(r.id), org_id: newOrg };
          if ("record_id" in x) x.record_id = remap(x.record_id);
          if ("from_id" in x) x.from_id = remap(x.from_id);
          if ("to_id" in x) x.to_id = remap(x.to_id);
          return x;
        })
        // side rows whose record was not in the backup are left out
        .filter((x) => !("record_id" in x) || (typeof x.record_id === "string" && [...map.values()].includes(x.record_id)) || t === "sm_links");
      await insertRows(tx, t, cols, out);
    }
    for (const b of file.blobs ?? []) {
      await tx.query(`insert into sm_blobs (org_id, sha256, size, data) values ($1, $2, $3, decode($4, 'base64')) on conflict do nothing`, [newOrg, b.sha256, b.size, b.data]);
    }
    await platformAudit(tx, cfg, admin, { org_id: newOrg, action: "backup_restore", entity: "backup", entity_id: id, summary: `بازیابی پشتیبان در سازمان تازهٔ «${name}»`, data: { source_org: file.org.id, rows: count } });
  });
  return { org_id: newOrg, name, rows: count, secrets_dropped: secrets };
}

let installed = false;
export function installBackupJobs(): void {
  if (installed) return;
  installed = true;
  registerJobHandler("admin.backup", async (job, jctx) => {
    await runBackup(jctx.cfg as ServerConfig, String(job.payload.id));
  });
}
