// W9 on the standalone Windows app (PGlite, desktop): ./w09-access-review.ts.
import { describe, afterAll } from "vitest";
import { desktopEdition, editionRef } from "./harness";
import { w09 } from "./w09-access-review";

const ref = editionRef(desktopEdition);
describe("Windows standalone (PGlite)", () => {
  afterAll(() => ref.close());
  w09(ref);
});
