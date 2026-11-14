// The data sources' screens (design A §15, package DA4 part a): the pure rules behind them
// (src/ui/modules/discovery/model.ts), the module's place in the shell, the result line's markup, and the screens'
// own requests against the real routes — so what the wizard and the settings send is what the API takes.
//   · only the kinds kept for 1.1 are offered; a kind's connection, options and settings by kind and way in
//   · keys are write-only: never sent back, typed ones sent once, asked again when the address moves
//   · what a person may change mirrors the connector guard, within the engine's word on the record
//   · the wizard's bodies, «آزمودن اتصال», «پیش‌نمایش», «ذخیره و اجرای نخست», «پذیرش اندازهٔ تازه» end to end
// Part b: «صف آشتی» (who acts on what, the bulk bar, the actions against the routes), «وضعیت پایش» and the side panel
// (a branch officer reads status without tool names, requesters get no panel, the record's meta folds it), the mapping
// editor (refused fields, the draft, what a sample gives), and the places of the CMDB's two secondary rows.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { composeEffective, gateAllows, roleCatalog, type FullGrant } from "@shared/access";
import { KIND_DESCRIPTORS, kindDescriptor } from "@shared/discovery/kinds";
import { describeKind } from "@shared/discovery/kinds/base";
import type { KindDescriptor } from "@shared/discovery/types";
import { ASSET_FIELDS as GUARD_ASSET_FIELDS, OWNER_FIELDS as GUARD_OWNER_FIELDS } from "@server/modules/discovery/guard";
import { KEYED_AUTH } from "@server/modules/discovery/runner";
import * as m from "../src/ui/modules/discovery/model";
import { NAV, ROUTES, SPACE_OF_SEGMENT } from "../src/ui/modules/registry";
import { TestResultNote, KindName } from "../src/ui/modules/discovery/parts";
import { MemoryRouter } from "react-router";
import { createIn } from "@server/engine";
import { QUEUE_TABS as SERVER_QUEUE_TABS } from "@server/modules/discovery/service";
import { aggregateTargets, applyItemStatuses, BOARD_CHIPS as SERVER_BOARD_CHIPS, resetStatusThrottles } from "@server/modules/discovery/status";
import { APPLICABLE_FIELDS as SERVER_APPLICABLE } from "@server/modules/discovery/mismatch";
import { REFUSED_FIELD_MESSAGE } from "@shared/discovery/mapping";
import { extensionsFor } from "../src/ui/records/extensions";
import { PanelBody } from "../src/ui/modules/discovery/Panel";
import { liveRecord } from "../src/ui/modules/discovery/Mapping";
import { discoveryWorld, type DiscoveryWorld, type Row } from "./discovery-helpers";
import { mountMocks, type Handler } from "./mocks/discovery/harness";
import { makeDevices, RestMock, REST_CONNECTOR, REST_TOKEN } from "./mocks/discovery/rest";

const kind = (d: Partial<KindDescriptor> & Pick<KindDescriptor, "kind" | "auth">): KindDescriptor =>
  describeKind({ label: d.kind, icon: "radar", category: "generic", editions: ["cloud", "server"], collects: ["inventory", "status"], contact: { lag_days: 0 }, availability: true, priority: 70, ready: true, ...d });
const rest = kindDescriptor("rest")!;
const zabbix = kind({ kind: "zabbix", category: "monitoring", auth: ["token"], options: [{ key: "host_groups", label: "گروه‌ها", type: "tags" }] });
const vcenter = kind({ kind: "vcenter", category: "virtualisation", auth: ["session"] });
const push = kind({ kind: "push", auth: ["none"], options: [{ key: "availability_match", label: "الگو", type: "string" }] });
const feed = kind({
  kind: "feed",
  category: "atm_files",
  auth: ["none", "token", "basic"],
  options: [
    { key: "source", label: "محل فایل", type: "choice", default: "url" },
    { key: "path", label: "مسیر فایل", type: "string" },
    { key: "format", label: "قالب", type: "choice", default: "auto" },
  ],
});

describe("the kinds the wizard offers (the owner's 1.1 list)", () => {
  it("offers only built kinds of the kept list — never a stub made ready by mistake, never the demo pack's kind", () => {
    expect([...m.KEPT_KINDS].sort()).toEqual(["demo", "feed", "prtg", "push", "rest", "vcenter", "zabbix"]);
    // every kind as if its package had landed: only the kept ones (without the hidden demo kind) are offered
    const all = KIND_DESCRIPTORS.map((d) => ({ ...d, ready: true, runs: true }));
    const offered = m.wizardGroups(all).flatMap((g) => g.kinds.map((k) => k.kind));
    expect(offered.sort()).toEqual(["feed", "prtg", "push", "rest", "vcenter", "zabbix"]);
    for (const moved of ["glpi", "mecm", "ad_computers", "ksc", "endpoint_central", "sql_view"]) expect(offered).not.toContain(moved);
    // as this branch has them: stubs stay hidden
    expect(m.wizardGroups(KIND_DESCRIPTORS.map((d) => ({ ...d, runs: true }))).flatMap((g) => g.kinds.map((k) => k.kind))).toEqual(
      KIND_DESCRIPTORS.filter((d) => d.ready && !d.hidden && m.KEPT_KINDS.includes(d.kind)).map((d) => d.kind),
    );
    // groups in the design's order, «پایش» first
    expect(m.wizardGroups(all).map((g) => g.label)).toEqual(["پایش", "مجازی‌سازی", "خودپردازها و فایل‌ها", "ورود عمومی"]);
  });
});

