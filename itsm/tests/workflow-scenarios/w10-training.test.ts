// W10 on the standalone Windows app (PGlite, desktop): ./w10-training.ts.
import { describe, afterAll } from "vitest";
import { desktopEdition, editionRef } from "./harness";
import { w10 } from "./w10-training";

const ref = editionRef(desktopEdition);
describe("Windows standalone (PGlite)", () => {
  afterAll(() => ref.close());
  w10(ref);
});
