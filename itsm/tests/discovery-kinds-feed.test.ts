// The «فایل CSV یا JSON» kind (design A §6.6, §17, package DA3c): CSV and JSON snapshots from a host-pinned URL and
// from the server edition's drop folder; the folder's rules (names, size, symbolic and hard links, working/,
// processed/ and failed/ with its reasons, housekeeping); snapshots make what they no longer list «gone», deltas never;
// the column map held to the allow-list; an ATM switch export reaching the items the ATM device path reads.
import { link, lstat, mkdir, mkdtemp, open, readdir, readFile, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REFUSED_FIELD_MESSAGE } from "@shared/discovery/mapping";
import { normaliseRecord } from "@shared/discovery/normalise";
import type { DiscoveredRecord, Page } from "@shared/discovery/types";
import { connector, decodeFeed, feedOptions, feedRecord, FEED_MESSAGES, forgetFeedFiles, parseFeed } from "@server/modules/discovery/connectors/feed";
import {
  claimDrop, DROP_MAX_BYTES, DROP_MESSAGES, ensureDropFolder, failClaimed, finishClaimed, installDropRoot, ownName, readClaimed, readDrop, refuseDrop, scanDrop, sweepDrop,
} from "@server/modules/discovery/drop";
import { CONNECTOR_MESSAGES, type ConnCtx } from "@server/modules/discovery/kind";
import { serverKind } from "@server/modules/discovery/registry";
import { kindOptions } from "@server/modules/discovery/runner";
import { discoveryWorld, type DiscoveryWorld, type Row } from "./discovery-helpers";
import { mountMocks } from "./mocks/discovery/harness";
import { ATM_COLUMNS, atmRows, dropFile, FEED_HOST, FEED_TOKEN, FeedMock, serverRows, toCsv } from "./mocks/discovery/feed";

const opts = (o: Record<string, unknown> = {}) => feedOptions.parse(o);
const ids = (p: Page) => p.records.map((r: DiscoveredRecord) => r.external_id);

