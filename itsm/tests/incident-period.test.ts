// Periodic incident reviews (INC-080): who runs them (agents and managers, never a requester; the owner and the
// participants compute), the figures of the period from what the reviewer may read, a stable sample, the report draft
// that respects the reviewers' edits unless rewritten on request, and the sweep drafting the next review when due.
import { describe, it, expect, beforeAll } from "vitest";
import { addDays } from "@shared/jalali";
import { localDate } from "@shared/incident/logic";
import { sweep } from "@server/modules/incident";
import { world, backdate, type World } from "./incident-helpers";

let w: World;
const today = () => localDate(Date.now(), "Asia/Tehran");

beforeAll(async () => {
  w = await world();
});

describe("a periodic review", () => {
  it("is run by agents and managers; its figures come from the period's incidents", async () => {
    await w.p.req.client.post(`${w.P}/r/incident_period_review`, { title: "x", period_from: today(), period_to: today() }, 403);
    const bad = await w.p.mim.client.post(`${w.P}/r/incident_period_review`, { title: "x", period_from: today(), period_to: addDays(today(), -2) }, 400);
    expect(JSON.stringify(bad.error)).toContain("پس از آغاز");

    const net1 = await w.incident({ short_description: "قطعی وای‌فای طبقهٔ سوم", category: "network", subcategory: "network.wifi" });
    await w.incident({ short_description: "قطعی وای‌فای طبقهٔ دوم", category: "network", subcategory: "network.wifi" });
    await w.incident({ short_description: "چاپگر کاغذ گیر می‌کند", category: "hardware", subcategory: "hardware.printer" });
    await w.o.post(`${w.P}/r/incident/${net1.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "نقطهٔ دسترسی تعویض شد" } });

    const review = (await w.p.mim.client.post(`${w.P}/r/incident_period_review`, { title: "بازبینی آزمایشی", period_from: addDays(today(), -3), period_to: addDays(today(), 1), review_trigger: "manual" })).row;
    // only the owner and participants (or a manager of its group) compute it
    await w.p.other.client.post(`${w.P}/incident/period-reviews/${review.id}/compute`, {}, 403);
    const r = (await w.p.mim.client.post(`${w.P}/incident/period-reviews/${review.id}/compute`, {})).row;
    expect([r.stats.opened, r.stats.resolved]).toEqual([3, 1]);
    expect(r.stats.top_categories[0]).toEqual({ key: "network", count: 2 });
    expect(r.stats.new_subcategories).toEqual(["hardware.printer", "network.wifi"]);
    expect(r.sample_ids).toEqual([net1.id]);
    expect(r.report).toContain("3 رخداد ثبت شد و 1 رخداد حل شد");
    expect(r.computed_at).toBeTruthy();

    // the reviewers' report stays theirs unless they ask for a rewrite
    await w.p.mim.client.patch(`${w.P}/r/incident_period_review/${review.id}`, { report: "گزارش ویرایش‌شده", version: r.version });
    const kept = (await w.p.mim.client.post(`${w.P}/incident/period-reviews/${review.id}/compute`, {})).row;
    expect(kept.report).toBe("گزارش ویرایش‌شده");
    const rewritten = (await w.p.mim.client.post(`${w.P}/incident/period-reviews/${review.id}/compute`, { overwrite: true })).row;
    expect(rewritten.report).toContain("## خلاصهٔ دوره");

    // improvement actions hang under it; completing it asks for findings
    await w.p.pm.client.post(`${w.P}/r/corrective_action`, { short_description: "به‌روزرسانی الگوی قطعی وای‌فای", action_type: "prevent", period_review_id: review.id });
    await w.p.mim.client.post(`${w.P}/r/incident_period_review/${review.id}/transition`, { to: "completed" }, 400);
    const done = await w.p.mim.client.post(`${w.P}/r/incident_period_review/${review.id}/transition`, { to: "completed", data: { findings: "قطعی‌های وای‌فای تکراری‌اند؛ مشکل ثبت شود." } });
    expect(done.row.state).toBe("completed");
  });
});

describe("the sweep", () => {
  it("drafts the next review once the history reaches the settings' period", async () => {
    const v = await world();
    const cfg = (await v.o.get(`${v.P}/r/incident_config`)).rows[0];
    await v.o.patch(`${v.P}/r/incident_config/${cfg.id}`, { period_review_days: 7, version: cfg.version });
    const old = await v.incident({ short_description: "رخداد قدیمی", category: "software", subcategory: "software.office" });
    expect((await sweep(v.sys)).period_review).toBeNull();
    await backdate(v.e, "sm_incidents", old.id, "opened_at", 10);
    const first = await sweep(v.sys);
    expect(first.period_review).toBeTruthy();
    const r = (await v.o.get(`${v.P}/r/incident_period_review/${first.period_review}`)).row;
    expect([r.review_trigger, r.period_from, r.period_to]).toEqual(["scheduled", addDays(today(), -7), addDays(today(), -1)]);
    expect(r.computed_at).toBeTruthy();
    // not again until the next period is over
    expect((await sweep(v.sys)).period_review).toBeNull();
  });
});
