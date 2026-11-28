// W11 on the standalone Windows app (PGlite, desktop): ./w11-peripheral.ts.
import { describe, afterAll } from "vitest";
import { desktopEdition, editionRef } from "./harness";
import { w11 } from "./w11-peripheral";

const ref = editionRef(desktopEdition);
describe("Windows standalone (PGlite)", () => {
  afterAll(() => ref.close());
  w11(ref);
});
