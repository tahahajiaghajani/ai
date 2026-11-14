// Status (design A §9, §17 «discovery-status»): availability per kept kind (Zabbix ICMP vs agent vs a disk trigger,
// PRTG's Ping sensor, vCenter's powered-off VM, records, alerts); aggregation (maintenance wins, vCenter's off over a
// monitor's down, freshness); status writes make no `record.*` event and no `rev` bump on ci or asset; the event sink —
// an ICMP-down Zabbix webhook alert makes the CI «قطع» and its clear brings it back, a disk alert makes it «هشدار», an
// installation that only pushes alerts gets status; a status pass reads a kind's status and problems; the board and
// the panel follow the read rules.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { alertSignal, prtgStatus, recordState, vcenterStatus, zabbixStatus } from "@shared/discovery/availability";
import { aggregateStatus, freshForMs } from "@shared/discovery/status";
import { normalize } from "@shared/event/logic";
import { parseBody } from "@server/modules/event/ingest";
import { createIn } from "@server/engine";
import { ingest, type SourceRow } from "@server/modules/event/ingest";
import { connector as restConnector } from "@server/modules/discovery/connectors/rest";
import type { ConnectorKind } from "@server/modules/discovery/kind";
import { overrideKind } from "@server/modules/discovery/registry";
import { aggregateTargets, applyItemStatuses, resetStatusThrottles, statusPass, STATUS_READ_MESSAGE } from "@server/modules/discovery/status";
import { discoveryWorld, type DiscoveryWorld, type Row } from "./discovery-helpers";

const NOW = Date.parse("2026-11-14T10:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("availability per kind (design A §9.2)", () => {
  it("Zabbix: ICMP decides down, the agent alone unreachable, a disk trigger warns, information never", () => {
    expect(zabbixStatus({ icmp: 0, agent: 1 })).toMatchObject({ state: "down", availability: true });
    expect(zabbixStatus({ agent: 2 })).toMatchObject({ state: "unreachable", availability: true });
    expect(zabbixStatus({ icmp: 1, agent: 2 }).state).toBe("warning");
    expect(zabbixStatus({ icmp: 1, problems: [{ severity: 3, name: "/: Disk space is low" }] })).toMatchObject({ state: "warning", message: "/: Disk space is low" });
    expect(zabbixStatus({ icmp: 1, problems: [{ severity: 1 }, { severity: "Not classified" }] }).state).toBe("up");
    expect(zabbixStatus({ icmp: 1, problems: [{ severity: 4, tags: [{ tag: "scope", value: "availability" }] }] }).state).toBe("down");
    expect(zabbixStatus({ maintenance: true, icmp: 0 }).state).toBe("maintenance");
  });
  it("PRTG: the Ping (or primary) sensor decides; other sensors and «down partial» warn; paused is maintenance", () => {
    expect(prtgStatus([{ name: "Ping", type: "ping", status_raw: 5 }, { name: "CPU", status_raw: 3 }])).toMatchObject({ state: "down", availability: true });
    expect(prtgStatus([{ name: "Ping", type: "ping", status_raw: 8 }]).state).toBe("unreachable");
    expect(prtgStatus([{ name: "Ping", type: "ping", status_raw: 3 }, { name: "Disk", status_raw: 5 }]).state).toBe("warning");
    expect(prtgStatus([{ name: "Ping", type: "ping", status_raw: 3 }, { name: "Disk", status_raw: 14 }]).state).toBe("warning");
    expect(prtgStatus([{ name: "Ping", type: "ping", status_raw: 7 }]).state).toBe("maintenance");
    expect(prtgStatus([{ id: 42, name: "HTTP", status_raw: 13 }, { name: "Ping", type: "ping", status_raw: 3 }], { primary_sensor: 42 }).state).toBe("down");
    expect(prtgStatus([{ name: "Ping", type: "ping", status_raw: 3 }]).state).toBe("up");
  });
  it("vCenter: a powered-off VM is «خاموش», a host vCenter lost is unreachable; records and alerts", () => {
    expect(vcenterStatus({ type: "vm", power_state: "POWERED_OFF" }).state).toBe("off");
    expect(vcenterStatus({ type: "vm", power_state: "SUSPENDED" }).state).toBe("off");
    expect(vcenterStatus({ type: "host", connection_state: "NOT_RESPONDING" }).state).toBe("unreachable");
    expect(vcenterStatus({ type: "host", maintenance: true, connection_state: "CONNECTED" }).state).toBe("maintenance");
    expect(recordState({ state: "down" })).toBe("warning");
    expect(recordState({ state: "down", availability: true })).toBe("down");
    expect(recordState({ state: "off" })).toBe("off");
    expect(alertSignal({ status: "firing", resource: "icmpping" })).toBe("down");
    expect(alertSignal({ status: "firing", resource: "vfs.fs.size[/,pused]", severity: "minor" })).toBe("warning");
    expect(alertSignal({ status: "firing", resource: "Ping" })).toBe("down");
    expect(alertSignal({ status: "firing", metric: "http check", severity: "info" })).toBeNull();
    expect(alertSignal({ status: "resolved", resource: "icmpping" })).toBeNull();
    expect(alertSignal({ status: "firing", metric: "SNMP uptime" }, "^snmp")).toBe("down");
  });
});

