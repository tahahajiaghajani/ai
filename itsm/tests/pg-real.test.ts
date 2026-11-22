// tests/pg-real.ts itself: a suite's scratch databases go when the suite stops its server — the extra databases of its
// worlds (`extraDatabase`) too, also on a server given by ITSM_PG_URL (CI's postgres service, a developer's own
// cluster), which outlives the suite. With ITSM_PG_BIN only, a throwaway cluster stands in for that server. Skipped
// unless ITSM_PG_URL or ITSM_PG_BIN.
import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { extraDatabase, realPg, realPgAvailable, type RealPg } from "./pg-real";

describe.skipIf(!realPgAvailable())("tests/pg-real.ts", () => {
  it("stop() drops the extra databases of the suite's worlds, also on a server given by ITSM_PG_URL", async () => {
    const given = process.env.ITSM_PG_URL;
    // no server of its own: a throwaway cluster plays the one ITSM_PG_URL names
    const host: RealPg | null = given ? null : await realPg("pgreal_host");
    if (host) process.env.ITSM_PG_URL = host.url;
    try {
      const server = process.env.ITSM_PG_URL!;
      const prefix = `pgreal_${process.pid}_`;
      const listed = async (): Promise<string[]> => {
        const admin = postgres(server, { max: 1, onnotice: () => {} });
        try {
          return (await admin.unsafe(`select datname from pg_database where datname like $1 order by datname`, [`${prefix}%`])).map((r) => String(r.datname));
        } finally {
          await admin.end({ timeout: 5 });
        }
      };
      const pg = await realPg("pgreal");
      const names = [`${prefix}1`, `${prefix}2`];
      for (const n of names) await extraDatabase(pg, n);
      expect(await listed()).toEqual(names);
      await pg.stop();
      expect(await listed()).toEqual([]);
    } finally {
      if (host) {
        delete process.env.ITSM_PG_URL;
        await host.stop();
      }
    }
  }, 120_000);
});
