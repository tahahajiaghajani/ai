// W2 «درخواست تنخواه شعبه» on the standalone Windows app (PGlite, desktop): ./w02-petty-cash.ts.
import { describe, afterAll } from "vitest";
import { desktopEdition, editionRef } from "./harness";
import { w02 } from "./w02-petty-cash";

const ref = editionRef(desktopEdition);
describe("Windows standalone (PGlite)", () => {
  afterAll(() => ref.close());
  w02(ref);
});
