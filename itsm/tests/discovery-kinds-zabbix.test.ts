// The «Zabbix» kind against its mock (design A §17 «discovery-kinds-zabbix», package DA3a): the test call, host-id
// chunks of ≤ 500 sorted ids, inventory mapping (serialno_a, MACs, vendor, model, the class by group or template, the
// place and tag as hints), availability by §9.2 (ICMP item, agent interface, a disk trigger is only a warning, an
// availability trigger is down), contact from the availability items' lastclock, problems in event-id order, deep links,
// every documented error message, the token by version (header from 6.4, `auth` member before) and plain http only
// with the server edition's tick. One pass through the runner loads hosts into CIs with their links.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connector as zabbixKind, frontEnd, ZABBIX_MESSAGES } from "@server/modules/discovery/connectors/zabbix";
import { CONNECTOR_MESSAGES, ConnectorError } from "@server/modules/discovery/kind";
import { availabilityItem, isAvailabilityProblem, zabbixAvailability, zabbixContact, zabbixSeverity, type ZabbixAvailabilityInput } from "@shared/discovery/kinds/zabbix";
import { kindDescriptor, offeredKinds } from "@shared/discovery/kinds";
import { normaliseRecord } from "@shared/discovery/normalise";
import type { DiscoveredRecord, Page, ProblemPage, StatusPage } from "@shared/discovery/types";
import { mountMocks } from "./mocks/discovery/harness";
import { allPages, kindCtx, outcome, serverEdition, WEB } from "./mocks/discovery/kindctx";
import { makeZabbixHosts, ZABBIX_HOST, ZABBIX_TOKEN, ZABBIX_URL, ZabbixMock } from "./mocks/discovery/zabbix";
import { discoveryWorld, type DiscoveryWorld } from "./discovery-helpers";

const base: ZabbixAvailabilityInput = { status: 0, maintenance: false, icmp: [], agent: [], interfaces: [], problems: [] };
const t = Math.floor(Date.now() / 1000);

describe("the Zabbix availability rule (design A §9.2)", () => {
  it("ICMP down is down; the agent without ICMP is unreachable, with ICMP up only a warning", () => {
    expect(zabbixAvailability({ ...base, icmp: [{ value: "0", clock: t }], interfaces: [{ type: 1, available: 1 }] })).toMatchObject({ state: "down", availability: true });
    expect(zabbixAvailability({ ...base, interfaces: [{ type: 1, available: 2 }] })).toMatchObject({ state: "unreachable", availability: true });
    expect(zabbixAvailability({ ...base, agent: [{ value: "0", clock: t }] })).toMatchObject({ state: "unreachable", availability: true });
    const agentOnly = zabbixAvailability({ ...base, icmp: [{ value: "1", clock: t }], interfaces: [{ type: 1, available: 2 }] });
    expect(agentOnly.state).toBe("warning");
    expect(agentOnly.availability).toBeUndefined();
    expect(zabbixAvailability({ ...base, icmp: [{ value: "1", clock: t }], interfaces: [{ type: 1, available: 1 }] })).toEqual({ state: "up" });
  });

  it("a disk-space trigger is a warning, an availability trigger is down, Information and Not classified change nothing", () => {
    const disk = { severity: 3, availability: false, name: "/: Disk space is critically low (used > 90%)", since: t - 600 };
    expect(zabbixAvailability({ ...base, icmp: [{ value: "1", clock: t }], problems: [disk] })).toMatchObject({ state: "warning", message: disk.name });
    const unavailable = { severity: 3, availability: true, name: "Zabbix agent is not available (for 3m)", since: t - 300 };
    expect(zabbixAvailability({ ...base, icmp: [{ value: "1", clock: t }], problems: [disk, unavailable] })).toMatchObject({ state: "down", availability: true, message: unavailable.name, since: new Date((t - 300) * 1000).toISOString() });
    expect(zabbixAvailability({ ...base, icmp: [{ value: "1", clock: t }], problems: [{ severity: 1, availability: false, name: "info" }, { severity: 0, availability: false, name: "nc" }] })).toEqual({ state: "up" });
    expect(isAvailabilityProblem([{ tag: "scope", value: "availability" }])).toBe(true);
    expect(isAvailabilityProblem([{ tag: "scope", value: "capacity" }, { tag: "component", value: "storage" }])).toBe(false);
  });

  it("maintenance, a host not monitored, no data yet; severities; which items are availability checks; contact", () => {
    expect(zabbixAvailability({ ...base, maintenance: true, icmp: [{ value: "0", clock: t }] }).state).toBe("maintenance");
    expect(zabbixAvailability({ ...base, status: 1 }).state).toBe("unknown");
    expect(zabbixAvailability(base).state).toBe("unknown");
    expect([0, 1, 2, 3, 4, 5].map(zabbixSeverity)).toEqual(["info", "info", "warning", "minor", "major", "critical"]);
    expect(["icmpping", "icmpping[,4]", "icmppingloss", "agent.ping", "zabbix[host,agent,available]", "vfs.fs.size[/,pused]"].map(availabilityItem)).toEqual(["icmp", "icmp", null, "agent", "agent", null]);
    // contact is the latest poll of a check that answered; a failed check is no contact
    expect(zabbixContact([{ value: "1", clock: t - 60 }, { value: "0", clock: t }, { value: "1", clock: t - 30 }])).toBe(new Date((t - 30) * 1000).toISOString());
    expect(zabbixContact([{ value: "0", clock: t }])).toBeUndefined();
  });
});

