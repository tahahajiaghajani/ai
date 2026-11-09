// Insights (docs/spec/AI.md §16): cards computed by code for the whole organisation, shown to a member only when they
// read every record a card was computed from (checked when they look), digests built per recipient from what that
// recipient may see, narratives from the card's numbers only, and the Iranian week of the periods.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayISO, weekday } from "@shared/jalali";
import { createIn, orgTz } from "@server/engine";
import { periodOf, runPeriod } from "@server/modules/ai/insights";
import { world, type World } from "./incident-helpers";

const before = process.env.ITSM_AI_FAKE;
let w: World;
const ids: { desk: string[]; network: string[] } = { desk: [], network: [] };

beforeAll(async () => {
  process.env.ITSM_AI_FAKE = "1";
  w = await world({ preset: "need_to_know" });
  await w.sys.write(async (tx) => {
    for (let i = 0; i < 12; i++) ids.desk.push(String((await createIn(tx, w.sys, "incident", { short_description: `ایمیل ${i}`, category: i % 3 ? "email" : "hardware", assignment_group_id: w.g.desk }, { trusted: true })).id));
    for (let i = 0; i < 6; i++) ids.network.push(String((await createIn(tx, w.sys, "incident", { short_description: `شبکه ${i}`, category: "network", assignment_group_id: w.g.network }, { trusted: true })).id));
  });
  await w.drain();
  // yesterday's incidents (and three the day before), in the organisation's time zone
  const all = [...ids.desk, ...ids.network];
  await w.e.db.query(`update sm_incidents set created_at = date_trunc('day', now() at time zone 'Asia/Tehran') at time zone 'Asia/Tehran' - interval '12 hours' where id = any($1::uuid[])`, [`{${all.join(",")}}`]);
  await w.e.db.query(`update sm_incidents set created_at = created_at - interval '1 day' where id = any($1::uuid[])`, [`{${ids.desk.slice(0, 3).join(",")}}`]);
  await w.o.post(`${w.P}/ai/connections`, { preset: "fake" });
}, 120_000);

afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

const daily = () => {
  const tz = orgTz(w.sys);
  return periodOf("daily", todayISO(tz), tz);
};

describe("periods", () => {
  it("are yesterday and the Iranian week before this one (Saturday to Friday)", () => {
    const tz = "Asia/Tehran";
    const d = periodOf("daily", "2026-11-09", tz);
    expect(d.key).toBe("2026-11-08");
    expect(Date.parse(d.to) - Date.parse(d.from)).toBe(86_400_000);
    const wk = periodOf("weekly", "2026-11-09", tz);
    expect(weekday(wk.key)).toBe(0);
    expect(Date.parse(wk.to) - Date.parse(wk.from)).toBe(7 * 86_400_000);
    expect(wk.label).toMatch(/هفتهٔ/);
  });
});

describe("the visibility rule", () => {
  it("computes cards with numbers from code", async () => {
    const n = await runPeriod(w.e.cfg, w.e.org, daily());
    expect(n).toBeGreaterThan(0);
    const all = await w.o.get(`${w.P}/ai/insights?period=daily`);
    const vol = all.insights.find((i: any) => i.kind === "volume" && i.table === "incident");
    expect(vol.numbers.current).toBe(15);
    expect(vol.numbers.previous).toBe(3);
    expect(vol.drivers.length).toBeGreaterThan(0);
    expect(vol.narrative).toMatch(/۱۵/);
  });

  it("hides a card from a member who does not read every record it counts", async () => {
    const desk = await w.p.agent.client.get(`${w.P}/ai/insights?period=daily`);
    expect(desk.insights.some((i: any) => i.kind === "volume" && i.table === "incident")).toBe(false);
    expect(desk.hidden).toBeGreaterThan(0);
    const card = (await w.o.get(`${w.P}/ai/insights?period=daily`)).insights.find((i: any) => i.kind === "volume" && i.table === "incident");
    await w.p.agent.client.post(`${w.P}/ai/insights/${card.id}/narrate`, {}, 404);
  });

  it("shows it once every counted record is readable to them (checked when they look)", async () => {
    // the network incidents leave the period's population (deleted): the desk agent now reads all that is counted
    await w.e.db.query(`update sm_incidents set deleted_at = now() where id = any($1::uuid[])`, [`{${ids.network.join(",")}}`]);
    const desk = await w.p.agent.client.get(`${w.P}/ai/insights?period=daily`);
    const card = desk.insights.find((i: any) => i.kind === "volume" && i.table === "incident");
    expect(card).toBeTruthy();
    const net = await w.p.other.client.get(`${w.P}/ai/insights?period=daily`);
    expect(net.insights.some((i: any) => i.kind === "volume" && i.table === "incident")).toBe(false);
  });

  it("narrates a card from its numbers only, for someone who sees it", async () => {
    const card = (await w.p.agent.client.get(`${w.P}/ai/insights?period=daily`)).insights.find((i: any) => i.kind === "volume" && i.table === "incident");
    const r = await w.p.agent.client.post(`${w.P}/ai/insights/${card.id}/narrate`, {});
    expect(r.ai).toBe(true);
    expect(r.text.length).toBeGreaterThan(0);
    const again = (await w.p.agent.client.get(`${w.P}/ai/insights?period=daily`)).insights.find((i: any) => i.id === card.id);
    expect(again.narrative_ai).toBe(true);
  });
});

describe("digests", () => {
  it("are built per recipient from the cards that recipient may see", async () => {
    await w.o.put(`${w.P}/ai/settings`, { insights: { roles: ["agent"], digest: "daily" } });
    const r = await w.o.post(`${w.P}/ai/insights/digest`, { period: "daily" });
    expect(r.sent).toBeGreaterThan(0);
    const rows = await w.e.db.query<{ recipient_id: string; body: string; insights: number }>(`select recipient_id, body, insights from sm_ai_digests where org_id = $1`, [w.e.org]);
    const desk = rows.find((x) => x.recipient_id === w.p.agent.userId);
    expect(desk?.body).toMatch(/بینش‌های/);
    const net = rows.find((x) => x.recipient_id === w.p.other.userId);
    if (net) expect(net.body).not.toMatch(/رخدادها: ۱۵/);
    // a digest is the recipient's own: nobody else reads it through the record API
    const own = await w.p.agent.client.get(`${w.P}/r/ai_digest`);
    expect(own.rows.every((x: any) => x.recipient_id === w.p.agent.userId)).toBe(true);
    const others = await w.p.other.client.get(`${w.P}/r/ai_digest`);
    expect(others.rows.some((x: any) => x.recipient_id === w.p.agent.userId)).toBe(false);
    // a second run sends nothing twice
    expect((await w.o.post(`${w.P}/ai/insights/digest`, { period: "daily" })).sent).toBe(0);
  });
});