describe("fields by kind and way in", () => {
  it("the connection asks what reaching each kind takes", () => {
    const v = (x: Record<string, unknown>) => ({ ...m.newValues(rest), ...x });
    expect(m.connectionFields(rest, v({ auth: "none" }), "cloud")).toEqual(["name", "base_url", "auth", "opt.path", "opt.items_path", "ca_cert", "hosts"]);
    expect(m.connectionFields(rest, v({ auth: "token" }), "cloud")).toEqual(["name", "base_url", "auth", "secret", "api_key_header", "opt.path", "opt.items_path", "ca_cert", "hosts"]);
    expect(m.connectionFields(rest, v({ auth: "basic" }), "cloud")).toEqual(["name", "base_url", "auth", "username", "secret", "opt.path", "opt.items_path", "ca_cert", "hosts"]);
    // one way in: no choice; no header choice outside the REST and file kinds; the unencrypted tick in the server edition only
    expect(m.connectionFields(zabbix, m.newValues(zabbix), "cloud")).toEqual(["name", "base_url", "secret", "ca_cert", "hosts"]);
    expect(m.connectionFields(zabbix, m.newValues(zabbix), "server")).toContain("plain_http");
    expect(m.connectionFields(vcenter, m.newValues(vcenter), "cloud")).toEqual(["name", "base_url", "username", "secret", "ca_cert", "hosts"]);
    // the tool sends: an integration user, no address and no key
    expect(m.connectionFields(push, m.newValues(push), "cloud")).toEqual(["name", "push_user_id"]);
    // files: an address and a path, or the server's drop folder (neither)
    expect(m.connectionFields(feed, { ...m.newValues(feed), "opt.source": "url" }, "server")).toEqual(["name", "opt.source", "base_url", "auth", "opt.path", "ca_cert", "hosts", "plain_http"]);
    expect(m.connectionFields(feed, { ...m.newValues(feed), "opt.source": "folder" }, "server")).toEqual(["name", "opt.source"]);
  });

  it("«چه بیاید» shows the kind's other options, REST only its paging style's parameters", () => {
    const at = (paging: string) => m.collectFields(rest, { ...m.newValues(rest), "opt.paging": paging }).filter((f) => f.startsWith(m.OPT));
    expect(at("offset")).toEqual(expect.arrayContaining(["opt.paging", "opt.page_size", "opt.offset_param", "opt.limit_param", "opt.total_path"]));
    expect(at("offset")).not.toContain("opt.page_param");
    expect(at("page")).toEqual(expect.arrayContaining(["opt.page_param", "opt.size_param", "opt.first_page"]));
    expect(at("next_link")).toEqual(expect.arrayContaining(["opt.next_path", "opt.limit_param"]));
    expect(at("none").filter((f) => /param|page_size|path$/.test(f) && f !== "opt.total_path")).toEqual([]);
    // the listing's path and array were asked with the connection
    expect(at("offset")).not.toContain("opt.path");
    expect(at("offset")).not.toContain("opt.items_path");
    expect(m.collectFields(push)).toEqual(["collect", "opt.availability_match", "create_policy", "default_class"]);
    // the status pass only when the kind reports status and it is collected
    expect(m.scheduleFields(rest, { collect: ["inventory", "status"] })).toEqual(["every_minutes", "status_every_minutes"]);
    expect(m.scheduleFields(rest, { collect: ["inventory"] })).toEqual(["every_minutes"]);
    expect(m.collectChoices(kind({ kind: "x", auth: ["none"], collects: ["inventory", "software"] }), { softwareManager: false }).map((o) => o.value)).toEqual(["inventory"]);
  });

  it("settings: ATM fields for the ATM sources, asset creation for asset managers only", () => {
    const fields = (d: KindDescriptor, assetManager: boolean) => m.settingsFields(d, m.newValues(d), "cloud", { assetManager });
    expect(fields(feed, false)).toEqual(expect.arrayContaining(["device_status_map", "device_hold_minutes", "manual_hold_hours"]));
    expect(fields(rest, false)).not.toContain("device_status_map");
    expect(fields(rest, false)).not.toContain("make_assets");
    expect(fields(rest, true)).toEqual(expect.arrayContaining(["make_assets", "make_assets_daily"]));
    expect(fields(push, false)).not.toContain("rate_per_second");
  });
});

describe("who changes what (the connector guard, mirrored)", () => {
  const fields = m.settingsFields(rest, { ...m.newValues(rest), auth: "token" }, "cloud", { assetManager: true });
  it("uses the guard's own lists", () => {
    expect([...m.OWNER_FIELDS]).toEqual([...GUARD_OWNER_FIELDS]);
    expect([...m.ASSET_FIELDS]).toEqual([...GUARD_ASSET_FIELDS]);
  });
  it("administrators change all but asset creation, owners their four fields, asset managers asset creation, readers nothing", () => {
    const admin = m.editableFields(fields, { admin: true, owner: false, assetManager: false, softwareManager: false });
    for (const f of ["secret", "base_url", "auth", "opt.path", "over_manual", "create_policy"]) expect(admin.has(f)).toBe(true);
    expect(admin.has("make_assets")).toBe(false);
    expect([...m.editableFields(fields, { admin: false, owner: true, assetManager: false, softwareManager: false })].sort()).toEqual(["active", "description", "every_minutes", "status_every_minutes"]);
    expect([...m.editableFields(fields, { admin: false, owner: false, assetManager: true, softwareManager: false })].sort()).toEqual(["make_assets", "make_assets_daily"]);
    expect(m.editableFields(fields, { admin: false, owner: false, assetManager: false, softwareManager: false }).size).toBe(0);
  });
  it("within the engine's word on the record: no write, nothing; a read-only field stays read-only", () => {
    const owner = { admin: false, owner: true, assetManager: false, softwareManager: false };
    expect(m.editableFields(fields, owner, { canWrite: false }).size).toBe(0);
    expect(m.editableFields(fields, { ...owner, admin: true }, { canWrite: true, readonly: ["name"] }).has("name")).toBe(false);
  });
});