describe("the Zabbix kind against its mock (design A §17)", () => {
  let mock: ZabbixMock;
  let unmount: (() => void) | null = null;
  const mount = (m: ZabbixMock, extra: Record<string, (r: Request) => Response | Promise<Response>> = {}) => {
    mock = m;
    unmount?.();
    unmount = mountMocks({ [ZABBIX_HOST]: m.handler, ...extra });
  };
  afterEach(() => {
    unmount?.();
    unmount = null;
  });
  const ctx = (over: Parameters<typeof kindCtx>[1] = {}) => kindCtx(zabbixKind, { secret: ZABBIX_TOKEN, ...over, view: { base_url: ZABBIX_URL, ...over.view } });

  it("is a built kind the wizard offers, and «آزمودن اتصال» tells the version and the hosts without inventory", async () => {
    expect(kindDescriptor("zabbix")?.ready).toBe(true);
    expect(offeredKinds("cloud").some((k) => k.kind.kind === "zabbix")).toBe(true);
    const data = makeZabbixHosts(3);
    data.hosts[2].inventory_mode = "-1";
    mount(new ZabbixMock(data));
    const r = await zabbixKind.test(ctx());
    expect(r).toMatchObject({ ok: true, version: "7.0.5" });
    expect(r.warnings).toEqual([ZABBIX_MESSAGES.noInventory(1)]);
    // apiinfo.version goes without the token; everything else carries it in the header (7.0)
    expect(mock.of("apiinfo.version")[0].auth).toBeNull();
    expect(mock.calls.filter((x) => x.method !== "apiinfo.version").every((x) => x.auth === "bearer")).toBe(true);
  });

  it("pages through host-id chunks of at most 500 sorted ids, with the tool's total, to the end", async () => {
    const data = makeZabbixHosts(1203);
    // the tool lists ids in its own order; the chunks follow the sorted order
    data.hosts.reverse();
    mount(new ZabbixMock(data));
    const { pages, cursors } = await allPages((cur) => zabbixKind.pages(ctx(), cur));
    expect(pages.map((p) => p.records.length)).toEqual([500, 500, 203]);
    expect(pages.every((p) => p.total === 1203 && p.complete === true)).toBe(true);
    expect(cursors).toEqual([{ after: "10599" }, { after: "11099" }]);
    const chunks = mock.of("host.get").filter((x) => Array.isArray(x.params.hostids)).map((x) => x.params.hostids as string[]);
    expect(chunks.map((ch) => ch.length)).toEqual([500, 500, 203]);
    expect(chunks.flat()).toEqual(Array.from({ length: 1203 }, (_, i) => String(10100 + i)));
    const ids = pages.flatMap((p) => p.records.map((r) => r.external_id));
    expect(new Set(ids).size).toBe(1203);
    // items and triggers are read for the same chunk, never for the whole estate
    expect(mock.of("item.get").every((x) => (x.params.hostids as string[]).length <= 500)).toBe(true);
    expect(mock.of("trigger.get").every((x) => (x.params.hostids as string[]).length <= 500)).toBe(true);
  });

  it("maps the inventory: serialno_a (serialno_b when empty), MACs, vendor, model, OS, interfaces, class by group then template, place and tag as hints", async () => {
    const data = makeZabbixHosts(4);
    data.hosts[0].inventory = { ...data.hosts[0].inventory, asset_tag: "AST-77", serialno_a: "CZJ1234ABC" };
    data.hosts[1].inventory = { serialno_a: "", serialno_b: "SNB-2", macaddress_b: "aa-bb-cc-dd-ee-ff" };
    data.hosts[1].interfaces = [
      { type: "2", main: "0", useip: "1", ip: "192.168.7.2", dns: "", available: "1" },
      { type: "1", main: "1", useip: "0", ip: "10.9.9.9", dns: "db02.bank.local", available: "1" },
    ];
    data.hosts[2].groups = ["Network devices"];
    data.hosts[2].templates = ["Cisco IOS by SNMP"];
    data.hosts[3].groups = ["Unmapped"];
    data.hosts[3].templates = ["Windows by Zabbix agent"];
    data.hosts[3].inventory_mode = "-1";
    mount(new ZabbixMock(data));
    const c = ctx({ options: { class_map: { "Linux servers": "server", "network devices": "network_device", "Windows by Zabbix agent": "computer" } } });
    const page = await zabbixKind.pages(c, null);
    const [a, b, k, d] = page.records;
    expect(a).toMatchObject({
      external_id: "10100", kind: "device", class: "server", name: "Server 10100", hostname: "srv10100.bank.local", serial_number: "CZJ1234ABC", manufacturer: "HPE",
      model: "ProLiant DL380", os: "Linux", ips: ["10.20.0.1"], macs: ["00:50:56:00:00:01"], reported: { location: "تهران", asset_tag: "AST-77" },
    });
    expect(b).toMatchObject({ serial_number: "SNB-2", macs: ["aa-bb-cc-dd-ee-ff"], fqdn: "db02.bank.local", ips: ["10.9.9.9", "192.168.7.2"] });
    expect(k.class).toBe("network_device");
    expect(d.class).toBe("computer");
    expect(d.serial_number).toBeUndefined();
    // the runner's normalisation keeps every one of them (the MAC in the canonical notation)
    const n = normaliseRecord(b);
    expect(n.record).toMatchObject({ macs: ["AA:BB:CC:DD:EE:FF"], hostname: "db02", fqdn: "db02.bank.local", serial_number: "SNB-2" });
    expect(normaliseRecord(a).record).toMatchObject({ hostname: "srv10100", fqdn: "srv10100.bank.local" });
    expect(page.raw).toHaveLength(4);
  });

  it("a malformed host never stops the page: its bad fields are dropped", async () => {
    const data = makeZabbixHosts(2);
    data.hosts[1].interfaces = [{ type: "1", main: "1", useip: "1", ip: "999.1.1.1", dns: "", available: "1" }];
    data.hosts[1].inventory = { macaddress_a: "not-a-mac", serialno_a: "To be filled by O.E.M." };
    data.hosts[1].host = "host with spaces";
    mount(new ZabbixMock(data));
    const page = await zabbixKind.pages(ctx(), null);
    expect(page.records).toHaveLength(2);
    const n = normaliseRecord(page.records[1]);
    expect(n.record).toMatchObject({ external_id: "10101", name: "Server 10101" });
    expect(n.record?.ips).toBeUndefined();
    expect(n.record?.macs).toBeUndefined();
    expect(n.record?.serial_number).toBeUndefined();
    expect(n.record?.hostname).toBeUndefined();
  });

  it("status and contact per host: ICMP and agent items, interfaces and triggers in problem state; a status flip and an availability flip", async () => {
    const data = makeZabbixHosts(3);
    const m = new ZabbixMock(data);
    // host 2: a disk trigger (a warning); host 3: no ICMP item and its agent interface unavailable
    m.triggers.push({ triggerid: "30001", hostid: "10101", description: "/: Disk space is low", priority: "2", lastchange: String(t - 900), value: "1", tags: [{ tag: "scope", value: "capacity" }] });
    m.items = m.items.filter((it) => !(it.hostid === "10102" && it.key_ === "icmpping"));
    m.hosts[2].interfaces![0].available = "2";
    m.items.find((it) => it.hostid === "10102" && it.key_ === "agent.ping")!.lastvalue = "0";
    mount(m);
    const page = await zabbixKind.pages(ctx(), null);
    expect(page.records.map((r) => r.status?.state)).toEqual(["up", "warning", "unreachable"]);
    const clock = Number(m.items.find((it) => it.hostid === "10100")!.lastclock);
    expect(page.records[0].last_contact_at).toBe(new Date(clock * 1000).toISOString());
    expect(page.records[2].last_contact_at).toBeUndefined();

    // the status pass: ICMP on host 1 stops answering (down), the agent on host 3 comes back (up)
    m.items.find((it) => it.hostid === "10100" && it.key_ === "icmpping")!.lastvalue = "0";
    m.hosts[2].interfaces![0].available = "1";
    m.items.find((it) => it.hostid === "10102" && it.key_ === "agent.ping")!.lastvalue = "1";
    const s: StatusPage = await zabbixKind.status!(ctx(), null);
    expect(s.next).toBeNull();
    expect(Object.fromEntries(s.items.map((x) => [x.external_id, x.status.state]))).toEqual({ 10100: "down", 10101: "warning", 10102: "up" });
    expect(s.items.find((x) => x.external_id === "10100")!.status.availability).toBe(true);
    // without "status" in collect, the inventory pass reads no triggers and stages no status
    const before = m.of("trigger.get").length;
    const inv = await zabbixKind.pages(ctx({ view: { collect: ["inventory"] } }), null);
    expect(inv.records.every((r) => r.status === undefined)).toBe(true);
    expect(m.of("trigger.get").length).toBe(before);
  });

  it("problems: the complete open set in event-id order (eventid_from), each with its host, severity and availability", async () => {
    const m = new ZabbixMock(makeZabbixHosts(2));
    m.triggers.push(
      { triggerid: "30001", hostid: "10100", description: "Unavailable by ICMP ping", priority: "4", lastchange: String(t - 60), value: "1", tags: [{ tag: "scope", value: "availability" }] },
      { triggerid: "30002", hostid: "10101", description: "Disk space is low", priority: "2", lastchange: String(t - 60), value: "1" },
    );
    for (let i = 0; i < 5; i++) m.problems.push({ eventid: String(900 + i), objectid: i % 2 ? "30002" : "30001", name: i % 2 ? "Disk space is low" : "Unavailable by ICMP ping", severity: i % 2 ? "2" : "4", clock: String(t - 100 + i), tags: i % 2 ? [] : [{ tag: "scope", value: "availability" }] });
    mount(m);
    const { pages } = await allPages((cur) => zabbixKind.problems!(ctx({ options: { chunk_size: 2 } }), cur) as Promise<ProblemPage>);
    expect(pages.map((p) => p.problems.length)).toEqual([2, 2, 1]);
    expect(m.of("problem.get").map((x) => x.params.eventid_from ?? null)).toEqual([null, "902", "904"]);
    const all = pages.flatMap((p) => p.problems);
    expect(all.map((p) => p.key)).toEqual(["900", "901", "902", "903", "904"]);
    expect(all[0]).toMatchObject({ external_id: "10100", severity: "major", availability: true, message: "Unavailable by ICMP ping", since: new Date((t - 100) * 1000).toISOString() });
    expect(all[1]).toMatchObject({ external_id: "10101", severity: "warning", availability: false });
  });

  it("the version decides how the token travels: the header from 6.4, the `auth` member before; host groups by version; 5.2 is refused", async () => {
    const m = new ZabbixMock(makeZabbixHosts(2));
    m.version = "6.0.31";
    mount(m);
    const page = await zabbixKind.pages(ctx({ options: { class_map: { "Linux servers": "server" } } }), null);
    expect(page.records.map((r) => r.class)).toEqual(["server", "server"]);
    expect(m.calls.filter((x) => x.method !== "apiinfo.version").every((x) => x.auth === "body")).toBe(true);
    expect(m.of("host.get").some((x) => x.params.selectGroups)).toBe(true);
    const n = new ZabbixMock(makeZabbixHosts(1));
    n.version = "6.4.12";
    mount(n);
    await zabbixKind.pages(ctx(), null);
    expect(n.calls.filter((x) => x.method !== "apiinfo.version").every((x) => x.auth === "bearer")).toBe(true);
    expect(n.of("host.get").some((x) => x.params.selectHostGroups)).toBe(true);
    const old = new ZabbixMock(makeZabbixHosts(1));
    old.version = "5.2.7";
    mount(old);
    expect(await outcome(zabbixKind.test(ctx()))).toBe(ZABBIX_MESSAGES.tooOld("5.2.7"));
  });

  it("host groups and tags narrow the scope; a group that is not there stops the pass instead of making hosts look gone", async () => {
    const data = makeZabbixHosts(4);
    data.hosts[0].groups = ["Branch ATMs"];
    data.hosts[1].tags = [{ tag: "env", value: "prod" }];
    mount(new ZabbixMock(data));
    expect((await zabbixKind.pages(ctx({ options: { host_groups: ["Branch ATMs"] } }), null)).records.map((r) => r.external_id)).toEqual(["10100"]);
    expect((await zabbixKind.pages(ctx({ options: { tags: ["env=prod"] } }), null)).records.map((r) => r.external_id)).toEqual(["10101"]);
    expect(await outcome(zabbixKind.pages(ctx({ options: { host_groups: ["Branch ATMs", "Renamed group"] } }), null))).toBe(ZABBIX_MESSAGES.noGroup(["Renamed group"]));
  });

  it("deep links go to the host's page in the Zabbix front end (the address's folder, or frontend_url on a pinned host)", async () => {
    const rec = { external_id: "10100", kind: "device", name: "x" } as DiscoveredRecord;
    expect(zabbixKind.link!(rec, ctx())).toBe(`https://${ZABBIX_HOST}/zabbix/hostinventories.php?hostid=10100`);
    expect(zabbixKind.link!(rec, ctx({ view: { base_url: `https://${ZABBIX_HOST}/zabbix/api_jsonrpc.php` } }))).toBe(`https://${ZABBIX_HOST}/zabbix/hostinventories.php?hostid=10100`);
    expect(zabbixKind.link!(rec, ctx({ view: { hosts: ["zabbix-web.bank.local"] }, options: { frontend_url: "https://zabbix-web.bank.local" } }))).toBe("https://zabbix-web.bank.local/hostinventories.php?hostid=10100");
    // a front end on a host the connector does not name is not linked to
    expect(frontEnd(ctx({ options: { frontend_url: "https://elsewhere.example/" } }))).toBe(`https://${ZABBIX_HOST}/zabbix/`);
    // the API at the address itself works too
    mount(new ZabbixMock(makeZabbixHosts(1)));
    expect((await zabbixKind.pages(ctx({ view: { base_url: `https://${ZABBIX_HOST}/zabbix/api_jsonrpc.php` } }), null)).records).toHaveLength(1);
  });

  it("answers every documented error with its Persian message", async () => {
    const m = new ZabbixMock(makeZabbixHosts(1));
    mount(m, { "elsewhere.mock.test": () => new Response("{}") });
    // a wrong token: Zabbix answers 200 with "Not authorized."
    const wrong = await zabbixKind.pages(ctx({ secret: "wrong-token" }), null).catch((e) => e);
    expect(wrong).toBeInstanceOf(ConnectorError);
    expect([wrong.code, wrong.message]).toEqual(["auth", CONNECTOR_MESSAGES.auth]);
    // the tool does not answer (503): retried by the runner
    m.failOnce.set("host.get", 503);
    const busy = await zabbixKind.pages(ctx(), null).catch((e) => e);
    expect([busy.code, busy.message, busy.retryable]).toEqual(["network", CONNECTOR_MESSAGES.noAnswer("Zabbix آزمایشی"), true]);
    // too many requests: Retry-After honoured
    m.failOnce.set("item.get", 429);
    const limited = await zabbixKind.pages(ctx(), null).catch((e) => e);
    expect([limited.code, limited.retryAfterMs]).toEqual(["rate_limited", 3000]);
    // not Zabbix at this address: a web page, or JSON that is not JSON-RPC
    m.notZabbix = "html";
    expect(await outcome(zabbixKind.test(ctx()))).toBe(CONNECTOR_MESSAGES.badJson);
    m.notZabbix = "json";
    expect(await outcome(zabbixKind.test(ctx()))).toBe(ZABBIX_MESSAGES.notZabbix);
    m.notZabbix = false;
    // a permission the API user lacks, and any other refusal of the API
    m.rpcFaults.set("host.get", { code: -32500, message: "Application error.", data: "No permissions to referred object or it does not exist!" });
    expect(await outcome(zabbixKind.pages(ctx(), null))).toBe(ZABBIX_MESSAGES.permission);
    m.rpcFaults.set("host.get", { code: -32602, message: "Invalid params.", data: 'Invalid parameter "/1": unexpected parameter "x".' });
    expect(await outcome(zabbixKind.pages(ctx(), null))).toBe(ZABBIX_MESSAGES.rpc('Invalid params. Invalid parameter "/1": unexpected parameter "x".'));
    m.rpcFaults.clear();
    // a redirect to another host
    m.redirectTo = "https://elsewhere.mock.test/zabbix/api_jsonrpc.php";
    expect(await outcome(zabbixKind.test(ctx({ cfg: serverEdition([ZABBIX_HOST]) })))).toBe(CONNECTOR_MESSAGES.redirect);
    m.redirectTo = null;
    // no key stored (a restored backup)
    expect(await outcome(zabbixKind.test(kindCtx(zabbixKind, { view: { base_url: ZABBIX_URL } })))).toBe(CONNECTOR_MESSAGES.reenterKey);
    // a scope with no host is a warning of «آزمودن اتصال», not a failure
    expect((await zabbixKind.test(ctx({ options: { tags: ["env=none"] } }))).warnings).toEqual([ZABBIX_MESSAGES.noHosts]);
    // a slow chunk still answers (the runner's slice, not the kind, bounds the time)
    m.slowMs = 50;
    expect((await zabbixKind.pages(ctx(), null)).records).toHaveLength(1);
  });

  it("plain http only on the server edition with the tick, never on the web version", async () => {
    mount(new ZabbixMock(makeZabbixHosts(2)));
    const plain = { base_url: `http://${ZABBIX_HOST}/zabbix/` };
    const server = serverEdition([ZABBIX_HOST]);
    expect((await zabbixKind.pages(ctx({ cfg: server, view: { ...plain, plain_http: true } }), null)).records).toHaveLength(2);
    expect(await outcome(zabbixKind.pages(ctx({ cfg: server, view: plain }), null))).toBe(CONNECTOR_MESSAGES.plainHttp);
    expect(await outcome(zabbixKind.pages(ctx({ cfg: WEB, view: { ...plain, plain_http: true } }), null))).toBe(CONNECTOR_MESSAGES.plainHttp);
    // and a host off the server's allowlist is refused before anything is sent
    expect(await outcome(zabbixKind.test(ctx({ cfg: serverEdition(["other.bank.local"]) })))).toBe(CONNECTOR_MESSAGES.notAllowed(ZABBIX_HOST));
  });
});

