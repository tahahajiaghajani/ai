// W7 on the standalone Windows app (PGlite, desktop): ./w07-complaint.ts.
import { describe, afterAll } from "vitest";
import { desktopEdition, editionRef } from "./harness";
import { w07 } from "./w07-complaint";

const ref = editionRef(desktopEdition);
describe("Windows standalone (PGlite)", () => {
  afterAll(() => ref.close());
  w07(ref);
});
