// W5 on the standalone Windows app (PGlite, desktop): ./w05-security-report.ts.
import { describe, afterAll } from "vitest";
import { desktopEdition, editionRef } from "./harness";
import { w05 } from "./w05-security-report";

const ref = editionRef(desktopEdition);
describe("Windows standalone (PGlite)", () => {
  afterAll(() => ref.close());
  w05(ref);
});
