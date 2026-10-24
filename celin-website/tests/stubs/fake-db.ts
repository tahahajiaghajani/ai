/**
 * A tiny in-memory stand-in for the Supabase client: enough of the query builder (select / insert / update /
 * delete with eq, is, in, or(role.eq.x), order, limit, maybeSingle, single, select-after-write) and rpc for
 * the server code under test. Unknown columns in a write fail like PostgREST (PGRST204) when the table
 * declares its columns, so "before the migration" paths can be tested too.
 */
type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export class FakeDb {
  tables: Record<string, Row[]> = {};
  columns: Record<string, string[]> = {};
  rpcs: Record<string, (args: Record<string, unknown>) => { data: unknown; error: { message: string; code?: string } | null }> = {};
  calls: { table: string; op: string; values?: Row }[] = [];
  /** objects removed from storage (bucket/path) */
  removed: string[] = [];
  storage = {
    from: (bucket: string) => ({
      remove: async (paths: string[]) => {
        this.removed.push(...paths.map((p) => `${bucket}/${p}`));
        return { data: [], error: null };
      },
    }),
  };

  table(name: string): Row[] {
    return (this.tables[name] ??= []);
  }

  from(name: string) {
    return new Query(this, name);
  }

  rpc(name: string, args: Record<string, unknown> = {}) {
    const fn = this.rpcs[name];
    return Promise.resolve(fn ? fn(args) : { data: null, error: { message: `Could not find the function public.${name}`, code: "PGRST202" } });
  }
}

class Query implements PromiseLike<{ data: unknown; error: { message: string; code?: string } | null; count?: number }> {
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private values: Row | Row[] | null = null;
  private filters: Filter[] = [];
  private cols = "*";
  private returning = false;
  private one: "single" | "maybe" | null = null;
  private limitN: number | null = null;
  private orderBy: { col: string; asc: boolean } | null = null;
  private counting = false;
  private head = false;

  constructor(
    private db: FakeDb,
    private name: string,
  ) {}

  select(cols = "*", opts: { count?: string; head?: boolean } = {}) {
    if (this.op === "select") this.cols = cols;
    else this.returning = true;
    this.counting = Boolean(opts.count);
    this.head = Boolean(opts.head);
    return this;
  }
  insert(v: Row | Row[]) {
    this.op = "insert";
    this.values = v;
    return this;
  }
  /** upsert on the first column of the row's natural key ("key" when present, otherwise "id") */
  upsert(v: Row) {
    this.op = "upsert";
    this.values = v;
    return this;
  }
  contains(col: string, vs: unknown[]) {
    this.filters.push((r) => Array.isArray(r[col]) && vs.every((x) => (r[col] as unknown[]).includes(x)));
    return this;
  }
  update(v: Row) {
    this.op = "update";
    this.values = v;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => value(r, col) === v);
    return this;
  }
  neq(col: string, v: unknown) {
    this.filters.push((r) => value(r, col) !== v);
    return this;
  }
  lte(col: string, v: number) {
    this.filters.push((r) => Number(value(r, col)) <= v);
    return this;
  }
  is(col: string, v: unknown) {
    this.filters.push((r) => (r[col] ?? null) === v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  or(expr: string) {
    const parts = expr.split(/,(?![^(]*\))/);
    const tests = parts.map((p) => {
      const m = /^(\w+)\.(eq|in)\.(.+)$/.exec(p)!;
      const [, col, op, val] = m;
      return op === "eq" ? (r: Row) => String(r[col]) === val : (r: Row) => val.replace(/^\(|\)$/g, "").split(",").includes(String(r[col]));
    });
    this.filters.push((r) => tests.some((t) => t(r)));
    return this;
  }
  order(col: string, o: { ascending?: boolean } = {}) {
    this.orderBy = { col, asc: o.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  range() {
    return this;
  }
  maybeSingle() {
    this.one = "maybe";
    return this;
  }
  single() {
    this.one = "single";
    return this;
  }

  private pick(r: Row): Row {
    if (this.cols === "*" || !this.cols) return { ...r };
    const out: Row = {};
    for (const c of this.cols.split(",").map((x) => x.trim())) out[c] = r[c] ?? null;
    return out;
  }

  private unknownColumn(v: Row): string | null {
    const known = this.db.columns[this.name];
    if (!known) return null;
    return Object.keys(v).find((k) => !known.includes(k)) ?? null;
  }

  private run(): { data: unknown; error: { message: string; code?: string } | null; count?: number } {
    const t = this.db.table(this.name);
    const match = (r: Row) => this.filters.every((f) => f(r));
    let rows: Row[];
    if (this.op === "insert") {
      const list = Array.isArray(this.values) ? this.values : [this.values!];
      for (const v of list) {
        const bad = this.unknownColumn(v);
        if (bad) return { data: null, error: { message: `Could not find the '${bad}' column`, code: "PGRST204" } };
      }
      rows = list.map((v) => ({ id: crypto.randomUUID(), ...v }));
      t.push(...rows);
      this.db.calls.push({ table: this.name, op: "insert" });
    } else if (this.op === "upsert") {
      const v = this.values as Row;
      const k = "key" in v ? "key" : "id";
      const cur = t.find((r) => r[k] === v[k]);
      if (cur) Object.assign(cur, v);
      else t.push({ ...v });
      rows = [cur ?? v];
    } else if (this.op === "update") {
      const bad = this.unknownColumn(this.values as Row);
      if (bad) return { data: null, error: { message: `Could not find the '${bad}' column`, code: "PGRST204" } };
      rows = t.filter(match);
      for (const r of rows) Object.assign(r, this.values);
      this.db.calls.push({ table: this.name, op: "update", values: this.values as Row });
    } else if (this.op === "delete") {
      rows = t.filter(match);
      this.db.tables[this.name] = t.filter((r) => !match(r));
    } else {
      if (this.cols !== "*" && this.db.columns[this.name]) {
        const missing = this.cols.split(",").map((x) => x.trim()).find((c) => !this.db.columns[this.name].includes(c));
        if (missing) return { data: null, error: { message: `column ${missing} does not exist`, code: "42703" } };
      }
      rows = t.filter(match);
    }
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.counting) return { data: this.head ? null : rows.map((r) => this.pick(r)), error: null, count: rows.length };
    const out = this.op === "select" || this.returning ? rows.map((r) => this.pick(r)) : null;
    if (this.one) {
      if (!out || out.length === 0) return this.one === "single" ? { data: null, error: { message: "no rows", code: "PGRST116" } } : { data: null, error: null };
      return { data: out[0], error: null };
    }
    return { data: out, error: null };
  }

  then<A, B>(ok?: ((v: { data: unknown; error: { message: string; code?: string } | null; count?: number }) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.run()).then(ok, fail);
  }
}

/** A column, or a JSON field written as PostgREST does ("image->>path"). */
function value(r: Row, col: string): unknown {
  const m = /^(\w+)->>(\w+)$/.exec(col);
  if (!m) return r[col];
  const obj = r[m[1]] as Record<string, unknown> | null | undefined;
  const v = obj?.[m[2]];
  return v === undefined || v === null ? null : String(v);
}

/** A cookie jar for next/headers' cookies(). */
export class FakeJar {
  store = new Map<string, string>();
  get(name: string) {
    const value = this.store.get(name);
    return value === undefined ? undefined : { name, value };
  }
  set(name: string, value: string) {
    this.store.set(name, value);
  }
  delete(name: string) {
    this.store.delete(name);
  }
}
