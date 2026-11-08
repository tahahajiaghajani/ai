// Who may do what in knowledge management: a requester (published articles of the bases and categories whose audience
// includes them — never drafts, the agents' base, internal sections or other people's feedback; votes, ratings and
// flags of their own; no writing), an agent of another group (reads published knowledge, writes where the base lets
// every agent, never another author's draft or its versions), an auditor (reads, never changes content), audiences that
// narrow (category, article, a base's deny list), the access diagnostics, and AI retrieval and cited answers that follow
// exactly the same rules (KB audiences restrict retrieval too).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { kbWorld, statusOf, type KbWorld } from "./knowledge-helpers";
import { askWithCitations, retrieve } from "@server/modules/ai/rag";

const before = process.env.ITSM_AI_FAKE;
afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

let w: KbWorld;
const P = () => w.P;
let guide: Record<string, any>; // published, requesters' base, with an internal section
let agentsOnly: Record<string, any>; // published, agents' base
let draft: Record<string, any>; // the desk agent's unpublished article
let narrow: Record<string, any>; // published, read only by req2
let inCategory: Record<string, any>; // published, in a category only req2 reads
let category: Record<string, any>;
let deniedBase: string;
let denied: Record<string, any>;

beforeAll(async () => {
  process.env.ITSM_AI_FAKE = "1";
  w = await kbWorld();
  await w.o.post(`${P()}/ai/connections`, { preset: "fake", embed: { model: "fake-embed", dims: 32 } });
  guide = await w.published({ title: "تنظیم امضای ایمیل kbtokguide", summary: "افزودن امضا به ایمیل سازمانی", body: "## گام‌ها\n\n1. تنظیمات را باز کنید kbtokguidebody\n", internal_body: "سرور SMTP داخلی kbtokinternal است" });
  agentsOnly = await w.published({ base_id: w.bases.agents, title: "بازنشانی صف چاپ kbtokagents", body: "## مسئله\n\nچاپ متوقف است kbtokagentsbody\n\n## محیط\n\nویندوز\n\n## راه‌حل\n\n1. سرویس را دوباره راه بیندازید\n" });
  draft = (await w.article({ base_id: w.bases.agents, title: "پیش‌نویس محرمانهٔ کارشناس kbtokdraft", body: "## مسئله\n\nkbtokdraftbody\n" }, w.p.agent.client)).article;
  narrow = await w.published({ title: "راهنمای ویژهٔ مدیران kbtoknarrow", summary: "فقط برای یک نفر", body: "## گام‌ها\n\n1. kbtoknarrowbody\n" });
  await w.p.km.client.patch(`${P()}/r/kb_article/${narrow.id}`, { audience_mode: "narrow", read_users: [w.p.req2.userId] });
  category = (await w.p.km.client.post(`${P()}/r/kb_category`, { base_id: w.bases.guide, name: "مدیریت ارشد", read_mode: "audience", read_users: [w.p.req2.userId] })).row;
  inCategory = await w.published({ category_id: category.id, title: "گزارش ماهانهٔ هیئت مدیره kbtokcategory", summary: "قالب گزارش ماهانه", body: "## گام‌ها\n\n1. kbtokcategorybody\n" });
  deniedBase = (await w.o.post(`${P()}/r/kb_base`, { name: "راهنمای پیمانکاران", kind: "external", read_mode: "everyone", publish_approval: false, deny_users: [w.p.req2.userId], manager_group_id: w.g.managers })).row.id;
  denied = await w.published({ base_id: deniedBase, title: "ورود پیمانکاران به ساختمان kbtokdenied", summary: "کارت ورود موقت", body: "## گام‌ها\n\n1. kbtokdeniedbody\n" });
  await w.drain();
}, 180_000);

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("a requester", () => {
  it("reads published articles of the requesters' base, never drafts or the agents' base", async () => {
    const c = w.p.req.client;
    expect(await statusOf(c, "GET", `${P()}/r/kb_article/${guide.id}`)).toBe(200);
    expect(await statusOf(c, "GET", `${P()}/knowledge/articles/${guide.id}/read`)).toBe(200);
    expect(await statusOf(c, "GET", `${P()}/r/kb_article/${agentsOnly.id}`)).toBe(404);
    expect(await statusOf(c, "GET", `${P()}/knowledge/articles/${agentsOnly.id}/read`)).toBe(404);
    expect(await statusOf(c, "GET", `${P()}/r/kb_article/${draft.id}`)).toBe(404);
    expect(await statusOf(c, "GET", `${P()}/r/kb_base/${w.bases.agents}`)).toBe(404);
    const list = (await c.get(`${P()}/r/kb_article?size=200`)).rows;
    expect(ids(list)).toContain(guide.id);
    expect(ids(list)).not.toContain(agentsOnly.id);
    expect(ids(list)).not.toContain(draft.id);
    // keyword and semantic hits alike are readable articles only
    const hits = ids((await c.get(`${P()}/knowledge/search?q=kbtokagents`)).hits);
    expect(hits).not.toContain(agentsOnly.id);
    expect(hits).not.toContain(draft.id);
  });

  it("never gets the internal section, on any path", async () => {
    const c = w.p.req.client;
    const view = await c.get(`${P()}/knowledge/articles/${guide.id}/read`);
    expect(view.internal_body).toBeNull();
    expect(JSON.stringify(view)).not.toContain("kbtokinternal");
    expect(JSON.stringify((await c.get(`${P()}/r/kb_article/${guide.id}`)).row)).not.toContain("kbtokinternal");
    const found = (await c.get(`${P()}/knowledge/search?q=kbtokinternal`)).hits;
    expect(found.every((h: any) => h.semantic)).toBe(true); // never found by the internal section's words
    expect(JSON.stringify(found)).not.toContain("kbtokinternal");
    // an agent reads it
    const agentView = await w.p.agent.client.get(`${P()}/knowledge/articles/${guide.id}/read`);
    expect(agentView.internal_body).toContain("kbtokinternal");
  });

  it("gives feedback of their own and never sees anyone else's", async () => {
    await w.p.req.client.post(`${P()}/knowledge/articles/${guide.id}/vote`, { helpful: false, reason: "unclear", comment: "گام دوم روشن نیست" });
    await w.p.req2.client.post(`${P()}/knowledge/articles/${guide.id}/vote`, { helpful: true });
    const mine = (await w.p.req.client.get(`${P()}/r/kb_feedback?size=50`)).rows;
    expect(mine.length).toBe(1);
    expect(mine[0].user_id).toBe(w.p.req.userId);
    const a = (await w.o.get(`${P()}/r/kb_article/${guide.id}`)).row;
    expect(a.helpful_yes).toBe(1);
    expect(a.helpful_no).toBe(1);
    // the owner's people see every vote
    expect((await w.p.km.client.get(`${P()}/r/kb_feedback?size=50&filter=${encodeURIComponent(JSON.stringify({ f: "article_id", op: "eq", v: guide.id }))}`)).rows.length).toBe(2);
  });

  it("cannot write, version, retire or diagnose", async () => {
    const c = w.p.req.client;
    expect(await statusOf(c, "POST", `${P()}/knowledge/articles`, { base_id: w.bases.guide, title: "x" })).toBe(403);
    expect(await statusOf(c, "POST", `${P()}/knowledge/articles/${guide.id}/draft`, { kind: "minor" })).toBe(403);
    expect(await statusOf(c, "POST", `${P()}/knowledge/articles/${guide.id}/retire`, { reason: "قدیمی" })).toBe(403);
    expect(await statusOf(c, "POST", `${P()}/knowledge/articles/${guide.id}/review`, { outcome: "confirm" })).toBe(403);
    expect(await statusOf(c, "GET", `${P()}/knowledge/articles/${guide.id}/access?user=${w.p.req2.userId}`)).toBe(403);
    expect(await statusOf(c, "GET", `${P()}/knowledge/workspace`)).toBe(403);
    expect(await statusOf(c, "POST", `${P()}/r/kb_category`, { base_id: w.bases.guide, name: "دستهٔ من" })).toBe(403);
  });
});

