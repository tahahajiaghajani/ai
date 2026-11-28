// W13 «پاسخ به نامهٔ مشتری» (business hours on the SLA seed's calendar, the clock pinned) on the standalone Windows app
// (PGlite, desktop): ./w13-business-hours.ts. No PostgreSQL twin: the pinned clock reaches PGlite's now(), never a
// PostgreSQL server's.
import { describe, afterAll } from "vitest";
import { desktopEdition, editionRef } from "./harness";
import { w13 } from "./w13-business-hours";

const ref = editionRef(desktopEdition);
describe("Windows standalone (PGlite)", () => {
  afterAll(() => ref.close());
  w13(ref);
});
