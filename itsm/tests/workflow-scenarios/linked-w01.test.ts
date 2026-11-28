// W1 with Windows apps linked to an authority (the web flavour on PGlite): ./linked.ts. One linked scenario per file:
// a Windows app remembers for a minute which organisation it is linked to.
import { describe, afterAll } from "vitest";
import { cloudEdition, editionRef } from "./harness";
import { linkedW1 } from "./linked";

const ref = editionRef(cloudEdition);
describe("Windows app linked to an authority (PGlite)", () => {
  afterAll(() => ref.close());
  linkedW1(ref);
});