describe("the prtg event format (design A §9.6)", () => {
  const spec = { kind: "prtg", default_severity: "minor" };
  it("takes a JSON body, JSON inside a form field, and plain form fields with PRTG's placeholders", () => {
    const json = normalize(spec, { device: "core-sw-01", host: "10.1.1.1", name: "Ping", status: "Down", message: "Destination unreachable", objid: "2041", datetime: "2026-11-14T09:00:00Z" }).events[0];
    expect(json).toMatchObject({ node: "10.1.1.1", resource: "Ping", status: "firing", severity: "major", fingerprint_hint: "prtg:2041", message: "Destination unreachable" });
    expect(alertSignal(json)).toBe("down");
    const inForm = normalize(spec, parseBody(`payload=${encodeURIComponent(JSON.stringify({ device: "core-sw-01", name: "Disk Free", status: "Warning", objid: "2042" }))}`, "application/x-www-form-urlencoded", "prtg")).events[0];
    expect(inForm).toMatchObject({ resource: "Disk Free", status: "firing", severity: "warning", fingerprint_hint: "prtg:2042" });
    expect(alertSignal(inForm)).toBe("warning");
    const plain = normalize(spec, parseBody("sitename=PRTG&device=core-sw-01&host=10.1.1.1&name=Ping&status=Up&down=&objid=2041&lastvalue=3%20msec", "application/x-www-form-urlencoded", "prtg")).events[0];
    expect(plain).toMatchObject({ status: "resolved", fingerprint_hint: "prtg:2041", value: 3 });
  });
});

describe("aggregation onto the target (design A §9.3)", () => {
  const fresh = freshForMs({ status_every_minutes: 5 });
  it("maintenance wins, vCenter's off explains a monitor's down, stale sources do not count, the worst fresh state wins", () => {
    const zbx = { state: "down" as const, since: ago(3), observed_at: ago(1), fresh_ms: fresh };
    expect(aggregateStatus([zbx, { state: "up", observed_at: ago(1), fresh_ms: fresh }], { now: NOW })).toMatchObject({ state: "down", since: ago(3), sources: 2 });
    expect(aggregateStatus([zbx], { now: NOW, maintenance: { label: "پنجره" } }).state).toBe("maintenance");
    expect(aggregateStatus([zbx, { state: "off", observed_at: ago(1), fresh_ms: fresh, virtualisation: true }], { now: NOW }).state).toBe("off");
    // a source older than 3 × its interval does not count
    expect(aggregateStatus([{ ...zbx, observed_at: ago(16) }, { state: "up", observed_at: ago(1), fresh_ms: fresh }], { now: NOW })).toMatchObject({ state: "up", sources: 1 });
    expect(aggregateStatus([{ ...zbx, observed_at: ago(16) }], { now: NOW })).toMatchObject({ state: "unknown", sources: 0 });
    // a pushed alert's signal never ages
    expect(aggregateStatus([{ state: "warning", since: ago(600) }], { now: NOW })).toMatchObject({ state: "warning", sources: 1 });
    expect(aggregateStatus([{ state: "warning", observed_at: ago(1), fresh_ms: fresh }, { state: "unreachable", observed_at: ago(1), fresh_ms: fresh }], { now: NOW }).state).toBe("unreachable");
  });
});