describe("keys are write-only", () => {
  const stored = m.formValues({ id: "c1", kind: "rest", auth: "token", base_url: "https://a.example/", secret: { secret: true, hint: "…" }, options: { path: "/x/", extra: 1 } }, rest);
  it("a stored key is never sent back; a typed one is sent once; an empty box keeps the stored one", () => {
    const fields = ["name", "secret", "base_url"];
    expect(m.changes(rest, stored, { ...stored }, fields)).toEqual({});
    expect(m.changes(rest, stored, { ...stored, secret: { secret: true } }, fields)).toEqual({});
    expect(m.changes(rest, stored, { ...stored, secret: "" }, fields)).toEqual({});
    expect(m.changes(rest, stored, { ...stored, secret: "new-key" }, fields)).toEqual({ secret: "new-key" });
    // a new source sends a typed key, never a placeholder
    expect(m.createBody(rest, { ...m.newValues(rest), name: "a", secret: { secret: true } }, ["name", "secret"])).not.toHaveProperty("secret");
    expect(m.createBody(rest, { ...m.newValues(rest), name: "a", secret: "k" }, ["name", "secret"])).toMatchObject({ secret: "k", active: false });
  });
  it("is asked while none is stored, and again when the address moves to another host (the server clears it then)", () => {
    const fields = m.connectionFields(rest, stored, "cloud");
    expect(m.requiredFields(rest, { ...m.newValues(rest), auth: "token" }, fields).has("secret")).toBe(true);
    expect(m.requiredFields(rest, stored, fields, stored).has("secret")).toBe(false);
    expect(m.requiredFields(rest, { ...stored, base_url: "https://a.example/other/" }, fields, stored).has("secret")).toBe(false);
    expect(m.requiredFields(rest, { ...stored, base_url: "https://b.example/" }, fields, stored).has("secret")).toBe(true);
    expect(m.requiredFields(rest, { ...stored, hosts: ["web.a.example"] }, fields, stored).has("secret")).toBe(true);
    expect(m.missingFields(new Set(["secret", "name"]), { name: "x", secret: { secret: true } })).toEqual(["secret"]);
    // every way in the server reads a key for asks for one here
    for (const a of ["token", "basic", "session"]) expect(KEYED_AUTH.has(a)).toBe(true);
  });
  it("options change as one object over the stored ones (other keys kept, emptied ones dropped)", () => {
    const fields = ["opt.path", "opt.items_path"];
    expect(m.changes(rest, stored, { ...stored, "opt.items_path": "results" }, fields)).toEqual({ options: { path: "/x/", extra: 1, items_path: "results" } });
    expect(m.changes(rest, stored, { ...stored, "opt.path": "" }, fields).options).not.toHaveProperty("path");
  });
});

describe("the words of the console and the connector page", () => {
  const ago = () => "۱۰ دقیقه پیش";
  // percentages carry an Arabic letter mark before the digits (lib/fa pct)
  const text = (x: { text: string }) => x.text.replace(/\u061c/g, "");
  const card = (x: Partial<m.ConnectorCard>): m.ConnectorCard => ({
    id: "c", name: "n", kind: "rest", label: "REST", icon: "braces", category: "generic", active: true, owner_id: null, plain_http: false, every_minutes: 60, needs_key: false,
    items: { total: 0 }, last_run: null, running: null, held: null, failures: 0, can: { edit: true, operate: true }, ...x,
  });
  it("one status line from the passes, in Persian digits", () => {
    expect(m.statusLine(card({}), ago).text).toBe("هنوز اجرا نشده است");
    expect(text(m.statusLine(card({ items: { total: 12408, linked: 12036 }, last_run: { id: "r", state: "completed", finished_at: "2026-11-14T10:00:00Z" } }), ago))).toBe("۱۲٬۴۰۸ مورد · ۹۷٪ پیوسته · آخرین اجرا ۱۰ دقیقه پیش");
    expect(m.statusLine(card({ last_run: { id: "r", state: "failed", error: "کلید پذیرفته نشد" } }), ago)).toEqual({ text: "اجرای آخر ناموفق: کلید پذیرفته نشد", tone: "danger" });
    expect(m.statusLine(card({ running: { id: "r", phase: "fetch", fetched: 1500 } }), ago)).toEqual({ text: "در حال اجرا · خواندن فهرست · ۱٬۵۰۰ خوانده‌شده", tone: "info" });
    expect(m.statusLine(card({ held: { run_id: "r", listed: 2, message: "" } }), ago).tone).toBe("warning");
    expect(m.statusLine(card({ needs_key: true, last_run: { id: "r", state: "completed" } }), ago).text).toBe("کلید منبع را دوباره وارد کنید");
    // items no longer reported do not count
    expect(m.currentItems({ total: 10, gone: 8, linked: 2 })).toBe(2);
  });
  it("the state chip: only what needs attention is a chip", () => {
    expect(m.connectorState(card({}))).toEqual({ label: "فعال", tone: null });
    expect(m.connectorState(card({ active: false }))).toEqual({ label: "خاموش", tone: "neutral" });
    expect(m.connectorState(card({ held: { run_id: "r", listed: 1, message: "" } })).tone).toBe("warning");
    expect(m.scheduleText(0)).toBe("فقط دستی");
    expect(m.scheduleText(60)).toBe("هر ساعت");
    expect(m.scheduleText(120)).toBe("هر ۲ ساعت");
    expect(m.scheduleText(15)).toBe("هر ۱۵ دقیقه");
    expect(m.durationText(95_000)).toBe("۲ دقیقه");
  });
  it("«آزمودن اتصال»'s result line: version in a Latin isolate, warnings listed, or the Persian cause", () => {
    const ok = renderToStaticMarkup(createElement(TestResultNote, { result: { ok: true, version: "6.4.2", identity: "kariz-ro", warnings: ["گروه «Linux» دیده نمی‌شود"] } }));
    expect(ok).toContain("اتصال برقرار است");
    expect(ok).toMatch(/<bdi dir="ltr"[^>]*>6\.4\.2<\/bdi>/);
    expect(ok).toContain("<li>گروه «Linux» دیده نمی‌شود</li>");
    const bad = renderToStaticMarkup(createElement(TestResultNote, { result: { ok: false, warnings: [], message: "کلید پذیرفته نشد" } }));
    expect(bad).toContain('data-tone="danger"');
    expect(bad).toContain("کلید پذیرفته نشد");
    // a Persian label that starts with a product name reads right to left
    expect(renderToStaticMarkup(createElement(KindName, { label: "REST/JSON عمومی" }))).toContain('dir="rtl"');
  });
});

