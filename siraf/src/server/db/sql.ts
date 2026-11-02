// Small helpers for building INSERT/UPDATE statements from plain objects.
// Table and column names always come from code (entity definitions), never from requests;
// they are still checked against an identifier pattern.
import type { Queryable, Row } from "./index";

const IDENT = /^[a-z_][a-z0-9_]*$/;

export function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`invalid identifier: ${name}`);
  return name;
}

export async function insertRow<T = Row>(q: Queryable, table: string, row: Record<string, unknown>, returning = "*"): Promise<T> {
  const cols = Object.keys(row).filter((k) => row[k] !== undefined);
  const sql = `insert into ${ident(table)} (${cols.map(ident).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning ${returning}`;
  const r = await q.one<T>(sql, cols.map((c) => row[c]));
  return r as T;
}

export async function insertMany(q: Queryable, table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r).filter((k) => r[k] !== undefined))));
  // chunk to stay well below the 65535 parameter limit
  const per = Math.max(1, Math.floor(30000 / Math.max(1, cols.length)));
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const params: unknown[] = [];
    const values = chunk.map((r) => `(${cols.map((c) => {
      if (r[c] === undefined) return "default";
      params.push(r[c]);
      return `$${params.length}`;
    }).join(", ")})`);
    await q.query(`insert into ${ident(table)} (${cols.map(ident).join(", ")}) values ${values.join(", ")}`, params);
  }
}

export async function updateRow<T = Row>(
  q: Queryable,
  table: string,
  where: { id: string; org_id?: string },
  patch: Record<string, unknown>,
  returning = "*",
): Promise<T | null> {
  const cols = Object.keys(patch).filter((k) => patch[k] !== undefined && k !== "id" && k !== "org_id");
  if (!cols.length) {
    const r = await q.one<T>(`select ${returning} from ${ident(table)} where id = $1${where.org_id ? " and org_id = $2" : ""}`, where.org_id ? [where.id, where.org_id] : [where.id]);
    return r;
  }
  const params: unknown[] = cols.map((c) => patch[c]);
  params.push(where.id);
  let cond = `id = $${params.length}`;
  if (where.org_id) {
    params.push(where.org_id);
    cond += ` and org_id = $${params.length}`;
  }
  const sql = `update ${ident(table)} set ${cols.map((c, i) => `${ident(c)} = $${i + 1}`).join(", ")} where ${cond} returning ${returning}`;
  return q.one<T>(sql, params);
}

/** Next document number in a series: max(no) + 1 (callers hold the organisation lock). */
export async function nextNo(q: Queryable, table: string, orgId: string, fiscalYearId: string, kind?: string): Promise<number> {
  const params: unknown[] = [orgId, fiscalYearId];
  let cond = "org_id = $1 and fiscal_year_id = $2 and deleted_at is null";
  if (kind) {
    params.push(kind);
    cond += " and kind = $3";
  }
  const r = await q.one<{ n: number }>(`select coalesce(max(no), 0) + 1 as n from ${ident(table)} where ${cond}`, params);
  return Number(r?.n ?? 1);
}

/** Next numeric code (e.g. parties 1001, 1002 …) among codes that are plain numbers. */
export async function nextCode(q: Queryable, table: string, orgId: string, start: number, column = "code"): Promise<string> {
  const col = ident(column);
  const r = await q.one<{ n: string | null }>(
    `select max(${col}::numeric) as n from ${ident(table)}
     where org_id = $1 and deleted_at is null and ${col} ~ '^[0-9]{1,15}$'`,
    [orgId],
  );
  const n = r?.n ? Number(r.n) + 1 : start;
  return String(Math.max(n, start));
}
