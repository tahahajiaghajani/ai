// Interactions (INC-044): agents record calls, chats and walk-ins (never a requester), turn one into an incident in a
// step (subject, transcript, caller and channel carried over, linked with its wrap-up), close it with a wrap-up and
// its duration, and an interaction left open closes with its incident; the caller reads theirs but changes nothing.
import { describe, it, expect, beforeAll } from "vitest";
import { world, type World } from "./incident-helpers";

let w: World;
beforeAll(async () => {
  w = await world();
});

const make = async (data: Record<string, unknown> = {}) =>
  (await w.p.agent.client.post(`${w.P}/r/interaction`, { short_description: "تماس دربارهٔ قطعی VPN", channel: "phone", caller_id: w.p.req.userId, assignment_group_id: w.g.desk, ...data })).row;

describe("interactions", () => {
  it("are recorded by agents, not requesters", async () => {
    await w.p.req.client.post(`${w.P}/r/interaction`, { short_description: "x", caller_id: w.p.req.userId }, 403);
    const it1 = await make();
    expect([it1.state, it1.agent_id, it1.number?.startsWith("INT")]).toEqual(["open", w.p.agent.userId, true]);
    expect(it1.started_at).toBeTruthy();
    // the caller reads their own interaction but changes nothing
    await w.p.req.client.get(`${w.P}/r/interaction/${it1.id}`);
    await w.p.req.client.patch(`${w.P}/r/interaction/${it1.id}`, { transcript: "x", version: it1.version }, 403);
    await w.p.req2.client.get(`${w.P}/r/interaction/${it1.id}`, 404);
  });

  it("become an incident in one step and close with it", async () => {
    const it1 = await make({ transcript: "کاربر از صبح به VPN وصل نمی‌شود؛ پیام خطای ۸۰۹.", channel: "walk_in" });
    await w.p.req.client.post(`${w.P}/incident/interactions/${it1.id}/incident`, {}, 403);
    const inc = (await w.p.agent.client.post(`${w.P}/incident/interactions/${it1.id}/incident`, {})).row;
    expect([inc.short_description, inc.caller_id, inc.channel]).toEqual(["تماس دربارهٔ قطعی VPN", w.p.req.userId, "walk_in"]);
    expect(inc.description).toContain("خطای ۸۰۹");
    const linked = (await w.o.get(`${w.P}/r/interaction/${it1.id}`)).row;
    expect([linked.incident_id, linked.wrap_up, linked.state]).toEqual([inc.id, "incident", "open"]);
    await w.p.agent.client.post(`${w.P}/incident/interactions/${it1.id}/incident`, {}, 409);

    await w.p.agent.client.post(`${w.P}/r/incident/${inc.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "پروفایل VPN دوباره نصب شد" } });
    await w.drain();
    const closed = (await w.o.get(`${w.P}/r/interaction/${it1.id}`)).row;
    expect(closed.state).toBe("closed");
    expect(closed.ended_at).toBeTruthy();
    expect(closed.duration).toBeGreaterThanOrEqual(0);
  });

  it("need a wrap-up to end, and an incident for «رخداد ثبت شد»", async () => {
    const it2 = await make({ short_description: "پرسش دربارهٔ تمدید گذرواژه" });
    await w.p.agent.client.post(`${w.P}/r/interaction/${it2.id}/transition`, { to: "closed" }, 400);
    const bad = await w.p.agent.client.post(`${w.P}/r/interaction/${it2.id}/transition`, { to: "closed", data: { wrap_up: "incident" } }, 400);
    expect(JSON.stringify(bad.error)).toContain("رخداد را مشخص کنید");
    const done = (await w.p.agent.client.post(`${w.P}/r/interaction/${it2.id}/transition`, { to: "closed", data: { wrap_up: "information", wrap_up_notes: "روش تمدید توضیح داده شد" } })).row;
    expect([done.state, done.wrap_up]).toEqual(["closed", "information"]);
    expect(done.duration).toBeGreaterThanOrEqual(0);
    await w.p.agent.client.post(`${w.P}/incident/interactions/${it2.id}/incident`, {}, 409);
  });
});
