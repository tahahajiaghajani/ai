// The «PRTG» kind against its mock (design A §17 «discovery-kinds-prtg», package DA3a): the test call, start/count
// paging in object-id order with the tool's total, inventory mapping (host as address or name, location as a hint, the
// class by group or tag), availability by §9.2 from the primary (Ping) sensor — a device «Up» with a down Ping sensor
// is down — contact from its `lastup`, problems from sensors in warning or down states, deep links, every documented
// error message, and plain http only with the server edition's tick.
import { afterEach, describe, expect, it } from "vitest";
import { connector as prtgKind, PRTG_MESSAGES, webBase } from "@server/modules/discovery/connectors/prtg";
import { CONNECTOR_MESSAGES } from "@server/modules/discovery/kind";
import { oleDateIso, prtgAvailability, prtgSeverity } from "@shared/discovery/kinds/prtg";
import { kindDescriptor } from "@shared/discovery/kinds";
import type { DiscoveredRecord, ProblemPage } from "@shared/discovery/types";
import { mountMocks } from "./mocks/discovery/harness";
import { allPages, kindCtx, outcome, serverEdition, WEB } from "./mocks/discovery/kindctx";
import { makePrtg, ole, PRTG_HOST, PRTG_TOKEN, PRTG_URL, PrtgMock } from "./mocks/discovery/prtg";

describe("the PRTG availability rule (design A §9.2)", () => {
  const up = { status: 3, name: "Ping", message: "OK" };
  it("reads the primary sensor, not the device: a device «Up» with a down Ping sensor is down", () => {
    expect(prtgAvailability({ device: 3, primary: { status: 5, name: "Ping", message: "Destination host unreachable" }, down: 1, warning: 0 })).toEqual({
      state: "down", availability: true, message: "Ping: Destination host unreachable",
    });
    expect(prtgAvailability({ device: 3, primary: { ...up, status: 13 }, down: 0, warning: 0 }).state).toBe("down");
    expect(prtgAvailability({ device: 3, primary: { ...up, status: 8 }, down: 0, warning: 0 })).toMatchObject({ state: "unreachable", availability: true });
    expect(prtgAvailability({ device: 3, primary: up, down: 0, warning: 0 })).toEqual({ state: "up" });
  });

  it("other sensors down or in warning and «down partial» are warnings; paused is maintenance; no primary sensor is unknown", () => {
    expect(prtgAvailability({ device: 5, primary: up, down: 2, warning: 0 }).state).toBe("warning");
    expect(prtgAvailability({ device: 3, primary: up, down: 0, warning: 1 }).state).toBe("warning");
    expect(prtgAvailability({ device: 3, primary: { ...up, status: 14 }, down: 0, warning: 0 }).state).toBe("warning");
    for (const s of [7, 9, 12]) expect(prtgAvailability({ device: 3, primary: { ...up, status: s }, down: 0, warning: 0 }).state).toBe("maintenance");
    expect(prtgAvailability({ device: 7, primary: null, down: 0, warning: 0 }).state).toBe("maintenance");
    expect(prtgAvailability({ device: 3, primary: null, down: 0, warning: 0 })).toMatchObject({ state: "unknown" });
    expect([prtgSeverity(5, true), prtgSeverity(5, false), prtgSeverity(13, false), prtgSeverity(4, false)]).toEqual(["critical", "major", "minor", "warning"]);
    const at = Date.UTC(2026, 10, 14, 6, 30);
    expect(oleDateIso(ole(at))).toBe(new Date(at).toISOString());
    expect(oleDateIso("")).toBeUndefined();
  });
});

