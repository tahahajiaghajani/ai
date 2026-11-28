// server edition (PostgreSQL 16, its pool): the workflow scenarios on a real PostgreSQL 16 (./harness.ts). Skipped unless ITSM_PG_URL or ITSM_PG_BIN
// (tests/pg-real.ts). Locally as root:
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody npx vitest run --maxWorkers=1 tests/workflow-scenarios/pg-server-b.test.ts
import { describe, afterAll } from "vitest";
import { editionRef, pgEdition, realPgAvailable } from "./harness";
import { w07 } from "./w07-complaint";
import { w08 } from "./w08-staff-loan";
import { w09 } from "./w09-access-review";
import { w10 } from "./w10-training";
import { w11 } from "./w11-peripheral";
import { w12 } from "./w12-transfer";

const ref = editionRef(() => pgEdition("server", "sb"));
describe.skipIf(!realPgAvailable())("server edition (PostgreSQL 16, its pool)", () => {
  afterAll(() => ref.close(), 120_000);
  w07(ref);
  w08(ref);
  w09(ref);
  w10(ref);
  w11(ref);
  w12(ref);
});