describe("a Zabbix pass through the runner (design A §7)", () => {
  let w: DiscoveryWorld;
  let unmount: () => void;
  const m = new ZabbixMock(makeZabbixHosts(30));
  beforeAll(async () => {
    w = await discoveryWorld();
    unmount = mountMocks({ [ZABBIX_HOST]: m.handler });
  }, 240_000);
  afterAll(() => unmount?.());

  it("loads hosts into CIs of the mapped class with the serial from serialno_a, and keeps each item's link, status and contact", async () => {
    m.triggers.push({ triggerid: "30001", hostid: "10101", description: "/: Disk space is low", priority: "2", lastchange: String(t), value: "1" });
    const c = await w.connector({ name: "Zabbix مرکز داده", kind: "zabbix", base_url: ZABBIX_URL, auth: "token", secret: ZABBIX_TOKEN, options: { class_map: { "Linux servers": "server" } } });
    const { run } = await w.pass(c.id);
    expect(run).toMatchObject({ state: "completed", complete: true, fetched: 30, created: 30 });
    const items = await w.q(`select external_id, state, link_url, status, last_contact_at, ci_id from sm_discovery_items where org_id = $1 and connector_id = $2 order by external_id`, [w.e.org, c.id]);
    expect(items).toHaveLength(30);
    expect(items.every((i) => i.state === "linked" && i.ci_id && i.last_contact_at)).toBe(true);
    expect(items[0].link_url).toBe(`https://${ZABBIX_HOST}/zabbix/hostinventories.php?hostid=10100`);
    expect(items[1].status).toBe("warning");
    const ci = await w.one(`select class, serial_number, ip_address, hostname from sm_cis where org_id = $1 and id = $2`, [w.e.org, items[0].ci_id]);
    expect(ci).toMatchObject({ class: "server", serial_number: "SN-10100", ip_address: "10.20.0.1", hostname: "srv10100" });
  });
});
