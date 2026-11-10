// Review fixes of predictive AI, insights and «پرسش تحلیلی» (each case failed before its fix):
//   · the assignment rules' predictor never routes to a retired or deleted group (and training forgets it)
//   · «ثبت مسئله» copies no member's number or title into the problem
//   · deciding a prediction needs the record's write access; dismissing a cluster needs the problem right and every
//     member readable
//   · «اعمال» takes the model's answer now (a retrained model, an edited text), not only the stored prediction's
//   · the models' acceptance is counted over the same predictions (never above 100%)
//   · an insight's narrative runs under the policies of its table and of the table its numbers come from
//   · alert storms: an hourly check of the event tables, each hour once, never configuration tables
//   · a recomputed period keeps its cards (ids, announcements); the backlog card's visibility is asked of what it counted
//   · the SLA breach model scores with the feature it was trained on
//   · forecasts take the default calendar's holiday sets only
//   · «پرسش تحلیلی» is offered only to readers of reports
import { beforeAll, describe, expect, it } from "vitest";
import { createIn } from "@server/engine";
import { memberCtx } from "@server/access";
import { modelRow, runModel } from "@server/modules/ai/ml";
import { mulberry32 } from "@server/modules/ai/ml/core/rng";
import { slaOpen } from "@server/modules/ai/ml/risk-models";
import { slaRiskDef } from "@server/modules/ai/ml/specs";
import { holidaysBetween } from "@server/modules/ai/ml/forecast";
import { canSee, computeInsights, insightRows, insightTables, periodOf, saveInsights, saveStorms, stormInsights } from "@server/modules/ai/insights";
import { dataUsePlan } from "@server/modules/ai/datause";
import { gateAllows } from "@shared/access";
import { tableDef } from "@shared/tables";
import { todayISO } from "@shared/jalali";
import { uuidv7 } from "@shared/id";
import { world, type World } from "./incident-helpers";

const TEXTS: Record<string, string[]> = {
  network: ["اینترنت قطع است", "وای‌فای طبقه دوم وصل نمی‌شود", "شبکه خیلی کند است", "وی‌پی‌ان وصل نمی‌شود", "سوییچ شبکه خاموش شد"],
  email: ["ایمیل ارسال نمی‌شود", "صندوق ایمیل پر شده است", "اوت‌لوک باز نمی‌شود", "ایمیل‌ها به دستم نمی‌رسد"],
  hardware: ["لپ‌تاپ روشن نمی‌شود", "چاپگر کاغذ گیر کرده", "صفحه نمایش سیاه است", "کیبورد کار نمی‌کند"],
};
const NOISE = ["لطفا", "فوری", "بررسی", "امروز", "صبح", "همکار", "دوباره", "واحد"];

let w: World;
let hw = "";
const ids: Record<string, string[]> = {};
const GROUP_KEY = "classify:incident:assignment_group_id";
const CAT_KEY = "classify:incident:category";

beforeAll(async () => {
  w = await world({ preset: "need_to_know" });
  hw = (await w.o.post(`${w.P}/r/group`, { name: "سخت‌افزار", types: ["assignment"] })).row.id as string;
  const r = mulberry32(5);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const groupOf: Record<string, string> = { network: w.g.network, email: w.g.desk, hardware: hw };
  await w.sys.write(async (tx) => {
    for (const [category, texts] of Object.entries(TEXTS)) {
      ids[category] = [];
      for (let i = 0; i < 30; i++) {
        const row = await createIn(tx, w.sys, "incident", { short_description: `${pick(texts)} ${pick(NOISE)}`, description: `${pick(NOISE)} ${pick(texts)}`, category: category === "email" ? "email" : category, assignment_group_id: groupOf[category] }, { trusted: true });
        ids[category].push(String(row.id));
      }
    }
  });
  await w.drain();
  await w.o.get(`${w.P}/ai/ml/models`);
  await w.drain();
  await runModel(w.e.cfg, w.e.org, CAT_KEY, { force: true });
  await runModel(w.e.cfg, w.e.org, GROUP_KEY, { force: true });
}, 300_000);

