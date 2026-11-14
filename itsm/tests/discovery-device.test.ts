// ATMs and the bank's device_status (design A §9.5, §17 «discovery-device»): the hold and the two-pass rule (flaps make
// no periods), the tool's own time for the periods (clamped into the open period), a person's correction detected
// through `device_applied` and respected, «در نگهداری» never set nor overwritten by a connector — on the pure step and
// end to end through the push API's service, the job `discovery.device_apply` and the bank's own asset write.
import { beforeAll, describe, expect, it } from "vitest";
import { deviceStep, mapDeviceStatus, type DeviceColumns, type DeviceRules } from "@shared/discovery/status";
import { createIn } from "@server/engine";
import { seedItamDefaults } from "@server/modules/itam";
import { setDeviceStatus } from "@server/modules/itam/bank";
import { applyDevice } from "@server/modules/discovery/device";
import { applyPushStatus } from "@server/modules/discovery/push";
import { loadConnector } from "@server/modules/discovery/runner";
import { discoveryWorld, type DiscoveryWorld, type Row } from "./discovery-helpers";

const T0 = Date.parse("2026-11-14T08:00:00Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const EMPTY: DeviceColumns = { device_reported: null, device_reported_since: null, device_pending: null, device_pending_since: null, device_pending_polls: null, device_applied: null, device_applied_at: null };
const PULL: DeviceRules = { hold_minutes: 10, manual_hold_hours: 24, pulled: true };
const PUSH: DeviceRules = { ...PULL, pulled: false };
const inService = { device_status: "in_service", device_status_at: at(-600) };

describe("the ATM hysteresis (design A §9.5)", () => {
  it("a pulled value waits out the hold and a second pass; the same listing read twice is one pass", () => {
    const a = deviceStep(EMPTY, inService, { value: "offline", at: at(0) }, PULL, T0);
    expect(a).toMatchObject({ apply: null, wake_at: at(10), next: { device_pending: "offline", device_pending_polls: 1, device_reported_since: at(0) } });
    // the hold passed but only one pass saw it
    expect(deviceStep(a.next, inService, { value: "offline", at: at(0) }, PULL, T0 + 11 * 60_000).apply).toBeNull();
    const b = deviceStep(a.next, inService, { value: "offline", at: at(11) }, PULL, T0 + 11 * 60_000);
    expect(b.apply).toEqual({ value: "offline", at: at(0) });
  });
  it("a pushed value with the tool's own time applies once it held, from that time", () => {
    expect(deviceStep(EMPTY, inService, { value: "out_of_cash", since: at(-15), at: at(0) }, PUSH, T0).apply).toEqual({ value: "out_of_cash", at: at(-15) });
    expect(deviceStep(EMPTY, inService, { value: "out_of_cash", since: at(-5), at: at(0) }, PUSH, T0)).toMatchObject({ apply: null, wake_at: at(5) });
  });
  it("a flap never opens a period; maintenance is never touched; unmapped values only inform", () => {
    const a = deviceStep(EMPTY, inService, { value: "offline", at: at(0) }, PUSH, T0);
    const back = deviceStep(a.next, inService, { value: "in_service", at: at(3) }, PUSH, T0 + 3 * 60_000);
    expect(back).toMatchObject({ apply: null, note: "same", next: { device_pending: null } });
    expect(deviceStep(back.next, inService, null, PUSH, T0 + 60 * 60_000).apply).toBeNull();
    const maint = { device_status: "maintenance", device_status_at: at(-30) };
    expect(deviceStep(EMPTY, maint, { value: "out_of_service", since: at(-60), at: at(0) }, PUSH, T0)).toMatchObject({ apply: null, note: "maintenance" });
    expect(deviceStep(EMPTY, inService, { value: "maintenance", since: at(-60), at: at(0) }, PUSH, T0).apply).toBeNull();
    expect(mapDeviceStatus("CASH_OUT", { cash_out: "out_of_cash" })).toBe("out_of_cash");
    expect(mapDeviceStatus("JAMMED", { cash_out: "out_of_cash" })).toBeNull();
    expect(deviceStep(EMPTY, inService, { value: null, at: at(0) }, PUSH, T0).note).toBe("unmapped");
  });
  it("a person's correction is respected until the tool reports a transition after it, or the manual hold passes", () => {
    const applied = { ...EMPTY, device_reported: "out_of_cash", device_reported_since: at(-60), device_applied: "out_of_cash", device_applied_at: at(-50) };
    const person = { device_status: "in_service", device_status_at: at(-10) };
    expect(deviceStep(applied, person, { value: "out_of_cash", since: at(-60), at: at(0) }, PUSH, T0)).toMatchObject({ apply: null, note: "person" });
    // a transition after the person's change: back to the hold
    const t = deviceStep(applied, person, { value: "offline", since: at(-5), at: at(0) }, PUSH, T0);
    expect(t).toMatchObject({ apply: null, note: "waiting", next: { device_pending: "offline" } });
    // a day later the person's value no longer holds the tool back
    expect(deviceStep(applied, person, { value: "out_of_cash", since: at(-60), at: at(25 * 60) }, PUSH, T0 + 25 * 3600_000).apply).toEqual({ value: "out_of_cash", at: at(-60) });
  });
});

describe("device_status from a tool, end to end (design A §9.5)", () => {
  let w: DiscoveryWorld;
  let conn: Row;
  let atm: Row;
  const periods = () => w.q<Row>(`select status, from_at, to_at, reason from sm_device_status_events where asset_id = $1 and deleted_at is null order by from_at`, [atm.id]);
  const asset = () => w.one<Row>(`select device_status, device_status_at, version from sm_assets where id = $1`, [atm.id]);
  const report = async (device_status: string, since?: string) => applyPushStatus(w.sys, (await loadConnector(w.e.db, w.e.org, conn.id))!, [{ match: { terminal_id: "1021" }, state: "up", device_status, ...(since ? { since } : {}) }], new Date());
  const later = (min: number) => applyDevice(w.sys, atm.id, conn.id, { now: Date.now() + min * 60_000 });
  const sec = (iso: string | Date) => Math.round(new Date(iso).getTime() / 1000);

  beforeAll(async () => {
    w = await discoveryWorld();
    await seedItamDefaults(w.e.cfg, w.e.org);
    await w.drain();
    const model = (await w.e.owner.post(`${w.P}/r/asset_model/query`, { filter: { f: "category", op: "eq", v: "atm" }, size: 1 })).rows[0].id;
    atm = await w.sys.write((tx) => createIn(tx, w.sys, "asset", { model_id: model, state: "in_use", terminal_id: "1021" }, { trusted: true }));
    // the ATM has been in service for two days
    await w.q(`update sm_device_status_events set from_at = now() - interval '2 days' where asset_id = $1`, [atm.id]);
    await w.q(`update sm_assets set device_status_at = now() - interval '2 days' where id = $1`, [atm.id]);
    conn = await w.connector({ name: "سوئیچ خودپردازها", kind: "push", device_hold_minutes: 10, device_status_map: { CASH_OUT: "out_of_cash", OFFLINE: "offline", IN_SERVICE: "in_service" } });
  }, 240_000);

  it("an ATM by terminal id changes device_status only after the hold, its period starting at the tool's time", async () => {
    const since = new Date(Date.now() - 4 * 60_000).toISOString();
    expect((await report("CASH_OUT", since))[0]).toMatchObject({ result: "updated", target: { table: "asset", id: atm.id } });
    expect((await asset()).device_status).toBe("in_service");
    const job = await w.one<Row>(`select run_at from sm_jobs where org_id = $1 and kind = 'discovery.device_apply' and status = 'queued'`, [w.e.org]);
    expect(sec(job.run_at)).toBe(sec(new Date(Date.parse(since) + 10 * 60_000)));
    // the job before the hold ends changes nothing and comes back
    expect(await later(1)).toMatchObject({ again: expect.any(Number) });
    expect((await asset()).device_status).toBe("in_service");
    await later(7);
    expect((await asset()).device_status).toBe("out_of_cash");
    const p = await periods();
    expect(p.map((x) => x.status)).toEqual(["in_service", "out_of_cash"]);
    // the tool's time, not the poll's: the old period ends and the new one starts when the ATM ran out of cash
    expect(sec(p[0].to_at)).toBe(sec(since));
    expect(sec(p[1].from_at)).toBe(sec(since));
    expect(p[1].reason).toContain("سوئیچ خودپردازها");
    expect(await w.one<Row>(`select device_applied, device_pending from sm_discovery_states where asset_id = $1`, [atm.id])).toEqual({ device_applied: "out_of_cash", device_pending: null });
  });

  it("a flap makes no period and no asset write", async () => {
    const before = { periods: (await periods()).length, version: (await asset()).version };
    await report("OFFLINE");
    await report("CASH_OUT");
    await later(30);
    expect((await periods()).length).toBe(before.periods);
    expect((await asset()).version).toBe(before.version);
  });

  it("a late value is clamped into the open period", async () => {
    const open = (await periods()).at(-1)!;
    await report("OFFLINE", new Date(Date.now() - 3 * 86400_000).toISOString());
    await later(1);
    const p = await periods();
    expect(p.at(-1)!.status).toBe("offline");
    expect(sec(p.at(-1)!.from_at)).toBe(sec(new Date(Date.parse(new Date(open.from_at).toISOString()) + 1000)));
  });

  it("a person's correction is respected; manual maintenance is never overwritten", async () => {
    const owner = await w.e.ctxOf(w.e.ownerId);
    await setDeviceStatus(owner, atm.id, { status: "in_service", reason: "بررسی حضوری" });
    const n = (await periods()).length;
    // the tool still says offline, as before the person's change: respected
    await report("OFFLINE", new Date(Date.now() - 3 * 86400_000).toISOString());
    await later(30);
    expect((await asset()).device_status).toBe("in_service");
    // a transition the tool reports after the person's change goes through the hold again
    await report("IN_SERVICE");
    await new Promise((r) => setTimeout(r, 1100));
    await report("CASH_OUT", new Date().toISOString());
    await later(11);
    expect((await asset()).device_status).toBe("out_of_cash");
    expect((await periods()).length).toBe(n + 1);
    // maintenance set by a person stays, whatever the tool says and however long it held
    await setDeviceStatus(owner, atm.id, { status: "maintenance", reason: "سرویس دوره‌ای" });
    await report("OFFLINE", new Date(Date.now() - 3600_000).toISOString());
    await later(120);
    expect((await asset()).device_status).toBe("maintenance");
    expect(await w.one<Row>(`select device_pending from sm_discovery_states where asset_id = $1`, [atm.id])).toEqual({ device_pending: null });
  });
});
