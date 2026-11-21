// W8 on the standalone Windows app (PGlite, desktop): ./w08-staff-loan.ts.
import { describe, afterAll } from "vitest";
import { desktopEdition, editionRef } from "./harness";
import { w08 } from "./w08-staff-loan";

const ref = editionRef(desktopEdition);
describe("Windows standalone (PGlite)", () => {
  afterAll(() => ref.close());
  w08(ref);
});
