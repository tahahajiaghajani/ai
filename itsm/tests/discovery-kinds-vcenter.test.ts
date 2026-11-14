// The «vCenter» kind against its mock (design A §17 «discovery-kinds-vcenter», package DA3a): the session, the test
// call, a pass split by cluster (hosts per cluster, then VMs per host — never a capped list), VMs and hosts mapped to
// their classes with `runs_on`, availability by §9.2 (a powered-off VM is «خاموش», a disconnected host «بی‌پاسخ»),
// contact while powered on or connected, the rolling detail refresh (details only for new, changed and due VMs), deep
// links, every documented error message and plain http only with the server edition's tick. A pass through the runner
// makes the CIs and their runs_on relations, and a second pass reads no details and calls no reconciliation.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connector as vcenterKind, resetVcenterSessions, VCENTER_MESSAGES } from "@server/modules/discovery/connectors/vcenter";
import { CONNECTOR_MESSAGES, type KnownItem } from "@server/modules/discovery/kind";
import { detailDue, vcenterHostStatus, vcenterVmStatus, vmwareSerial } from "@shared/discovery/kinds/vcenter";
import { ITEM_KIND_CLASS, kindDescriptor } from "@shared/discovery/kinds";
import { normaliseRecord } from "@shared/discovery/normalise";
import type { DiscoveredRecord, Page } from "@shared/discovery/types";
import { mountMocks } from "./mocks/discovery/harness";
import { allPages, kindCtx, outcome, serverEdition, WEB } from "./mocks/discovery/kindctx";
import { makeVcenter, VCENTER_HOST, VCENTER_PASSWORD, VCENTER_URL, VCENTER_USER, VcenterMock } from "./mocks/discovery/vcenter";
import { discoveryWorld, type DiscoveryWorld } from "./discovery-helpers";

const UUID = "6f3e1c2a-9b8d-4e5f-a1b2-c3d4e5f60718";

describe("the vCenter rules (design A §9.2, §7.6)", () => {
  it("a host's connection decides availability; a powered-off or suspended VM is «خاموش», never down", () => {
    expect(vcenterHostStatus("DISCONNECTED")).toMatchObject({ state: "unreachable", availability: true });
    expect(vcenterHostStatus("NOT_RESPONDING")).toMatchObject({ state: "unreachable", availability: true });
    expect(vcenterHostStatus("CONNECTED", "POWERED_ON")).toEqual({ state: "up" });
    expect(vcenterHostStatus("CONNECTED", "STANDBY").state).toBe("off");
    expect(vcenterVmStatus("POWERED_OFF", true)).toMatchObject({ state: "off" });
    expect(vcenterVmStatus("SUSPENDED", true)).toMatchObject({ state: "off" });
    expect(vcenterVmStatus("POWERED_OFF", true).availability).toBeUndefined();
    expect(vcenterVmStatus("POWERED_ON", true)).toEqual({ state: "up" });
    expect(vcenterVmStatus("POWERED_ON", false).state).toBe("unknown");
  });

  it("VMware's serial from the BIOS UUID; each VM due for its detail refresh once per period", () => {
    expect(vmwareSerial("4237d0b3-12b5-2b98-5e6c-5d3a0c8b9e1f")).toBe("VMware-42 37 d0 b3 12 b5 2b 98-5e 6c 5d 3a 0c 8b 9e 1f");
    expect(vmwareSerial("00000000-0000-0000-0000-000000000000")).toBeNull();
    const now = new Date("2026-11-14T08:00:00Z");
    expect(detailDue("vm-1", null, now, 7)).toBe(true);
    expect(detailDue("vm-1", new Date(now.getTime() - 8 * 86_400_000).toISOString(), now, 7)).toBe(true);
    // passes every 15 minutes for a week: each VM is due exactly once, and a day's share is about a seventh
    const ids = Array.from({ length: 700 }, (_, i) => `vm-${i + 1}`);
    const step = 15 * 60_000;
    const dueTimes = new Map<string, number>();
    for (let at = now.getTime(); at < now.getTime() + 7 * 86_400_000; at += step) {
      for (const id of ids) if (detailDue(id, new Date(at - step).toISOString(), new Date(at), 7)) dueTimes.set(id, (dueTimes.get(id) ?? 0) + 1);
    }
    expect(dueTimes.size).toBe(700);
    expect([...dueTimes.values()].every((n) => n === 1)).toBe(true);
    let firstDay = 0;
    for (let at = now.getTime(); at < now.getTime() + 86_400_000; at += step) for (const id of ids) if (detailDue(id, new Date(at - step).toISOString(), new Date(at), 7)) firstDay++;
    expect(firstDay).toBeGreaterThan(50);
    expect(firstDay).toBeLessThan(160);
  });
});

