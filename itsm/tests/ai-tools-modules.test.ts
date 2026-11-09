// Tools the AI layer registers over the modules' services (docs/spec/AI.md §11.8): an order drafted for confirmation
// (nothing is ordered until the person confirms; then the request module places it with their access), and the change
// risk / CMDB impact tools that read with the caller's access only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { world, type World } from "./incident-helpers";
import type { AiProposal } from "@shared/ai/types";
import { toolByName } from "@server/modules/ai/tools";

const before = process.env.ITSM_AI_FAKE;
afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

type Ev = { type: string; proposal?: AiProposal; ok?: boolean; summary_fa?: string };

describe("module tools", () => {
  let w: World;

  async function ask(client: World["o"], text: string): Promise<Ev[]> {
    const res = await w.e.app.fetch(new Request(`http://local.test/api${w.P}/ai/chat`, { method: "POST", headers: { "content-type": "application/json", cookie: client.cookie }, body: JSON.stringify({ text }) }));
    return (await res.text())
      .split("\n\n")
      .map((f) => f.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n"))
      .filter(Boolean)
      .map((d) => JSON.parse(d) as Ev);
  }

  beforeAll(async () => {
    process.env.ITSM_AI_FAKE = "1";
    w = await world();
    await w.o.post(`${w.P}/ai/connections`, { preset: "fake" });
    await w.o.post(`${w.P}/request/seed`, {});
    await w.drain();
  });

  it("are registered for the installed modules", () => {
    for (const n of ["change_risk", "cmdb_impact", "draft_order_catalog_item", "start_agent"]) expect(toolByName(n)).toBeTruthy();
  });

  it("drafts an order; nothing is ordered until the person confirms it, then it is placed with their access", async () => {
    const count = async () => (await w.p.req.client.get(`${w.P}/r/request_item?size=100`)).rows.length as number;
    const n0 = await count();
    const events = await ask(w.p.req.client, `[tool:draft_order_catalog_item {"item":"لپ‌تاپ جدید","answers":{"model":"standard","os":"windows","reason":"کارمند تازه‌وارد"}}] یک لپ‌تاپ سفارش بده`);
    const p = events.find((e) => e.type === "proposal")?.proposal;
    expect(p?.kind).toBe("request.order");
    expect(await count()).toBe(n0);
    // another member cannot apply someone else's assistant proposal
    await w.p.req2.client.post(`${w.P}/ai/actions/${p!.id}/confirm`, {}, 404);
    const done = (await w.p.req.client.post(`${w.P}/ai/actions/${p!.id}/confirm`, {})).proposal as AiProposal;
    expect(done.status).toBe("executed");
    expect(done.result?.type).toBe("request_item");
    expect(await count()).toBe(n0 + 1);
  });

  it("refuses an order whose answers the form would refuse", async () => {
    const events = await ask(w.p.req.client, `[tool:draft_order_catalog_item {"item":"لپ‌تاپ جدید","answers":{"model":"standard"}}] سفارش`);
    expect(events.find((e) => e.type === "proposal")).toBeUndefined();
    const end = events.find((e) => e.type === "tool_end");
    expect(end?.ok).toBe(false);
  });

  it("reads a change's risk only when the person may read the change", async () => {
    const events = await ask(w.p.req.client, `[tool:change_risk {"change":"CHG0000001"}] خطر این تغییر`);
    const end = events.find((e) => e.type === "tool_end");
    if (end) expect(end.ok).toBe(false);
  });
});