describe("the module in the shell", () => {
  const grantsOf = (...roles: string[]): Record<string, FullGrant> => composeEffective({ role: "member", levels: { work: "edit" }, explicit: roles, catalog: roleCatalog([]) }).grants;
  const keys = (g: Record<string, FullGrant>) => NAV.flatMap((n) => n.items.filter((i) => !i.access || [i.access].flat().every((a) => gateAllows(g, a))).map((i) => i.key));
  it("a group of the assets space, web and server edition only; routes under discovery/", () => {
    const group = NAV.find((g) => g.key === "discovery")!;
    expect(group.space).toBe("assets");
    expect(group.items.every((i) => i.cloudOnly)).toBe(true);
    expect(SPACE_OF_SEGMENT.discovery).toBe("assets");
    for (const p of ["discovery", "discovery/new", "discovery/:id"]) expect(ROUTES.map((r) => r.path)).toContain(p);
  });
  it("CMDB readers see the console, CMDB administrators also «منبع داده تازه», requesters nothing", () => {
    expect(keys(grantsOf("requester")).filter((k) => k.startsWith("discovery:"))).toEqual([]);
    // (part b's queue and board rows are counted in «part b in the shell»)
    const partA = (ks: string[]) => ks.filter((k) => k === "discovery:console" || k === "discovery:new");
    expect(partA(keys(grantsOf("agent")))).toEqual(["discovery:console"]);
    expect(partA(keys(grantsOf("configuration_manager")))).toEqual(["discovery:console", "discovery:new"]);
  });
});

describe("the screens' requests against the routes", () => {
  let w: DiscoveryWorld;
  const hosts: Record<string, Handler> = {};
  let unmount: () => void;
  beforeAll(async () => {
    w = await discoveryWorld();
    unmount = mountMocks(hosts);
  }, 180_000);
  afterAll(() => unmount?.());

  it("the wizard: «اتصال» makes the source switched off and tests it, «چه بیاید» sends what changed, a preview, «ذخیره و اجرای نخست»", async () => {
    const P = w.P;
    hosts["ui.mock.test"] = new RestMock(makeDevices(6, { from: 7000 })).handler;
    const meta = await w.e.owner.get(`${P}/discovery/meta`);
    const d = meta.kinds.find((k: Row) => k.kind === "rest") as m.OfferedKind;
    const offered = m.wizardGroups(meta.kinds).flatMap((g) => g.kinds.map((k) => k.kind));
    expect(offered).toContain("rest");
    expect(offered.every((k) => m.KEPT_KINDS.includes(k) && k !== "demo")).toBe(true);
    const v = { ...m.newValues(d), name: "منبع ویزارد", base_url: "https://ui.mock.test/", auth: "token", secret: REST_TOKEN, api_key_header: "X-API-Key", "opt.path": "/api/devices/", "opt.items_path": "results" };
    const conn = m.connectionFields(d, v, meta.edition);
    expect(m.missingFields(m.requiredFields(d, v, conn), v)).toEqual([]);
    const made = (await w.e.owner.post(`${P}/discovery/connectors`, m.createBody(d, v, conn), 201)).row;
    expect(made).toMatchObject({ active: false, auth: "token", api_key_header: "X-API-Key", secret: { secret: true }, options: { path: "/api/devices/", items_path: "results" } });
    // a switched-off source queues no sweep
    expect(await w.e.owner.post(`${P}/discovery/connectors/${made.id}/test`)).toMatchObject({ ok: true });
    const stored = m.formValues(made, d);
    const what = [...m.collectFields(d, stored), ...m.scheduleFields(d, stored)];
    const body = m.changes(d, stored, { ...stored, "opt.total_path": "count", create_policy: "review" }, what);
    expect(body).toEqual({ create_policy: "review", options: { path: "/api/devices/", items_path: "results", total_path: "count" } });
    const patched = (await w.e.owner.patch(`${P}/discovery/connectors/${made.id}`, { ...body, version: made.version })).row;
    expect(patched).toMatchObject({ create_policy: "review", secret: { secret: true }, options: { total_path: "count" } });
    const preview = await w.e.owner.post(`${P}/discovery/connectors/${made.id}/preview`, { limit: 20 });
    expect(preview).toMatchObject({ total: 6 });
    expect(preview.rows.map((r: Row) => r.action)).toEqual(Array(6).fill("unmatched"));
    // «ذخیره و اجرای نخست»
    await w.e.owner.patch(`${P}/discovery/connectors/${made.id}`, { active: true, version: patched.version });
    expect(await w.e.owner.post(`${P}/discovery/connectors/${made.id}/run`)).toMatchObject({ queued: true });
    await w.drain();
    const page = await w.e.owner.get(`${P}/discovery/connectors/${made.id}`);
    expect(page.can).toMatchObject({ edit: true, operate: true, preview: true });
    expect(page.meta.canWrite).toBe(true);
    expect(m.statusLine(page.card, () => "اکنون").text.replace(/\u061c/g, "")).toBe("۶ مورد · ۰٪ پیوسته · آخرین اجرا اکنون");
    expect(page.card.items.unmatched).toBe(6);
    // nothing the screens read carries the key
    for (const path of [`/discovery/connectors/${made.id}`, "/discovery/connectors", `/discovery/connectors/${made.id}/runs`]) expect(JSON.stringify(await w.e.owner.get(`${P}${path}`))).not.toContain(REST_TOKEN);
  }, 180_000);

  it("settings: a moved address needs the key again (the server clears it); «پذیرش اندازهٔ تازه» after a held drop", async () => {
    const P = w.P;
    const mock = new RestMock(makeDevices(10, { from: 7100 }));
    hosts["drop-ui.mock.test"] = mock.handler;
    hosts["moved-ui.mock.test"] = mock.handler;
    const c = await w.connector({ kind: "rest", name: "منبع جابه‌جا", base_url: "https://drop-ui.mock.test/", auth: "token", api_key_header: "X-API-Key", secret: REST_TOKEN, options: { path: "/api/devices/", items_path: "results", total_path: "count" } });
    const d = kindDescriptor("rest")!;
    // the held drop: ten, then two
    await w.pass(c.id);
    mock.devices = mock.devices.slice(0, 2);
    await w.pass(c.id);
    let card = (await w.e.owner.get(`${P}/discovery/connectors/${c.id}`)).card;
    expect(card.held).toMatchObject({ listed: 2 });
    expect(m.connectorState(card).label).toBe("در انتظار پذیرش");
    expect(await w.e.owner.post(`${P}/discovery/runs/${card.held.run_id}/accept`)).toEqual({ gone: 8 });
    card = (await w.e.owner.get(`${P}/discovery/connectors/${c.id}`)).card;
    expect(card.held).toBeNull();
    expect(m.currentItems(card.items)).toBe(2);
    // the address moves: the screens ask for the key; sent without one, the server clears the stored key
    const page = await w.e.owner.get(`${P}/discovery/connectors/${c.id}`);
    const before = m.formValues(page.row, d);
    const after = { ...before, base_url: "https://moved-ui.mock.test/" };
    const fields = m.connectionFields(d, after, "cloud");
    expect(m.missingFields(m.requiredFields(d, after, fields, before), after)).toEqual(["secret"]);
    await w.e.owner.patch(`${P}/discovery/connectors/${c.id}`, { ...m.changes(d, before, after, fields), version: page.row.version });
    expect((await w.e.owner.get(`${P}/discovery/connectors`)).connectors.find((x: Row) => x.id === c.id).needs_key).toBe(true);
    // with the key typed again, the same change keeps it
    const again = await w.e.owner.get(`${P}/discovery/connectors/${c.id}`);
    const typed = { ...m.formValues(again.row, d), secret: REST_TOKEN };
    await w.e.owner.patch(`${P}/discovery/connectors/${c.id}`, { ...m.changes(d, m.formValues(again.row, d), typed, fields), version: again.row.version });
    expect((await w.e.owner.get(`${P}/discovery/connectors`)).connectors.find((x: Row) => x.id === c.id).needs_key).toBe(false);
  }, 240_000);
});