describe("audiences that narrow", () => {
  it("an article read by named people only", async () => {
    expect(await statusOf(w.p.req.client, "GET", `${P()}/r/kb_article/${narrow.id}`)).toBe(404);
    expect(await statusOf(w.p.req2.client, "GET", `${P()}/r/kb_article/${narrow.id}`)).toBe(200);
    expect(await statusOf(w.p.other.client, "GET", `${P()}/r/kb_article/${narrow.id}`)).toBe(404);
    // its contributors still read it
    expect(await statusOf(w.p.km.client, "GET", `${P()}/r/kb_article/${narrow.id}`)).toBe(200);
  });

  it("a category's audience reaches the category and every article in it", async () => {
    expect(await statusOf(w.p.req.client, "GET", `${P()}/r/kb_category/${category.id}`)).toBe(404);
    expect(await statusOf(w.p.req.client, "GET", `${P()}/r/kb_article/${inCategory.id}`)).toBe(404);
    expect(await statusOf(w.p.req2.client, "GET", `${P()}/r/kb_article/${inCategory.id}`)).toBe(200);
    const home = await w.p.req.client.get(`${P()}/knowledge/home`);
    expect(home.categories.map((c: any) => c.id)).not.toContain(category.id);
    const home2 = await w.p.req2.client.get(`${P()}/knowledge/home`);
    expect(home2.categories.map((c: any) => c.id)).toContain(category.id);
  });

  it("a base's deny list wins over its audience", async () => {
    expect(await statusOf(w.p.req2.client, "GET", `${P()}/r/kb_base/${deniedBase}`)).toBe(404);
    expect(await statusOf(w.p.req2.client, "GET", `${P()}/r/kb_article/${denied.id}`)).toBe(404);
    expect(await statusOf(w.p.req.client, "GET", `${P()}/r/kb_article/${denied.id}`)).toBe(200);
  });

  it("explains a member's access layer by layer (knowledge managers only)", async () => {
    const r = await w.p.km.client.get(`${P()}/knowledge/articles/${narrow.id}/access?user=${w.p.req.userId}`);
    expect(r.readable).toBe(false);
    expect(r.layers.some((l: any) => l.ok === false)).toBe(true);
    const r2 = await w.p.km.client.get(`${P()}/knowledge/articles/${narrow.id}/access?user=${w.p.req2.userId}`);
    expect(r2.readable).toBe(true);
  });
});

