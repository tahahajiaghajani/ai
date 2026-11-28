// The push API (design A §12, §17 «discovery-push»): batches are always 202 and idempotent by batch id (the same id
// again answers the stored outcome, nothing reprocessed); records are checked one by one (bad ones by index, refused
// fields dropped with a warning); a snapshot finalises only once every part arrived (in any order) and is abandoned
// after 24 h with parts missing; a complete problem set is diffed; the status endpoint matches by tool id, terminal
// id, serial, hostname or address, never creates, and refuses a device value sent with a hostname or an address; only
// the connector's push user with the scope may push.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIn } from "@server/engine";
import { seedItamDefaults } from "@server/modules/itam";
import { STRONG_ONLY_MESSAGE } from "@server/modules/discovery/device";
import { PUSH_MESSAGES, pushBatchJob } from "@server/modules/discovery/push";
import { resetStatusThrottles } from "@server/modules/discovery/status";
import { Client } from "./helpers";
import { discoveryWorld, type DiscoveryWorld, type Row } from "./discovery-helpers";

describe("the push API (design A §12)", () => {
  let w: DiscoveryWorld;
  let api: Client;
  let key: string;
  let user: Row;
  let conn: Row;
  let atmModel: string;
  const P = () => `/v1/discovery/${conn.id}`;
  const rec = (id: string, extra: Record<string, unknown> = {}) => ({ external_id: id, kind: "host", class: "server", name: id, hostname: id, serial_number: `SN-${id}`, ...extra });

  /** Run the queue until the discovery work in it is done (jobs that wait a few seconds are pulled forward). */
  const settle = async (rounds = 40) => {
    for (let i = 0; i < rounds; i++) {
      await w.drain();
      const due = await w.q(
        `update sm_jobs set run_at = now() where org_id = $1 and status = 'queued' and kind in ('discovery.push_batch', 'discovery.pull', 'discovery.status', 'discovery.stale', 'discovery.push_status')
           and run_at > now() and run_at < now() + interval '1 hour' returning id`,
        [w.e.org],
      );
      if (!due.length) break;
    }
  };
  const itemsOf = () => w.q<Row>(`select external_id, state, ci_id, status from sm_discovery_items where connector_id = $1 and deleted_at is null order by external_id`, [conn.id]);

  beforeAll(async () => {
    w = await discoveryWorld();
    await seedItamDefaults(w.e.cfg, w.e.org);
    await w.drain();
    resetStatusThrottles();
    user = (await w.e.owner.post(`${w.P}/r/integration_user`, { name: "سامانهٔ پایش شعب", rate_limit: 1000 })).row;
    await w.e.owner.put(`${w.P}/integration/users/${user.id}/roles`, { roles: ["requester"] });
    key = (await w.e.owner.post(`${w.P}/integration/users/${user.id}/keys`, { name: "کلید ارسال", scopes: [{ table: "discovery_item", ops: ["create"] }] })).key;
    api = new Client(w.e.app);
    api.token = key;
    conn = await w.connector({ name: "ارسال از سامانهٔ پایش", kind: "push", push_user_id: user.user_id });
    atmModel = (await w.e.owner.post(`${w.P}/r/asset_model/query`, { filter: { f: "category", op: "eq", v: "atm" }, size: 1 })).rows[0].id;
  }, 240_000);
  afterAll(() => resetStatusThrottles());

  it("only the connector's push user with the scope pushes, to an active push connector", async () => {
    const other = (await w.e.owner.post(`${w.P}/r/integration_user`, { name: "سامانهٔ دیگر" })).row;
    await w.e.owner.put(`${w.P}/integration/users/${other.id}/roles`, { roles: ["requester"] });
    const otherKey = (await w.e.owner.post(`${w.P}/integration/users/${other.id}/keys`, { name: "کلید دیگر", scopes: [{ table: "discovery_item", ops: ["create"] }] })).key;
    const unscoped = (await w.e.owner.post(`${w.P}/integration/users/${user.id}/keys`, { name: "بی‌مجوز", scopes: [{ table: "todo", ops: ["read"] }] })).key;
    const as = (k: string) => Object.assign(new Client(w.e.app), { token: k });
    expect((await as(otherKey).req("POST", `${P()}/batches`, { batch_id: "x", records: [] }, 403)).error.message).toBe(PUSH_MESSAGES.user);
    expect((await as(unscoped).req("POST", `${P()}/batches`, { batch_id: "x", records: [] }, 403)).error.message).toBe(PUSH_MESSAGES.scope);
    await api.req("POST", `/v1/discovery/00000000-0000-4000-8000-000000000000/batches`, { batch_id: "x", records: [] }, 404);
    const off = await w.connector({ name: "منبع خاموش", kind: "push", push_user_id: user.user_id, active: false });
    expect((await api.req("POST", `/v1/discovery/${off.id}/batches`, { batch_id: "x", records: [] }, 409)).error.message).toBe(PUSH_MESSAGES.inactive);
    expect((await api.req("POST", `${P()}/batches`, { records: [] }, 400)).error.message).toBe(PUSH_MESSAGES.batchId);
    // nothing was written by the refusals
    expect(await w.q(`select 1 from sm_discovery_batches where connector_id = $1`, [conn.id])).toEqual([]);
  });

  it("answers 202 with a status URL, then the same batch id answers the stored outcome without reprocessing", async () => {
    const body = {
      schema: "kariz.discovery/1", batch_id: "b-1",
      records: [rec("srv-a"), rec("srv-b", { owned_by: "someone" }), { kind: "host", name: "no id" }, rec("srv-c", { last_contact_at: new Date(Date.now() - 3600_000).toISOString() })],
    };
    const first = await api.req("POST", `${P()}/batches`, body, 202);
    expect(first).toMatchObject({ batch_id: "b-1", state: "queued", records: 4, rejected: 1, status_url: `/api/v1/discovery/${conn.id}/batches/b-1` });
    // a bad record is reported by its index; a field people own is dropped with a warning
    expect(first.errors).toEqual([expect.objectContaining({ index: 2 })]);
    expect(first.warnings.some((x: Row) => x.index === 1 && /owned_by/.test(x.message))).toBe(true);
    const jobs = await w.q(`select id from sm_jobs where org_id = $1 and kind = 'discovery.push_batch'`, [w.e.org]);
    expect(jobs.length).toBe(1);
    // the same id again (header or body): the stored outcome, nothing staged or queued again
    const again = await api.req("POST", `${P()}/batches`, { ...body, records: [rec("srv-z")] }, 200);
    expect(again).toMatchObject({ batch_id: "b-1", duplicate: true, records: 4, rejected: 1 });
    const res = await w.e.app.fetch(new Request(`http://local.test/api${P()}/batches`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "idempotency-key": "b-1" }, body: JSON.stringify({ records: [rec("srv-y")] }),
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).duplicate).toBe(true);
    expect((await w.q(`select id from sm_jobs where org_id = $1 and kind = 'discovery.push_batch'`, [w.e.org])).length).toBe(1);
    expect((await itemsOf()).map((i) => i.external_id)).toEqual(["srv-a", "srv-b", "srv-c"]);
    // reconciled under the pull path's budget, then the outcome
    await settle();
    const done = await api.get(`${P()}/batches/b-1`);
    expect(done).toMatchObject({ state: "done", created: 3, updated: 0, failed: 1 });
    expect((await itemsOf()).every((i) => i.state === "linked" && i.ci_id)).toBe(true);
    // the outcome does not change when asked again
    expect(await api.req("POST", `${P()}/batches`, body, 200)).toMatchObject({ state: "done", created: 3, duplicate: true });
    // a record older than what the item holds is ignored
    const older = await api.req("POST", `${P()}/batches`, { batch_id: "b-older", records: [rec("srv-c", { os: "older", last_contact_at: new Date(Date.now() - 10 * 86400_000).toISOString() })] }, 202);
    expect(older.warnings).toEqual([expect.objectContaining({ index: 0, message: PUSH_MESSAGES.older })]);
  });

  it("finalises a snapshot only when every part arrived (in any order), and abandons one missing parts after 24 h", async () => {
    await settle();
    // part 2 of 2 first: nothing goes «gone» yet
    await api.req("POST", `${P()}/batches`, { batch_id: "s1-p2", snapshot: { id: "s1", part: 2, parts: 2 }, records: [rec("srv-b"), rec("srv-c")] }, 202);
    await settle();
    expect((await itemsOf()).filter((i) => i.state === "gone")).toEqual([]);
    expect((await api.get(`${P()}/batches/s1-p2`)).snapshot).toMatchObject({ id: "s1", part: 2, parts: 2, state: "waiting" });
    // part 1 completes it: srv-a, listed by neither part, is gone; one complete inventory pass is recorded
    await api.req("POST", `${P()}/batches`, { batch_id: "s1-p1", snapshot: { id: "s1", part: 1, parts: 2 }, records: [rec("srv-d")] }, 202);
    await settle();
    const items = await itemsOf();
    expect(items.find((i) => i.external_id === "srv-a")?.state).toBe("gone");
    expect(items.filter((i) => i.state !== "gone").map((i) => i.external_id)).toEqual(["srv-b", "srv-c", "srv-d"]);
    const runs = await w.q<Row>(`select trigger, complete, items_total, cursor->>'snapshot' as snapshot from sm_discovery_runs where connector_id = $1 and cursor->>'snapshot' is not null`, [conn.id]);
    expect(runs).toEqual([{ trigger: "push", complete: true, items_total: 3, snapshot: "s1" }]);
    expect((await api.get(`${P()}/batches/s1-p1`)).snapshot.state).toBe("finalised");
    // a snapshot with a part missing: waits, then after 24 h is abandoned with a warning and marks nothing gone
    await api.req("POST", `${P()}/batches`, { batch_id: "s2-p1", snapshot: { id: "s2", part: 1, parts: 2 }, records: [rec("srv-d")] }, 202);
    await settle();
    expect((await api.get(`${P()}/batches/s2-p1`)).snapshot.state).toBe("waiting");
    const b = await w.one<Row>(`update sm_discovery_batches set received_at = now() - interval '25 hours' where connector_id = $1 and batch_id = 's2-p1' returning id`, [conn.id]);
    await pushBatchJob(w.sys, conn.id, b.id, { new: [], changed: [] });
    const abandoned = await api.get(`${P()}/batches/s2-p1`);
    expect(abandoned.snapshot.state).toBe("abandoned");
    expect(abandoned.warnings.at(-1).message).toBe(PUSH_MESSAGES.snapshotAbandoned);
    expect((await itemsOf()).filter((i) => i.state !== "gone").map((i) => i.external_id)).toEqual(["srv-b", "srv-c", "srv-d"]);
    // the missing part sent late under the same id: its records are taken, but an id with an abandoned part is never
    // finalised — the part waits for ever — so the guide's remedy is the whole snapshot again under a new id
    await api.req("POST", `${P()}/batches`, { batch_id: "s2-p2", snapshot: { id: "s2", part: 2, parts: 2 }, records: [rec("srv-b"), rec("srv-c")] }, 202);
    await settle();
    const late = await api.get(`${P()}/batches/s2-p2`);
    expect(late.state).toBe("done");
    expect(late.snapshot.state).toBe("waiting");
    expect((await api.get(`${P()}/batches/s2-p1`)).snapshot.state).toBe("abandoned");
    const finalised = async (id: string) =>
      (await w.q<Row>(`select 1 from sm_discovery_runs where connector_id = $1 and cursor->>'snapshot' = $2`, [conn.id, id])).length;
    expect(await finalised("s2")).toBe(0);
    // sent again whole under a new snapshot.id: finalised, one complete pass
    await api.req("POST", `${P()}/batches`, { batch_id: "s3-p1", snapshot: { id: "s3", part: 1, parts: 2 }, records: [rec("srv-d")] }, 202);
    await api.req("POST", `${P()}/batches`, { batch_id: "s3-p2", snapshot: { id: "s3", part: 2, parts: 2 }, records: [rec("srv-b"), rec("srv-c")] }, 202);
    await settle();
    expect((await api.get(`${P()}/batches/s3-p2`)).snapshot.state).toBe("finalised");
    expect(await finalised("s3")).toBe(1);
    expect((await itemsOf()).filter((i) => i.state !== "gone").map((i) => i.external_id)).toEqual(["srv-b", "srv-c", "srv-d"]);
  });

  it("diffs a complete problem set", async () => {
    await api.req("POST", `${P()}/batches`, { batch_id: "p-1", records: [], problems: { complete: true, items: [{ key: "e1", external_id: "srv-b", severity: "high", message: "دیسک پر است" }, { key: "e2", external_id: "srv-c", severity: "average" }] } }, 202);
    await api.req("POST", `${P()}/batches`, { batch_id: "p-2", records: [], problems: { complete: true, items: [{ key: "e2", external_id: "srv-c", severity: "average" }] } }, 202);
    const rows = await w.q<Row>(`select problem_key, cleared_at is not null as cleared from sm_discovery_problems where connector_id = $1 order by problem_key`, [conn.id]);
    expect(rows).toEqual([{ problem_key: "e1", cleared: true }, { problem_key: "e2", cleared: false }]);
    expect((await api.get(`${P()}/batches/p-2`)).problems).toMatchObject({ received: 1, opened: 0, cleared: 1, complete: true });
  });

  it("status only: matches by tool id, terminal id, serial and hostname, never creates, and refuses a device value with a hostname", async () => {
    await settle();
    const srvB = (await itemsOf()).find((i) => i.external_id === "srv-b")!;
    const atm = await w.sys.write((tx) => createIn(tx, w.sys, "asset", { model_id: atmModel, state: "in_use", terminal_id: "7001", serial_number: "ATM-SN-7001" }, { trusted: true }));
    const counts = async () => w.one<Row>(`select (select count(*)::int from sm_discovery_items where org_id = $1) as items, (select count(*)::int from sm_cis where org_id = $1) as cis, (select count(*)::int from sm_assets where org_id = $1) as assets`, [w.e.org]);
    const before = await counts();
    const r = await api.post(`${P()}/status`, {
      items: [
        { external_id: "srv-b", state: "down", availability: true, message: "ping قطع" },
        { match: { terminal_id: "7001" }, state: "up", device_status: "out_of_cash" },
        { match: { hostname: "SRV-C" }, state: "warning", device_status: "offline" },
        { match: { ip: "10.99.99.99" }, state: "down" },
        { external_id: "nope", state: "up" },
      ],
    });
    expect(r.items.map((x: Row) => x.result)).toEqual(["updated", "updated", "updated", "unmatched", "unmatched"]);
    expect(r.items[1].target).toEqual({ table: "asset", id: atm.id });
    expect(r.items[2].warnings).toEqual([STRONG_ONLY_MESSAGE]);
    // status alone never creates: no item, CI or asset more
    expect(await counts()).toEqual(before);
    // the item took the status, the ATM's target its own signal; the CI found by hostname got monitor status only
    expect((await w.one<Row>(`select status, status_message from sm_discovery_items where connector_id = $1 and external_id = 'srv-b'`, [conn.id]))).toEqual({ status: "down", status_message: "ping قطع" });
    const states = await w.q<Row>(`select target_table, target_id, monitor_status, device_reported, device_pending from sm_discovery_states where org_id = $1 and deleted_at is null`, [w.e.org]);
    expect(states.find((s) => s.target_id === srvB.ci_id)?.monitor_status).toBe("down");
    expect(states.find((s) => s.target_id === atm.id)).toMatchObject({ target_table: "asset", monitor_status: "up", device_reported: "out_of_cash", device_pending: "out_of_cash" });
    const srvC = (await itemsOf()).find((i) => i.external_id === "srv-c")!;
    expect(states.find((s) => s.target_id === srvC.ci_id)).toMatchObject({ monitor_status: "warning", device_reported: null, device_pending: null });
    // more than 200 items are queued
    const many = Array.from({ length: 201 }, () => ({ external_id: "srv-b", state: "up" }));
    expect(await api.req("POST", `${P()}/status`, { items: many }, 202)).toEqual({ state: "queued", items: 201 });
    await settle();
    expect((await w.one<Row>(`select status from sm_discovery_items where connector_id = $1 and external_id = 'srv-b'`, [conn.id])).status).toBe("up");
  });
});