describe("the feed's files, rows and records (design A §6.6, §6.3)", () => {
  it("CSV with its delimiter guessed, quotes and a byte-order mark; JSON at a path with a column map; the reasons a file is refused", () => {
    const csv = "﻿external_id;name;status.state\r\nS1;\"srv; one\";UP\r\nS2;srv-2;down\r\n";
    const p = parseFeed(csv, opts(), { name: "x.csv" });
    expect(p).toEqual({ format: "csv", rows: [{ external_id: "S1", name: "srv; one", "status.state": "UP" }, { external_id: "S2", name: "srv-2", "status.state": "down" }] });
    // without a column map, columns named after a record field are read as it
    expect(feedRecord(p.rows[0], opts(), "csv")).toEqual({ external_id: "S1", name: "srv; one", status: { state: "up" }, kind: "device" });
    const o = opts({ items_path: "data.items", columns: { external_id: "$.id", name: "$.host", serial_number: "$.hw.serial" } });
    const j = parseFeed(JSON.stringify({ data: { items: [{ id: 7, host: "db-7", hw: { serial: "X7" } }] } }), o);
    expect(j.format).toBe("json");
    expect(feedRecord(j.rows[0], o, "json")).toEqual({ external_id: 7, name: "db-7", serial_number: "X7", kind: "device" });
    // a JSON element without a column map is a record of the push API's shape
    expect(feedRecord({ external_id: "P1", kind: "VM", status: { state: "down" } }, opts(), "json")).toEqual({ external_id: "P1", kind: "vm", status: { state: "down" } });
    expect(() => parseFeed("{nope", opts({ format: "json" }))).toThrow(FEED_MESSAGES.badJson);
    expect(() => parseFeed(JSON.stringify({ data: {} }), opts({ items_path: "data.items" }), { name: "a.json" })).toThrow(FEED_MESSAGES.notArray("data.items"));
  });

  it("a column map: cells by name whatever their case, lists split, yes and no, the tool's words kept for the ATM path", () => {
    const o = opts({ columns: { ...ATM_COLUMNS, "status.availability": "Online", ips: "IPs" }, item_kind: "atm" });
    const row = { terminalid: "T00001", "Serial No": "ATM-SN-1", Branch: "شعبهٔ ۱", State: "CASH_OUT", Model: "NCR", Online: "بله", IPs: "10.1.1.1; 10.1.1.2" };
    const raw = feedRecord(row, o, "csv");
    expect(raw).toEqual({
      external_id: "T00001", terminal_id: "T00001", name: "T00001", serial_number: "ATM-SN-1", model: "NCR", reported: { site: "شعبهٔ ۱" },
      status: { device_status: "CASH_OUT", availability: true }, ips: ["10.1.1.1", "10.1.1.2"], kind: "atm",
    });
    // normalised as a pass does: an ATM identified by its terminal id, with the switch's word for the device path
    expect(normaliseRecord(raw).record).toMatchObject({ kind: "atm", terminal_id: "T00001", status: { state: "unknown", device_status: "CASH_OUT", availability: true } });
  });

  it("files decoded: UTF-8 with or without its mark, UTF-16 by its mark, Windows-1256 when the options say so", () => {
    const text = "external_id,name\r\nA1,خودپرداز شعبه\r\n";
    expect(decodeFeed(Buffer.from(`﻿${text}`, "utf8"))).toBe(text);
    expect(decodeFeed(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]))).toBe(text);
    expect(decodeFeed(Buffer.from([0xc7, 0xe1]), "windows-1256")).toBe("ال");
  });

  it("the column map is held to the allow-list like every mapping (§6.3)", () => {
    const k = serverKind("feed")!;
    expect(k.ready).toBe(true);
    const refused = kindOptions(k, { columns: { location_id: "Branch" } });
    expect("error" in refused && refused.error).toContain(REFUSED_FIELD_MESSAGE);
    const unknown = kindOptions(k, { columns: { colour: "C" } });
    expect("error" in unknown && unknown.error).toContain("شناخته نیست");
    expect(kindOptions(k, { columns: { "attrs.rack": "Rack" } })).toMatchObject({ options: { source: "url", mode: "snapshot", columns: { "attrs.rack": "Rack" } } });
    // sql_view stays a stub in 1.1
    expect(serverKind("sql_view")!.ready).toBe(false);
  });

  it("from a URL: paged from memory, read again by another process, and a file changed under the pass makes it incomplete", async () => {
    let body = JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ external_id: `J${i}`, name: `n${i}` })));
    let fetches = 0;
    const o = opts({ page_size: 2 });
    const ctx = {
      connector: { id: "feed-url-test", name: "آزمایش", kind: "feed", base_url: `https://${FEED_HOST}/x.json`, hosts: [], auth: "none", username: null, api_key_header: null, plain_http: false, collect: [], options: o, mapping: {}, default_class: null, rate_per_second: 5, ca_cert: null },
      options: o, secret: null, secret2: null, edition: "cloud", deadline: Date.now() + 60_000, now: () => new Date(), log: () => undefined,
      fetchJson: async () => {
        throw new Error("not used");
      },
      fetchText: async () => {
        fetches++;
        return { status: 200, headers: { "content-type": "application/json" }, body, url: `https://${FEED_HOST}/x.json` };
      },
    } as unknown as ConnCtx;
    const p1 = await connector.pages(ctx, null);
    expect([ids(p1), p1.complete, p1.total]).toEqual([["J0", "J1"], true, 5]);
    const p2 = await connector.pages(ctx, p1.next);
    expect([ids(p2), fetches]).toEqual([["J2", "J3"], 1]);
    forgetFeedFiles();
    const p3 = await connector.pages(ctx, p2.next);
    expect([ids(p3), p3.next, p3.complete, fetches]).toEqual([["J4"], null, true, 2]);
    // the export changed between two slices of one pass (read again elsewhere): not the whole picture
    const q1 = await connector.pages(ctx, null);
    body = JSON.stringify([{ external_id: "K0" }, { external_id: "K1" }, { external_id: "K2" }]);
    forgetFeedFiles();
    const q2 = await connector.pages(ctx, q1.next);
    expect([ids(q2), q2.complete, q2.next]).toEqual([["K2"], false, null]);
    // a delta file is never the whole picture
    const d = await connector.pages({ ...ctx, options: opts({ mode: "delta" }) } as ConnCtx, null);
    expect(d.complete).toBe(false);
  });
});

