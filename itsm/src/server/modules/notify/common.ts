// Small pieces every part of the notification service uses: which runtime delivers, reading engine tables as the
// system (through the access provider's predicate, never around it), the organisation's time zone and record links.
import type { TableDef } from "@shared/model/types";
import { tableDef } from "@shared/tables";
import { DEFAULT_TIMEZONE } from "@shared/constants";
import type { Ctx, OrgRow, ServerConfig } from "../../context";
import type { Queryable } from "../../db";
import type { JobConfig } from "../../jobs";
import { condEnv, readable, fromDb, systemCtx } from "../../engine";
import { cloudLink } from "../ai/relay";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

/**
 * Does this runtime deliver notifications and read mailboxes? The web version always; a Windows app only while it
 * is not linked to a web version — a linked one pushes its changes and the web version notifies (once) when it
 * applies them, and its people get their inbox items with the next pull.
 */
export function actsHere(cfg: Partial<ServerConfig>): boolean {
  if (cfg.mode !== "desktop") return true;
  return !cloudLink(cfg as ServerConfig);
}

/** The full server configuration a job runs with (ticks get it from the app). */
export const fullCfg = (cfg: JobConfig): ServerConfig => cfg as ServerConfig;

/** The organisation's time zone. */
export function tzOf(org: Pick<OrgRow, "settings"> | null | undefined): string {
  const tz = org?.settings?.timezone;
  return typeof tz === "string" && tz ? tz : DEFAULT_TIMEZONE;
}

export function defOf(key: string): TableDef {
  const def = tableDef(key);
  if (!def) throw new Error(`table ${key} is not registered`);
  return def;
}

/**
 * Rows of an engine table read by the system (rules, channels, group members…): the access provider's predicate for
 * the system context (tenant isolation) and live rows only, plus the caller's own conditions.
 */
export async function systemRows<T = Record<string, any>>(sys: Ctx, key: string, where = "true", params: unknown[] = [], tail = "", q: Queryable = sys.db): Promise<T[]> {
  const def = defOf(key);
  const env = await condEnv(sys);
  const all = [...params];
  const pred = readable(sys, def, "t", all, env);
  const rows = await q.query<Record<string, any>>(`select t.* from ${def.table} t where ${pred} and (${where}) ${tail}`, all);
  return rows.map((r) => fromDb(def, r) as T);
}

const sysCache = new WeakMap<object, Map<string, { at: number; ctx: Promise<Ctx> }>>();

/** A system context of the organisation, reused for a few seconds within a process (jobs create many). */
export function sysCtx(cfg: JobConfig, orgId: string): Promise<Ctx> {
  let m = sysCache.get(cfg.db);
  if (!m) sysCache.set(cfg.db, (m = new Map()));
  const hit = m.get(orgId);
  if (hit && Date.now() - hit.at < 5_000) return hit.ctx;
  const ctx = systemCtx(cfg, orgId);
  m.set(orgId, { at: Date.now(), ctx });
  ctx.catch(() => m!.delete(orgId));
  return ctx;
}

/** The org-relative path of a record in the app (the UI maps it to the module's own page). */
export const recordAppPath = (table: string, id: string) => `r/${table}/${id}`;

/** An absolute link to a record when the web version's address is known (PUBLIC_URL), else the app path. */
export function recordUrl(cfg: Partial<ServerConfig>, orgId: string, table: string, id: string): string {
  const base = (cfg.publicUrl ?? "").replace(/\/+$/, "");
  const path = `/${orgId}/${recordAppPath(table, id)}`;
  return base ? `${base}${path}` : path;
}

export const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 1000);
