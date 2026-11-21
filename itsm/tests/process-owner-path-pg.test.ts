// The owner's path of release 1.1.5 (tests/process-owner-path-scenario.ts) on a real PostgreSQL, with the pool options of
// each edition that runs on one: the web version's (Supabase's transaction pooler: no pipelining, no prepared
// statements, three connections) and the server edition's (its own PostgreSQL: prepared statements). Skipped unless
// ITSM_PG_URL or ITSM_PG_BIN (tests/pg-real.ts). Locally as root:
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody npx vitest run tests/process-owner-path-pg.test.ts
import { describe, beforeAll, afterAll } from "vitest";
import { createPostgresDb } from "@server/db/postgres";
import type { Db } from "@server/db";
import { useServerDb } from "./helpers";
import { extraDatabase, realPg, realPgAvailable, type RealPg } from "./pg-real";
import { ownerPathScenario } from "./process-owner-path-scenario";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pg: RealPg;
let seq = 0;
let flavour: "web" | "server" = "web";
const pools: Db[] = [];

describe.skipIf(!realPgAvailable())("the owner's path on a real PostgreSQL", () => {
  beforeAll(async () => {
    pg = await realPg("owner_path");
    useServerDb(async () => {
      const url = await extraDatabase(pg, `owner_path_${process.pid}_${++seq}`);
      const db = createPostgresDb(flavour === "web" ? { url, ssl: false, max: 3, maxPipeline: 1 } : { url, ssl: false, max: 4, prepare: true });
      pools.push(db);
      return db;
    });
  }, 300_000);

  afterAll(async () => {
    useServerDb(null);
    await Promise.all(pools.splice(0).map((db) => Promise.race([db.close().catch(() => undefined), sleep(15_000)])));
    await pg?.stop();
  }, 120_000);

  describe("the web version's pool", () => {
    beforeAll(() => {
      flavour = "web";
    });
    ownerPathScenario("the owner's path: «کسی پیدا نشد» and the demo pack (PostgreSQL, the web version's pool)");
  });

  describe("the server edition's pool", () => {
    beforeAll(() => {
      flavour = "server";
    });
    ownerPathScenario("the owner's path: «کسی پیدا نشد» and the demo pack (PostgreSQL, the server edition's pool)");
  });
});