describe("the vCenter kind against its mock (design A §17)", () => {
  let unmount: (() => void) | null = null;
  const mount = (m: VcenterMock, extra: Record<string, (r: Request) => Response> = {}) => {
    unmount?.();
    unmount = mountMocks({ [VCENTER_HOST]: m.handler, ...extra });
    return m;
  };
  beforeEach(() => resetVcenterSessions());
  afterEach(() => {
    unmount?.();
    unmount = null;
  });
  const ctx = (over: Parameters<typeof kindCtx>[1] = {}) => kindCtx(vcenterKind, { secret: VCENTER_PASSWORD, ...over, view: { base_url: VCENTER_URL, username: VCENTER_USER, ...over.view } });
  /** A whole pass: the records of every page. */
  const pass = async (c = ctx()) => (await allPages((cur) => vcenterKind.pages(c, cur))).pages.flatMap((p) => p.records);
  /** What the runner would keep of a pass: the normalised records, listed now. */
  const keep = (records: DiscoveredRecord[], listedAt = new Date().toISOString()) =>
    new Map<string, KnownItem>(records.map((r) => [r.external_id, { record: normaliseRecord(r).record!, listed_at: listedAt }]));

  it("is a built kind; «آزمودن اتصال» tells who the connector is, the version and that links need the instance UUID", async () => {
    expect(kindDescriptor("vcenter")?.ready).toBe(true);
    const m = mount(new VcenterMock(makeVcenter(1)));
    const c = ctx();
    expect(await vcenterKind.test(c)).toEqual({ ok: true, version: "8.0.2.00300", identity: VCENTER_USER.toUpperCase(), warnings: [VCENTER_MESSAGES.noLinks] });
    await vcenterKind.pages(c, null);
    // one session per connector, kept between its calls
    expect(m.logins).toBe(1);
    expect((await vcenterKind.test(ctx({ options: { instance_uuid: UUID } }))).warnings).toEqual([]);
    expect(m.logins).toBe(2);
    m.legacy = true;
    resetVcenterSessions();
    expect(await outcome(vcenterKind.test(ctx()))).toBe(VCENTER_MESSAGES.noApi);
  });

  it("splits a pass by cluster: hosts per cluster (and the standalone ones) first, then VMs host by host — never a capped list", async () => {
    const m = mount(new VcenterMock(makeVcenter(2)));
    m.cap = 4;
    const { pages, cursors } = await allPages((cur) => vcenterKind.pages(ctx(), cur));
    expect(pages[0].records.map((r) => [r.external_id, r.kind])).toEqual([["host-11", "host"], ["host-12", "host"], ["host-21", "host"], ["host-22", "host"], ["host-31", "host"]]);
    expect(cursors[0]).toMatchObject({ i: 0, done: 0 });
    const hostLists = m.gets.filter((g) => g.startsWith("/api/vcenter/host"));
    expect(hostLists).toEqual(["/api/vcenter/host?clusters=domain-c8", "/api/vcenter/host?clusters=domain-c9", "/api/vcenter/host?standalone=true"]);
    const vmLists = m.gets.filter((g) => g.startsWith("/api/vcenter/vm?"));
    expect(vmLists).toEqual(["host-11", "host-12", "host-21", "host-22", "host-31"].map((h) => `/api/vcenter/vm?hosts=${h}`));
    const vms = pages.flatMap((p) => p.records).filter((r) => r.kind === "vm");
    expect(vms).toHaveLength(10);
    expect(pages.every((p) => p.complete === true)).toBe(true);
    // the cap is real: an unsplit list would fail
    expect(m.vms.length).toBeGreaterThan(m.cap);
  });

  it("maps VMs and hosts: classes by kind, runs_on through the parent, cluster, serial from the BIOS UUID, MACs, disks, the guest's name and address", async () => {
    mount(new VcenterMock(makeVcenter(1)));
    const records = await pass();
    const host = records.find((r) => r.external_id === "host-11")!;
    expect(host).toMatchObject({ kind: "host", name: "esx11.bank.local", hostname: "esx11.bank.local", attrs: { cluster: "Prod" }, status: { state: "up" } });
    expect(records.find((r) => r.external_id === "host-31")).toMatchObject({ ips: ["10.40.0.31"] });
    expect(records.find((r) => r.external_id === "host-31")!.attrs).toBeUndefined();
    const vm = records.find((r) => r.external_id === "vm-101")!;
    expect(vm).toMatchObject({
      kind: "vm", name: "app-101", cpu_count: 2, ram_mb: 4096, parent_external_id: "host-11", bios_uuid: "42370065-12b5-2b98-5e6c-5d3a0c8b0065",
      serial_number: "VMware-42 37 00 65 12 b5 2b 98-5e 6c 5d 3a 0c 8b 00 65", macs: ["00:50:56:a1:00:65"], disk_gb: 140, os: "Red Hat Enterprise Linux 8 (64-bit)",
      fqdn: "app-101.bank.local", hostname: "app-101", ips: ["10.41.0.101"], status: { state: "up" },
    });
    // the class follows the kind: a VM is a virtual machine, a host a server (§6.3)
    expect([vm.class, host.class]).toEqual([undefined, undefined]);
    expect([ITEM_KIND_CLASS.vm, ITEM_KIND_CLASS.host]).toEqual(["virtual_machine", "server"]);
  });

  it("status and contact: a powered-off VM is off, a disconnected host unreachable and its VMs unknown; a status flip and an availability flip", async () => {
    const data = makeVcenter(1);
    data.vms.find((v) => v.vm === "vm-102")!.power_state = "POWERED_OFF";
    data.vms.find((v) => v.vm === "vm-103")!.power_state = "SUSPENDED";
    data.hosts.find((h) => h.host === "host-22")!.connection_state = "NOT_RESPONDING";
    const m = mount(new VcenterMock(data));
    const records = await pass();
    const by = (id: string) => records.find((r) => r.external_id === id)!;
    expect([by("vm-101").status?.state, by("vm-102").status?.state, by("vm-103").status?.state, by("vm-104").status?.state]).toEqual(["up", "off", "off", "unknown"]);
    expect(by("host-22").status).toMatchObject({ state: "unreachable", availability: true });
    expect(by("vm-101").last_contact_at).toBeTruthy();
    expect([by("vm-102").last_contact_at, by("vm-104").last_contact_at, by("host-22").last_contact_at]).toEqual([undefined, undefined, undefined]);
    expect(by("host-11").last_contact_at).toBeTruthy();
    // the status pass needs no details
    const reads = m.detailReads().length;
    m.vms.find((v) => v.vm === "vm-101")!.power_state = "POWERED_OFF";
    m.hosts.find((h) => h.host === "host-22")!.connection_state = "CONNECTED";
    const items = (await allPages((cur) => vcenterKind.status!(ctx(), cur))).pages.flatMap((p) => p.items);
    const state = Object.fromEntries(items.map((x) => [x.external_id, x.status.state]));
    expect([state["vm-101"], state["host-22"], state["vm-104"]]).toEqual(["off", "up", "up"]);
    expect(m.detailReads()).toHaveLength(reads);
  });

  it("the rolling detail refresh: details only for new VMs, changed list fields, power changes and VMs whose slot came", async () => {
    const m = mount(new VcenterMock(makeVcenter(2)));
    const first = await pass();
    expect(m.detailReads()).toHaveLength(10);
    // the next pass with what the runner keeps: no detail is read, and every record is the same
    const known = keep(first);
    const second = await pass(ctx({ known }));
    expect(m.detailReads()).toHaveLength(10);
    const stable = (r: DiscoveredRecord) => ({ ...normaliseRecord(r).record, last_contact_at: undefined });
    expect(second.map(stable)).toEqual(first.map(stable));
    // a VM grows a CPU, another is powered off, a third is new: three reads
    m.vms.find((v) => v.vm === "vm-101")!.cpu_count = 4;
    m.vms.find((v) => v.vm === "vm-102")!.power_state = "POWERED_OFF";
    m.vms.push({ ...m.vms[0], vm: "vm-999", name: "new-vm", host: "host-31" });
    await pass(ctx({ known }));
    expect(m.detailReads().slice(10).sort()).toEqual(["/api/vcenter/vm/vm-101", "/api/vcenter/vm/vm-102", "/api/vcenter/vm/vm-999"]);
    // listed more than a period ago: every VM is due once
    const old = keep(first, new Date(Date.now() - 8 * 86_400_000).toISOString());
    const before = m.detailReads().length;
    await pass(ctx({ known: old }));
    expect(m.detailReads().length - before).toBe(11);
    // renames rewrite the stored record: details are read every pass then
    const renamed = m.detailReads().length;
    await pass(ctx({ known, view: { mapping: { "attrs.guest": "os" } } }));
    expect(m.detailReads().length - renamed).toBe(11);
  });

  it("a page stops at 500 VMs or at the slice's end and resumes inside the host", async () => {
    const data = makeVcenter(101);
    for (const v of data.vms) v.power_state = "POWERED_OFF";
    const m = mount(new VcenterMock(data));
    // known VMs (no details to read): the 500-VM bound
    const known = new Map<string, KnownItem>(data.vms.map((v) => [v.vm, { record: { external_id: v.vm, kind: "vm", name: v.name, cpu_count: 2, ram_mb: 4096, status: { state: "off" } }, listed_at: new Date().toISOString() }]));
    const { pages, cursors } = await allPages((cur) => vcenterKind.pages(ctx({ known }), cur));
    expect(pages.map((p) => p.records.length)).toEqual([5, 500, 5]);
    expect(cursors.slice(1)).toEqual([expect.objectContaining({ i: 4, done: 96 })]);
    expect(m.detailReads()).toHaveLength(0);
    // the slice's end: a page always makes progress, one VM at least, and the next resumes after it
    const small = mount(new VcenterMock(makeVcenter(3)));
    const hostsPage = await vcenterKind.pages(ctx(), null);
    const late = ctx({ deadline: Date.now() });
    const p1: Page = await vcenterKind.pages(late, hostsPage.next);
    expect(p1.records.map((r) => r.external_id)).toEqual(["vm-101"]);
    expect(p1.next).toMatchObject({ i: 0, done: 1 });
    const p2 = await vcenterKind.pages(late, p1.next);
    expect(p2.records.map((r) => r.external_id)).toEqual(["vm-102"]);
    expect(small.detailReads()).toEqual(["/api/vcenter/vm/vm-101", "/api/vcenter/vm/vm-102"]);
  });

  it("clusters narrow the pass (no standalone hosts); a cluster that is not there stops it instead of making machines look gone", async () => {
    const m = mount(new VcenterMock(makeVcenter(1)));
    const records = await pass(ctx({ options: { clusters: ["prod"] } }));
    expect(records.map((r) => r.external_id)).toEqual(["host-11", "host-12", "vm-101", "vm-102"]);
    expect(m.gets.filter((g) => g.startsWith("/api/vcenter/host?standalone"))).toHaveLength(0);
    expect(await outcome(vcenterKind.pages(ctx({ options: { clusters: ["Prod", "DR"] } }), null))).toBe(VCENTER_MESSAGES.noCluster(["DR"]));
  });

  it("an expired session is replaced once; a VM without Tools keeps its other details; a VM gone before its details and a malformed one are left out", async () => {
    const data = makeVcenter(1);
    delete data.vms.find((v) => v.vm === "vm-102")!.guest;
    data.vms.find((v) => v.vm === "vm-103")!.malformed = true;
    const m = mount(new VcenterMock(data));
    const c = ctx();
    const first = await vcenterKind.pages(c, null);
    m.expireSessions();
    const vmsPage = await vcenterKind.pages(c, first.next);
    expect(m.logins).toBe(2);
    const vm102 = vmsPage.records.find((r) => r.external_id === "vm-102")!;
    expect(vm102).toMatchObject({ bios_uuid: expect.any(String), os: "RHEL_8_64" });
    expect(vm102.hostname).toBeUndefined();
    expect(vmsPage.rejected).toEqual([{ message: VCENTER_MESSAGES.noVmId }]);
    // a VM deleted between the list and its details
    const original = m.handler;
    unmount?.();
    unmount = mountMocks({ [VCENTER_HOST]: (req) => (new URL(req.url).pathname === "/api/vcenter/vm/vm-101" ? new Response(JSON.stringify({ error_type: "NOT_FOUND" }), { status: 404 }) : original(req)) });
    const again = await vcenterKind.pages(c, first.next);
    expect(again.records.map((r) => r.external_id)).not.toContain("vm-101");
  });

  it("deep links to vSphere Client need the vCenter's instance UUID", () => {
    const c = ctx({ options: { instance_uuid: UUID } });
    expect(vcenterKind.link!({ external_id: "vm-101", kind: "vm", name: "x" }, c)).toBe(`https://${VCENTER_HOST}/ui/app/vm;nav=h/urn:vmomi:VirtualMachine:vm-101:${UUID}/summary`);
    expect(vcenterKind.link!({ external_id: "host-11", kind: "host", name: "x" }, c)).toBe(`https://${VCENTER_HOST}/ui/app/host;nav=h/urn:vmomi:HostSystem:host-11:${UUID}/summary`);
    expect(vcenterKind.link!({ external_id: "vm-101", kind: "vm", name: "x" }, ctx())).toBeNull();
    expect(() => vcenterKind.optionsSchema.parse({ instance_uuid: "not-a-uuid" })).toThrow();
  });

  it("answers every documented error with its Persian message", async () => {
    const m = mount(new VcenterMock(makeVcenter(1)), { "elsewhere.mock.test": () => new Response("{}") });
    expect(await outcome(vcenterKind.test(ctx({ secret: "wrong" })))).toBe(CONNECTOR_MESSAGES.auth);
    m.failOnce.set("/api/vcenter/cluster", 503);
    const busy = await vcenterKind.pages(ctx(), null).catch((e) => e);
    expect([busy.code, busy.message]).toEqual(["network", CONNECTOR_MESSAGES.noAnswer("VMware vCenter آزمایشی")]);
    m.failOnce.set("/api/vcenter/host", 429);
    const limited = await vcenterKind.pages(ctx(), null).catch((e) => e);
    expect([limited.code, limited.retryAfterMs]).toEqual(["rate_limited", 5000]);
    m.redirectTo = "https://elsewhere.mock.test/api/session";
    resetVcenterSessions();
    expect(await outcome(vcenterKind.test(ctx()))).toBe(CONNECTOR_MESSAGES.redirect);
    m.redirectTo = null;
    expect(await outcome(vcenterKind.test(kindCtx(vcenterKind, { view: { base_url: VCENTER_URL, username: VCENTER_USER } })))).toBe(CONNECTOR_MESSAGES.reenterKey);
    m.badSession = true;
    resetVcenterSessions();
    expect(await outcome(vcenterKind.test(ctx()))).toBe(VCENTER_MESSAGES.noSession);
    m.badSession = false;
    // a vCenter where the user sees no host: a warning of «آزمودن اتصال», not a failure
    const hosts = m.hosts;
    m.hosts = [];
    expect((await vcenterKind.test(ctx({ options: { instance_uuid: UUID } }))).warnings).toEqual([VCENTER_MESSAGES.noHosts]);
    m.hosts = hosts;
    // a slow list still answers (the runner's slice, not the kind, bounds the time)
    m.slowMs = 50;
    expect((await pass()).length).toBe(10);
  });

  it("plain http only on the server edition with the tick, never on the web version", async () => {
    mount(new VcenterMock(makeVcenter(1)));
    const plain = { base_url: `http://${VCENTER_HOST}/` };
    const server = serverEdition([VCENTER_HOST]);
    expect((await pass(ctx({ cfg: server, view: { ...plain, plain_http: true } }))).length).toBe(10);
    expect(await outcome(vcenterKind.pages(ctx({ cfg: server, view: plain }), null))).toBe(CONNECTOR_MESSAGES.plainHttp);
    expect(await outcome(vcenterKind.pages(ctx({ cfg: WEB, view: { ...plain, plain_http: true } }), null))).toBe(CONNECTOR_MESSAGES.plainHttp);
  });
});