describe("the drop folder's rules (design A §6.6)", () => {
  let base: string;
  let root: string;
  const id = "0190f3a2-0000-7000-8000-00000000d301";
  const old = new Date(Date.now() - 120_000);
  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "kariz-drop-"));
    root = join(base, "drop");
    await mkdir(root);
    installDropRoot(root);
  });
  afterAll(async () => {
    installDropRoot(null);
    await rm(base, { recursive: true, force: true });
  });

  it("names, size, symbolic and hard links: refused files go to failed/ with a .txt reason, other names stay, a fresh file waits", async () => {
    const d = await ensureDropFolder(id);
    const { dir, kept } = d;
    // Kariz's own folders are beside the drop root, outside the folder the export writes
    expect([dir, kept]).toEqual([join(root, id), join(base, "kept", id)]);
    expect((await readdir(kept)).sort()).toEqual(["failed", "processed", "working"]);
    expect(await readdir(dir)).toEqual([]);
    await dropFile(dir, "atm_status-1.csv", "external_id\r\nA\r\n");
    await dropFile(dir, "Inventory.JSON", "[]");
    await dropFile(dir, "atm status.csv", "x");
    await dropFile(dir, "وضعیت.csv", "x");
    await dropFile(dir, "export.csv.tmp", "x");
    await dropFile(dir, "fresh.csv", "x", 1000);
    const big = join(dir, "big.csv");
    const fh = await open(big, "w");
    await fh.truncate(DROP_MAX_BYTES + 1);
    await fh.close();
    await utimes(big, old, old);
    const outside = join(root, "outside.csv");
    await writeFile(outside, "external_id\r\nX\r\n");
    await utimes(outside, old, old);
    await symlink(outside, join(dir, "link.csv"));
    await link(outside, join(dir, "hard.csv"));
    const scan = await scanDrop(dir);
    expect(scan.ready.map((f) => f.name).sort()).toEqual(["Inventory.JSON", "atm_status-1.csv"]);
    expect(Object.fromEntries(scan.refused.map((r) => [r.name, r.reason]))).toEqual({
      "atm status.csv": DROP_MESSAGES.badName, "وضعیت.csv": DROP_MESSAGES.badName, "big.csv": DROP_MESSAGES.tooLarge, "link.csv": DROP_MESSAGES.symlink, "hard.csv": DROP_MESSAGES.hardLink,
    });
    expect(scan.settling).toEqual(["fresh.csv"]);
    for (const r of scan.refused) await refuseDrop(d, r);
    const failed = await readdir(join(kept, "failed"));
    expect(failed.filter((f) => !f.endsWith(".txt"))).toHaveLength(5);
    expect(failed.filter((f) => f.endsWith(".txt"))).toHaveLength(5);
    expect(await readFile(join(kept, "failed", failed.find((f) => f.endsWith("-link.csv.txt"))!), "utf8")).toContain(DROP_MESSAGES.symlink);
    // a link is moved, never followed: what it pointed at is untouched, and reading it is refused
    const moved = join(kept, "failed", failed.find((f) => f.endsWith("-link.csv"))!);
    expect((await lstat(moved)).isSymbolicLink()).toBe(true);
    expect(await readFile(outside, "utf8")).toBe("external_id\r\nX\r\n");
    await expect(readDrop(moved)).rejects.toThrow(DROP_MESSAGES.symlink);
    expect((await readdir(dir)).sort()).toEqual(["Inventory.JSON", "atm_status-1.csv", "export.csv.tmp", "fresh.csv"].sort());
  });

  it("the folder is the server's: a connector's folder that is a link, a name that is not an id, no root — all refused", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "kariz-elsewhere-"));
    const id2 = "0190f3a2-0000-7000-8000-00000000d302";
    await symlink(elsewhere, join(root, id2));
    await expect(ensureDropFolder(id2)).rejects.toThrow(DROP_MESSAGES.broken(join(root, id2)));
    expect(await readdir(elsewhere)).toEqual([]);
    await expect(ensureDropFolder("../etc")).rejects.toThrow(DROP_MESSAGES.noRoot);
    installDropRoot(null);
    await expect(ensureDropFolder(id)).rejects.toThrow(DROP_MESSAGES.noRoot);
    installDropRoot(root);
    await rm(elsewhere, { recursive: true, force: true });
  });

  it("claimed into working/, to processed/ once read (still readable there), to failed/ with a reason; processed kept 7 days, failed 30", async () => {
    const d = await ensureDropFolder(id);
    const { dir, kept } = d;
    const f = (await scanDrop(dir)).ready.find((x) => x.name === "atm_status-1.csv")!;
    const claimed = (await claimDrop(d, f)) as string;
    expect(claimed).toMatch(/^\d{8}T\d{9}Z-atm_status-1\.csv$/);
    expect(ownName(claimed)).toBe("atm_status-1.csv");
    expect(await readdir(dir)).not.toContain("atm_status-1.csv");
    expect(String(await readClaimed(d, claimed))).toBe("external_id\r\nA\r\n");
    await finishClaimed(d, claimed);
    expect(await readdir(join(kept, "working"))).toEqual([]);
    expect(String(await readClaimed(d, claimed))).toBe("external_id\r\nA\r\n");
    // a cursor's file name never leads outside the folder
    expect(await readClaimed(d, "../../outside.csv")).toBeNull();
    const g = (await scanDrop(dir)).ready.find((x) => x.name === "Inventory.JSON")!;
    const c2 = (await claimDrop(d, g)) as string;
    await failClaimed(d, c2, "دلیل آزمایشی");
    expect(await readFile(join(kept, "failed", `${c2}.txt`), "utf8")).toContain("دلیل آزمایشی");
    const at = (days: number, name: string) => `${new Date(Date.now() - days * 86_400_000).toISOString().replace(/[-:.]/g, "")}-${name}`;
    await writeFile(join(kept, "processed", at(8, "a.csv")), "x");
    await writeFile(join(kept, "processed", at(6, "b.csv")), "x");
    await writeFile(join(kept, "failed", at(31, "c.csv")), "x");
    await writeFile(join(kept, "failed", `${at(31, "c.csv")}.txt`), "x");
    await writeFile(join(kept, "failed", at(29, "d.csv")), "x");
    expect(await sweepDrop(d)).toBe(3);
    const left = [...(await readdir(join(kept, "processed"))), ...(await readdir(join(kept, "failed")))].join(" ");
    expect([left.includes("-b.csv"), left.includes("-d.csv"), left.includes("-a.csv"), left.includes("-c.csv")]).toEqual([true, true, false, false]);
  });

  it("the housekeeping removes only names Kariz gave, in its own folders out of the export's reach, never through a link (review DA3c-1)", async () => {
    const d = await ensureDropFolder(id);
    const outside = await mkdtemp(join(tmpdir(), "kariz-outside-"));
    const ago = (n: number) => new Date(Date.now() - n * 86_400_000);
    const at = (n: number, name: string) => `${ago(n).toISOString().replace(/[-:.]/g, "")}-${name}`;
    const plant = async (folder: string, name: string, days: number) => {
      await writeFile(join(folder, name), "x");
      await utimes(join(folder, name), ago(days), ago(days));
    };
    const precious = ["system-file.ini", at(40, "other.csv"), at(40, "other.csv.txt")].sort();
    for (const name of precious) await plant(outside, name, 40);
    const safe = async () => expect((await readdir(outside)).sort()).toEqual(precious);
    // the export account may write its folder, links named like Kariz's folders included: they lead the housekeeping nowhere
    expect(relative(d.dir, d.kept).startsWith("..")).toBe(true);
    for (const sub of ["processed", "failed", "working"]) await symlink(outside, join(d.dir, sub));
    // a name Kariz never gives stays, whatever its age; one it gave goes after its days
    await plant(join(d.kept, "processed"), "not-ours.dat", 40);
    await plant(join(d.kept, "processed"), at(8, "mine.csv"), 8);
    await sweepDrop(d);
    const processed = await readdir(join(d.kept, "processed"));
    expect([processed.includes("not-ours.dat"), processed.some((n) => n.endsWith("-mine.csv"))]).toEqual([true, false]);
    await safe();
    // a folder of Kariz's own swapped for a link is never followed (and the next pass refuses the folder)
    await rename(join(d.kept, "processed"), join(d.kept, "processed-real"));
    await symlink(outside, join(d.kept, "processed"));
    await sweepDrop(d);
    await safe();
    await expect(ensureDropFolder(id)).rejects.toThrow(DROP_MESSAGES.broken(join(d.kept, "processed")));
    await rm(join(d.kept, "processed"));
    await rename(join(d.kept, "processed-real"), join(d.kept, "processed"));
    for (const sub of ["processed", "failed", "working"]) await rm(join(d.dir, sub));
    await rm(outside, { recursive: true, force: true });
  });
});