// ---------------------------------------------------------------------------------------------------------------
// Part b

/** The side panel's body as a CMDB reader or a branch officer gets it (server-rendered). */
const renderPanel = (data: m.PanelData) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(PanelBody, { data, orgId: "o", timezone: "Asia/Tehran" })));

describe("the reconciliation queue's rules (design A §8.4, §14.5)", () => {
  const admin: m.QueueRights = { admin: true, assetManager: false, operates: new Set() };
  const owner: m.QueueRights = { admin: false, assetManager: false, operates: new Set(["c1"]) };
  const agent: m.QueueRights = { admin: false, assetManager: false, operates: new Set() };
  const assets: m.QueueRights = { admin: false, assetManager: true, operates: new Set() };
  const item = (x: Partial<m.ItemRow> = {}) => ({ connector_id: "c1", kind: "device", state: "unmatched", mismatch_state: "none", ...x });
  it("the tabs and the asset fields are the server's", () => {
    expect(m.QUEUE_TABS.map((t) => t.key)).toEqual([...SERVER_QUEUE_TABS]);
    expect([...m.APPLICABLE_FIELDS].sort()).toEqual([...SERVER_APPLICABLE].sort());
    expect(m.tabLabel("بی‌همتا", 12)).toBe("بی‌همتا ۱۲");
    expect(m.tabLabel("خطا", 0)).toBe("خطا");
  });
  it("CMDB administrators and the connector's owner act on its items; never «ساخت پیکربندی» for an ATM", () => {
    expect(m.queueActions("unmatched", item(), admin)).toEqual(["create", "link", "ignore"]);
    expect(m.queueActions("duplicate", item({ state: "duplicate" }), owner)).toEqual(["create", "link", "ignore"]);
    expect(m.queueActions("unmatched", item({ connector_id: "c2" }), owner)).toEqual([]);
    expect(m.queueActions("unmatched", item(), agent)).toEqual([]);
    expect(m.queueActions("unmatched", item({ kind: "atm" }), admin)).toEqual(["link", "ignore"]);
    expect(m.queueActions("error", item({ state: "linked" }), admin)).toEqual([]);
    // differences with the asset register: asset managers and CMDB administrators, not an owner by being one
    expect(m.queueActions("mismatch", item({ state: "linked", mismatch_state: "open" }), assets)).toEqual(["dismiss"]);
    expect(m.queueActions("mismatch", item({ state: "linked", mismatch_state: "open" }), owner)).toEqual([]);
  });
  it("the bulk bar offers what every selected item offers, «پیوند به…» one item at a time", () => {
    expect(m.bulkActions("unmatched", [item(), item({ kind: "atm" })], admin)).toEqual(["ignore"]);
    expect(m.bulkActions("unmatched", [item()], admin)).toEqual(["create", "link", "ignore"]);
    expect(m.bulkActions("unmatched", [], admin)).toEqual([]);
  });
  it("«به‌روزرسانی دارایی با مقدار ابزار» only for an asset field whose value resolved", () => {
    const e = (x: Partial<m.MismatchEntry>): m.MismatchEntry => ({ field: "asset_tag", target: "asset", label: "برچسب اموال", reported: "AST-1", held: "AST-2", ...x });
    expect(m.applicable(e({}))).toBe(true);
    expect(m.applicable(e({ field: "assigned_to", reported: "ali", resolved: null }))).toBe(false);
    expect(m.applicable(e({ field: "assigned_to", reported: "ali", resolved: "u1" }))).toBe(true);
    expect(m.applicable(e({ field: "ram_mb", target: "ci" }))).toBe(false);
  });
  it("the toasts say what happened, in Persian digits", () => {
    expect(m.bulkOutcome(3, [])).toEqual({ ok: true, text: "۳ مورد انجام شد" });
    expect(m.bulkOutcome(2, ["x", "y"]).text).toBe("۲ مورد انجام شد؛ ۲ مورد نه: x");
    expect(m.bulkOutcome(0, ["x"])).toEqual({ ok: false, text: "x" });
    expect(m.createdText({ action: "created", number: "CI-0001" })).toEqual({ ok: true, text: "پیکربندی CI-0001 ساخته شد" });
    expect(m.createdText({ action: "duplicate" }).ok).toBe(false);
  });
});