describe("predictions", () => {
  it("never routes a record to a retired or deleted group, and training forgets it", async () => {
    expect((await modelRow(w.e.db, w.e.org, GROUP_KEY))!.status).toBe("ready");
    await w.o.patch(`${w.P}/ai/ml/models/${encodeURIComponent(GROUP_KEY)}`, { threshold_apply: 0.5 });
    await w.o.post(`${w.P}/r/assignment_rule`, { name: "مسیریابی هوشمند", table_key: "incident", ai_group: true, sort_order: 1 });
    const routed = await w.incident({ short_description: "وی‌پی‌ان و اینترنت شبکه قطع است" });
    expect(routed.assignment_group_id).toBe(w.g.network);
    // the network group is retired: the prediction is not applied
    try {
      const g = (await w.o.get(`${w.P}/r/group/${w.g.network}`)).row;
      await w.o.patch(`${w.P}/r/group/${w.g.network}`, { active: false, version: g.version });
      const off = await w.incident({ short_description: "وی‌پی‌ان و اینترنت شبکه قطع است دوباره" });
      expect(off.assignment_group_id ?? null).not.toBe(w.g.network);
      // … and deleted: reporting still works (no reference to a deleted group is written)
      await w.e.db.query(`update sm_groups set deleted_at = now() where id = $1`, [w.g.network]);
      const gone = await w.incident({ short_description: "اینترنت و شبکه وی‌پی‌ان قطع است" });
      expect(gone.assignment_group_id ?? null).not.toBe(w.g.network);
      // the next training leaves the dead group out of the labels
      await runModel(w.e.cfg, w.e.org, GROUP_KEY, { force: true });
      const p = await w.e.db.one<{ params: any; status: string }>(`select params, status from sm_ai_models where org_id = $1 and key = $2`, [w.e.org, GROUP_KEY]);
      expect(p!.params.labels).not.toContain(w.g.network);
      expect(p!.params.labels.length).toBeGreaterThanOrEqual(2);
    } finally {
      await w.e.db.query(`update sm_groups set deleted_at = null where id = $1`, [w.g.network]);
      const g = (await w.o.get(`${w.P}/r/group/${w.g.network}`)).row;
      await w.o.patch(`${w.P}/r/group/${w.g.network}`, { active: true, version: g.version });
    }
  });

  it("lets only those who may change a record decide its suggestion; «اعمال» takes the model's answer now", async () => {
    const mine = await w.incident({ short_description: "ایمیل ارسال نمی‌شود فوری", caller_id: w.p.req.userId });
    await w.drain();
    const view = await w.p.req.client.get(`${w.P}/ai/ml/records/incident/${mine.id}`).catch(() => null);
    const stored = await w.e.db.one<{ id: string }>(`select id from sm_ai_predictions where org_id = $1 and model_key = $2 and record_id = $3`, [w.e.org, CAT_KEY, mine.id]);
    expect(stored).toBeTruthy();
    if (view) expect(view.predictions.length).toBeGreaterThanOrEqual(0);
    // the requester reads their incident but does not work it: no dismissal (decided for those who do)
    await w.p.req.client.post(`${w.P}/ai/ml/predictions/${stored!.id}/dismiss`, {}, 403);
    await w.p.auditor.client.post(`${w.P}/ai/ml/predictions/${stored!.id}/dismiss`, {}, 403);
    expect((await w.e.db.one<{ status: string }>(`select status from sm_ai_predictions where id = $1`, [stored!.id]))!.status).toBe("open");
    // a stored prediction from an older model: the record page offers the model's answer now, and «اعمال» takes it
    const net = await w.incident({ short_description: "اینترنت ساختمان قطع است فوری", assignment_group_id: w.g.network });
    await w.drain();
    const pid = (await w.e.db.one<{ id: string }>(`select id from sm_ai_predictions where org_id = $1 and model_key = $2 and record_id = $3`, [w.e.org, CAT_KEY, net.id]))!.id;
    await w.e.db.query(`update sm_ai_predictions set value = 'hardware', alternatives = $2::jsonb where id = $1`, [pid, JSON.stringify([{ value: "hardware", score: 0.6 }, { value: "email", score: 0.3 }])]);
    const page = await w.p.other.client.get(`${w.P}/ai/ml/records/incident/${net.id}`);
    const cat = page.predictions.find((p: any) => p.field === "category");
    expect(cat.value).toBe("network");
    await w.p.other.client.post(`${w.P}/ai/ml/predictions/${pid}/apply`, { value: "network" });
    expect((await w.o.get(`${w.P}/r/incident/${net.id}`)).row.category).toBe("network");
  });

  it("counts acceptance over the same predictions, never above 100%", async () => {
    await w.e.db.query(`update sm_ai_predictions set status = 'applied', actual = value where org_id = $1 and model_key = $2`, [w.e.org, CAT_KEY]);
    const m = ((await w.o.get(`${w.P}/ai/ml/models`)).models as any[]).find((x) => x.key === CAT_KEY);
    expect(m.predictions.applied).toBeGreaterThan(0);
    expect(m.predictions.agreed).toBeLessThanOrEqual(m.predictions.outcome);
  });
});

