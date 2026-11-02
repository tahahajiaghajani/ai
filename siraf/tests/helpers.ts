// Test helpers: an in-memory server (desktop flavour or cloud flavour) and a tiny API client.
import { createPgliteDb } from "@server/db/pglite";
import { migrate } from "@server/db/migrate";
import { createApp } from "@server/app";
import type { Db } from "@server/db";
import type { ServerConfig } from "@server/context";

export const quietLog = { info() {}, warn() {}, error: (m: string, d?: unknown) => console.error(m, d) };

export async function makeServer(opts: { mode?: "cloud" | "desktop"; config?: Partial<ServerConfig> } = {}) {
  const db = await createPgliteDb({ desktop: opts.mode === "desktop" });
  await migrate(db);
  const app = createApp({
    mode: opts.mode ?? "cloud",
    db,
    secret: "test-secret",
    allowSignup: true,
    platformAdmins: [],
    origin: opts.mode === "desktop" ? "00000000-0000-7000-8000-000000000001" : "cloud",
    log: quietLog,
    fetch: globalThis.fetch.bind(globalThis),
    ...opts.config,
  });
  return { app, db };
}

export class Client {
  cookie = "";
  token = "";
  constructor(private app: { fetch: (r: Request) => Response | Promise<Response> }, private base = "http://local.test") {}
  async req<T = any>(method: string, path: string, body?: unknown, expect = 200): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.cookie) headers.cookie = this.cookie;
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await this.app.fetch(new Request(`${this.base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (res.status !== expect) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
    return data as T;
  }
  get = <T = any>(p: string, expect?: number) => this.req<T>("GET", p, undefined, expect);
  post = <T = any>(p: string, b?: unknown, expect?: number) => this.req<T>("POST", p, b ?? {}, expect);
  patch = <T = any>(p: string, b?: unknown, expect?: number) => this.req<T>("PATCH", p, b ?? {}, expect);
  put = <T = any>(p: string, b?: unknown, expect?: number) => this.req<T>("PUT", p, b ?? {}, expect);
  del = <T = any>(p: string, expect?: number) => this.req<T>("DELETE", p, undefined, expect);
}

export async function signupWithOrg(c: Client, modules: ("goods" | "gold" | "fx")[] = ["goods", "gold", "fx"], kind = "mixed") {
  await c.post("/auth/signup", { email: "owner@example.com", password: "s3cret-pass", full_name: "مالک آزمایشی" });
  const { id } = await c.post<{ id: string }>("/orgs", { name: "فروشگاه آزمایشی", business_kind: kind, modules, base_currency: "IRR", fiscal_year: 1405 });
  return id;
}

export async function accountId(db: Db, orgId: string, key: string) {
  const r = await db.one<{ id: string }>(`select id from tz_accounts where org_id = $1 and system_key = $2`, [orgId, key]);
  return r!.id;
}
