// W12 on the standalone Windows app (PGlite, desktop): ./w12-transfer.ts.
import { describe, afterAll } from "vitest";
import { desktopEdition, editionRef } from "./harness";
import { w12 } from "./w12-transfer";

const ref = editionRef(desktopEdition);
describe("Windows standalone (PGlite)", () => {
  afterAll(() => ref.close());
  w12(ref);
});