describe("the board and the side panel (design A §15, §14.5)", () => {
  const status = { state: "down", label: "قطع", color: "red", since: "2026-11-14T09:00:00Z", sources: 1, last_contact_at: "2026-11-14T09:30:00Z", stale_since: null };
  const render = renderPanel;
  it("the chips are the server's; a row opens its CI for CMDB readers, its asset for others", () => {
    expect(m.BOARD_CHIPS.map((c) => c.key)).toEqual([...SERVER_BOARD_CHIPS]);
    expect(m.boardPath({ target_table: "ci", ci_id: "c", asset_id: "a" }, true)).toBe("cis/c");
    expect(m.boardPath({ target_table: "ci", ci_id: "c", asset_id: "a" }, false)).toBe("assets/a");
    expect(m.boardPath({ target_table: "asset", ci_id: null, asset_id: "a" }, true)).toBe("assets/a");
    expect(m.boardPath({ target_table: "ci", ci_id: "c", asset_id: null }, false)).toBeNull();
    expect(m.sourcesText(2)).toBe("۲ منبع");
  });
  it("the panel: a word, a dot and the times for everyone it shows to; tool names and links only in source rows; only http(s) links open", () => {
    const officer = render({ empty: false, status, sources: [], signals: [] });
    expect(officer).toContain("قطع");
    expect(officer).toContain("rk-tag");
    expect(officer).not.toContain("Zabbix");
    const source = {
      connector_id: "k1", name: "پایش مرکز داده", kind: "zabbix", state: "linked", status: "down", status_label: "قطع", status_since: null, message: null, last_contact_at: null, reported_at: null,
      link_url: "https://zbx.bank.local/zabbix.php?action=host.view&hostid=10",
    };
    const reader = render({ empty: false, status: { ...status, message: "Unavailable by ICMP ping" }, sources: [source, { ...source, connector_id: "k2", link_url: "javascript:alert(1)" }], signals: [] });
    expect(reader).toContain('href="/o/discovery/k1"');
    expect(reader).toMatch(/href="https:\/\/zbx\.bank\.local[^"]*" target="_blank" rel="noopener noreferrer"/);
    expect(reader).toContain("Zabbix");
    expect(reader).not.toContain("javascript:");
    expect(m.safeLink("ftp://x")).toBeNull();
  });
  it("on CI and asset pages, the panel follows the record's meta (the server's panel.ts)", () => {
    for (const t of ["ci", "asset"]) {
      const p = extensionsFor(t).sidePanels?.find((x) => x.key === "discovery:panel");
      expect(p?.title).toBe("منبع‌ها و وضعیت پایش");
      expect(p?.when?.({ meta: {} } as never)).toBe(false);
      expect(p?.when?.({ meta: { discovery: { panel: true } } } as never)).toBe(true);
    }
  });
});

describe("the mapping editor (design A §6.3)", () => {
  it("lines of a stored map in the record's order, what a save sends, whether the draft moved", () => {
    const rows = m.mappingRows({ name: "$.name", external_id: "$.id", "attrs.rack": "$.rack" });
    expect(rows.map((r) => r.target)).toEqual(["external_id", "name", "attrs.rack"]);
    expect(m.rowsMapping([...rows, { key: "x", target: "", source: "" }, { key: "y", target: " serial_number ", source: " $.serial " }])).toEqual({ external_id: "$.id", name: "$.name", "attrs.rack": "$.rack", serial_number: "$.serial" });
    expect(m.mappingChanged({ name: "$.name", external_id: "$.id", "attrs.rack": "$.rack" }, rows)).toBe(false);
    expect(m.mappingChanged({ name: "$.name" }, rows)).toBe(true);
    // a line typed on one side is a draft the unsaved guard keeps, though a save would send nothing new
    const half = [...rows, { key: "h", target: "attrs.rack", source: "" }];
    expect(m.mappingChanged({ name: "$.name", external_id: "$.id", "attrs.rack": "$.rack" }, half)).toBe(false);
    expect(m.mappingDraft({ name: "$.name", external_id: "$.id", "attrs.rack": "$.rack" }, half)).toBe(true);
    expect(m.mappingDraft({ name: "$.name", external_id: "$.id", "attrs.rack": "$.rack" }, rows)).toBe(false);
  });
  it("refuses what people or ITAM own with the reason, a field twice, a half line; REST needs the item's id", () => {
    const r = (target: string, source = "$.x") => ({ key: target, target, source });
    const p = m.mappingProblems([r("external_id", "$.id"), r("location_id"), r("name"), { key: "dup", target: "name", source: "$.n2" }, { key: "half", target: "os", source: "" }], true);
    expect(p.byRow.location_id).toBe(REFUSED_FIELD_MESSAGE);
    expect(p.byRow["attrs.reported_user"]).toBeUndefined();
    expect(m.mappingProblems([r("attrs.reported_user")], false).byRow["attrs.reported_user"]).toBe(REFUSED_FIELD_MESSAGE);
    expect(p.byRow.dup).toContain("یک بار");
    expect(p.byRow.half).toBe("مسیر را بنویسید");
    expect(p.general).toEqual([]);
    expect(m.mappingProblems([r("name")], true).general).toEqual(["برای منبع REST، مسیر شناسهٔ مورد (external_id) لازم است"]);
    expect(m.mappingProblems([r("name")], false).general).toEqual([]);
  });
  it("what a sample gives with a map, as it is typed: a REST element by paths, a kind's record by renames", () => {
    const el = { id: 7, name: "srv-7", serial: "SN7", ip: "10.0.0.7" };
    expect(liveRecord("rest", el, { external_id: "$.id", name: "$.name", serial_number: "$.serial", ip_address: "$.ip" })).toMatchObject({ external_id: "7", values: { name: "srv-7", serial_number: "SN7", ip_address: "10.0.0.7" }, error: null });
    expect(liveRecord("rest", el, { name: "$.name" }).error).toBeTruthy();
    expect(liveRecord("zabbix", { external_id: "10", kind: "host", name: "srv", attrs: { location: "R1" } }, { "attrs.rack": "attrs.location" }).attrs).toMatchObject({ rack: "R1", location: "R1" });
  });
});

