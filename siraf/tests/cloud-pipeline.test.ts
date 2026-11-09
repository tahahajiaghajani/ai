// The web version reaches Supabase through its shared transaction pooler (Supavisor), which loses queries that a
// client pipelines, i.e. sends on a connection while an earlier query there is still unanswered: they never get an
// answer (porsager/postgres#970, supabase/supavisor#1239). postgres.js 4 pipelines by default once every pooled
// connection is busy. The platform dashboard fetches its figures in parallel, so it did that on every load, and
// «پیشخوان» waited until Vercel's time limit while the other admin pages (one query at a time) worked.
// The cloud adapter must never pipeline. A proxy between it and the server counts every query (Query or Parse) that
// starts while another one on the same connection has not reached ReadyForQuery yet.
import net from "node:net";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createPostgresDb, postgresOptions } from "@server/db/postgres";
import { migrate } from "@server/db/migrate";
import { createApp } from "@server/app";
import type { Db } from "@server/db";
import { Client, quietLog } from "./helpers";

interface Counter {
  queries: number;
  pipelined: number;
  close(): Promise<void>;
  port: number;
}

/** A TCP proxy to `port` that reads the PostgreSQL wire protocol in both directions and counts pipelined queries. */
async function pipelineCounter(port: number): Promise<Counter> {
  const stats = { queries: 0, pipelined: 0 };
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const upstream = net.connect(port, "127.0.0.1");
    sockets.add(client).add(upstream);
    let inflight = 0; // queries started (Q or P) whose ReadyForQuery has not come back
    let startup = true; // the first client message has no type byte
    let fromClient = Buffer.alloc(0);
    let fromServer = Buffer.alloc(0);
    client.on("data", (chunk) => {
      fromClient = Buffer.concat([fromClient, chunk]);
      for (;;) {
        if (startup) {
          if (fromClient.length < 4 || fromClient.length < fromClient.readInt32BE(0)) break;
          fromClient = fromClient.subarray(fromClient.readInt32BE(0));
          startup = false;
          continue;
        }
        if (fromClient.length < 5 || fromClient.length < fromClient.readInt32BE(1) + 1) break;
        const type = String.fromCharCode(fromClient[0]);
        if (type === "Q" || type === "P") {
          stats.queries++;
          if (inflight > 0) stats.pipelined++;
          inflight++;
        }
        fromClient = fromClient.subarray(fromClient.readInt32BE(1) + 1);
      }
      upstream.write(chunk);
    });
    upstream.on("data", (chunk) => {
      fromServer = Buffer.concat([fromServer, chunk]);
      while (fromServer.length >= 5 && fromServer.length >= fromServer.readInt32BE(1) + 1) {
        if (fromServer[0] === 0x5a /* Z, ReadyForQuery */) inflight = Math.max(0, inflight - 1);
        fromServer = fromServer.subarray(fromServer.readInt32BE(1) + 1);
      }
      client.write(chunk);
    });
    const end = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("close", end).on("error", end);
    upstream.on("close", end).on("error", end);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  return {
    get queries() {
      return stats.queries;
    },
    get pipelined() {
      return stats.pipelined;
    },
    port: (server.address() as net.AddressInfo).port,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}

/**
 * PGlite behind a PostgreSQL socket, reached through the counting proxy. One connection: the socket server runs
 * every connection on PGlite's single session, so a second connection would mix up their unnamed statements; and
 * one connection is all postgres.js needs to pipeline (it does once every pooled connection is busy).
 */
async function startServer() {
  const pg = await PGlite.create();
  const port = 55000 + Math.floor(Math.random() * 5000);
  const server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1" });
  await server.start();
  const proxy = await pipelineCounter(port);
  return {
    pg,
    proxy,
    url: `postgres://postgres:postgres@127.0.0.1:${proxy.port}/postgres`,
    stop: async () => {
      await proxy.close();
      await server.stop();
      await pg.close();
    },
  };
}

describe("the pipelining counter", () => {
  it("sees postgres.js pipeline with its default settings", async () => {
    const s = await startServer();
    const raw = postgres(s.url, { prepare: false, max: 1, ssl: false, onnotice: () => {} });
    await Promise.all(Array.from({ length: 6 }, (_, i) => raw.unsafe(`select ${i} as n`)));
    await raw.end({ timeout: 5 });
    expect(s.proxy.pipelined).toBeGreaterThan(0);
    await s.stop();
  });
});

describe("cloud adapter never pipelines (Supabase's transaction pooler loses pipelined queries)", () => {
  let srv: Awaited<ReturnType<typeof startServer>>;
  let proxy: Counter;
  let db: Db;
  let c: Client;
  let url = "";

  beforeAll(async () => {
    srv = await startServer();
    proxy = srv.proxy;
    url = srv.url;
    db = createPostgresDb({ url, ssl: false, max: 1 });
    await migrate(db);
    const app = createApp({ mode: "cloud", db, secret: "s", allowSignup: true, platformAdmins: ["admin@example.com"], origin: "cloud", log: quietLog, fetch: globalThis.fetch.bind(globalThis) });
    c = new Client(app);
    await c.post("/auth/signup", { email: "admin@example.com", password: "admin-pass-1405", full_name: "مدیر سامانه" });
    await c.post("/orgs", { name: "فروشگاه", business_kind: "mixed", modules: ["goods", "gold", "fx"], base_currency: "IRR", fiscal_year: 1405 });
  });

  afterAll(async () => {
    await db?.close();
    await srv?.stop();
  });

  it("parallel queries wait for a free connection instead of pipelining", async () => {
    expect(postgresOptions({ url, max: 3 }).max_pipeline).toBe(1);
    const before = { q: proxy.queries, p: proxy.pipelined };
    const rows = await Promise.all(Array.from({ length: 12 }, (_, i) => db.one<{ n: number }>(i % 2 ? `select ${i}::int as n` : `select $1::int as n`, i % 2 ? [] : [i])));
    expect(rows.map((r) => r?.n)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(proxy.queries - before.q).toBeGreaterThanOrEqual(12);
    expect(proxy.pipelined).toBe(before.p);
  });

  it("the platform dashboard loads without one pipelined query, also several at once", async () => {
    const before = { q: proxy.queries, p: proxy.pipelined };
    const loads = await Promise.all([
      c.get("/admin/overview"),
      c.get("/admin/overview"),
      c.get("/admin/support?active=1"),
      c.get("/admin/orgs"),
      c.get("/admin/ai/overview"),
    ]);
    expect(loads[0].kpis.orgs.total).toBe(1);
    expect(loads[0].kpis.users.total).toBe(1);
    expect(proxy.queries - before.q).toBeGreaterThan(20);
    expect(proxy.pipelined).toBe(before.p);
  });
});