describe("clusters", () => {
  it("open a problem without copying members, and are dismissed only by those who could open one and read them all", async () => {
    await w.sys.write(async (tx) => {
      for (let i = 0; i < 6; i++) await createIn(tx, w.sys, "incident", { short_description: `خطای اتصال سرور حسابداری محرمانه ${["امروز", "صبح", "دوباره", "باز", "هم", "باز هم"][i]}`, assignment_group_id: w.g.network }, { trusted: true });
    });
    await w.drain();
    await runModel(w.e.cfg, w.e.org, "cluster:incident", { force: true });
    const clusters = (await w.p.pm.client.get(`${w.P}/ai/ml/clusters?table=incident`)).clusters as any[];
    const c = clusters.find((x) => x.members.some((m: any) => /حسابداری/.test(m.title)));
    expect(c).toBeTruthy();
    // the auditor reads them all but opens no problem: no dismissal for the organisation
    await w.p.auditor.client.post(`${w.P}/ai/ml/clusters/${c.id}/dismiss`, { table: "incident" }, 403);
    const made = await w.p.pm.client.post(`${w.P}/ai/ml/clusters/${c.id}/problem`, { table: "incident", title: "اتصال سرور حسابداری" });
    const problem = (await w.o.get(`${w.P}/r/problem/${made.problem_id}`)).row;
    expect(String(problem.description)).not.toMatch(/حسابداری محرمانه/);
    for (const m of c.members) if (m.number) expect(String(problem.description)).not.toContain(m.number);
  });
});

describe("insights", () => {
  it("narrate under the card's own table's policy as well as its scope table's", async () => {
    expect(insightTables({ table_key: "sec_incident", scope: { table: "task_sla" } })).toEqual(["sec_incident", "task_sla"]);
    expect((await dataUsePlan(w.sys, ["task_sla"])).use).toBe("cloud");
    expect((await dataUsePlan(w.sys, insightTables({ table_key: "sec_incident", scope: { table: "task_sla" } }))).use).not.toBe("cloud");
  });

  it("check alert storms hourly on the event tables only, each hour once", async () => {
    const hourEnd = Date.now() - (Date.now() % 3_600_000);
    const inHour = new Date(hourEnd - 30 * 60_000).toISOString();
    await w.sys.write(async (tx) => {
      for (let i = 0; i < 25; i++) {
        const a = await createIn(tx, w.sys, "alert", { short_description: `CPU بالا ${i}`, severity: "minor" }, { trusted: true });
        await tx.query(`update ${tableDef("alert")!.table} set created_at = $2 where id = $1`, [a.id, inHour]);
        const r = await createIn(tx, w.sys, "event_rule", { name: `قاعدهٔ وارده ${i}`, action: "set", set_severity: "minor" }, { trusted: true });
        await tx.query(`update ${tableDef("event_rule")!.table} set created_at = $2 where id = $1`, [r.id, inHour]);
      }
    });
    const drafts = await stormInsights(w.sys, [hourEnd]);
    expect(drafts.map((d) => d.table)).toEqual(["alert"]);
    expect(await saveStorms(w.sys, drafts, "Asia/Tehran")).toBe(1);
    expect(await saveStorms(w.sys, await stormInsights(w.sys, [hourEnd]), "Asia/Tehran")).toBe(0);
    const p = periodOf("daily", todayISO("Asia/Tehran"), "Asia/Tehran");
    expect((await computeInsights(w.sys, p)).some((d) => d.kind === "alert_storm")).toBe(false);
  });

  it("keep a recomputed card (its id and announcement), and ask the backlog card's visibility of what it counted", async () => {
    const p = periodOf("daily", todayISO("Asia/Tehran"), "Asia/Tehran");
    await saveInsights(w.sys, p, await computeInsights(w.sys, p));
    const before = (await insightRows(w.sys, { period: "daily", key: p.key, limit: 500 })).find((r) => r.kind === "backlog" && r.table_key === "incident")!;
    expect(before).toBeTruthy();
    await w.e.db.query(`update sm_ai_insights set notified_at = now() where id = $1`, [before.id]);
    await saveInsights(w.sys, p, await computeInsights(w.sys, p));
    const again = (await insightRows(w.sys, { period: "daily", key: p.key, limit: 500 })).find((r) => r.kind === "backlog" && r.table_key === "incident")!;
    expect(again.id).toBe(before.id);
    expect(again.notified_at).toBeTruthy();
    // the desk agent does not read the network group's incidents (need to know): the card is not theirs, and stays so
    // once those incidents are closed
    const agent = await memberCtx(w.e.cfg, w.e.org, w.p.agent.userId);
    expect(await canSee(agent, again)).toBe(false);
    await w.e.db.query(`update sm_incidents set active = false, closed_at = now() + interval '1 minute' where org_id = $1 and assignment_group_id = $2`, [w.e.org, w.g.network]);
    expect(await canSee(await memberCtx(w.e.cfg, w.e.org, w.p.agent.userId), again)).toBe(false);
  });
});