describe("a vCenter pass through the runner (design A §6.3, §7.4, §7.6)", () => {
  let w: DiscoveryWorld;
  let unmount: () => void;
  const m = new VcenterMock(makeVcenter(2));
  beforeAll(async () => {
    resetVcenterSessions();
    w = await discoveryWorld();
    unmount = mountMocks({ [VCENTER_HOST]: m.handler });
  }, 240_000);
  afterAll(() => unmount?.());

  it("makes hosts servers and VMs virtual machines that run on them; the second pass reads no details and calls no reconciliation", async () => {
    const c = await w.connector({ name: "vCenter مرکز داده", kind: "vcenter", base_url: VCENTER_URL, auth: "session", username: VCENTER_USER, secret: VCENTER_PASSWORD, options: { instance_uuid: UUID } });
    const first = await w.pass(c.id);
    expect(first.run).toMatchObject({ state: "completed", complete: true, fetched: 15, created: 15, failed: 0 });
    const cis = await w.q(`select i.external_id, ci.class from sm_discovery_items i join sm_cis ci on ci.id = i.ci_id where i.connector_id = $1 order by i.external_id`, [c.id]);
    expect(cis.filter((x) => x.external_id.startsWith("host-")).every((x) => x.class === "server")).toBe(true);
    expect(cis.filter((x) => x.external_id.startsWith("vm-")).every((x) => x.class === "virtual_machine")).toBe(true);
    const rels = await w.one<{ n: number }>(
      `select count(*)::int as n from sm_discovery_items vm join sm_discovery_items h on h.connector_id = vm.connector_id and h.external_id = vm.data->>'parent_external_id'
         join sm_ci_rels r on r.parent_id = vm.ci_id and r.child_id = h.ci_id and r.type = 'runs_on' and r.deleted_at is null
        where vm.connector_id = $1`,
      [c.id],
    );
    expect(rels.n).toBe(10);
    const link = await w.one<{ link_url: string }>(`select link_url from sm_discovery_items where connector_id = $1 and external_id = 'vm-101'`, [c.id]);
    expect(link.link_url).toBe(`https://${VCENTER_HOST}/ui/app/vm;nav=h/urn:vmomi:VirtualMachine:vm-101:${UUID}/summary`);
    expect(m.detailReads()).toHaveLength(10);
    const second = await w.pass(c.id);
    expect(second.run).toMatchObject({ state: "completed", skipped_unchanged: 15, created: 0, updated: 0 });
    expect(m.detailReads()).toHaveLength(10);
  });
});
