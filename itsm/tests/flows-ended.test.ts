// `record.flow_ended` (docs/spec/services/flows.md §8): a run started on a record tells the record when it ends —
// completed with the outputs of «پایان», failed with the error, canceled — so modules waiting for their flows (the
// request module's zero-touch check) react to it instead of polling the run.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { engineOrg, outbox, type EngineOrg } from "./engine-helpers";
import { N, flowsKit, line, standIns, type FlowsKit } from "./flows-helpers";

describe("record.flow_ended", () => {
  let o: EngineOrg;
  let k: FlowsKit;
  let services = () => {};
  beforeAll(async () => {
    o = await engineOrg();
    k = flowsKit(o);
    services = standIns();
  });
  afterAll(() => services());
  const ended = async (id: string) => (await outbox(o.db, o.org, "record.flow_ended")).filter((j) => j.payload.id === id).map((j) => j.payload.data);

  it("a completed run carries its outputs to the record it ran on", async () => {
    const flow = await k.live({ trigger: "record", trigger_events: ["created"], name: "پایان با خروجی" }, line(N("end", "end", { outputs: [{ name: "ticket", value: "T-{{trigger.record.short_description}}" }] })));
    const t = await k.todo({ short_description: "ثبت" });
    await k.drain();
    const [e] = await ended(t.id);
    expect(e).toMatchObject({ flow_id: flow, flow_name: "پایان با خروجی", state: "completed", error: null, outputs: { ticket: "T-ثبت" }, test: false });
    expect(e.run_id).toBeTruthy();
  });

  it("a failed run carries its error; a canceled run says so", async () => {
    const t = await k.todo({ short_description: "ناموفق" });
    const failing = await k.live({ trigger: "manual", name: "ناموفق" }, line(N("end", "end", { outcome: "failed", message: "نشد" })));
    await o.owner.post(`${k.P}/flows/${failing}/run`, { table: "todo", record_id: t.id });
    await k.drain();
    expect((await ended(t.id)).find((d) => d.flow_id === failing)).toMatchObject({ state: "failed", error: "نشد" });
    const waiting = await k.live({ trigger: "manual", name: "منتظر" }, line(N("w", "wait_duration", { duration: { amount: 1, unit: "day" } })));
    const run = (await o.owner.post(`${k.P}/flows/${waiting}/run`, { table: "todo", record_id: t.id })).run.id as string;
    await k.drain();
    await o.owner.post(`${k.P}/flows/runs/${run}/cancel`, {});
    expect((await ended(t.id)).find((d) => d.flow_id === waiting)).toMatchObject({ state: "canceled", run_id: run });
  });
});