describe("a feed from a URL, web version (design A §6.6, §14.1)", () => {
  let w: DiscoveryWorld;
  const mock = new FeedMock();
  let unmount: () => void;
  beforeAll(async () => {
    w = await discoveryWorld();
    unmount = mountMocks({ [FEED_HOST]: mock.handler });
  }, 180_000);
  afterAll(() => unmount?.());
  const FEED = { kind: "feed", base_url: `https://${FEED_HOST}/exports/servers.csv`, auth: "token", api_key_header: "X-API-Key", secret: FEED_TOKEN, default_class: "server" };
  const items = (id: string) => w.q(`select external_id, state, ci_id, data from sm_discovery_items where connector_id = $1 and deleted_at is null order by external_id`, [id]);

  it("a CSV snapshot through the routes: test, preview, a pass that makes CIs; the next export without one server makes it «gone»", async () => {
    const P = w.P;
    mock.put("/exports/servers.csv", toCsv(serverRows(10)));
    const made = (await w.e.owner.post(`${P}/discovery/connectors`, { ...FEED, name: "فهرست CSV" }, 201)).row;
    expect(await w.e.owner.post(`${P}/discovery/connectors/${made.id}/test`)).toMatchObject({ ok: true, identity: FEED_MESSAGES.summary("csv", 10), warnings: [] });
    const preview = await w.e.owner.post(`${P}/discovery/connectors/${made.id}/preview`, { limit: 2 });
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[0]).toMatchObject({ external_id: "S1", values: { serial_number: "FS000001", ip_address: "10.20.0.1" }, raw: { external_id: "S1" } });
    const first = await w.pass(made.id);
    expect(first.run).toMatchObject({ state: "completed", complete: true, items_total: 10, created: 10 });
    expect((await items(made.id)).every((i) => i.state === "linked" && i.ci_id)).toBe(true);
    mock.put("/exports/servers.csv", toCsv(serverRows(9)));
    const second = await w.pass(made.id);
    expect(second.run).toMatchObject({ state: "completed", complete: true, items_total: 9 });
    expect(second.run.warnings).toContainEqual(expect.objectContaining({ code: "gone" }));
    expect((await items(made.id)).filter((i) => i.state === "gone").map((i) => i.external_id)).toEqual(["S10"]);
    // the key goes in its header: a wrong one is refused by the tool
    mock.token = "another-key";
    expect(await w.e.owner.post(`${P}/discovery/connectors/${made.id}/test`)).toMatchObject({ ok: false, message: CONNECTOR_MESSAGES.auth });
    mock.token = FEED_TOKEN;
  }, 180_000);

  it("a JSON snapshot at a path under the address, with a column map, paged from one fetch", async () => {
    const devices = Array.from({ length: 7 }, (_, i) => ({ id: 500 + i, host: `db-${500 + i}`, hw: { serial: `JX${500 + i}`, vendor: "Dell" } }));
    mock.put("/api/export.json", JSON.stringify({ data: { items: devices } }));
    const c = await w.connector({
      ...FEED, name: "فهرست JSON", base_url: `https://${FEED_HOST}/api/`,
      options: { path: "export.json", items_path: "data.items", page_size: 3, columns: { external_id: "$.id", name: "$.host", serial_number: "$.hw.serial", manufacturer: "$.hw.vendor" } },
    });
    const before = mock.requests.length;
    const run = await w.pass(c.id);
    expect(run.run).toMatchObject({ state: "completed", complete: true, items_total: 7, pages: 3, created: 7 });
    expect(mock.requests.length - before).toBe(1);
    const ci = await w.one(`select c.serial_number, c.manufacturer from sm_cis c join sm_discovery_items i on i.ci_id = c.id where i.connector_id = $1 and i.external_id = '503'`, [c.id]);
    expect(ci).toEqual({ serial_number: "JX503", manufacturer: "Dell" });
  }, 180_000);

  it("host-pinned: a path to another host is refused before anything is sent; the drop folder is the server edition's", async () => {
    const before = mock.requests.length;
    const c = await w.connector({ ...FEED, name: "میزبان دیگر", options: { path: "https://other.mock.test/servers.csv" } });
    expect((await w.pass(c.id)).run).toMatchObject({ state: "failed", error: CONNECTOR_MESSAGES.otherHost });
    expect(mock.requests.length).toBe(before);
    const f = await w.connector({ kind: "feed", name: "پوشهٔ وب", options: { source: "folder" } });
    expect(await w.e.owner.post(`${w.P}/discovery/connectors/${f.id}/test`)).toMatchObject({ ok: false, message: FEED_MESSAGES.folderServerOnly });
    expect((await w.pass(f.id)).run).toMatchObject({ state: "failed", error: FEED_MESSAGES.folderServerOnly });
  }, 180_000);
});

