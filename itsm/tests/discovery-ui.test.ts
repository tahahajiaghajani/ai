// The data sources' screens (design A §15, package DA4 part a): the pure rules behind them
// (src/ui/modules/discovery/model.ts), the module's place in the shell, the result line's markup, and the screens'
// own requests against the real routes — so what the wizard and the settings send is what the API takes.
//   · only the kinds kept for 1.1 are offered; a kind's connection, options and settings by kind and way in
//   · keys are write-only: never sent back, typed ones sent once, asked again when the address moves
//   · what a person may change mirrors the connector guard, within the engine's word on the record
//   · the wizard's bodies, «آزمودن اتصال», «پیش‌نمایش», «ذخیره و اجرای نخست», «پذیرش اندازهٔ تازه» end to end
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
import { discoveryWorld, type DiscoveryWorld, type Row } from "./discovery-helpers";
import { mountMocks, type Handler } from "./mocks/discovery/harness";
import { makeDevices, RestMock, REST_TOKEN } from "./mocks/discovery/rest";

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
    expect(keys(grantsOf("agent")).filter((k) => k.startsWith("discovery:"))).toEqual(["discovery:console"]);
    expect(keys(grantsOf("configuration_manager")).filter((k) => k.startsWith("discovery:"))).toEqual(["discovery:console", "discovery:new"]);
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
