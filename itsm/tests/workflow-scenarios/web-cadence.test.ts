// The web edition's own cadence (after-write, traffic and heartbeat ticks; nothing drains the queue) on the web
// flavour with PGlite: ./cadence.ts. The same on PostgreSQL through the Supavisor emulator: ./pg-pooler.test.ts.
import { describe, afterAll } from "vitest";
import { cloudEdition, editionRef } from "./harness";
import { webCadence } from "./cadence";

const ref = editionRef(cloudEdition);
describe("web flavour (PGlite)", () => {
  afterAll(() => ref.close());
  webCadence(ref);
});