describe("the PRTG kind against its mock (design A §17)", () => {
  let unmount: (() => void) | null = null;
  const mount = (m: PrtgMock, extra: Record<string, (r: Request) => Response> = {}) => {
    unmount?.();
    unmount = mountMocks({ [PRTG_HOST]: m.handler, ...extra });
    return m;
  };
  afterEach(() => {
    unmount?.();
    unmount = null;
  });
  const ctx = (over: Parameters<typeof kindCtx>[1] = {}) => kindCtx(prtgKind, { secret: PRTG_TOKEN, ...over, view: { base_url: PRTG_URL, ...over.view } });

  it("is a built kind (key in a header only), and «آزمودن اتصال» tells the version and a missing Ping sensor", async () => {
    expect(kindDescriptor("prtg")).toMatchObject({ ready: true, auth: ["token"] });
    const m = mount(new PrtgMock(makePrtg(2)));
    expect(await prtgKind.test(ctx())).toEqual({ ok: true, version: "24.1.92.1554", warnings: [] });
    m.sensors = m.sensors.filter((s) => s.type_raw !== "ping");
    expect((await prtgKind.test(ctx())).warnings).toEqual([PRTG_MESSAGES.noPrimary("ping")]);
    m.devices = [];
    expect((await prtgKind.test(ctx())).warnings).toEqual([PRTG_MESSAGES.noDevices]);
    // the key never travels in the address
    expect(m.requests.every((r) => ![...r.params.keys()].some((k) => /apitoken|passhash|password/i.test(k)))).toBe(true);
  });

  it("pages by start and count in object-id order with the tool's total; primary sensors a hundred devices a call", async () => {
    const m = mount(new PrtgMock(makePrtg(1150)));
    const { pages, cursors } = await allPages((cur) => prtgKind.pages(ctx(), cur));
    expect(pages.map((p) => p.records.length)).toEqual([500, 500, 150]);
    expect(cursors).toEqual([{ start: 500 }, { start: 1000 }]);
    expect(pages.every((p) => p.total === 1150 && p.complete === true)).toBe(true);
    const devices = m.of("devices");
    expect(devices.map((r) => [r.params.get("start"), r.params.get("count"), r.params.get("sortby")])).toEqual([["0", "500", "objid"], ["500", "500", "objid"], ["1000", "500", "objid"]]);
    const sensorCalls = m.of("sensors");
    expect(sensorCalls).toHaveLength(12);
    expect(sensorCalls.every((r) => r.params.getAll("filter_parentid").length <= 100 && r.params.get("filter_type") === "ping")).toBe(true);
    expect(new Set(pages.flatMap((p) => p.records.map((r) => r.external_id))).size).toBe(1150);
  });

  it("maps a device: its host as an address or a name, the location as a hint, the class by group or tag, the Ping sensor's lastup as contact", async () => {
    const data = makePrtg(3);
    data.devices[1].host = "core-sw2.bank.local";
    data.devices[1].group = "Firewalls";
    data.devices[2].tags = "printer floor3";
    const m = mount(new PrtgMock(data));
    const page = await prtgKind.pages(ctx({ options: { class_map: { firewalls: "network_device", printer: "printer" } } }), null);
    const [a, b, c] = page.records;
    expect(a).toMatchObject({ external_id: "2001", kind: "device", name: "Switch 2001", ips: ["10.30.0.1"], reported: { location: "شعبهٔ مرکزی" }, status: { state: "up" } });
    expect(a.class).toBeUndefined();
    expect(a.last_contact_at).toBe(new Date(m.sensors[0].lastup!).toISOString());
    expect(b).toMatchObject({ hostname: "core-sw2.bank.local", class: "network_device" });
    expect(c.class).toBe("printer");
    expect(page.raw).toHaveLength(3);
  });

  it("status: a device «Up» whose Ping sensor is down is down; a CPU sensor down only warns; a status flip and an availability flip", async () => {
    const data = makePrtg(3);
    const m = mount(new PrtgMock(data));
    // device 2001: PRTG still says Up, its Ping sensor is down (Paessler's KB case)
    m.sensors.find((s) => s.objid === 5001)!.status_raw = 5;
    m.sensors.find((s) => s.objid === 5001)!.message = "Destination host unreachable";
    // device 2002: Ping up, CPU sensor down
    m.sensors.find((s) => s.objid === 7002)!.status_raw = 5;
    const page = await prtgKind.pages(ctx(), null);
    expect(m.devices[0].status_raw).toBe(3);
    expect(page.records.map((r) => r.status?.state)).toEqual(["down", "warning", "up"]);
    expect(page.records[0].status).toMatchObject({ availability: true, message: "Ping: Destination host unreachable" });
    // the status pass: the Ping sensor comes back, device 2003's is paused by its parent going down
    m.sensors.find((s) => s.objid === 5001)!.status_raw = 3;
    m.sensors.find((s) => s.objid === 5003)!.status_raw = 8;
    const s = await prtgKind.status!(ctx(), null);
    expect(Object.fromEntries(s.items.map((x) => [x.external_id, x.status.state]))).toEqual({ 2001: "up", 2002: "warning", 2003: "unreachable" });
    expect(s.items.every((x) => x.last_contact_at)).toBe(true);
    // another primary sensor type
    m.sensors.push({ objid: 9001, parentid: 2003, sensor: "HTTPS", type_raw: "https", status_raw: 3, lastup: Date.now() - 5_000 });
    const https = await prtgKind.status!(ctx({ options: { primary_sensor: "HTTPS" } }), null);
    expect(https.items.find((x) => x.external_id === "2003")!.status.state).toBe("up");
    expect(https.items.find((x) => x.external_id === "2001")!.status.state).toBe("unknown");
  });

  it("problems: sensors in warning, unusual or down states, paged by start and count, one per sensor whatever its state", async () => {
    const data = makePrtg(4);
    const m = mount(new PrtgMock(data));
    const down = Date.now() - 120_000;
    Object.assign(m.sensors.find((s) => s.objid === 5001)!, { status_raw: 5, message: "Timeout", lastdown: down });
    Object.assign(m.sensors.find((s) => s.objid === 7002)!, { status_raw: 4, message: "92 %" });
    Object.assign(m.sensors.find((s) => s.objid === 7003)!, { status_raw: 13, message: "Disk failed", lastdown: down });
    Object.assign(m.sensors.find((s) => s.objid === 7004)!, { status_raw: 10, message: "Unusual traffic" });
    const { pages } = await allPages((cur) => prtgKind.problems!(ctx({ options: { page_size: 3 } }), cur) as Promise<ProblemPage>);
    expect(pages.map((p) => p.problems.length)).toEqual([3, 1]);
    const all = pages.flatMap((p) => p.problems);
    expect(all.map((p) => p.key)).toEqual(["5001", "7002", "7003", "7004"]);
    expect(all[0]).toMatchObject({ external_id: "2001", severity: "critical", availability: true, message: "Ping: Timeout", since: new Date(down).toISOString() });
    expect(all[1]).toMatchObject({ external_id: "2002", severity: "warning", availability: false });
    expect(all[2]).toMatchObject({ severity: "minor", availability: false });
    expect(m.of("sensors").every((r) => r.params.getAll("filter_status").sort().join() === "10,13,14,4,5")).toBe(true);
    // a state change keeps the problem and changes its severity (§9.6): acknowledged in PRTG, a warning turned down
    m.sensors.find((s) => s.objid === 5001)!.status_raw = 13;
    m.sensors.find((s) => s.objid === 7002)!.status_raw = 5;
    const after = (await prtgKind.problems!(ctx(), null)).problems;
    expect(after.map((p) => [p.key, p.severity])).toEqual([["5001", "minor"], ["7002", "major"], ["7003", "minor"], ["7004", "warning"]]);
  });

  it("problems stay on the devices the connector lists: its tags narrow them as they narrow the devices", async () => {
    const data = makePrtg(4);
    data.devices[2].tags = "atm";
    const m = mount(new PrtgMock(data));
    for (const id of [5001, 5003, 7003, 7004]) m.sensors.find((s) => s.objid === id)!.status_raw = 5;
    const scoped = ctx({ options: { tags: ["atm"] } });
    expect((await prtgKind.pages(scoped, null)).records.map((r) => r.external_id)).toEqual(["2003"]);
    const { pages } = await allPages((cur) => prtgKind.problems!(scoped, cur) as Promise<ProblemPage>);
    expect(pages.flatMap((p) => p.problems.map((x) => [x.key, x.external_id]))).toEqual([["5003", "2003"], ["7003", "2003"]]);
    // the parents' own rows, a hundred a call
    expect(m.of("devices").at(-1)!.params.getAll("filter_objid")).toEqual(["2001", "2003", "2004"]);
    // without tags every problem the API user sees is the connector's
    expect((await prtgKind.problems!(ctx(), null)).problems.map((x) => x.key)).toEqual(["5001", "5003", "7003", "7004"]);
  });

  it("a group or tags narrow the devices; a malformed row is rejected without stopping the page", async () => {
    const data = makePrtg(4);
    data.devices[3].groupid = 77;
    data.devices[2].tags = "atm";
    const m = mount(new PrtgMock(data));
    expect((await prtgKind.pages(ctx({ options: { group_id: 77 } }), null)).records.map((r) => r.external_id)).toEqual(["2004"]);
    const tagged = await prtgKind.pages(ctx({ options: { tags: ["atm"] } }), null);
    expect(tagged.records.map((r) => r.external_id)).toEqual(["2003"]);
    expect(tagged.total).toBeUndefined();
    m.malformed.add(2002);
    const page = await prtgKind.pages(ctx(), null);
    expect(page.records.map((r) => r.external_id)).toEqual(["2001", "2003", "2004"]);
    expect(page.rejected).toEqual([{ message: PRTG_MESSAGES.noObjid }]);
  });

  it("deep links go to the device's page", () => {
    const rec = { external_id: "2001", kind: "device", name: "x" } as DiscoveredRecord;
    expect(prtgKind.link!(rec, ctx())).toBe(`https://${PRTG_HOST}/device.htm?id=2001`);
    expect(prtgKind.link!(rec, ctx({ view: { base_url: `https://${PRTG_HOST}/prtg/index.htm` } }))).toBe(`https://${PRTG_HOST}/prtg/device.htm?id=2001`);
    expect(webBase(`https://${PRTG_HOST}/prtg`)).toBe(`https://${PRTG_HOST}/prtg/`);
  });

  it("answers every documented error with its Persian message", async () => {
    const m = mount(new PrtgMock(makePrtg(2)), { "elsewhere.mock.test": () => new Response("{}") });
    expect(await outcome(prtgKind.test(ctx({ secret: "wrong" })))).toBe(CONNECTOR_MESSAGES.auth);
    m.failOnce.set("devices", 503);
    const busy = await prtgKind.pages(ctx(), null).catch((e) => e);
    expect([busy.code, busy.message]).toEqual(["network", CONNECTOR_MESSAGES.noAnswer("PRTG Network Monitor آزمایشی")]);
    m.failOnce.set("sensors", 429);
    const limited = await prtgKind.pages(ctx(), null).catch((e) => e);
    expect([limited.code, limited.retryAfterMs]).toEqual(["rate_limited", 4000]);
    m.notPrtg = true;
    expect(await outcome(prtgKind.test(ctx()))).toBe(PRTG_MESSAGES.notPrtg);
    m.notPrtg = false;
    m.redirectTo = "https://elsewhere.mock.test/api/table.json";
    expect(await outcome(prtgKind.pages(ctx(), null))).toBe(CONNECTOR_MESSAGES.redirect);
    m.redirectTo = null;
    expect(await outcome(prtgKind.test(kindCtx(prtgKind, { view: { base_url: `${PRTG_URL}?apitoken=abc` }, secret: PRTG_TOKEN })))).toBe(CONNECTOR_MESSAGES.credentialsInUrl);
    // a slow page still answers (the runner's slice, not the kind, bounds the time)
    m.slowMs = 50;
    expect((await prtgKind.pages(ctx(), null)).records).toHaveLength(2);
  });

  it("plain http only on the server edition with the tick, never on the web version", async () => {
    mount(new PrtgMock(makePrtg(2)));
    const plain = { base_url: `http://${PRTG_HOST}/` };
    const server = serverEdition([PRTG_HOST]);
    expect((await prtgKind.pages(ctx({ cfg: server, view: { ...plain, plain_http: true } }), null)).records).toHaveLength(2);
    expect(await outcome(prtgKind.pages(ctx({ cfg: server, view: plain }), null))).toBe(CONNECTOR_MESSAGES.plainHttp);
    expect(await outcome(prtgKind.pages(ctx({ cfg: WEB, view: { ...plain, plain_http: true } }), null))).toBe(CONNECTOR_MESSAGES.plainHttp);
  });
});