describe("part b in the shell", () => {
  const grantsOf = (...roles: string[]): Record<string, FullGrant> => composeEffective({ role: "member", levels: { work: "edit" }, explicit: roles, catalog: roleCatalog([]) }).grants;
  const keys = (g: Record<string, FullGrant>) => NAV.flatMap((n) => n.items.filter((i) => !i.access || [i.access].flat().every((a) => gateAllows(g, a))).map((i) => i.key)).filter((k) => k.startsWith("discovery:"));
  it("routes under discovery/; the queue for CMDB readers, the board also for asset readers without the CMDB; requesters nothing", () => {
    for (const p of ["discovery/reconcile", "discovery/status"]) expect(ROUTES.map((r) => r.path)).toContain(p);
    expect(keys(grantsOf("requester"))).toEqual([]);
    expect(keys(grantsOf("agent"))).toEqual(["discovery:console", "discovery:reconcile", "discovery:status"]);
    expect(keys(grantsOf("configuration_manager"))).toEqual(["discovery:console", "discovery:reconcile", "discovery:status", "discovery:new"]);
    // facilities staff read assets, not the CMDB: the board only (no tool names reach them)
    expect(keys(grantsOf("facilities_agent"))).toEqual(["discovery:status"]);
  });
  it("CMDB's «اولویت منبع‌ها» and «جمع‌آورنده‌های کشف» sit with «تعریف‌ها», after the space's work", () => {
    const cmdb = NAV.find((g) => g.key === "cmdb")!;
    const row = (path: string) => cmdb.items.find((i) => i.path === path)!;
    expect(row("cmdb/sources")).toMatchObject({ label: "اولویت منبع‌ها", section: "تعریف‌ها" });
    expect(row("cmdb/collectors").section).toBe("تعریف‌ها");
  });
});

