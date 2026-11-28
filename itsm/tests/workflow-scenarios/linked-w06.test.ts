// W6 R7 with a Windows app linked to an authority (the web flavour on PGlite): a publish without the managers' group
// reaches the group member's app as tombstones (./linked.ts). One linked scenario per file: a Windows app remembers for
// a minute which organisation it is linked to.
import { describe, afterAll } from "vitest";
import { cloudEdition, editionRef } from "./harness";
import { linkedW6 } from "./linked";

const ref = editionRef(cloudEdition);
describe("Windows app linked to an authority (PGlite)", () => {
  afterAll(() => ref.close());
  linkedW6(ref);
});
