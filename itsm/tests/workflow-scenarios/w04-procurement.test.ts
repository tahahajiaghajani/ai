// W4 on the standalone Windows app (PGlite, desktop): ./w04-procurement.ts.
import { describe, afterAll } from "vitest";
import { desktopEdition, editionRef } from "./harness";
import { w04 } from "./w04-procurement";

const ref = editionRef(desktopEdition);
describe("Windows standalone (PGlite)", () => {
  afterAll(() => ref.close());
  w04(ref);
});