describe("an agent of another group", () => {
  it("reads published knowledge of both bases with internal sections", async () => {
    const c = w.p.other.client;
    expect(await statusOf(c, "GET", `${P()}/r/kb_article/${agentsOnly.id}`)).toBe(200);
    expect((await c.get(`${P()}/knowledge/articles/${guide.id}/read`)).internal_body).toContain("kbtokinternal");
  });

  it("never sees another author's draft or its versions", async () => {
    const c = w.p.other.client;
    expect(await statusOf(c, "GET", `${P()}/r/kb_article/${draft.id}`)).toBe(404);
    expect(await statusOf(c, "GET", `${P()}/r/kb_version/${draft.draft_version_id}`)).toBe(404);
    expect(ids((await c.get(`${P()}/r/kb_version?size=200`)).rows)).not.toContain(draft.draft_version_id);
    expect(await statusOf(c, "GET", `${P()}/knowledge/versions/${draft.draft_version_id}/check`)).toBe(404);
  });

  it("writes in the agents' base, where every agent contributes", async () => {
    const r = await w.article({ base_id: w.bases.agents, title: "اتصال چاپگر شبکه در لینوکس", body: "## مسئله\n\nچاپگر دیده نمی‌شود\n\n## محیط\n\nاوبونتو\n\n## راه‌حل\n\n1. CUPS را باز کنید\n" }, w.p.other.client);
    expect(r.article.author_id).toBe(w.p.other.userId);
    // ...and the desk agent does not see it while it is a draft
    expect(await statusOf(w.p.agent.client, "GET", `${P()}/r/kb_article/${r.article.id}`)).toBe(404);
  });

  it("the article's contributors follow its owner group (compiled onto its versions)", async () => {
    const r = await w.article({ base_id: w.bases.agents, title: "رویهٔ پشتیبان‌گیری سوییچ", body: "## مسئله\n\nپشتیبان سوییچ\n\n## محیط\n\nسیسکو\n\n## راه‌حل\n\n1. دستور copy را اجرا کنید\n" }, w.p.agent.client);
    expect(await statusOf(w.p.other.client, "GET", `${P()}/r/kb_version/${r.version.id}`)).toBe(404);
    await w.p.agent.client.patch(`${P()}/r/kb_article/${r.article.id}`, { owner_group_id: w.g.network });
    await w.drain();
    expect(await statusOf(w.p.other.client, "GET", `${P()}/r/kb_article/${r.article.id}`)).toBe(200);
    expect(await statusOf(w.p.other.client, "GET", `${P()}/r/kb_version/${r.version.id}`)).toBe(200);
  });
});