describe("status in the database (design A §9.1, §9.7)", () => {
  let w: DiscoveryWorld;
  let push: Row;
  let zabbixSource: SourceRow;
  beforeAll(async () => {
    w = await discoveryWorld();
    resetStatusThrottles();
    push = await w.connector({ name: "پایش شعب", kind: "push" });
    const src = await w.sys.write((tx) => createIn(tx, w.sys, "event_source", { name: "Zabbix مرکز داده", kind: "zabbix", active: true }, { trusted: true }));
    zabbixSource = (await w.one<SourceRow>(`select id, org_id, name, kind, active, mapping, severity_map, default_severity, rate_limit, assignment_group_id, service_id from sm_event_sources where id = $1`, [src.id]))!;
  }, 240_000);
  afterAll(() => resetStatusThrottles());

  const ci = (name: string) => w.sys.write((tx) => createIn(tx, w.sys, "ci", { class: "server", name, hostname: name, state: "operational" }, { trusted: true }));
  /** An item of the push connector on a CI, as a pass leaves it. */
  const item = async (ext: string, ciId: string, status: string) =>
    w.q(
      `insert into sm_discovery_items (id, org_id, connector_id, external_id, kind, name, state, ci_id, status, status_since, listed_at, first_seen_at, reconciled_at, mismatch_state, data, origin)
       values (gen_random_uuid(), $1, $2, $3, 'host', $3, 'linked', $4, $5, now(), now(), now(), now(), 'none', jsonb_build_object('external_id', $3::text), 'cloud')`,
      [w.e.org, push.id, ext, ciId, status],
    );
  const stateOf = async (ciId: string) => (await w.q<Row>(`select monitor_status, sources, signals from sm_discovery_states where target_table = 'ci' and target_id = $1 and deleted_at is null`, [ciId]))[0];
  const zabbix = async (payload: Record<string, unknown>) => {
    await ingest(w.e.cfg, zabbixSource, payload);
    await w.drain();
  };

  it("status writes make no record event and no rev bump on the CI or its asset", async () => {
    const c = await ci("srv-quiet");
    const model = await w.sys.write((tx) => createIn(tx, w.sys, "asset_model", { name: "سرور آزمایشی", category: "server" }, { trusted: true }));
    const a = await w.sys.write((tx) => createIn(tx, w.sys, "asset", { model_id: model.id, ci_id: c.id, state: "in_use" }, { trusted: true }));
    await item("q-1", c.id, "up");
    await w.drain();
    const rows = () => w.q<Row>(`select id, rev, version, updated_at from sm_cis where id = $1 union all select id, rev, version, updated_at from sm_assets where id = $2`, [c.id, a.id]);
    const events = () => w.q<Row>(`select kind from sm_jobs where org_id = $1 and kind like 'record.%' and payload->>'id' = any($2::text[])`, [w.e.org, `{${c.id},${a.id}}`]);
    const before = { rows: await rows(), events: (await events()).length };
    // a flapping host: up, down, up, down — each one an item update and a target write
    for (const state of ["down", "up", "down", "up", "down"]) {
      await applyItemStatuses(w.e.db, w.e.org, push.id, [{ external_id: "q-1", status: { state: state as never, availability: true } }], new Date());
      await aggregateTargets(w.e.db, w.sys, [{ table: "ci", id: c.id }]);
      expect((await stateOf(c.id)).monitor_status).toBe(state);
    }
    expect(await rows()).toEqual(before.rows);
    expect((await events()).length).toBe(before.events);
  });

  it("an ICMP-down Zabbix webhook alert makes the CI «قطع» and its clear brings it back; a disk alert makes it «هشدار»", async () => {
    const c = await ci("srv-icmp");
    await item("z-1", c.id, "up");
    await aggregateTargets(w.e.db, w.sys, [{ table: "ci", id: c.id }]);
    expect((await stateOf(c.id)).monitor_status).toBe("up");
    const base = { host: "srv-icmp", severity: "High" };
    await zabbix({ ...base, event_id: "9001", status: "PROBLEM", trigger_id: "700", trigger_name: "Unavailable by ICMP ping", item_key: "icmpping" });
    expect(await stateOf(c.id)).toMatchObject({ monitor_status: "down", signals: { [zabbixSource.id]: { state: "down" } } });
    await zabbix({ ...base, event_id: "9002", status: "RESOLVED", trigger_id: "700", trigger_name: "Unavailable by ICMP ping", item_key: "icmpping" });
    expect(await stateOf(c.id)).toMatchObject({ monitor_status: "up", signals: {} });
    await zabbix({ ...base, event_id: "9003", status: "PROBLEM", trigger_id: "701", trigger_name: "/: Disk space is critically low", item_key: "vfs.fs.size[/,pused]", severity: "Average" });
    expect((await stateOf(c.id)).monitor_status).toBe("warning");
    await zabbix({ ...base, event_id: "9004", status: "RESOLVED", trigger_id: "701", trigger_name: "/: Disk space is critically low", item_key: "vfs.fs.size[/,pused]" });
    expect((await stateOf(c.id)).monitor_status).toBe("up");
  });

  it("an installation that only pushes alerts gets status without any item; a maintenance window wins", async () => {
    const c = await ci("srv-alerts-only");
    await zabbix({ host: "srv-alerts-only", event_id: "9101", status: "PROBLEM", trigger_id: "710", trigger_name: "Zabbix agent is not available", item_key: "agent.ping", severity: "High" });
    expect(await stateOf(c.id)).toMatchObject({ monitor_status: "down", sources: 1 });
    const now = Date.now();
    await w.sys.write((tx) => createIn(tx, w.sys, "change_window", { name: "نگهداری شبانه", kind: "maintenance", active: true, start_at: new Date(now - 3600_000).toISOString(), end_at: new Date(now + 3600_000).toISOString(), cis: [c.id] }, { trusted: true }));
    await aggregateTargets(w.e.db, w.sys, [{ table: "ci", id: c.id }]);
    expect((await stateOf(c.id)).monitor_status).toBe("maintenance");
  });

  it("a status pass reads the kind's status and problems; the board and the panel follow the read rules", async () => {
    const rec = (id: string) => ({ external_id: id, kind: "host", class: "server", name: id, hostname: id, serial_number: `SN-${id}` });
    const fake: ConnectorKind = {
      ...restConnector,
      collects: ["inventory", "status", "problems"],
      optionsSchema: z.record(z.string(), z.unknown()),
      async pages() {
        return { records: [rec("srv-10"), rec("srv-11")] as never, next: null, complete: true, total: 2 };
      },
      async status() {
        return { items: [{ external_id: "srv-10", status: zabbixStatus({ icmp: 0 }) }, { external_id: "srv-11", status: zabbixStatus({ icmp: 1 }) }], next: null };
      },
      async problems() {
        return { problems: [{ key: "p-1", external_id: "srv-11", severity: "major", message: "/var: Disk space is low" }], next: null, complete: true };
      },
    };
    const restore = overrideKind(fake);
    try {
      const conn = await w.connector({ name: "Zabbix آزمایشی", kind: "rest", base_url: "https://status.mock.test/", collect: ["inventory", "status", "problems"], options: {} });
      await w.pass(conn.id);
      await statusPass(w.sys, conn.id, { deadline: Date.now() + 60_000 });
      const run = await w.one<Row>(`select state, fetched, problems_opened from sm_discovery_runs where connector_id = $1 and lane = 'status'`, [conn.id]);
      expect(run).toMatchObject({ state: "completed", fetched: 3, problems_opened: 1 });
      const items = await w.q<Row>(`select external_id, status, ci_id from sm_discovery_items where connector_id = $1 order by external_id`, [conn.id]);
      expect(items.map((i) => i.status)).toEqual(["down", "up"]);
      // the problem went to event management, and its alert warns on srv-11's CI
      await w.drain();
      expect((await stateOf(items[0].ci_id)).monitor_status).toBe("down");
      expect((await stateOf(items[1].ci_id)).monitor_status).toBe("warning");
      expect(await w.one<Row>(`select sent_firing, fingerprint from sm_discovery_problems where connector_id = $1`, [conn.id])).toEqual({ sent_firing: true, fingerprint: `disc:${conn.id}:p-1` });
      // the board: worst first, with counts; the panel names the source
      const board = await w.e.owner.get(`${w.P}/discovery/status`);
      expect(board.rows[0]).toMatchObject({ status: "down", status_label: "قطع" });
      expect(board.counts.down).toBeGreaterThanOrEqual(1);
      expect((await w.e.owner.get(`${w.P}/discovery/status?chip=warning`)).rows.every((r: Row) => r.status === "warning")).toBe(true);
      const panel = await w.e.owner.get(`${w.P}/discovery/panel/ci/${items[0].ci_id}`);
      expect(panel).toMatchObject({ empty: false, status: { state: "down" }, sources: [expect.objectContaining({ name: "Zabbix آزمایشی", status: "down" })] });
      // a requester sees none of it
      const req = await w.e.member("member", `req-status-${w.e.org.slice(0, 6)}@example.com`);
      await w.e.owner.put(`${w.P}/access/members/${req.userId}`, { roles: ["requester"], persona: "requester" });
      expect((await req.client.get(`${w.P}/discovery/status`, 403)).error.message).toBe(STATUS_READ_MESSAGE);
      await req.client.get(`${w.P}/discovery/panel/ci/${items[0].ci_id}`, 403);
    } finally {
      restore();
    }
  });
});
