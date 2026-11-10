// API key scopes (catalogue INT-001/003/004): a key of an integration user names the tables it may use and, per table,
// the operations — read, create, update (also transitions, notes, links, watchers, attachments) and delete. The key
// never reaches past its integration user's own access: the engine's provider judges every call with that member's
// roles, and the scopes only narrow it further. `"*"` names every table the user may use.
// Imported by the UI: keep it free of server imports.

export type ApiOp = "read" | "create" | "update" | "delete";
export const API_OPS: ApiOp[] = ["read", "create", "update", "delete"];
export const API_OP_LABELS: Record<ApiOp, string> = { read: "خواندن", create: "ثبت", update: "تغییر", delete: "حذف" };

export interface TableScope {
  /** a table key, or "*" for every table */
  table: string;
  ops: ApiOp[];
}

/** Clean scopes from input: known operations, each table once, at most 200 entries. */
export function cleanScopes(raw: unknown): TableScope[] {
  if (!Array.isArray(raw)) return [];
  const out = new Map<string, Set<ApiOp>>();
  for (const s of raw.slice(0, 200)) {
    if (!s || typeof s !== "object") continue;
    const table = String((s as TableScope).table ?? "").trim();
    if (table !== "*" && !/^[a-z][a-z0-9_]{0,62}$/.test(table)) continue;
    const ops = Array.isArray((s as TableScope).ops) ? (s as TableScope).ops.filter((o): o is ApiOp => (API_OPS as string[]).includes(o)) : [];
    if (!ops.length) continue;
    const set = out.get(table) ?? new Set<ApiOp>();
    for (const o of ops) set.add(o);
    out.set(table, set);
  }
  return [...out].map(([table, ops]) => ({ table, ops: API_OPS.filter((o) => ops.has(o)) }));
}

/** May a key with these scopes do `op` on `table`? (A table's own entry wins over "*".) */
export function scopeAllows(scopes: TableScope[], table: string, op: ApiOp): boolean {
  const own = scopes.find((s) => s.table === table);
  if (own) return own.ops.includes(op);
  const any = scopes.find((s) => s.table === "*");
  return !!any?.ops.includes(op);
}

/** The operations a key may do on a table (empty: the table is outside the key). */
export function scopeOps(scopes: TableScope[], table: string): ApiOp[] {
  return API_OPS.filter((o) => scopeAllows(scopes, table, o));
}

/**
 * The table and operation of a record-API request (`/r/:table…`), null for paths outside the record API. `also`
 * names further operations the request needs: an import with a match key updates the rows it finds.
 */
export function requestScope(method: string, path: string, body?: unknown): { table: string; op: ApiOp; also?: ApiOp[] } | null {
  const m = path.match(/^\/r\/([a-z][a-z0-9_]{0,62})(?:\/([^/]+))?(?:\/([a-z_]+))?(?:\/[^/]+)?\/?$/);
  if (!m) return null;
  const [, table, second, third] = m;
  const M = method.toUpperCase();
  if (M === "GET" || M === "HEAD") return { table, op: "read" };
  if (!second) return { table, op: M === "POST" ? "create" : "update" };
  if (second === "query" || second === "agg" || second === "export") return { table, op: "read" };
  if (second === "import") {
    const b = (body ?? {}) as { key?: unknown };
    return b.key ? { table, op: "create", also: ["update"] } : { table, op: "create" };
  }
  if (second === "bulk") {
    const b = (body ?? {}) as { delete?: unknown };
    return { table, op: b.delete ? "delete" : "update" };
  }
  if (!third) return { table, op: M === "DELETE" ? "delete" : "update" };
  return { table, op: "update" };
}

/** A short Persian sentence of what a key may do («خواندن و ثبت رخدادها؛ خواندن همهٔ جدول‌ها»). */
export function scopeSummary(scopes: TableScope[], label: (table: string) => string): string {
  if (!scopes.length) return "هیچ";
  return scopes.map((s) => `${s.ops.map((o) => API_OP_LABELS[o]).join("، ")} ${s.table === "*" ? "همهٔ جدول‌ها" : `«${label(s.table)}»`}`).join("؛ ");
}

/** Does an IP address match an allow-list entry (an address or an IPv4 CIDR)? */
export function ipAllowed(ip: string | null | undefined, list: string[] | null | undefined): boolean {
  if (!list || !list.length) return true;
  if (!ip) return false;
  const addr = ip.replace(/^::ffff:/, "").trim();
  for (const entry of list) {
    const e = entry.trim();
    if (!e) continue;
    if (!e.includes("/")) {
      if (e === addr) return true;
      continue;
    }
    const [net, bitsRaw] = e.split("/");
    const bits = Number(bitsRaw);
    const a = ipv4(addr);
    const n = ipv4(net);
    if (a === null || n === null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((a & mask) >>> 0 === (n & mask) >>> 0) return true;
  }
  return false;
}

function ipv4(s: string): number | null {
  const p = s.split(".");
  if (p.length !== 4) return null;
  let n = 0;
  for (const x of p) {
    const v = Number(x);
    if (!/^\d{1,3}$/.test(x) || v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}