describe("an auditor", () => {
  it("reads published knowledge and never changes it", async () => {
    const c = w.p.auditor.client;
    expect(await statusOf(c, "GET", `${P()}/r/kb_article/${agentsOnly.id}`)).toBe(200);
    expect(await statusOf(c, "GET", `${P()}/r/kb_article/${draft.id}`)).toBe(404);
    expect(await statusOf(c, "POST", `${P()}/knowledge/articles`, { base_id: w.bases.guide, title: "x" })).toBe(403);
    expect(await statusOf(c, "POST", `${P()}/knowledge/articles/${guide.id}/draft`, { kind: "minor" })).toBe(403);
    expect(await statusOf(c, "POST", `${P()}/knowledge/articles/${guide.id}/retire`, { reason: "قدیمی" })).toBe(403);
    expect(await statusOf(c, "PATCH", `${P()}/r/kb_article/${guide.id}`, { owner_id: w.p.auditor.userId })).toBe(403);
    expect(await statusOf(c, "PATCH", `${P()}/r/kb_base/${w.bases.guide}`, { description: "x" })).toBe(403);
  });
});

describe("AI follows the same audiences", () => {
  const cited = async (userId: string, q: string) => {
    const ctx = await w.e.ctxOf(userId);
    const r = await retrieve(ctx, q, { tables: ["kb_article"], k: 12 });
    return new Set(r.passages.map((p) => p.citation.id));
  };

  it("retrieve returns only articles the member may read, without sections they may not see", async () => {
    const req = await w.e.ctxOf(w.p.req.userId);
    const r = await retrieve(req, "kbtokguidebody kbtokinternal kbtokagentsbody kbtokdraftbody kbtoknarrowbody kbtokcategorybody kbtokdeniedbody", { tables: ["kb_article"], k: 20 });
    const got = new Set(r.passages.map((p) => p.citation.id));
    expect(got.has(guide.id)).toBe(true);
    for (const x of [agentsOnly, draft, narrow, inCategory]) expect(got.has(x.id)).toBe(false);
    expect(r.passages.some((p) => p.text.includes("kbtokinternal"))).toBe(false);
    // req2: the narrow article and the category's, never the denied base
    const two = await cited(w.p.req2.userId, "kbtoknarrowbody kbtokcategorybody kbtokdeniedbody");
    expect(two.has(narrow.id)).toBe(true);
    expect(two.has(inCategory.id)).toBe(true);
    expect(two.has(denied.id)).toBe(false);
    // agents: their base and the internal section
    const agent = await w.e.ctxOf(w.p.agent.userId);
    const ra = await retrieve(agent, "kbtokagentsbody kbtokinternal", { tables: ["kb_article"], k: 12 });
    expect(ra.passages.map((p) => p.citation.id)).toContain(agentsOnly.id);
    expect(ra.passages.some((p) => p.text.includes("kbtokinternal"))).toBe(true);
  });

  it("cited answers cite only readable articles", async () => {
    const req = await w.e.ctxOf(w.p.req.userId);
    const a = await askWithCitations(req, "kbtokagentsbody kbtoknarrowbody kbtokguidebody چیست؟", { tables: ["kb_article"] }, { k: 6 });
    const all = [...a.citations.map((c) => c.id), ...a.passages.map((p) => p.citation.id)];
    for (const x of [agentsOnly, draft, narrow, inCategory]) expect(all).not.toContain(x.id);
    expect(`${a.answer}\n${a.passages.map((p) => p.text).join("\n")}`).not.toMatch(/kbtok(agents|draft|narrow|category|internal)/);
  });

  it("a retired article stops answering; a base with AI off answers nobody", async () => {
    const tmp = await w.published({ title: "راهنمای kbtokretire", summary: "موقت", body: "## گام‌ها\n\n1. kbtokretirebody\n" });
    await w.drain();
    expect((await cited(w.p.req.userId, "kbtokretirebody")).has(tmp.id)).toBe(true);
    await w.p.km.client.post(`${P()}/knowledge/articles/${tmp.id}/retire`, { reason: "دیگر لازم نیست" });
    await w.drain();
    expect((await cited(w.p.req.userId, "kbtokretirebody")).has(tmp.id)).toBe(false);
    await w.o.patch(`${P()}/r/kb_base/${deniedBase}`, { ai_enabled: false });
    await w.drain();
    expect((await cited(w.p.req.userId, "kbtokdeniedbody")).has(denied.id)).toBe(false);
  });
});
