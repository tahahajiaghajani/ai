// What surrounds a record: the journal (public comments and internal work notes, the first-response stamp),
// attachments (deduplicated contents, the size limit, safe names and download headers), typed links shown from
// both sides, and watchers.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, upload, raw, PNG, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { contentDisposition, safeFileName, sniffMime } from "@server/engine/attachments";

describe("journal, attachments, links and watchers", () => {
  let e: EngineOrg;
  let base = "";
  let viewer: { client: Client; userId: string };
  let member: { client: Client; userId: string };

  beforeAll(async () => {
    e = await engineOrg();
    base = `/o/${e.org}/r/todo`;
    viewer = await e.member("viewer");
    member = await e.member("member");
  });

  it("keeps work notes internal and stamps the first response", async () => {
    const { row } = await member.client.post(base, { short_description: "یادداشت‌ها" });
    const url = `${base}/${row.id}/journal`;
    // the requester's own comment is no first response
    await member.client.post(url, { body: "سلام، کمک لازم دارم" });
    expect((await e.owner.get(`${base}/${row.id}`)).row.first_response_at).toBeNull();
    const reply = await e.owner.post(url, { body: "بررسی می‌کنیم" });
    expect(reply.entry).toMatchObject({ kind: "comment", visibility: "public", author: e.ownerId });
    expect(reply.display[e.ownerId]).toBe("مالک آزمایشی");
    const after = await e.owner.get(`${base}/${row.id}`);
    expect(after.row.first_response_at).toBeTruthy();
    expect(after.row.version).toBe(row.version); // an engine stamp: forms stay valid
    const note = await e.owner.post(url, { kind: "work_note", body: "احتمالاً کابل شبکه" });
    expect(note.entry.visibility).toBe("internal");
    // a viewer reads the public stream only and cannot write work notes
    const seen = await viewer.client.get(url);
    expect(seen.entries.map((x: { body: string }) => x.body)).toEqual(["سلام، کمک لازم دارم", "بررسی می‌کنیم"]);
    expect((await e.owner.get(url)).entries).toHaveLength(3);
    await viewer.client.post(url, { kind: "work_note", body: "x" }, 403);
    expect((await e.owner.get(`${url}?kinds=work_note`)).entries.map((x: { kind: string }) => x.kind)).toEqual(["work_note"]);
    await e.owner.post(url, { kind: "system", body: "x" }, 400);
    await e.owner.post(url, { body: "   " }, 400);
    await e.owner.post(`/o/${e.org}/r/view/${row.id}/journal`, { body: "x" }, 400);
  });

  it("stores attachment contents once, limits their size and serves them safely", async () => {
    const { row } = await e.owner.post(base, { short_description: "پیوست‌ها" });
    const other = (await e.owner.post(base, { short_description: "پیوست دیگر" })).row;
    const url = `/o/${e.org}/r/todo/${row.id}/attachments`;
    const a = await upload(e.app, e.owner, url, "../../etc/تصویر\u202Egnp.exe", PNG, "text/html");
    expect(a.status).toBe(200);
    const { attachment } = await a.json();
    expect(attachment).toMatchObject({ name: "تصویرgnp.exe", mime: "image/png", size: PNG.byteLength, previewable: true });
    // the same content on another record: a second attachment, one stored content
    await upload(e.app, e.owner, `/o/${e.org}/r/todo/${other.id}/attachments`, "copy.png", PNG);
    expect((await e.db.one<{ n: number }>(`select count(*)::int as n from sm_blobs where org_id = $1`, [e.org]))!.n).toBe(1);
    expect((await e.db.one<{ n: number }>(`select count(*)::int as n from sm_attachments where org_id = $1`, [e.org]))!.n).toBe(2);
    const list = await e.owner.get(url);
    expect(list.attachments.map((x: { id: string }) => x.id)).toEqual([attachment.id]);
    // download headers: attachment by default, inline only for a raster image, RFC 5987 Persian name
    const dl = await raw(e.app, e.owner, `/o/${e.org}/attachments/${attachment.id}/content`);
    expect(dl.headers.get("content-type")).toBe("image/png");
    expect(dl.headers.get("content-disposition")).toBe(`attachment; filename="_____gnp.exe"; filename*=UTF-8''${encodeURIComponent("تصویرgnp.exe")}`);
    expect(dl.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(PNG);
    const inline = await raw(e.app, e.owner, `/o/${e.org}/attachments/${attachment.id}/content?inline=1`);
    expect(inline.headers.get("content-disposition")).toMatch(/^inline;/);
    const text = await (await upload(e.app, e.owner, url, "note.html", new TextEncoder().encode("<script>alert(1)</script>"), "text/html")).json();
    expect(text.attachment).toMatchObject({ mime: "application/octet-stream", previewable: false });
    const notInline = await raw(e.app, e.owner, `/o/${e.org}/attachments/${text.attachment.id}/content?inline=1`);
    expect(notInline.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(notInline.headers.get("content-type")).toBe("application/octet-stream");
    // the organisation's limit
    await e.owner.patch(`/o/${e.org}`, { settings: { attachment_max_mb: 0.001 } });
    const big = await upload(e.app, e.owner, url, "big.bin", new Uint8Array(2048));
    expect(big.status).toBe(413);
    expect((await big.json()).error.message).toMatch(/مگابایت/);
    await e.owner.patch(`/o/${e.org}`, { settings: { attachment_max_mb: 10 } });
    // removing: the uploader or a writer; the content stays while another attachment uses it
    await viewer.client.del(`${url}/${attachment.id}`, 403);
    await e.owner.del(`${url}/${attachment.id}`);
    expect((await e.owner.get(url)).attachments.map((x: { name: string }) => x.name)).toEqual(["note.html"]);
    expect((await raw(e.app, e.owner, `/o/${e.org}/attachments/${attachment.id}/content`)).status).toBe(404);
    // a journal entry may show attachments of its record only
    const j = await e.owner.post(`${base}/${row.id}/journal`, { body: "پیوست را ببینید", attachments: [text.attachment.id] });
    expect(j.entry.attachments).toEqual([{ id: text.attachment.id, name: "note.html", mime: "application/octet-stream", size: 25 }]);
    const foreign = (await (await upload(e.app, e.owner, `/o/${e.org}/r/todo/${other.id}/attachments`, "x.txt", new TextEncoder().encode("x"))).json()).attachment;
    await e.owner.post(`${base}/${row.id}/journal`, { body: "x", attachments: [foreign.id] }, 400);
  });

  it("makes names and types safe", () => {
    expect(safeFileName("C:\\Users\\a\\report.pdf")).toBe("report.pdf");
    expect(safeFileName("con.txt")).toBe("_con.txt");
    expect(safeFileName(" ..")).toBe("پیوست");
    expect(safeFileName(`${"ا".repeat(300)}.docx`)).toHaveLength(180);
    expect(safeFileName(`${"ا".repeat(300)}.docx`).endsWith(".docx")).toBe(true);
    expect(sniffMime(new TextEncoder().encode("%PDF-1.7"), "x.bin")).toBe("application/pdf");
    expect(sniffMime(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "a.xlsx")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(sniffMime(new TextEncoder().encode("<svg/>"), "x.svg")).toBe("application/octet-stream");
    expect(contentDisposition("گزارش \"نهایی\".pdf")).toBe(`attachment; filename="_____ _______.pdf"; filename*=UTF-8''${encodeURIComponent("گزارش \"نهایی\".pdf")}`);
  });

  it("links records with a label for each side and only between readable records", async () => {
    const a = (await e.owner.post(base, { short_description: "رخداد" })).row;
    const b = (await e.owner.post(base, { short_description: "مشکل" })).row;
    const r = await e.owner.post(`${base}/${a.id}/links`, { kind: "caused_by", table: "todo", id: b.id, note: "همان علت" });
    expect(r.link).toMatchObject({ kind: "caused_by", direction: "out", label: "ناشی از", note: "همان علت", other: { table: "todo", id: b.id, number: b.number, display: "مشکل", state: "new", state_label: "جدید" } });
    const fromB = await e.owner.get(`${base}/${b.id}/links`);
    expect(fromB.links).toEqual([expect.objectContaining({ direction: "in", label: "علت", other: expect.objectContaining({ id: a.id }) })]);
    expect((await e.owner.post(`${base}/${a.id}/links`, { kind: "caused_by", table: "todo", id: b.id }, 409)).error.message).toBe("این پیوند از پیش وجود دارد");
    await e.owner.post(`${base}/${a.id}/links`, { kind: "related", table: "todo", id: b.id });
    await e.owner.post(`${base}/${b.id}/links`, { kind: "related", table: "todo", id: a.id }, 409); // symmetric
    await e.owner.post(`${base}/${a.id}/links`, { kind: "nonsense", table: "todo", id: b.id }, 400);
    await e.owner.post(`${base}/${a.id}/links`, { kind: "related", table: "todo", id: a.id }, 400);
    // a saved view of someone else is not readable: no link to it, and it is never listed
    const privateView = (await member.client.post(`/o/${e.org}/r/view`, { table_key: "todo", name: "خصوصی" })).row;
    await e.owner.post(`${base}/${a.id}/links`, { kind: "related", table: "view", id: privateView.id }, 404);
    await e.db.query(`insert into sm_links (id, org_id, kind, from_table, from_id, to_table, to_id) values (gen_random_uuid(), $1, 'related', 'todo', $2, 'view', $3)`, [e.org, a.id, privateView.id]);
    expect((await e.owner.get(`${base}/${a.id}/links`)).links).toHaveLength(2);
    // a viewer may read but not link
    await viewer.client.post(`${base}/${a.id}/links`, { kind: "blocks", table: "todo", id: b.id }, 403);
    await e.owner.del(`${base}/${a.id}/links/${r.link.id}`);
    expect((await e.owner.get(`${base}/${b.id}/links`)).links.map((l: { kind: string }) => l.kind)).toEqual(["related"]);
  });

  it("lets readers watch and writers add others, without moving the version", async () => {
    const { row } = await e.owner.post(base, { short_description: "پیگیری" });
    const url = `${base}/${row.id}/watch`;
    const w = await viewer.client.post(url, {});
    expect(w).toEqual({ watching: true, watch_list: [viewer.userId] });
    await viewer.client.post(url, { user_id: member.userId }, 403);
    const both = await e.owner.post(url, { user_id: member.userId });
    expect(both.watch_list.sort()).toEqual([viewer.userId, member.userId].sort());
    const got = await viewer.client.get(`${base}/${row.id}`);
    expect(got.meta.watching).toBe(true);
    expect(got.row.version).toBe(1);
    expect((await viewer.client.del(url)).watching).toBe(false);
    // closed records still take watchers
    await e.owner.post(`${base}/${row.id}/transition`, { to: "canceled", data: { close_notes: "لغو" } });
    expect((await e.owner.post(url, {})).watching).toBe(true);
    const h = await e.owner.get(`${base}/${row.id}/history`);
    expect(h.entries.filter((x: { field: string }) => x.field === "watch_list").length).toBe(4);
    await e.owner.post(`/o/${e.org}/r/view/${row.id}/watch`, {}, 400);
  });
});
