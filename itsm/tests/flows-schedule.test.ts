// Schedules: recurring records from a template (Jalali pills, the «ساخته به نام» member), scheduled flows, one firing
// per occurrence however often the scheduler runs, re-planning when a schedule changes, failed occurrences, the
// scheduler job itself, and a Windows app linked to the web version leaving its organisation's schedules to it.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { N, flowsKit, line, type FlowsKit } from "./flows-helpers";
import { runScheduler } from "@server/modules/flows";
import { schedulesRunHere } from "@server/modules/flows/scheduler";
import { zonedTime } from "@shared/flows";
import { fromJalali } from "@shared/jalali";
import type { ServerConfig } from "@server/context";

const TZ = "Asia/Tehran";
const jat = (jy: number, jm: number, jd: number, hh = 0, mm = 0) => zonedTime(fromJalali(jy, jm, jd), hh * 60 + mm, TZ);

describe("flows: schedules", () => {
  let o: EngineOrg;
  let k: FlowsKit;
  beforeAll(async () => {
    o = await engineOrg();
    k = flowsKit(o);
  });
  const timer = (kind: string, id: string) => o.db.one<{ next_at: string | null; last_at: string | null; last_error: string | null; spec_key: string }>(`select * from sm_flow_timers where org_id = $1 and kind = $2 and ref_id = $3`, [o.org, kind, id]);
  const todos = async (prefix: string) => (await o.owner.post(`${k.P}/r/todo/query`, { filter: { f: "short_description", op: "starts", v: prefix }, fields: ["short_description", "created_by", "due_at"] })).rows;

  it("creates a record from the template once per occurrence, as the chosen member, with Jalali pills", async () => {
    const s = await o.owner.post(`${k.P}/r/schedule`, {
      name: "نگهداری ماهانه",
      active: true,
      table_key: "todo",
      spec: { kind: "monthly", time: "09:00", days: [1] },
      template: { short_description: "نگهداری {{jalali.month_name}} {{jalali.year}}", due_at: "{{now + 3d}}" },
    });
    expect(s.row.run_as).toBe(o.ownerId);
    // saving queued the organisation's scheduler
    expect(await o.db.one(`select 1 from sm_jobs where org_id = $1 and kind = 'flows.scheduler' and status = 'queued'`, [o.org])).not.toBeNull();
    const t0 = jat(1404, 12, 20);
    await runScheduler(o.cfg, o.org, t0);
    const planned = await timer("schedule", s.row.id);
    expect(Date.parse(String(planned!.next_at))).toBe(jat(1405, 1, 1, 9));
    expect(await todos("نگهداری")).toHaveLength(0);
    const at = jat(1405, 1, 1, 9, 1);
    expect((await runScheduler(o.cfg, o.org, at)).fired).toBe(1);
    expect((await runScheduler(o.cfg, o.org, at)).fired).toBe(0);
    const rows = await todos("نگهداری");
    expect(rows.map((r: any) => r.short_description)).toEqual(["نگهداری فروردین 1405"]);
    expect(rows[0].created_by).toBe(o.ownerId);
    expect(Date.parse(rows[0].due_at)).toBe(jat(1405, 1, 1, 9) + 3 * 86_400_000);
    const after = await timer("schedule", s.row.id);
    expect(Date.parse(String(after!.next_at))).toBe(jat(1405, 2, 1, 9));
    const meta = (await o.owner.get(`${k.P}/r/schedule/${s.row.id}`)).meta.schedule;
    expect(meta.description).toBe("روز ۱ هر ماه ساعت ۰۹:۰۰");
    expect(Date.parse(meta.next_at)).toBe(jat(1405, 2, 1, 9));
    // a changed schedule is planned again from now; a deactivated one loses its timer
    const cur = await o.owner.get(`${k.P}/r/schedule/${s.row.id}`);
    await o.owner.patch(`${k.P}/r/schedule/${s.row.id}`, { spec: { kind: "yearly", time: "10:00", month: 1, day: 1 }, version: cur.row.version });
    await runScheduler(o.cfg, o.org, at);
    expect(Date.parse(String((await timer("schedule", s.row.id))!.next_at))).toBe(jat(1405, 1, 1, 10));
    const cur2 = await o.owner.get(`${k.P}/r/schedule/${s.row.id}`);
    await o.owner.patch(`${k.P}/r/schedule/${s.row.id}`, { active: false, version: cur2.row.version });
    await runScheduler(o.cfg, o.org, at);
    expect(await timer("schedule", s.row.id)).toBeNull();
  });

  it("refuses invalid schedules and templates when they are saved", async () => {
    const base = { name: "بد", active: true, table_key: "todo", spec: { kind: "daily", time: "08:00" }, template: { short_description: "x" } };
    await o.owner.post(`${k.P}/r/schedule`, { ...base, spec: { kind: "daily", time: "8" } }, 400);
    await o.owner.post(`${k.P}/r/schedule`, { ...base, template: { nope: 1 } }, 400);
    await o.owner.post(`${k.P}/r/schedule`, { ...base, template: {} }, 400);
    // an inactive schedule may wait for its template; the spec has a default
    const draft = await o.owner.post(`${k.P}/r/schedule`, { name: "پیش‌نویس", table_key: "todo" });
    expect(draft.row.spec).toEqual({ kind: "monthly", time: "09:00", days: [1] });
    await o.owner.post(`${k.P}/r/schedule`, { ...base, template: { reopen_count: 1 } }, 400);
    await o.owner.post(`${k.P}/r/schedule`, { ...base, table_key: "flow" }, 400);
    await o.owner.post(`${k.P}/r/schedule`, { ...base, table_key: "nothing" }, 400);
  });

  it("keeps the error of a failed occurrence and plans the next one", async () => {
    const s = await o.owner.post(`${k.P}/r/schedule`, { name: "خراب", active: true, table_key: "todo", spec: { kind: "daily", time: "08:00" }, template: { short_description: "x", priority: "{{jalali.year}}" } });
    const t0 = Date.UTC(2026, 5, 1, 0, 0);
    await runScheduler(o.cfg, o.org, t0);
    const first = Date.parse(String((await timer("schedule", s.row.id))!.next_at));
    const r = await runScheduler(o.cfg, o.org, first + 60_000);
    expect(r.errors).toBe(1);
    const t = await timer("schedule", s.row.id);
    expect(t!.last_error).toMatch(/اولویت/);
    expect(Date.parse(String(t!.next_at))).toBe(first + 86_400_000);
    expect((await o.owner.get(`${k.P}/r/schedule/${s.row.id}`)).meta.schedule.last_error).toMatch(/اولویت/);
    const cur = await o.owner.get(`${k.P}/r/schedule/${s.row.id}`);
    await o.owner.patch(`${k.P}/r/schedule/${s.row.id}`, { active: false, version: cur.row.version });
  });

  it("starts scheduled flows (their published schedule) once per occurrence", async () => {
    const flow = await k.live({ trigger: "schedule", schedule: { kind: "interval", every: 1, unit: "hour" } }, line(N("v", "set_vars", { vars: [{ name: "at", value: "{{trigger.scheduled_at}}" }] })));
    // simulated times in the future, so the real scheduler job of the queue (drained below) finds nothing due
    const t0 = Date.now() + 3_600_000;
    await runScheduler(o.cfg, o.org, t0);
    const next = Date.parse(String((await timer("flow", flow))!.next_at));
    expect(next).toBe(t0 + 3_600_000);
    expect((await runScheduler(o.cfg, o.org, next + 1000)).fired).toBe(1);
    expect((await runScheduler(o.cfg, o.org, next + 2000)).fired).toBe(0);
    await k.drain();
    const runs = await k.runs(flow);
    expect(runs).toHaveLength(1);
    expect(runs[0].trigger_kind).toBe("schedule");
    expect(runs[0].state).toBe("completed");
    expect((await k.detail(runs[0].id)).context.vars.at).toBe(new Date(next).toISOString());
    // a draft change does not move the published schedule until it is published
    const cur = await o.owner.get(`${k.P}/r/flow/${flow}`);
    await o.owner.patch(`${k.P}/r/flow/${flow}`, { schedule: { kind: "daily", time: "07:00" }, version: cur.row.version });
    const key = (await timer("flow", flow))!.spec_key;
    await runScheduler(o.cfg, o.org, next + 3000);
    expect((await timer("flow", flow))!.spec_key).toBe(key);
    await k.publish(flow);
    await runScheduler(o.cfg, o.org, next + 4000);
    expect((await timer("flow", flow))!.spec_key).not.toBe(key);
    await k.activate(flow, false);
    await runScheduler(o.cfg, o.org, next + 5000);
    expect(await timer("flow", flow)).toBeNull();
  });

  it("runs as a job that comes back every minute while something is scheduled", async () => {
    await o.db.query(`delete from sm_jobs where org_id = $1 and kind = 'flows.scheduler'`, [o.org]);
    await o.owner.post(`${k.P}/r/schedule`, { name: "روزانه", active: true, table_key: "todo", spec: { kind: "daily", time: "08:00" }, template: { short_description: "روزانه" } });
    await k.drain();
    const job = await o.db.one<{ status: string; run_at: string }>(`select status, run_at from sm_jobs where org_id = $1 and kind = 'flows.scheduler' order by created_at desc limit 1`, [o.org]);
    expect(job!.status).toBe("queued");
    expect(Date.parse(String(job!.run_at)) - Date.now()).toBeGreaterThan(30_000);
  });

  it("leaves the schedules of a synchronised organisation to the web version on a linked Windows app", async () => {
    const desktop = (org: string | null) =>
      ({ ...o.cfg, mode: "desktop", desktop: { info: async () => ({ cloud: { linked: !!org, org_id: org } }) } }) as unknown as ServerConfig;
    expect(await schedulesRunHere(o.cfg, o.org)).toBe(true);
    expect(await schedulesRunHere(desktop(o.org), o.org)).toBe(false);
  });
});
