// The platform dashboard («پیشخوان») answers even when a part of it fails or never answers: that part is left out,
// named in «نیازمند توجه» and logged, and the rest of the page is there. Before, one failing or hanging query held
// the whole page, and the console showed its loading skeleton forever.
import { describe, it, expect, beforeAll } from "vitest";
import { createPgliteDb } from "@server/db/pglite";
import { migrate } from "@server/db/migrate";
import { createApp } from "@server/app";
import type { Db } from "@server/db";
import type { ServerConfig } from "@server/context";
import { overview } from "@server/modules/platform/console";
import { Client } from "./helpers";

/** The same database, but statements matching `fail` throw and those matching `hang` never answer. */
function faulty(db: Db, rules: { fail?: RegExp; hang?: RegExp }): Db {
  const check = (text: string) => {
    if (rules.hang?.test(text)) return new Promise<never>(() => {});
    if (rules.fail?.test(text)) return Promise.reject(new Error("relation does not exist (test)"));
    return null;
  };
  return {
    ...db,
    kind: db.kind,
    query: (text: string, params?: unknown[]) => (check(text) as Promise<never>) ?? db.query(text, params),
    one: (text: string, params?: unknown[]) => (check(text) as Promise<never>) ?? db.one(text, params),
    exec: (text: string) => (check(text) as Promise<never>) ?? db.exec(text),
    tx: (fn) => db.tx(fn),
    close: () => db.close(),
  } as Db;
}

describe("platform dashboard with a failing or silent part", () => {
  let db: Db;
  let cfg: ServerConfig;
  const warnings: { msg: string; data: unknown }[] = [];

  beforeAll(async () => {
    db = await createPgliteDb({});
    await migrate(db);
    cfg = {
      mode: "cloud",
      db,
      secret: "s",
      secretSource: "env",
      allowSignup: true,
      platformAdmins: ["admin@example.com"],
      origin: "cloud",
      log: { info() {}, warn: (msg, data) => void warnings.push({ msg, data }), error() {} },
      fetch: globalThis.fetch.bind(globalThis),
    };
    const c = new Client(createApp(cfg));
    await c.post("/auth/signup", { email: "admin@example.com", password: "admin-pass-1405", full_name: "مدیر سامانه" });
    await c.post("/orgs", { name: "فروشگاه نمونه", business_kind: "mixed", modules: ["goods"], base_currency: "IRR", fiscal_year: 1405 });
  });

  it("answers in full when every part answers", async () => {
    const o = await overview(cfg);
    expect(o.partial).toEqual([]);
    expect(o.kpis.orgs.total).toBe(1);
    expect(o.recent_orgs.map((x) => x.name)).toEqual(["فروشگاه نمونه"]);
    expect(o.attention.find((a) => a.key === "overview_partial")).toBeUndefined();
  });

  it("leaves out a part that fails and one that never answers, and says which", async () => {
    warnings.length = 0;
    const started = Date.now();
    const o = await overview({ ...cfg, db: faulty(db, { fail: /from tz_security_events e/, hang: /from tz_support_sessions s\s/ }) }, { partMs: 300 });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(o.partial.sort()).toEqual(["recent_events", "support"]);
    // the rest of the page is there
    expect(o.kpis.orgs.total).toBe(1);
    expect(o.kpis.users.total).toBe(1);
    expect(o.recent_orgs).toHaveLength(1);
    expect(o.recent_events).toEqual([]);
    expect(o.active_support).toEqual([]);
    const note = o.attention.find((a) => a.key === "overview_partial");
    expect(note?.tone).toBe("warning");
    expect(note?.detail).toContain("رویدادهای امنیتی");
    expect(note?.detail).toContain("پشتیبانی فعال");
    expect(warnings.map((w) => (w.data as { part: string }).part).sort()).toEqual(["recent_events", "support"]);
  });

  it("keeps the page when the main figures fail, and says so", async () => {
    const o = await overview({ ...cfg, db: faulty(db, { fail: /as orgs_total/ }) }, { partMs: 300 });
    expect(o.partial).toEqual(["figures"]);
    expect(o.recent_orgs).toHaveLength(1);
    expect(o.attention.find((a) => a.key === "overview_partial")?.detail).toContain("آمار کلی");
  });
});
