// The ingestion endpoint and the processing pipeline end to end: keys and rate limits, idempotency, normalisation of
// the tools' formats, rules (ignore, enrich, threshold), CI binding, deduplication, clear and re-open, flapping,
// maintenance, correlation into groups and the alert → incident rules.
import { beforeAll, describe, expect, it } from "vitest";
import { eventWorld, type EventWorld } from "./event-helpers";

let w: EventWorld;
beforeAll(async () => {
  w = await eventWorld();
}, 120_000);

const alertsOf = async (filter: unknown) => (await w.o.post(`${w.P}/r/alert/query`, { filter, size: 50 })).rows as Record<string, any>[];

describe("ingestion", () => {
  it("refuses an unknown key and stores a delivery once", async () => {
    expect((await w.send("ev_notarealkeynotarealkeynotarealkey", { title: "x" })).status).toBe(401);
    const s = await w.source({ name: "عمومی ۱" });
    const first = await w.send(s.key, { title: "CPU بالا", host: "srv-db01", severity: "warning", event_id: "e-1" });
    expect(first.status).toBe(202);
    expect(first.body.accepted).toBe(1);
    const again = await w.send(s.key, { title: "CPU بالا", host: "srv-db01", severity: "warning", event_id: "e-1" });
    expect(again.body).toMatchObject({ accepted: 0, duplicates: 1 });
    await w.drain();
    const ev = (await w.o.post(`${w.P}/r/event/query`, { filter: { f: "source_id", op: "eq", v: s.id }, size: 10, fields: ["outcome", "ci_id", "alert_id", "payload"] })).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0].outcome).toBe("created");
    expect(ev[0].ci_id).toBe(w.ci.host);
  });
});
