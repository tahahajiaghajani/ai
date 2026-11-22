// W4 R5 with Windows apps linked to an authority on a real PostgreSQL 16 (the server edition's pool): the parallel
// reviews' values merged when legal and finance decide on their apps, offline or online, in either order
// (./linked.ts). Skipped unless ITSM_PG_URL or ITSM_PG_BIN (tests/pg-real.ts). One linked scenario per file.
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody npx vitest run --maxWorkers=1 tests/workflow-scenarios/pg-linked-w04.test.ts
import { describe, afterAll } from "vitest";
import { editionRef, pgEdition, realPgAvailable } from "./harness";
import { linkedW4 } from "./linked";

const ref = editionRef(() => pgEdition("server", "lk4"));
describe.skipIf(!realPgAvailable())("Windows app linked to the server edition (PostgreSQL 16)", () => {
  afterAll(() => ref.close(), 120_000);
  linkedW4(ref);
});
