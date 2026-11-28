// W6 R7 with a Windows app linked to an authority on a real PostgreSQL 16 (the server edition's pool): a publish
// without the managers' group reaches the group member's app as tombstones (./linked.ts). Skipped unless ITSM_PG_URL
// or ITSM_PG_BIN (tests/pg-real.ts). One linked scenario per file.
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody npx vitest run --maxWorkers=1 tests/workflow-scenarios/pg-linked-w06.test.ts
import { describe, afterAll } from "vitest";
import { editionRef, pgEdition, realPgAvailable } from "./harness";
import { linkedW6 } from "./linked";

const ref = editionRef(() => pgEdition("server", "lk6"));
describe.skipIf(!realPgAvailable())("Windows app linked to the server edition (PostgreSQL 16)", () => {
  afterAll(() => ref.close(), 120_000);
  linkedW6(ref);
});
