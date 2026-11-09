// The routes of analytics and the scheduled deliveries: meta, questions without a model and narratives, Excel files,
// copies, certification (report administrators; a change by someone else drops it), ownership transfer, JSON export
// and import, widget previews; schedules (validation, next run), sending as each recipient with their own access
// (the Excel file attached to the recipient's own delivery, a requester gets nothing, an empty report skipped), and
// the tick that delivers what is due.
import { describe, it, expect, beforeAll } from "vitest";
import { tick } from "@server/jobs";
import { LIBRARY_DASHBOARDS } from "@shared/analytics/library";
import { analyticsWorld, type AnalyticsWorld } from "./analytics-helpers";

let w: AnalyticsWorld;
let report: Record<string, any>;
const spec = { v: 1, table: "incident", measures: [{ fn: "count" }], dims: [{ field: "assignment_group_id" }], viz: "bar" };

beforeAll(async () => {
  w = await analyticsWorld();
  report = (await w.sdm.client.post(`${w.P}/r/analytics_report`, { name: "رخدادها به تفکیک گروه", folder: "میز خدمت", spec })).row;
});

/** A raw request (binary answers). */
async function raw(c: { cookie: string }, method: string, path: string, body?: unknown): Promise<Response> {
  return w.e.app.fetch(new Request(`http://local.test/api${path}`, { method, headers: { "content-type": "application/json", cookie: c.cookie }, body: body === undefined ? undefined : JSON.stringify(body) }));
}

describe("meta, questions and narratives", () => {
  it("meta says who may author and administer, and which tables a person reports on", async () => {
    const o = await w.o.get(`${w.P}/analytics/meta`);
    expect(o).toMatchObject({ can_author: true, can_admin: true, seeded: true });
    const a = await w.p.agent.client.get(`${w.P}/analytics/meta`);
    expect(a.can_author).toBe(false);
    expect(a.can_admin).toBe(false);
    expect(a.tables.map((t: any) => t.key)).toContain("incident");
    expect(a.tables.map((t: any) => t.key)).not.toContain("analytics_score");
    const s = await w.sdm.client.get(`${w.P}/analytics/meta`);
    expect(s.can_author).toBe(true);
  });

  it("a Persian question becomes a definition run with the asker's access (rule-based without a model)", async () => {
    const mine = await w.p.other.client.post(`${w.P}/analytics/ask`, { question: "تعداد رخدادها به تفکیک اولویت" });
    expect(mine.ai).toBe(false);
    expect(mine.spec.table).toBe("incident");
    expect(mine.chips.map((c: any) => c.kind)).toEqual(expect.arrayContaining(["table", "measure", "dim"]));
    expect(mine.result.total_n).toBe(2);
    const vague = await w.p.other.client.post(`${w.P}/analytics/ask`, { question: "سلام خوبی" });
    expect(vague.spec).toBeNull();
    expect(vague.problem).toBeTruthy();
  });

  it("narratives come from the computed numbers", async () => {
    const n = await w.sdm.client.post(`${w.P}/analytics/narrate`, { report_id: report.id });
    expect(n.ai).toBe(false);
    expect(n.text).toContain("رخدادها");
    await w.p.agent.client.post(`${w.P}/analytics/narrate`, { report_id: report.id }, 404);
  });
});

