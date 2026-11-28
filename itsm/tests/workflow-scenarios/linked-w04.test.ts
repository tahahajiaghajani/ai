// W4 R5 with Windows apps linked to an authority (the web flavour on PGlite): the parallel reviews' values merged when
// legal and finance decide on their apps — offline, online, in either order (./linked.ts). One linked scenario per file:
// a Windows app remembers for a minute which organisation it is linked to.
import { describe, afterAll } from "vitest";
import { cloudEdition, editionRef } from "./harness";
import { linkedW4 } from "./linked";

const ref = editionRef(cloudEdition);
describe("Windows app linked to an authority (PGlite)", () => {
  afterAll(() => ref.close());
  linkedW4(ref);
});
