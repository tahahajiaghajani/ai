// The portal's core paths end to end: the seed (idempotent), the configuration a requester sees, «درخواست‌های من»
// across tables and tabs, the requester-safe ticket page (public replies only, actions of a requester), and the
// CSAT survey sent when an incident is resolved — answered once, written back to the incident.
import { beforeAll, describe, expect, it } from "vitest";
import { portalWorld, statusOf, type PortalWorld } from "./portal-helpers";

let w: PortalWorld;

beforeAll(async () => {
  w = await portalWorld();
}, 120_000);

describe("seed", () => {
  it("adds the portal, the CSAT survey and its triggers once", async () => {
    const again = await w.o.post(`${w.P}/portal/seed`, {});
    expect(again.skipped).toBe(true);
    const forced = await w.o.post(`${w.P}/portal/seed`, { force: true });
    expect(forced.skipped).toBe(false);
    expect(Object.values(forced.created as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(0);
    const portals = (await w.o.get(`${w.P}/r/portal`)).rows;
    expect(portals).toHaveLength(1);
    const surveys = (await w.o.get(`${w.P}/r/survey`)).rows as { name: string; active: boolean }[];
    expect(surveys.find((s) => s.name === "رضایت از رسیدگی")?.active).toBe(true);
    const triggers = (await w.o.get(`${w.P}/r/survey_trigger`)).rows as { table_key: string }[];
    expect(triggers.map((t) => t.table_key).sort()).toEqual(["incident", "request_item"]);
    const topics = (await w.o.get(`${w.P}/r/va_topic?size=100`)).rows as { key: string }[];
    expect(topics.map((t) => t.key)).toEqual(expect.arrayContaining(["portal_feedback", "portal_messenger", "portal_status", "report_issue", "status"]));
  });
});

describe("configuration", () => {
  it("gives a requester the published home page and what they may do", async () => {
    const cfg = await w.p.req.client.get(`${w.P}/portal/config`);
    expect(cfg.portal.name).toBe("درگاه خدمات");
    expect(cfg.layout[0].type).toBe("search");
    expect(cfg.can).toMatchObject({ admin: false, agent: false, order: true, report: true, feedback: true });
    const admin = await w.p.sdm.client.get(`${w.P}/portal/config`);
    expect(admin.can.admin).toBe(true);
    expect(admin.can.agent).toBe(true);
  });

  it("serves a home page with the parts its layout shows", async () => {
    const home = await w.p.req.client.get(`${w.P}/portal/home`);
    expect(home.popular.length).toBeGreaterThan(0);
    expect(home.actions).toMatchObject({ approvals: 0, surveys: 0 });
  });
});

describe("my items and the ticket page", () => {
  let inc: Record<string, any>;
  beforeAll(async () => {
    inc = await w.incident(w.p.req.client);
  });

  it("lists the requester's own records and nobody else's", async () => {
    const mine = await w.p.req.client.get(`${w.P}/portal/items?tab=mine&state=open`);
    expect(mine.items.map((i: { id: string }) => i.id)).toContain(inc.id);
    expect(mine.items.find((i: { id: string }) => i.id === inc.id)).toMatchObject({ table: "incident", stage: "received", relation: "mine" });
    for (const who of ["req2", "other", "mgr"] as const) {
      const theirs = await w.p[who].client.get(`${w.P}/portal/items?tab=mine&state=all`);
      expect(theirs.items.map((i: { id: string }) => i.id)).not.toContain(inc.id);
    }
    // an agent who reads every incident still sees only their own in the portal
    const agent = await w.p.agent.client.get(`${w.P}/portal/items?tab=mine&state=all`);
    expect(agent.items.map((i: { id: string }) => i.id)).not.toContain(inc.id);
  });

  it("shows a manager their people's records under «تیم من» only", async () => {
    const team = await w.p.mgr.client.get(`${w.P}/portal/items?tab=team&state=all`);
    expect(team.team).toBe(true);
    expect(team.items.map((i: { id: string }) => i.id)).toContain(inc.id);
    const notTeam = await w.p.req2.client.get(`${w.P}/portal/items?tab=team&state=all`);
    expect(notTeam.team).toBe(false);
    expect(notTeam.items).toHaveLength(0);
  });

  it("shows public replies only, never internal notes", async () => {
    await w.p.agent.client.post(`${w.P}/r/incident/${inc.id}/journal`, { kind: "work_note", body: "یادداشت داخلی: رمز مدیر چاپگر ۱۲۳" });
    await w.p.agent.client.post(`${w.P}/r/incident/${inc.id}/journal`, { kind: "comment", body: "سلام، کارشناس در راه است." });
    const t = await w.p.req.client.get(`${w.P}/portal/tickets/incident/${inc.id}`);
    const text = JSON.stringify(t);
    expect(text).toContain("کارشناس در راه است");
    expect(text).not.toContain("یادداشت داخلی");
    expect(t.timeline.find((e: { body: string | null }) => e.body?.includes("کارشناس در راه"))).toMatchObject({ staff: true, mine: false });
    // the agent opening their own portal view of someone else's record: not theirs, not found
    expect(await statusOf(w.p.agent.client, "GET", `${w.P}/portal/tickets/incident/${inc.id}`)).toBe(404);
    expect(await statusOf(w.p.other.client, "GET", `${w.P}/portal/tickets/incident/${inc.id}`)).toBe(404);
    expect(await statusOf(w.p.req2.client, "GET", `${w.P}/portal/tickets/incident/${inc.id}`)).toBe(404);
    // the manager reads it as their team's, without a requester's actions
    const m = await w.p.mgr.client.get(`${w.P}/portal/tickets/incident/${inc.id}`);
    expect(m.relation).toBe("team");
    expect(m.actions).toHaveLength(0);
  });

  it("lets the requester reply and chase, once a day", async () => {
    const t = await w.p.req.client.post(`${w.P}/portal/tickets/incident/${inc.id}/reply`, { body: "ممنون، منتظرم." });
    expect(t.timeline.some((e: { body: string | null; mine: boolean }) => e.mine && e.body === "ممنون، منتظرم.")).toBe(true);
    expect(t.actions.map((a: { key: string }) => a.key)).toContain("chase");
    await w.p.req.client.post(`${w.P}/portal/tickets/incident/${inc.id}/action`, { action: "chase" });
    expect(await statusOf(w.p.req.client, "POST", `${w.P}/portal/tickets/incident/${inc.id}/action`, { action: "chase" })).toBe(400);
    expect(await statusOf(w.p.req2.client, "POST", `${w.P}/portal/tickets/incident/${inc.id}/reply`, { body: "سلام" })).toBe(404);
  });
});

describe("the CSAT survey", () => {
  it("invites the requester when the incident is resolved and takes one answer", async () => {
    const inc = await w.incident(w.p.req.client, { short_description: "ایمیل باز نمی‌شود" });
    await w.o.post(`${w.P}/r/incident/${inc.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "تنظیمات اصلاح شد" } });
    await w.drain();
    const todo = await w.p.req.client.get(`${w.P}/portal/todo`);
    expect(todo.surveys).toHaveLength(1);
    const invitation = todo.surveys[0].id as string;
    // nobody else may open it
    expect(await statusOf(w.p.req2.client, "GET", `${w.P}/portal/surveys/${invitation}`)).toBe(404);
    const view = await w.p.req.client.get(`${w.P}/portal/surveys/${invitation}`);
    expect(view.questions.length).toBe(3);
    const rating = view.questions.find((q: { metric: string }) => q.metric === "csat");
    const comment = view.questions.find((q: { kind: string }) => q.kind === "text");
    expect(await statusOf(w.p.req.client, "POST", `${w.P}/portal/surveys/${invitation}`, { answers: {} })).toBe(400);
    const r = await w.p.req.client.post(`${w.P}/portal/surveys/${invitation}`, { answers: { [rating.id]: 5, [comment.id]: "سریع و دقیق" } });
    expect(r.thanks).toBeTruthy();
    expect(await statusOf(w.p.req.client, "POST", `${w.P}/portal/surveys/${invitation}`, { answers: { [rating.id]: 1 } })).toBe(409);
    const after = (await w.o.get(`${w.P}/r/incident/${inc.id}`)).row;
    expect(after.satisfaction).toBe(5);
    const ticket = await w.p.req.client.get(`${w.P}/portal/tickets/incident/${inc.id}`);
    expect(ticket.rating).toBe(5);
    expect(ticket.survey).toBeNull();
    const results = await w.p.sdm.client.get(`${w.P}/portal/survey-results?days=30`);
    expect(results.totals.responses).toBeGreaterThanOrEqual(1);
    expect(results.totals.csat_pct).toBe(100);
  });
});
