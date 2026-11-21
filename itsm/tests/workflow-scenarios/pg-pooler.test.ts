// The web edition through Supabase's transaction pooler as it behaves in v2.9.13 (tests/web-db-pooler.ts in front of a
// real PostgreSQL 16, the web pool's options): W1 and W2 drained, then the web's own cadence (./cadence.ts) — and the
// pooler dropped or misdelivered no answer. Skipped unless ITSM_PG_URL or ITSM_PG_BIN (tests/pg-real.ts). Locally:
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody npx vitest run --maxWorkers=1 tests/workflow-scenarios/pg-pooler.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { editionRef, pgEdition, realPgAvailable } from "./harness";
import { w01 } from "./w01-project";
import { w02 } from "./w02-petty-cash";
import { webCadence } from "./cadence";

const ref = editionRef(() => pgEdition("pooler", "pl"));
describe.skipIf(!realPgAvailable())("web through Supavisor v2.9.13 (emulator)", () => {
  afterAll(() => ref.close(), 120_000);
  w01(ref);
  w02(ref);
  webCadence(ref);
  it("the pooler lost no answer and gave none to another client", async () => {
    const poolers = (await ref.get()).pooler?.() ?? [];
    expect(poolers.length).toBeGreaterThan(0);
    for (const p of poolers) expect(p.stats).toMatchObject({ droppedMsgs: 0, misdeliveredMsgs: 0 });
  });
});
