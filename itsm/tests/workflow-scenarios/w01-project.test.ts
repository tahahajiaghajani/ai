// W1 «گردش کار پروژه» (the owner's case) on the standalone Windows app (PGlite, desktop): ./w01-project.ts.
import { describe, afterAll } from "vitest";
import { desktopEdition, editionRef } from "./harness";
import { w01 } from "./w01-project";

const ref = editionRef(desktopEdition);
describe("Windows standalone (PGlite)", () => {
  afterAll(() => ref.close());
  w01(ref);
});
