// W6 on the standalone Windows app (PGlite, desktop): ./w06-core-access.ts.
import { describe, afterAll } from "vitest";
import { desktopEdition, editionRef } from "./harness";
import { w06 } from "./w06-core-access";

const ref = editionRef(desktopEdition);
describe("Windows standalone (PGlite)", () => {
  afterAll(() => ref.close());
  w06(ref);
});