describe("a feed from the server's drop folder (design A §6.6)", () => {
  let w: DiscoveryWorld;
  let base: string;
  let root: string;
  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "kariz-drop-e2e-"));
    root = join(base, "drop");
    installDropRoot(root);
    const server = { health: async () => ({}), info: () => ({ air_gapped: true, public_url: "", directory_path: "" }), allow: async () => ({ allow: [] }) };
    w = await discoveryWorld({ config: { server, network: { lan: true, airGapped: true, allow: [] } } });
  }, 180_000);
  afterAll(async () => {
    installDropRoot(null);
    await rm(base, { recursive: true, force: true });
  });
  const FOLDER = { kind: "feed", default_class: "server", options: { source: "folder" } };
  const items = (id: string) => w.q(`select external_id, state, data from sm_discovery_items where connector_id = $1 and deleted_at is null order by external_id`, [id]);
  const gone = async (id: string) => (await items(id)).filter((i) => i.state === "gone").map((i) => i.external_id);

  it("CSV snapshots: the test names the folder, a preview moves nothing, a pass reads and keeps the file; the newest wins and makes the missing «gone»", async () => {
    const P = w.P;
    const made = (await w.e.owner.post(`${P}/discovery/connectors`, { ...FOLDER, name: "پوشهٔ CSV" }, 201)).row;
    const dir = join(root, made.id);
    const kept = join(base, "kept", made.id);
    expect(await w.e.owner.post(`${P}/discovery/connectors/${made.id}/test`)).toMatchObject({ ok: true, identity: dir, warnings: [FEED_MESSAGES.noFile(dir)] });
    await dropFile(dir, "servers-1.csv", toCsv(serverRows(6)), 300_000);
    const preview = await w.e.owner.post(`${P}/discovery/connectors/${made.id}/preview`, { limit: 3 });
    expect(preview.rows.map((r: Row) => r.external_id)).toEqual(["S1", "S2", "S3"]);
    expect(await readdir(dir)).toContain("servers-1.csv");
    const first = await w.pass(made.id);
    expect(first.run).toMatchObject({ state: "completed", complete: true, items_total: 6, created: 6 });
    expect(await readdir(dir)).not.toContain("servers-1.csv");
    expect(await readdir(join(kept, "working"))).toEqual([]);
    expect(await readdir(join(kept, "processed"))).toEqual([expect.stringMatching(/^\d{8}T\d{9}Z-servers-1\.csv$/)]);
    // two snapshots waiting: the newest is read, the older goes to processed/ unread
    await dropFile(dir, "servers-2.csv", toCsv(serverRows(6).map((r) => ({ ...r, name: `old-${r.name}` }))), 240_000);
    await dropFile(dir, "servers-3.csv", toCsv(serverRows(5)), 180_000);
    const second = await w.pass(made.id);
    expect(second.run).toMatchObject({ state: "completed", complete: true, items_total: 5 });
    expect(await gone(made.id)).toEqual(["S6"]);
    expect((await readdir(join(kept, "processed"))).filter((n) => /-servers-[23]\.csv$/.test(n))).toHaveLength(2);
    expect((await items(made.id)).some((i) => String(i.data?.name ?? "").startsWith("old-"))).toBe(false);
    // no new file: the pass lists nothing new and marks nothing gone
    const third = await w.pass(made.id);
    expect(third.run).toMatchObject({ state: "completed", complete: false, items_total: 0 });
    expect(await gone(made.id)).toEqual(["S6"]);
  }, 180_000);

  it("a JSON snapshot from the folder (UTF-16 with its mark, records in the push API's shape) makes CIs; the next one without a machine makes it «gone»", async () => {
    const c = await w.connector({ ...FOLDER, name: "پوشهٔ JSON" });
    const { dir } = await ensureDropFolder(c.id);
    const records = (n: number) => Array.from({ length: n }, (_, i) => ({ external_id: `J${200 + i}`, kind: "host", name: `esx-${200 + i}`, serial_number: `JS${200 + i}`, ips: [`10.30.0.${i + 1}`], status: { state: "up" } }));
    const utf16 = (v: unknown) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify(v), "utf16le")]);
    await dropFile(dir, "hosts-1.json", utf16(records(4)), 120_000);
    const first = await w.pass(c.id);
    expect(first.run).toMatchObject({ state: "completed", complete: true, items_total: 4, created: 4 });
    expect(await w.one(`select c.serial_number, c.ip_address from sm_cis c join sm_discovery_items i on i.ci_id = c.id where i.connector_id = $1 and i.external_id = 'J201'`, [c.id])).toEqual({ serial_number: "JS201", ip_address: "10.30.0.2" });
    await dropFile(dir, "hosts-2.json", utf16(records(3)), 60_000);
    expect((await w.pass(c.id)).run).toMatchObject({ state: "completed", complete: true, items_total: 3 });
    expect(await gone(c.id)).toEqual(["J203"]);
  }, 180_000);

  it("delta files: read oldest first in one pass and never «gone»; one that cannot be read goes to failed/ with its reason and the pass goes on", async () => {
    const c = await w.connector({ ...FOLDER, name: "پوشهٔ تغییرها", options: { source: "folder", mode: "delta" } });
    const { dir, kept } = await ensureDropFolder(c.id);
    await dropFile(dir, "d1.csv", toCsv(serverRows(3, { from: 100 })), 300_000);
    await dropFile(dir, "d2.json", "{broken", 240_000);
    await dropFile(dir, "d3.csv", toCsv([{ ...serverRows(1, { from: 100 })[0], manufacturer: "Lenovo" }]), 180_000);
    const run = await w.pass(c.id);
    expect(run.run).toMatchObject({ state: "completed", complete: false, items_total: 3 });
    expect(run.run.warnings).toContainEqual(expect.objectContaining({ message: FEED_MESSAGES.fileFailed("d2.json", FEED_MESSAGES.badJson) }));
    const failed = await readdir(join(kept, "failed"));
    expect(await readFile(join(kept, "failed", failed.find((n) => n.endsWith("-d2.json.txt"))!), "utf8")).toContain(FEED_MESSAGES.badJson);
    expect((await readdir(join(kept, "processed"))).length).toBe(2);
    expect((await w.one(`select data from sm_discovery_items where connector_id = $1 and external_id = 'S100'`, [c.id])).data).toMatchObject({ manufacturer: "Lenovo" });
    await dropFile(dir, "d4.csv", toCsv(serverRows(1, { from: 101 })), 120_000);
    expect((await w.pass(c.id)).run).toMatchObject({ state: "completed", complete: false, items_total: 1 });
    expect(await gone(c.id)).toEqual([]);
  }, 180_000);

  it("a snapshot that cannot be read fails its pass with the reason and goes to failed/; refused files go there too", async () => {
    const c = await w.connector({ ...FOLDER, name: "پوشهٔ خراب", options: { source: "folder", items_path: "items" } });
    const { dir, kept } = await ensureDropFolder(c.id);
    await dropFile(dir, "atm.json", JSON.stringify({ rows: [] }));
    await dropFile(dir, "atm list.json", "[]");
    const outside = join(root, "outside.csv");
    await writeFile(outside, "external_id\r\nX\r\n");
    await symlink(outside, join(dir, "evil.csv"));
    const run = await w.pass(c.id);
    expect(run.run).toMatchObject({ state: "failed", error: FEED_MESSAGES.fileFailed("atm.json", FEED_MESSAGES.notArray("items")) });
    const failed = await readdir(join(kept, "failed"));
    for (const name of ["atm.json", "atm list.json", "evil.csv"]) expect([name, failed.filter((n) => n.endsWith(`-${name}`) || n.endsWith(`-${name}.txt`)).length]).toEqual([name, 2]);
    expect(await readFile(outside, "utf8")).toBe("external_id\r\nX\r\n");
    expect(await readdir(dir)).toEqual([]);
  }, 180_000);

  it("a pass killed after it claimed its file reads it from working/ when it resumes", async () => {
    const c = await w.connector({ ...FOLDER, name: "پوشهٔ بازیابی" });
    const { dir, kept } = await ensureDropFolder(c.id);
    await dropFile(dir, "crash.csv", toCsv(serverRows(3, { from: 300 })));
    const run = await w.pass(c.id, { crashes: ["fetch"], onSlice: () => forgetFeedFiles() });
    expect(run.crashes).toBe(1);
    expect(run.run).toMatchObject({ state: "completed", complete: true, items_total: 3, created: 3 });
    expect(await readdir(join(kept, "working"))).toEqual([]);
    expect(await readdir(join(kept, "processed"))).toEqual([expect.stringMatching(/-crash\.csv$/)]);
  }, 180_000);

  it("an ATM switch export: terminal ids and the switch's words reach the items the ATM device path reads; an ATM makes no CI", async () => {
    const c = await w.connector({ kind: "feed", name: "سوئیچ خودپردازها", options: { source: "folder", item_kind: "atm", columns: ATM_COLUMNS, listing_is_contact: true } });
    const { dir } = await ensureDropFolder(c.id);
    await dropFile(dir, "terminals.csv", toCsv(atmRows(4)));
    const run = await w.pass(c.id);
    expect(run.run).toMatchObject({ state: "completed", complete: true, items_total: 4, created: 0 });
    const rows = await w.q(`select external_id, kind, data, last_contact_at from sm_discovery_items where connector_id = $1 order by external_id`, [c.id]);
    expect(rows.map((r) => [r.external_id, r.kind, r.data.terminal_id, r.data.status?.device_status, r.data.reported?.site])).toEqual([
      ["T00001", "atm", "T00001", "OUT_OF_SERVICE", "شعبهٔ 1"],
      ["T00002", "atm", "T00002", "CASH_OUT", "شعبهٔ 2"],
      ["T00003", "atm", "T00003", "COMMS_DOWN", "شعبهٔ 3"],
      ["T00004", "atm", "T00004", "IN_SERVICE", "شعبهٔ 4"],
    ]);
    expect(rows.every((r) => r.last_contact_at)).toBe(true);
  }, 180_000);
});