describe("part b's screens against the routes", () => {
  let w: DiscoveryWorld;
  const hosts: Record<string, Handler> = {};
  let unmount: () => void;
  beforeAll(async () => {
    w = await discoveryWorld();
    resetStatusThrottles();
    unmount = mountMocks(hosts);
  }, 180_000);
  afterAll(() => {
    unmount?.();
    resetStatusThrottles();
  });
  const persona = async (roles: string[], kind: "agent" | "requester") => {
    const who = await w.e.member("member", `${roles[0]}-${Math.random().toString(36).slice(2, 8)}@example.com`);
    await w.e.owner.put(`${w.P}/access/members/${who.userId}`, { roles, persona: kind });
    return who;
  };

  it("«صف آشتی»: counts per tab, the owner's actions, «ساخت پیکربندی»، «نادیده گرفتن»، «پیوند به…»; others are refused as the screen hides", async () => {
    const P = w.P;
    hosts["queue-ui.mock.test"] = new RestMock(makeDevices(4, { from: 7300 })).handler;
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع صف", base_url: "https://queue-ui.mock.test/", create_policy: "match_only", owner_id: w.e.ownerId });
    await w.pass(c.id);
    let q = await w.e.owner.get(`${P}/discovery/queue?tab=unmatched&connector=${c.id}`);
    expect(q.counts).toMatchObject({ unmatched: 4, duplicate: 0, error: 0, mismatch: 0 });
    expect(q.rows).toHaveLength(4);
    expect(q.display[c.id]).toBe("منبع صف");
    const meta = await w.e.owner.get(`${P}/discovery/meta`);
    const cards = (await w.e.owner.get(`${P}/discovery/connectors`)).connectors as m.ConnectorCard[];
    const rights: m.QueueRights = { admin: meta.can.admin, assetManager: meta.can.assetManager, operates: new Set(cards.filter((k) => k.can.operate).map((k) => k.id)) };
    const rows = q.rows as m.ItemRow[];
    expect(m.queueActions("unmatched", rows[0], rights)).toEqual(["create", "link", "ignore"]);
    // «ساخت پیکربندی»
    const made = await w.e.owner.post(`${P}/discovery/items/${rows[0].id}/create`);
    expect(m.createdText(made)).toMatchObject({ ok: true });
    // «نادیده گرفتن»
    await w.e.owner.post(`${P}/discovery/items/${rows[1].id}/ignore`);
    // «پیوند به…» an existing CI
    const target = await w.sys.write((tx) => createIn(tx, w.sys, "ci", { class: "server", name: "srv-دستی", hostname: "srv-manual", state: "operational" }, { trusted: true }));
    await w.e.owner.post(`${P}/discovery/items/${rows[2].id}/link`, { ci_id: target.id });
    q = await w.e.owner.get(`${P}/discovery/queue?tab=unmatched&connector=${c.id}`);
    expect(q.counts.unmatched).toBe(1);
    const states = await w.q<Row>(`select id, state, ci_id from sm_discovery_items where connector_id = $1`, [c.id]);
    expect(states.find((x) => x.id === rows[0].id)).toMatchObject({ state: "linked" });
    expect(states.find((x) => x.id === rows[1].id)).toMatchObject({ state: "ignored" });
    expect(states.find((x) => x.id === rows[2].id)).toMatchObject({ state: null, ci_id: target.id });
    // an agent reads the queue but acts on nothing: the screen offers nothing, the server refuses the same
    const agent = await persona(["agent"], "agent");
    const seen = await agent.client.get(`${P}/discovery/queue?tab=unmatched&connector=${c.id}`);
    const am = await agent.client.get(`${P}/discovery/meta`);
    const agentRights: m.QueueRights = { admin: am.can.admin, assetManager: am.can.assetManager, operates: new Set() };
    expect(m.queueActions("unmatched", seen.rows[0], agentRights)).toEqual([]);
    await agent.client.post(`${P}/discovery/items/${seen.rows[0].id}/create`, {}, 403);
    // a requester sees no queue at all
    const req = await persona(["requester"], "requester");
    await req.client.get(`${P}/discovery/queue`, 403);
  }, 240_000);

  it("«وضعیت پایش» and the panel: the meta says when the panel shows; a branch officer reads status without tool names; requesters get nothing", async () => {
    const P = w.P;
    const push = await w.connector({ name: "پایش شعب", kind: "push" });
    const ci = await w.sys.write((tx) => createIn(tx, w.sys, "ci", { class: "server", name: "srv-board-1", hostname: "srv-board-1", state: "operational" }, { trusted: true }));
    const quiet = await w.sys.write((tx) => createIn(tx, w.sys, "ci", { class: "server", name: "srv-quiet-1", hostname: "srv-quiet-1", state: "operational" }, { trusted: true }));
    const model = await w.sys.write((tx) => createIn(tx, w.sys, "asset_model", { name: "سرور آزمون", category: "server" }, { trusted: true }));
    const asset = await w.sys.write((tx) => createIn(tx, w.sys, "asset", { model_id: model.id, ci_id: ci.id, state: "in_use" }, { trusted: true }));
    await w.q(
      `insert into sm_discovery_items (id, org_id, connector_id, external_id, kind, name, state, ci_id, asset_id, status, status_since, listed_at, first_seen_at, reconciled_at, mismatch_state, data, link_url, origin)
       values (gen_random_uuid(), $1, $2, 'b-1', 'host', 'srv-board-1', 'linked', $3, $4, 'up', now(), now(), now(), now(), 'none', jsonb_build_object('external_id', 'b-1'), 'https://zbx.bank.local/h/1', 'cloud')`,
      [w.e.org, push.id, ci.id, asset.id],
    );
    await applyItemStatuses(w.e.db, w.e.org, push.id, [{ external_id: "b-1", status: { state: "down", availability: true, message: "ICMP ping ناموفق" } }], new Date());
    await aggregateTargets(w.e.db, w.sys, [{ table: "ci", id: ci.id }]);
    // the record's meta: a status reader on a reported CI or its asset — not on a CI no tool reports
    expect(m.showsPanel((await w.e.owner.get(`${P}/r/ci/${ci.id}`)).meta)).toBe(true);
    expect(m.showsPanel((await w.e.owner.get(`${P}/r/asset/${asset.id}`)).meta)).toBe(true);
    expect(m.showsPanel((await w.e.owner.get(`${P}/r/ci/${quiet.id}`)).meta)).toBe(false);
    // the board: worst first; a CMDB reader opens the CI and reads what the tool said
    const board = await w.e.owner.get(`${P}/discovery/status?q=srv-board`);
    expect(board.rows[0]).toMatchObject({ name: "srv-board-1", status: "down", status_label: "قطع", message: "ICMP ping ناموفق", sources: 1 });
    expect(m.boardPath(board.rows[0], true)).toBe(`cis/${ci.id}`);
    expect(board.counts.down).toBeGreaterThanOrEqual(1);
    const panel = (await w.e.owner.get(`${P}/discovery/panel/ci/${ci.id}`)) as m.PanelData;
    expect(panel.sources[0]).toMatchObject({ name: "پایش شعب", status: "down" });
    expect(renderPanel(panel)).toContain("پایش شعب");
    // a branch officer (assets, no CMDB): the asset's word and times, never a tool's name; the board opens the asset
    const officer = await persona(["facilities_agent"], "agent");
    expect(m.showsPanel((await officer.client.get(`${P}/r/asset/${asset.id}`)).meta)).toBe(true);
    const theirs = (await officer.client.get(`${P}/discovery/panel/asset/${asset.id}`)) as m.PanelData;
    expect(theirs).toMatchObject({ status: { state: "down" }, sources: [], signals: [] });
    expect(renderPanel(theirs)).not.toContain("پایش شعب");
    expect(JSON.stringify(theirs)).not.toContain("ICMP");
    const mine = ((await officer.client.get(`${P}/discovery/status`)).rows as m.BoardRow[]).find((r) => r.asset_id === asset.id)!;
    expect(mine).toMatchObject({ status: "down", status_label: "قطع" });
    expect(mine).not.toHaveProperty("message");
    expect(m.boardPath(mine, false)).toBe(`assets/${asset.id}`);
    // a requester: no board, no panel
    const req = await persona(["requester"], "requester");
    await req.client.get(`${P}/discovery/status`, 403);
    await req.client.get(`${P}/discovery/panel/asset/${asset.id}`, 403);
  }, 240_000);

  it("«نگاشت»: a refused field is refused by the server with the editor's reason; a map saves and previews as the editor sends it", async () => {
    const P = w.P;
    hosts["map-ui.mock.test"] = new RestMock(makeDevices(3, { from: 7400 })).handler;
    const c = await w.connector({ ...REST_CONNECTOR, name: "منبع نگاشت", base_url: "https://map-ui.mock.test/" });
    const page = await w.e.owner.get(`${P}/discovery/connectors/${c.id}`);
    const refused = [...m.mappingRows(page.row.mapping), { key: "x", target: "location_id", source: "$.rack" }];
    expect(m.mappingProblems(refused, true).byRow.x).toBe(REFUSED_FIELD_MESSAGE);
    const no = await w.e.owner.patch(`${P}/discovery/connectors/${c.id}`, { mapping: m.rowsMapping(refused), version: page.row.version }, 400);
    expect(no.error.message).toContain(REFUSED_FIELD_MESSAGE);
    // the editor's draft: the serial no longer mapped, the rack as a class attribute
    const rows = m.mappingRows(page.row.mapping).filter((r) => r.target !== "serial_number");
    const preview = await w.e.owner.post(`${P}/discovery/connectors/${c.id}/preview`, { draft: { mapping: m.rowsMapping(rows) }, limit: 20 });
    expect(preview.rows).toHaveLength(3);
    expect(preview.rows[0].values.serial_number).toBeUndefined();
    const saved = (await w.e.owner.patch(`${P}/discovery/connectors/${c.id}`, { mapping: m.rowsMapping(rows), version: page.row.version })).row;
    expect(saved.mapping).toEqual(m.rowsMapping(rows));
    expect(m.mappingChanged(saved.mapping, rows)).toBe(false);
    // an agent reads the map but may not change it
    const agent = await persona(["agent"], "agent");
    const theirs = await agent.client.get(`${P}/discovery/connectors/${c.id}`);
    expect(theirs.can.edit).toBe(false);
    await agent.client.patch(`${P}/discovery/connectors/${c.id}`, { mapping: { external_id: "$.id", name: "$.name" }, version: theirs.row.version }, 403);
  }, 240_000);
});
