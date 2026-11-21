// W3 on the standalone Windows app (PGlite, desktop): ./w03-leave.ts.
import { describe, afterAll } from "vitest";
import { desktopEdition, editionRef } from "./harness";
import { w03 } from "./w03-leave";

const ref = editionRef(desktopEdition);
describe("Windows standalone (PGlite)", () => {
  afterAll(() => ref.close());
  w03(ref);
});
