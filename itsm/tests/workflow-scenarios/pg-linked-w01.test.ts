// W1 with Windows apps linked to an authority on a real PostgreSQL 16 (the server edition's pool): ./linked.ts. Skipped
// unless ITSM_PG_URL or ITSM_PG_BIN (tests/pg-real.ts). One linked scenario per file (the app's link state is cached).
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody npx vitest run --maxWorkers=1 tests/workflow-scenarios/pg-linked-w01.test.ts
import { describe, afterAll } from "vitest";
import { editionRef, pgEdition, realPgAvailable } from "./harness";
import { linkedW1 } from "./linked";

const ref = editionRef(() => pgEdition("server", "lk"));
describe.skipIf(!realPgAvailable())("Windows app linked to the server edition (PostgreSQL 16)", () => {
  afterAll(() => ref.close(), 120_000);
  linkedW1(ref);
});
