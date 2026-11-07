// «اسناد هوشمند» end to end: collections shared privately, with people, groups, units or everyone (documents follow
// their collection), adding documents (who may, open contributions), uploads read into pages (text, Markdown, PDF with
// page anchors, Word; images through the vision model; «نیازمند خواندن تصویر» without one), summaries, cited answers over
// chosen collections (a collection the asker may not read contributes nothing even when named), the AI-channel rule
// (collections switched off for AI and «سری» ones are never used), owners removing their own documents, a non-empty
// collection refused, re-reading a document, and the pages viewer's access.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { engineOrg, upload, type EngineOrg } from "./engine-helpers";
import { Client } from "./helpers";
import { tick } from "@server/jobs";
import { memberCtx } from "@server/access";
import { askWithCitations, retrieve } from "@server/modules/ai/rag";

const before = process.env.ITSM_AI_FAKE;
let e: EngineOrg;
let P = "";
const people = {} as Record<"agent" | "peer" | "unitMate" | "stranger" | "manager", { client: Client; userId: string }>;
let unit = "";
let group = "";

async function drain() {
  for (let i = 0; i < 20; i++) {
    const r = await tick(e.cfg, { budgetMs: 30_000 });
    if (!r.more && !r.ran) break;
  }
}

/** A minimal PDF with one line of Helvetica text per page. */
function pdf(pages: string[]): Uint8Array {
  const objs: string[] = [];
  const add = (s: string) => objs.push(s);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const contents = pages.map((t) => {
    const stream = `BT /F1 12 Tf 72 720 Td (${t}) Tj ET`;
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    return objs.length;
  });
  const pagesObj = objs.length + pages.length + 1;
  const pageIds = contents.map((c) => {
    add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Contents ${c} 0 R /Resources << /Font << /F1 1 0 R >> >> >>`);
    return objs.length;
  });
  add(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  add(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

async function uploadDoc(client: Client, collection: string, name: string, data: Uint8Array, type: string, title?: string) {
  const form = new FormData();
  form.append("collection_id", collection);
  if (title) form.append("title", title);
  form.append("file", new File([Buffer.from(data)], name, { type }));
  const headers: Record<string, string> = {};
  if (client.cookie) headers.cookie = client.cookie;
  const res = await e.app.fetch(new Request(`http://local.test/api${P}/ai/docs/upload`, { method: "POST", headers, body: form }));
  return { status: res.status, body: (await res.json()) as any };
}

const collection = async (client: Client, data: Record<string, unknown>) => (await client.post(`${P}/r/doc_collection`, { name: "مجموعه", ...data })).row.id as string;
const seen = async (who: keyof typeof people | "owner", table: string) => {
  const c = who === "owner" ? e.owner : people[who].client;
  return new Set<string>((await c.get(`${P}/r/${table}?size=200&total=false`)).rows.map((r: { id: string }) => r.id));
};

beforeAll(async () => {
  process.env.ITSM_AI_FAKE = "1";
  e = await engineOrg();
  P = `/o/${e.org}`;
  await e.owner.post(`${P}/ai/connections`, { preset: "fake" });
  for (const k of ["agent", "peer", "unitMate", "stranger", "manager"] as const) people[k] = await e.member("member", `${k}@docs.test`);
  unit = (await e.owner.post(`${P}/r/org_unit`, { name: "واحد پشتیبانی" })).row.id;
  const other = (await e.owner.post(`${P}/r/org_unit`, { name: "واحد مالی" })).row.id;
  group = (await e.owner.post(`${P}/r/group`, { name: "تیم شبکه" })).row.id;
  await e.owner.post(`${P}/access/groups/${group}/members`, { user_ids: [people.peer.userId] });
  const set = (k: keyof typeof people, body: Record<string, unknown>) => e.owner.put(`${P}/access/members/${people[k].userId}`, body);
  await set("agent", { roles: ["agent"], persona: "agent", org_unit_id: unit });
  await set("peer", { roles: ["agent"], persona: "agent", org_unit_id: other });
  await set("unitMate", { roles: ["requester"], persona: "requester", org_unit_id: unit });
  await set("stranger", { roles: ["requester"], persona: "requester", org_unit_id: other });
  await set("manager", { roles: ["knowledge_manager"], persona: "agent", org_unit_id: other });
});

afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

describe("collections and sharing", () => {
  it("private: the owner and the people named; groups: their members; units: members of the unit; everyone: all", async () => {
    const priv = await collection(people.agent.client, { name: "یادداشت‌های من", sharing: "private", share_users: [people.stranger.userId] });
    const byGroup = await collection(people.agent.client, { name: "اسناد تیم شبکه", sharing: "groups", share_groups: [group] });
    const byUnit = await collection(people.agent.client, { name: "اسناد واحد", sharing: "units", share_units: [unit] });
    const all = await collection(people.agent.client, { name: "اسناد عمومی", sharing: "everyone" });
    expect(await seen("agent", "doc_collection")).toEqual(new Set([priv, byGroup, byUnit, all]));
    expect(await seen("stranger", "doc_collection")).toEqual(new Set([priv, all]));
    expect(await seen("peer", "doc_collection")).toEqual(new Set([byGroup, all]));
    expect(await seen("unitMate", "doc_collection")).toEqual(new Set([byUnit, all]));
    // even an administrator does not see a private collection that is not shared with them
    expect((await seen("owner", "doc_collection")).has(priv)).toBe(false);
    expect((await seen("manager", "doc_collection")).has(byUnit)).toBe(false);
  });

  it("refuses group or unit sharing without groups or units, and keeps «سری» collections out of AI", async () => {
    await people.agent.client.post(`${P}/r/doc_collection`, { name: "بی‌گروه", sharing: "groups" }, 400);
    const secret = (await people.agent.client.post(`${P}/r/doc_collection`, { name: "سری", classification: "secret", ai_enabled: true })).row;
    expect(secret.ai_enabled).toBe(false);
  });
});

describe("documents", () => {
  let shared = "";
  let mine = "";
  let docText = "";
  let docPdf = "";

  beforeAll(async () => {
    shared = await collection(people.agent.client, { name: "راهنماهای شبکه", sharing: "everyone" });
    mine = await collection(people.agent.client, { name: "خصوصی کارشناس", sharing: "private" });
  });

  it("uploads a Markdown file, reads it into pages, summarises it and makes it answerable with citations", async () => {
    const md = "# راهنمای VPN\n\nبرای اتصال VPN ابتدا برنامهٔ FortiClient را نصب کنید.\n\n## خطای ۶۱۹\n\nاگر خطای 619 دیدید، دیواره‌آتش ویندوز را بررسی کنید و پورت 443 را باز کنید.";
    const r = await uploadDoc(people.agent.client, shared, "vpn-guide.md", new TextEncoder().encode(md), "text/markdown");
    expect(r.status).toBe(200);
    docText = r.body.document.id;
    expect(r.body.document).toMatchObject({ status: "ingesting", file_name: "vpn-guide.md", title: "vpn guide" });
    await drain();
    const doc = (await people.agent.client.get(`${P}/r/doc_document/${docText}`)).row;
    expect(doc).toMatchObject({ status: "ready", pages: 1, language: "fa", error: null });
    const pages = await people.stranger.client.get(`${P}/ai/docs/${docText}/pages`);
    expect(pages.pages[0].text).toContain("FortiClient");
    const stranger = await memberCtx(e.cfg, e.org, people.stranger.userId);
    const a = await askWithCitations(stranger, "خطای 619 در VPN را چطور حل کنم؟", { collections: [shared] });
    expect(a.synthesized).toBe(true);
    expect(a.abstained).toBe(false);
    expect(a.citations[0]).toMatchObject({ table: "doc_document", id: docText, title: "vpn guide" });
    expect(a.citations[0].path).toMatch(new RegExp(`^docs/d/${docText}\\?page=1&hl=`));
    expect(a.answer).toMatch(/\[1\]/);
  });

  it("keeps page anchors of PDFs for citations", async () => {
    const r = await uploadDoc(people.agent.client, shared, "manual.pdf", pdf(["Router reset procedure first page", "Firmware upgrade requires the admin password"]), "application/pdf", "Router manual");
    docPdf = r.body.document.id;
    await drain();
    expect((await people.agent.client.get(`${P}/r/doc_document/${docPdf}`)).row).toMatchObject({ status: "ready", pages: 2, language: "en" });
    const agent = await memberCtx(e.cfg, e.org, people.agent.userId);
    const res = await retrieve(agent, "firmware upgrade admin password", { documents: [docPdf] });
    expect(res.passages[0].citation).toMatchObject({ id: docPdf, page: 2 });
  });

  it("reads an image with the vision model; without one it waits as «نیازمند خواندن تصویر»", async () => {
    const png = new Uint8Array([...Buffer.from("89504e470d0a1a0a", "hex"), ...new TextEncoder().encode('[json:{"pages":[{"page":1,"text":"رسید تحویل لپ‌تاپ به واحد مالی"}]}]')]);
    const r = await uploadDoc(people.agent.client, shared, "receipt.png", png, "image/png");
    await drain();
    expect((await people.agent.client.get(`${P}/r/doc_document/${r.body.document.id}`)).row).toMatchObject({ status: "ready", ocr: true, pages: 1 });
    const pages = await people.agent.client.get(`${P}/ai/docs/${r.body.document.id}/pages`);
    expect(pages.pages[0].text).toBe("رسید تحویل لپ‌تاپ به واحد مالی");
    // no vision model: switched off files → needs OCR
    await e.owner.put(`${P}/ai/settings`, { features: { files: false } });
    const r2 = await uploadDoc(people.agent.client, shared, "scan.png", png, "image/png");
    await drain();
    const d2 = (await people.agent.client.get(`${P}/r/doc_document/${r2.body.document.id}`)).row;
    expect(d2.status).toBe("needs_ocr");
    expect(d2.error).toMatch(/مدل تصویر/);
    await e.owner.put(`${P}/ai/settings`, { features: { files: true } });
    // re-reading once a model is there
    await people.agent.client.post(`${P}/ai/docs/${r2.body.document.id}/reingest`, {});
    await drain();
    expect((await people.agent.client.get(`${P}/r/doc_document/${r2.body.document.id}`)).row.status).toBe("ready");
  });

  it("answers only from collections the asker may read, even when another one is named", async () => {
    const secretDoc = await uploadDoc(people.agent.client, mine, "salaries.md", new TextEncoder().encode("حقوق تیم شبکه در سال جاری افزایش یافت؛ رقم دقیق محرمانه است: کد ۹۹۷۱."), "text/markdown", "حقوق تیم");
    await drain();
    const stranger = await memberCtx(e.cfg, e.org, people.stranger.userId);
    const r = await retrieve(stranger, "حقوق تیم شبکه", { collections: [mine, shared] });
    expect(r.passages.map((p) => p.citation.id)).not.toContain(secretDoc.body.document.id);
    const a = await askWithCitations(stranger, "حقوق تیم شبکه چقدر است؟", { collections: [mine] });
    expect(a.abstained).toBe(true);
    expect(JSON.stringify(a)).not.toContain("۹۹۷۱");
    // the owner finds it
    const agent = await memberCtx(e.cfg, e.org, people.agent.userId);
    expect((await retrieve(agent, "حقوق تیم شبکه", { collections: [mine] })).passages[0]?.citation.id).toBe(secretDoc.body.document.id);
    // pages of a document the member may not read do not exist for them
    await people.stranger.client.get(`${P}/ai/docs/${secretDoc.body.document.id}/pages`, 404);
  });

  it("drops a collection from AI answers as soon as it is switched off (live, no re-index)", async () => {
    const agent = await memberCtx(e.cfg, e.org, people.agent.userId);
    expect((await retrieve(agent, "FortiClient VPN")).passages.map((p) => p.citation.id)).toContain(docText);
    await people.agent.client.patch(`${P}/r/doc_collection/${shared}`, { ai_enabled: false });
    expect((await retrieve(agent, "FortiClient VPN")).passages.map((p) => p.citation.id)).not.toContain(docText);
    await people.agent.client.patch(`${P}/r/doc_collection/${shared}`, { ai_enabled: true });
    expect((await retrieve(agent, "FortiClient VPN")).passages.map((p) => p.citation.id)).toContain(docText);
  });

  it("lets only those who may change a collection add to it, unless it is open to contributions", async () => {
    // a requester creates nothing in the knowledge area at all
    expect((await uploadDoc(people.stranger.client, shared, "note.txt", new TextEncoder().encode("یادداشت"), "text/plain")).status).toBe(403);
    // another agent reads the collection but may change only their own
    expect((await uploadDoc(people.peer.client, shared, "note.txt", new TextEncoder().encode("یادداشت"), "text/plain")).status).toBe(403);
    await people.agent.client.patch(`${P}/r/doc_collection/${shared}`, { open_contrib: true });
    const ok = await uploadDoc(people.peer.client, shared, "note.txt", new TextEncoder().encode("یادداشت همکار درباره چاپگر"), "text/plain");
    expect(ok.status).toBe(200);
    expect(ok.body.document.owner_id).toBe(people.peer.userId);
    // a collection one cannot read is not found
    const hidden = await uploadDoc(people.peer.client, mine, "x.txt", new TextEncoder().encode("x"), "text/plain");
    expect(hidden.status).toBe(400);
  });

  it("owners remove their own documents; a collection with documents is not removed", async () => {
    const r = await uploadDoc(people.agent.client, mine, "temp.txt", new TextEncoder().encode("موقت"), "text/plain");
    await drain();
    await people.agent.client.del(`${P}/ai/docs/collections/${mine}`, 409);
    await people.peer.client.del(`${P}/ai/docs/${r.body.document.id}`, 404);
    await people.agent.client.del(`${P}/ai/docs/${r.body.document.id}`);
    await drain();
    const left = await e.db.one<{ n: number }>(`select count(*)::int as n from sm_ai_chunks where record_id = $1`, [r.body.document.id]);
    expect(left!.n).toBe(0);
    const pages = await e.db.one<{ n: number }>(`select count(*)::int as n from sm_ai_doc_pages where doc_id = $1`, [r.body.document.id]);
    expect(pages!.n).toBe(0);
  });

  it("refuses unknown file types with a reason", async () => {
    const r = await uploadDoc(people.agent.client, shared, "tool.exe", new Uint8Array([77, 90, 0, 1]), "application/octet-stream");
    await drain();
    const d = (await people.agent.client.get(`${P}/r/doc_document/${r.body.document.id}`)).row;
    expect(d.status).toBe("failed");
    expect(d.error).toMatch(/خوانده نمی‌شود/);
  });
});

describe("HTTP: ask and the index's admin endpoints", () => {
  it("streams passages, the answer and the result", async () => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (people.agent.client.cookie) headers.cookie = people.agent.client.cookie;
    const res = await e.app.fetch(new Request(`http://local.test/api${P}/ai/ask/stream`, { method: "POST", headers, body: JSON.stringify({ question: "خطای 619 در VPN" }) }));
    expect(res.status).toBe(200);
    const text = await res.text();
    const events = [...text.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);
    expect(events[0]).toBe("passages");
    expect(events).toContain("text");
    expect(events[events.length - 1]).toBe("done");
  });

  it("status and rebuild for ai:full only", async () => {
    const st = await e.owner.get(`${P}/ai/rag/status`);
    expect(st.backend.kind).toBe("pgvector");
    expect(st.embedder.quality).toBe("local");
    expect(st.tables.find((t: { table: string }) => t.table === "doc_document").documents).toBeGreaterThan(2);
    // the private collection of the agent is not listed for the owner
    expect(st.collections.map((c: { name: string }) => c.name)).not.toContain("خصوصی کارشناس");
    await people.agent.client.get(`${P}/ai/rag/status`, 403);
    expect((await e.owner.post(`${P}/ai/rag/rebuild`, { table: "doc_document" })).queued).toBeTruthy();
    await drain();
    const st2 = await e.owner.get(`${P}/ai/rag/status`);
    expect(st2.runs[0].kind).toBe("backfill:doc_document");
  });
});
