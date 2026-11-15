// Helpers of the security module: the shared reads of the incident module (live rows through the access rule, a
// system context derived from a request), the module's settings with their defaults, the secure workspace «امنیت»
// every security-operations record lives in, and small date helpers. Every read of engine tables goes through
// `readable`, so the helpers are safe with a member's context too.
import { SECURITY_CONFIG_DEFAULTS, type SecurityConfig } from "@shared/tables/security";
import { grantIn } from "@shared/access/model";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { createIn, orgSchema, orgTz, updateIn } from "../../engine";
import { subjectOf } from "../../access";
import { access } from "../../access/provider";
import { defFor } from "../../engine";
import { countRows, eqAll, isUuid, liveRow, liveRows, lockedRow, sysOf, type Row } from "../incident/common";

export { countRows, eqAll, isUuid, liveRow, liveRows, lockedRow, sysOf, type Row };

/** The organisation's security settings (its row, else the defaults), with the row's id and seed marker. */
export async function securityConfig(q: Queryable, ctx: Ctx): Promise<SecurityConfig & { id: string | null; seeded: number }> {
  const [row] = await liveRows(q, sysOf(ctx), "sec_config", null, { order: "t.created_at", limit: 1 });
  const out = { ...SECURITY_CONFIG_DEFAULTS } as Record<string, unknown>;
  if (row) for (const k of Object.keys(SECURITY_CONFIG_DEFAULTS)) if (row[k] !== null && row[k] !== undefined) out[k] = row[k];
  return { ...(out as SecurityConfig), id: row?.id ?? null, seeded: Number(row?.seeded ?? 0) };
}

/** The settings row, created when missing (inside a write). */
export async function ensureConfigRow(tx: Tx, ctx: Ctx): Promise<Row> {
  const sys = sysOf(ctx);
  const [row] = await liveRows(tx, sys, "sec_config", null, { order: "t.created_at", limit: 1 });
  return row ?? createIn(tx, sys, "sec_config", { config_key: "default", name: "تنظیمات امنیت" }, { trusted: true });
}

export const SECURE_WORKSPACE_KEY = "security";

/**
 * The secure workspace «امنیت» (members only; tenant administrators and support sessions stay outside unless they are
 * members): the settings' choice, else the workspace keyed «security», created when missing.
 */
export async function secureWorkspace(tx: Tx, ctx: Ctx): Promise<string> {
  const sys = sysOf(ctx);
  const cfg = await securityConfig(tx, sys);
  if (cfg.secure_workspace_id) {
    const ws = await liveRow(tx, sys, "workspace", cfg.secure_workspace_id);
    if (ws) return ws.id;
  }
  let [ws] = await liveRows(tx, sys, "workspace", eqAll({ key: SECURE_WORKSPACE_KEY }), { limit: 1 });
  if (!ws) {
    ws = await createIn(tx, sys, "workspace", { key: SECURE_WORKSPACE_KEY, name: "امنیت", secure: true, icon: "shield", color: "red", description: "رخدادهای امنیتی، شواهد و نشانگرها؛ فقط اعضای این فضا آن‌ها را می‌بینند" }, { trusted: true });
  } else if (!ws.secure) {
    ws = await updateIn(tx, sys, "workspace", ws.id, { secure: true }, { trusted: true });
  }
  const row = await ensureConfigRow(tx, sys);
  if (row.secure_workspace_id !== ws.id) await updateIn(tx, sys, "sec_config", row.id, { secure_workspace_id: ws.id }, { trusted: true, keepVersion: true });
  return ws.id;
}

/** Is the member in the workspace (explicitly or through one of their groups)? The system always is. */
export function inWorkspace(ctx: Ctx, workspaceId: string): boolean {
  if (ctx.actor === "system") return true;
  return subjectOf(ctx).workspaces.includes(workspaceId);
}

/** May the caller read anything of the area (their roles' read scope is not «none»)? */
export async function readsArea(ctx: Ctx, area: string): Promise<boolean> {
  if (ctx.actor === "system") return true;
  await orgSchema(ctx);
  return grantIn(subjectOf(ctx).eff, area).read !== "none";
}

/** May the caller read the table at all (area grant)? */
export async function readsTable(ctx: Ctx, table: string): Promise<boolean> {
  const { def } = await defFor(ctx, table);
  return access().canReadTable(ctx, def);
}

/** The area's approve flag or full write («مدیر» of the area): definitions, decisions, settings. */
export async function managesArea(ctx: Ctx, area: string): Promise<boolean> {
  if (ctx.actor === "system") return true;
  await orgSchema(ctx);
  const g = grantIn(subjectOf(ctx).eff, area);
  return !!g.approve || g.write === "all";
}

/** The caller's read scope in an area (the subject loaded first). */
export async function readScope(ctx: Ctx, area: string): Promise<string> {
  if (ctx.actor === "system") return "all";
  await orgSchema(ctx);
  return grantIn(subjectOf(ctx).eff, area).read;
}

/** Today in the organisation's time zone (YYYY-MM-DD). */
export function todayOf(ctx: Ctx, at = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: orgTz(ctx), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

/** A date `days` after `date` (YYYY-MM-DD). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A date `months` after `date` (YYYY-MM-DD; the day clamped to the month). */
export function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** Unique non-empty ids of a refs/users value. */
export const ids = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : []).filter(isUuid).map((x) => String(x).toLowerCase()))];

/** The open states of a table's state model (categories new, active, waiting). */
export function openStates(def: { states?: { states: { value: string; category: string }[] } }): string[] {
  return (def.states?.states ?? []).filter((s) => s.category === "new" || s.category === "active" || s.category === "waiting").map((s) => s.value);
}
