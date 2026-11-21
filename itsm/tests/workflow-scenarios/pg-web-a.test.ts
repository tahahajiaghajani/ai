// web (PostgreSQL 16, webPoolOptions): the workflow scenarios on a real PostgreSQL 16 (./harness.ts). Skipped unless ITSM_PG_URL or ITSM_PG_BIN
// (tests/pg-real.ts). Locally as root:
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody npx vitest run --maxWorkers=1 tests/workflow-scenarios/pg-web-a.test.ts
import { describe, afterAll } from "vitest";
import { editionRef, pgEdition, realPgAvailable } from "./harness";
import { w01 } from "./w01-project";
import { w02 } from "./w02-petty-cash";
import { w03 } from "./w03-leave";
import { w04 } from "./w04-procurement";
import { w05 } from "./w05-security-report";
import { w06 } from "./w06-core-access";

const ref = editionRef(() => pgEdition("web", "wa"));
describe.skipIf(!realPgAvailable())("web (PostgreSQL 16, webPoolOptions)", () => {
  afterAll(() => ref.close(), 120_000);
  w01(ref);
  w02(ref);
  w03(ref);
  w04(ref);
  w05(ref);
  w06(ref);
});