describe("files, copies and administration", () => {
  it("Excel files hold what the downloader may see", async () => {
    const res = await raw(w.p.other.client, "POST", `${w.P}/analytics/xlsx`, { spec, title: "گروه‌ها" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
    expect(res.headers.get("content-disposition")).toContain(".xlsx");
    const byId = await raw(w.sdm.client, "GET", `${w.P}/analytics/reports/${report.id}/xlsx`);
    expect(byId.status).toBe(200);
    expect((await raw(w.p.agent.client, "GET", `${w.P}/analytics/reports/${report.id}/xlsx`)).status).toBe(404);
  });

  it("copies are private and the copier's own; readers without the create right cannot copy", async () => {
    const c = await w.sdm.client.post(`${w.P}/analytics/copy`, { table: "analytics_report", id: report.id });
    expect(c.row.owner_id).toBe(w.sdm.userId);
    expect(c.row.shares).toEqual([]);
    await w.p.agent.client.post(`${w.P}/analytics/copy`, { table: "analytics_report", id: report.id }, 403);
  });

  it("only report administrators certify; a change by someone else drops the certification", async () => {
    await w.sdm.client.post(`${w.P}/analytics/certify`, { table: "analytics_report", id: report.id, certified: true }, 403);
    const c = await w.o.post(`${w.P}/analytics/certify`, { table: "analytics_report", id: report.id, certified: true });
    expect(c.row.certified).toBe(true);
    const row = (await w.sdm.client.get(`${w.P}/r/analytics_report/${report.id}`)).row;
    const up = (await w.sdm.client.patch(`${w.P}/r/analytics_report/${report.id}`, { spec: { ...spec, viz: "column" }, version: row.version })).row;
    expect(up.certified).toBe(false);
    expect(up.viz).toBe("column");
    expect(up.spec_version).toBe(2);
  });

  it("ownership moves to an active member (administrators only)", async () => {
    const mine = (await w.sdm.client.post(`${w.P}/r/analytics_report`, { name: "گزارش جابه‌جا", spec })).row;
    await w.sdm.client.post(`${w.P}/analytics/transfer`, { table: "analytics_report", id: mine.id, owner_id: w.p.mim.userId }, 403);
    const t = await w.o.post(`${w.P}/analytics/transfer`, { table: "analytics_report", id: mine.id, owner_id: w.p.mim.userId });
    expect(t.row.owner_id).toBe(w.p.mim.userId);
    await w.p.mim.client.get(`${w.P}/r/analytics_report/${mine.id}`);
    await w.sdm.client.get(`${w.P}/r/analytics_report/${mine.id}`, 404);
  });

  it("JSON bundles carry definitions only, and import them as the importer's own", async () => {
    const dash = (await w.o.get(`${w.P}/r/analytics_dashboard?size=10`)).rows.find((d: any) => d.library_key === "service_desk");
    const bundle = await w.sdm.client.post(`${w.P}/analytics/export`, { dashboards: [dash.id], reports: [report.id] });
    expect(bundle.format).toBe("itsm.analytics");
    expect(JSON.stringify(bundle)).not.toContain(w.sdm.userId);
    expect(bundle.indicators.length).toBeGreaterThan(0);
    const r = await w.sdm.client.post(`${w.P}/analytics/import`, { bundle, folder: "واردشده" });
    expect(r.dashboards).toBe(1);
    expect(r.reports).toBe(1);
    expect(r.indicators).toBe(0); // the library's keys exist here: reused, not duplicated
    const d = (await w.sdm.client.get(`${w.P}/r/analytics_dashboard/${r.ids.dashboards[0]}`)).row;
    expect(d.owner_id).toBe(w.sdm.userId);
    expect(d.folder).toBe("واردشده");
    await w.p.agent.client.get(`${w.P}/r/analytics_dashboard/${d.id}`, 404);
    await w.p.agent.client.post(`${w.P}/analytics/import`, { bundle }, 403);
    await w.sdm.client.post(`${w.P}/analytics/import`, { bundle: { format: "other" } }, 400);
  });

  it("a widget being designed previews with the caller's access", async () => {
    const run = await w.p.other.client.post(`${w.P}/analytics/widgets/preview`, { widget: { id: "x", kind: "report", x: 0, y: 0, w: 6, h: 4, spec: { ...spec, viz: "column" } } });
    expect(run.kind).toBe("report");
    expect(run.result.total_n).toBe(2);
    const denied = await w.p.agent.client.post(`${w.P}/analytics/widgets/preview`, { widget: { id: "y", kind: "report", x: 0, y: 0, w: 6, h: 4, spec: { v: 1, table: "change_request", measures: [{ fn: "sum", field: "planned_cost" }], dims: [], viz: "score" } } });
    expect(denied.kind).toBe("restricted");
  });

  it("the library and the defaults are for report administrators", async () => {
    await w.sdm.client.post(`${w.P}/analytics/seed`, { force: true }, 403);
    await w.p.agent.client.post(`${w.P}/analytics/collect`, {}, 403);
    const lib = await w.p.agent.client.get(`${w.P}/analytics/library`);
    // every seeded dashboard whose tables exist (incident, change and — with the release module — release/DevOps)
    expect(lib.dashboards.length).toBe(LIBRARY_DASHBOARDS.length);
  });
});

describe("scheduled deliveries", () => {
  let schedule: Record<string, any>;
  it("are validated, and their next run computed in the organisation's time zone", async () => {
    await w.sdm.client.post(`${w.P}/r/analytics_schedule`, { name: "بی‌هدف", schedule: { kind: "daily", time: "08:00" } }, 400);
    await w.sdm.client.post(`${w.P}/r/analytics_schedule`, { name: "بد", report_id: report.id, schedule: { kind: "daily", time: "25:00" } }, 400);
    schedule = (
      await w.sdm.client.post(`${w.P}/r/analytics_schedule`, {
        name: "گزارش روزانهٔ گروه‌ها",
        report_id: report.id,
        schedule: { kind: "daily", time: "08:00" },
        recipients: [w.p.agent.userId, w.p.other.userId, w.p.req.userId],
        channels: ["in_app"],
        formats: ["xlsx", "summary", "link"],
        skip_if_empty: false,
      })
    ).row;
    expect(schedule.number).toMatch(/^SCD/);
    expect(Date.parse(schedule.next_run_at)).toBeGreaterThan(Date.now());
    // a schedule is its owner's: nobody else reads it
    await w.p.agent.client.get(`${w.P}/r/analytics_schedule/${schedule.id}`, 404);
  });

  it("send each recipient their own numbers; a recipient without access gets nothing", async () => {
    // the report is shared with the network group so its members read it
    const row = (await w.sdm.client.get(`${w.P}/r/analytics_report/${report.id}`)).row;
    await w.sdm.client.patch(`${w.P}/r/analytics_report/${report.id}`, { shares: [{ kind: "group", id: w.g.network }, { kind: "group", id: w.g.desk }], version: row.version });
    // «ارسال اکنون» queues the occurrence: the owner learns how many recipients, never what each one got
    const r = await w.sdm.client.post(`${w.P}/analytics/schedules/${schedule.id}/send`, {});
    expect(r).toEqual({ queued: true, recipients: 4 });
    await w.drain();
    const statuses = await w.e.db.query<{ recipient_id: string; status: string }>(`select recipient_id, status from sm_analytics_deliveries where org_id = $1 and schedule_id = $2`, [w.e.org, schedule.id]);
    const by = Object.fromEntries(statuses.map((o) => [o.recipient_id, o.status]));
    expect(by[w.sdm.userId]).toBe("sent");
    expect(by[w.p.agent.userId]).toBe("sent");
    expect(by[w.p.other.userId]).toBe("sent");
    expect(by[w.p.req.userId]).toBe("no_access");
    const mine = (await w.p.other.client.get(`${w.P}/r/analytics_delivery?size=10`)).rows;
    expect(mine.length).toBe(1);
    expect(mine[0].recipient_id).toBe(w.p.other.userId);
    const full = (await w.p.other.client.get(`${w.P}/r/analytics_delivery/${mine[0].id}`)).row;
    expect(full.summary).toContain("۲ رکورد");
    expect(full.status).toBe("sent");
    // the evidence is the recipient's alone
    await w.p.agent.client.get(`${w.P}/r/analytics_delivery/${mine[0].id}`, 404);
    const att = await w.p.other.client.get(`${w.P}/r/analytics_delivery/${mine[0].id}/attachments`);
    expect(att.attachments.length).toBe(1);
    expect(att.attachments[0].name).toMatch(/\.xlsx$/);
    const file = await raw(w.p.other.client, "GET", `${w.P}/attachments/${att.attachments[0].id}/content`);
    expect(file.status).toBe(200);
    // the notification service tells each recipient (rendered under their access)
    const queued = await w.e.db.one<{ n: number }>(`select count(*)::int as n from sm_jobs where kind = 'notify.send' and org_id = $1`, [w.e.org]);
    expect(queued!.n).toBeGreaterThanOrEqual(3);
    const s = (await w.sdm.client.get(`${w.P}/r/analytics_schedule/${schedule.id}`)).row;
    expect(s.last_result).toContain("۴ گیرنده پردازش شد");
    expect(s.last_result).not.toContain("دسترسی");
  });

  it("an empty report is skipped and logged when the schedule says so", async () => {
    const empty = (await w.sdm.client.post(`${w.P}/r/analytics_report`, { name: "رخدادهای گروه میز", spec: { ...spec, filter: { f: "assignment_group_id", op: "eq", v: w.g.desk } }, shares: [{ kind: "group", id: w.g.network }] })).row;
    const s = (await w.sdm.client.post(`${w.P}/r/analytics_schedule`, { name: "خالی", report_id: empty.id, schedule: { kind: "weekly", time: "09:00", weekdays: [0] }, recipients: [w.p.other.userId], include_owner: false, channels: ["in_app"], formats: ["summary"], skip_if_empty: true })).row;
    const r = await w.sdm.client.post(`${w.P}/analytics/schedules/${s.id}/send`, {});
    expect(r).toEqual({ queued: true, recipients: 1 });
    await w.drain();
    // empty under the recipient's access: logged on the recipient's own delivery, reported to the owner as processed
    const rows = await w.e.db.query<{ recipient_id: string; status: string }>(`select recipient_id, status from sm_analytics_deliveries where org_id = $1 and schedule_id = $2`, [w.e.org, s.id]);
    expect(rows).toEqual([expect.objectContaining({ recipient_id: w.p.other.userId, status: "empty" })]);
    const after = (await w.sdm.client.get(`${w.P}/r/analytics_schedule/${s.id}`)).row;
    expect(after.last_result).toContain("۱ گیرنده پردازش شد");
    expect(after.last_result).not.toContain("خالی");
  });

  it("the tick delivers what is due and moves the schedule to its next occurrence", async () => {
    await w.e.db.query(`update sm_analytics_schedules set next_run_at = now() - interval '1 minute' where id = $1`, [schedule.id]);
    const before = (await w.p.agent.client.get(`${w.P}/r/analytics_delivery?size=50`)).rows.length;
    await w.e.db.query(`insert into sm_jobs (org_id, kind, payload, run_at, dedupe_key) select $1, 'analytics.tick', '{}'::jsonb, now(), null where not exists (select 1 from sm_jobs where org_id = $1 and kind = 'analytics.tick' and status = 'queued')`, [w.e.org]).catch(() => undefined);
    await w.e.db.query(`update sm_jobs set run_at = now() where org_id = $1 and kind = 'analytics.tick' and status = 'queued'`, [w.e.org]);
    for (let i = 0; i < 6; i++) await tick(w.e.cfg, { budgetMs: 30_000 });
    const after = (await w.p.agent.client.get(`${w.P}/r/analytics_delivery?size=50`)).rows.length;
    expect(after).toBe(before + 1);
    const s = (await w.sdm.client.get(`${w.P}/r/analytics_schedule/${schedule.id}`)).row;
    expect(Date.parse(s.next_run_at)).toBeGreaterThan(Date.now());
  });
});