describe("the SLA breach model and forecasts", () => {
  it("scores an open SLA with the share of its span gone by on the wall clock (the training feature)", async () => {
    const inc = await w.incident({ short_description: "سرور ایمیل کند است", impact: "1", urgency: "1" });
    const sla = await w.e.db.one<{ id: string; start_at: string; planned_end_at: string }>(`select id, start_at, planned_end_at from sm_task_slas where org_id = $1 and record_id = $2 and stage = 'in_progress' limit 1`, [w.e.org, inc.id]);
    expect(sla).toBeTruthy();
    await w.e.db.query(`update sm_task_slas set percent = 95 where id = $1`, [sla!.id]);
    const rows = await slaOpen(w.sys, slaRiskDef(tableDef("incident")!));
    const row = rows.find((r) => r.record_id === inc.id)!;
    const wall = (Date.now() - Date.parse(sla!.start_at)) / (Date.parse(sla!.planned_end_at) - Date.parse(sla!.start_at));
    expect(Math.abs(Number(row.x.elapsed) - wall)).toBeLessThan(0.05);
  });

  it("takes as holidays only the default calendar's sets", async () => {
    await w.e.db.query(`insert into sm_holidays (id, org_id, date, title, holiday_set, active, half_day) values ($1, $2, '2031-03-21', 'نوروز', 'ir', true, false), ($3, $2, '2031-03-25', 'تعطیلی کارخانه', 'site_a', true, false)`, [uuidv7(), w.e.org, uuidv7()]);
    const days = await holidaysBetween(w.sys, "2031-03-01", "2031-03-31");
    expect(days.has("2031-03-21")).toBe(true);
    expect(days.has("2031-03-25")).toBe(false);
  });
});

describe("«پرسش تحلیلی»", () => {
  it("is offered in the menu and the palette only to readers of reports", async () => {
    const { aiUi } = await import("@ui/modules/ai/index");
    const item = aiUi.nav!.flatMap((g: any) => g.items ?? []).find((i: any) => i.key === "ai:ask-report");
    const search = aiUi.searches!.find((s) => s.key === "ai:ask-report")!;
    const none = { ai: { read: "all" }, reports: { read: "none" } } as never;
    const some = { ai: { read: "all" }, reports: { read: "all" } } as never;
    for (const gate of [item.access, search.access]) {
      expect(gate).toBeTruthy();
      expect(gateAllows(none, gate)).toBe(false);
      expect(gateAllows(some, gate)).toBe(true);
    }
  });
});
