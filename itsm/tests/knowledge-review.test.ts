// Regressions of the knowledge review: files and comments of an article stay with its people (readers see the files
// its published text shows); retirement and approval rounds cannot be bypassed or replayed; content reaches
// requesters only through the sensitive-data check; child rows follow the article's deny lists; feedback and quality
// scores come from the service paths; search folds what Persian keyboards type; dashboards and AQI tasks show only
// what their reader may read; the reading view offers what the server allows.
import { beforeAll, describe, expect, it } from "vitest";
import { kbWorld, statusOf, type KbWorld } from "./knowledge-helpers";
import { PNG, raw, upload } from "./engine-helpers";
import type { Client } from "./helpers";
import { BY_ENTITY } from "@server/sync/registry";
import { pullEngine } from "@server/engine/sync";
import { kbSweep, runPublishingModels, sampleAqi, searchKnowledge } from "@server/modules/knowledge";
import { orgSchema } from "@server/engine";

let w: KbWorld;
const R = (t: string, id?: string) => `${w.P}/r/${t}${id ? `/${id}` : ""}`;
const K = (p: string) => `${w.P}/knowledge${p}`;
const as = (k: keyof KbWorld["p"]): Client => w.p[k].client;
const read = (who: Client, id: string) => who.get(K(`/articles/${id}/read`));
const put = async (who: Client, path: string, name: string) => {
  const res = await upload(w.e.app, who, `${path}/attachments`, name, PNG, "image/png");
  return { status: res.status, id: res.status === 200 ? ((await res.json()) as { attachment: { id: string } }).attachment.id : null };
};

beforeAll(async () => {
  w = await kbWorld();
}, 120_000);

describe("an article's files and comments stay with its people", () => {
  it("shows readers only the files its published text shows, internal-section ones only with «داخلی»", async () => {
    const a = await w.published({ title: "تنظیم چاپگر طبقهٔ دوم", body: "## گام‌ها\n\n1. چاپگر را روشن کنید\n2. کاغذ بگذارید\n" });
    // a file put straight on the published article is not something readers see (nor an author who may not change it)
    const stray = await put(as("km"), R("kb_article", a.id), "internal-console.png");
    expect(stray.status).toBe(200);
    expect((await read(as("req2"), a.id)).attachments).toEqual([]);
    expect((await raw(w.e.app, as("req2"), `${w.P}/attachments/${stray.id}/content`)).status).toBe(404);
    expect((await put(as("agent"), R("kb_article", a.id), "agent.png")).status).toBe(403);
    // a draft keeps its images until it is published; then the ones its text shows go to the article
    const draft = (await as("km").post(K(`/articles/${a.id}/draft`), {})).version;
    const pub = await put(as("km"), R("kb_version", draft.id), "printer.png");
    const secret = await put(as("km"), R("kb_version", draft.id), "server-console.png");
    expect((await raw(w.e.app, as("req2"), `${w.P}/attachments/${pub.id}/content`)).status).toBe(404);
    await as("km").patch(R("kb_version", draft.id), {
      body: `## گام‌ها\n\n1. چاپگر را روشن کنید\n2. کاغذ بگذارید\n\n![چاپگر](attachment:${pub.id})\n`,
      internal_body: `کنسول کارساز چاپ:\n\n![کنسول](attachment:${secret.id})\n`,
    });
    const v = await w.submit(draft.id);
    if (v.state === "in_review") await w.decide(w.o, "kb_version", draft.id);
    const reader = await read(as("req2"), a.id);
    expect(reader.attachments.map((x: any) => x.id)).toEqual([pub.id]);
    expect((await raw(w.e.app, as("req2"), `${w.P}/attachments/${pub.id}/content`)).status).toBe(200);
    expect((await raw(w.e.app, as("req2"), `${w.P}/attachments/${secret.id}/content`)).status).toBe(404);
    expect((await read(as("other"), a.id)).attachments.map((x: any) => x.id).sort()).toEqual(expect.arrayContaining([pub.id, secret.id]));
    // a Windows app of the reader gets the same files
    const pulled = (await pullEngine(await w.e.ctxOf(w.p.req2.userId), BY_ENTITY.get("attachment")!, 0, Number.MAX_SAFE_INTEGER)).aggregates.map((x) => x.id);
    expect(pulled).toContain(pub.id);
    expect(pulled).not.toContain(secret.id);
    expect(pulled).not.toContain(stray.id);
  });

  it("takes readers' comments as feedback only, and only where the base takes them", async () => {
    const a = await w.published({ title: "راه‌اندازی وی‌پی‌ان", body: "## گام‌ها\n\n1. برنامه را نصب کنید\n2. وارد شوید\n" });
    const base = w.bases.guide;
    await w.o.patch(R("kb_base", base), { allow_comments: false });
    try {
      expect((await put(as("req"), R("kb_article", a.id), "phish.png")).status).toBe(403);
      expect(await statusOf(as("req"), "POST", `${R("kb_article", a.id)}/journal`, { kind: "comment", body: "این را بخوانید: http://phish.example" })).toBe(403);
      expect(await statusOf(as("req"), "POST", K(`/articles/${a.id}/vote`), { helpful: false, comment: "نظر من" })).toBe(403);
      expect((await as("req").post(K(`/articles/${a.id}/vote`), { helpful: false })).vote).toBe("not_helpful");
      // the article's people still discuss it; readers see none of it but their own entries
      await as("km").post(`${R("kb_article", a.id)}/journal`, { kind: "comment", body: "بازبینی سالانه انجام شد" });
      expect((await as("req2").get(`${R("kb_article", a.id)}/journal`)).entries).toEqual([]);
      expect((await read(as("req2"), a.id)).attachments).toEqual([]);
    } finally {
      await w.o.patch(R("kb_base", base), { allow_comments: true });
    }
  });
});

const pending = async (who: Client, table: string, id: string) => ((await who.get(`${w.P}/approvals/mine`)).approvals as any[]).filter((x) => x.table_key === table && x.record_id === id);
const state = async (table: string, id: string) => (await w.o.get(R(table, id))).row.state;

describe("retirement and approval rounds", () => {
  it("never publishes a retired article: its version waiting for approval or for its date leaves with it", async () => {
    const a = await w.published({ title: "تنظیم پروکسی مرورگر", body: "## گام‌ها\n\n1. تنظیمات را باز کنید\n2. پروکسی را بنویسید\n" });
    const d1 = (await as("km").post(K(`/articles/${a.id}/draft`), {})).version;
    await as("km").patch(R("kb_version", d1.id), { body: "## گام‌ها\n\n1. تنظیمات را باز کنید\n2. پروکسی تازه را بنویسید\n" });
    expect((await w.submit(d1.id)).state).toBe("in_review");
    await w.drain();
    expect(await pending(w.o, "kb_version", d1.id)).toHaveLength(1);
    await as("km").post(K(`/articles/${a.id}/retire`), { reason: "پروکسی برداشته شد" });
    expect(await state("kb_article", a.id)).toBe("retired");
    expect(await state("kb_version", d1.id)).toBe("discarded");
    expect(await pending(w.o, "kb_version", d1.id)).toHaveLength(0);
    // a version scheduled for later goes too, and the sweep publishes nothing into a retired article
    const b = await w.published({ title: "تنظیم چاپ دورو", body: "## گام‌ها\n\n1. چاپگر را انتخاب کنید\n2. دورو را بزنید\n" });
    const d2 = (await as("km").post(K(`/articles/${b.id}/draft`), {})).version;
    await as("km").post(K(`/versions/${d2.id}/submit`), { publish_at: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    await w.drain();
    await w.decide(w.o, "kb_version", d2.id);
    expect(await state("kb_version", d2.id)).toBe("scheduled");
    await as("km").post(K(`/articles/${b.id}/retire`), { reason: "دیگر لازم نیست" });
    await w.e.db.query(`update sm_kb_versions set publish_at = now() - interval '1 minute' where id = $1`, [d2.id]);
    await kbSweep(w.sys);
    expect(await state("kb_article", b.id)).toBe("retired");
  });

  it("keeps a requested retirement and a retirement date to the approvers", async () => {
    await w.o.patch(R("kb_base", w.bases.guide), { retire_approval: true });
    try {
      const a = await w.published({ title: "راهنمای دستگاه کپی قدیمی", body: "## گام‌ها\n\n1. کاغذ بگذارید\n2. کپی بزنید\n" }, as("agent"));
      expect((await as("agent").post(K(`/articles/${a.id}/retire`), { reason: "دستگاه جمع شد" })).row.state).toBe("pending_retirement");
      expect(await statusOf(as("agent"), "POST", `${R("kb_article", a.id)}/transition`, { to: "retired", data: { retire_reason: "دستگاه جمع شد" } })).toBe(409);
      expect(await statusOf(as("agent"), "POST", K(`/articles/${a.id}/retire`), { reason: "دوباره" })).toBe(409);
      // the reading view does not offer what the server refuses
      expect((await read(as("agent"), a.id)).can.retire).toBe(false);
      expect(await state("kb_article", a.id)).toBe("pending_retirement");
      // a date retires without approval: in this base only approvers set one
      const b = await w.published({ title: "راهنمای نمابر قدیمی", body: "## گام‌ها\n\n1. شماره را بگیرید\n2. بفرستید\n" }, as("agent"));
      const later = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      expect(await statusOf(as("agent"), "POST", K(`/articles/${b.id}/retire`), { reason: "نمابر جمع می‌شود", at: later })).toBe(403);
      expect(await statusOf(as("agent"), "PATCH", R("kb_article", b.id), { retire_at: later })).toBe(403);
      expect((await w.o.get(R("kb_article", b.id))).row.retire_at ?? null).toBeNull();
      // the approver decides the request
      await w.decide(as("km"), "kb_article", a.id);
      expect(await state("kb_article", a.id)).toBe("retired");
    } finally {
      await w.o.patch(R("kb_base", w.bases.guide), { retire_approval: false });
    }
  });

  it("starts a new approval round when a version goes back to draft by any path", async () => {
    await w.o.patch(R("kb_base", w.bases.guide), { approval_mode: "all" });
    try {
      const r = await w.article({ title: "تنظیم امضای ایمیل", body: "## گام‌ها\n\n1. تنظیمات را باز کنید\n2. امضا را بنویسید\n" }, as("agent"));
      expect((await w.submit(r.version.id, as("agent"))).state).toBe("in_review");
      await w.drain();
      const first = (await w.o.get(`${w.P}/approvals/record/kb_version/${r.version.id}`)).approvals as any[];
      expect(first.length).toBeGreaterThanOrEqual(2);
      await w.decide(as("km"), "kb_version", r.version.id);
      // back to draft through the record's own transition, rewritten, submitted again
      await as("agent").post(`${R("kb_version", r.version.id)}/transition`, { to: "draft", data: {} });
      await as("agent").patch(R("kb_version", r.version.id), { body: "## گام‌ها\n\n1. متن دیگری\n2. کاملاً تازه\n" });
      expect((await w.submit(r.version.id, as("agent"))).state).toBe("in_review");
      await w.drain();
      await w.decide(w.o, "kb_version", r.version.id);
      // the knowledge manager's approval was for the earlier text: the rewritten one waits for them again
      expect(await state("kb_version", r.version.id)).toBe("in_review");
      expect(await pending(as("km"), "kb_version", r.version.id)).toHaveLength(1);
      await w.decide(as("km"), "kb_version", r.version.id);
      expect(await state("kb_version", r.version.id)).toBe("published");
    } finally {
      await w.o.patch(R("kb_base", w.bases.guide), { approval_mode: "any" });
    }
  });

  it("offers review and restore only to those the server lets do them", async () => {
    const a = await w.published({ title: "راهنمای اسکنر طبقهٔ اول", body: "## گام‌ها\n\n1. سند را بگذارید\n2. اسکن بزنید\n" });
    const desk = await read(as("agent"), a.id);
    expect(desk.can.review).toBe(false);
    expect(await statusOf(as("agent"), "POST", K(`/articles/${a.id}/review`), { outcome: "confirm" })).toBe(403);
    expect((await read(as("km"), a.id)).can.review).toBe(true);
    const mine = await w.published({ title: "راهنمای قفل صفحه", body: "## گام‌ها\n\n1. کلید ویندوز و L\n2. تمام\n" }, as("agent"));
    await as("km").post(K(`/articles/${mine.id}/retire`), { reason: "دیگر لازم نیست" });
    expect((await read(as("agent"), mine.id)).can.restore).toBe(false);
    expect(await statusOf(as("agent"), "POST", K(`/articles/${mine.id}/restore`), {})).toBe(403);
    expect((await read(as("km"), mine.id)).can.restore).toBe(true);
  });
});

describe("content reaches requesters only through the checks", () => {
  it("keeps an internal article with sensitive data internal when a field edit would turn it external", async () => {
    const body = "## چه زمانی\n\nوقتی سرویس فایل پاسخ نمی‌دهد\n\n## گام‌ها\n\n1. سرویس روی FS01.corp.local (10.10.2.5) را دوباره راه بیندازید\n2. نتیجه را بررسی کنید\n";
    const a = await w.published({ title: "راه‌اندازی دوبارهٔ سرویس فایل", article_type: "procedure", body }, as("agent"));
    expect(a.state).toBe("published");
    expect(await statusOf(as("req"), "GET", K(`/articles/${a.id}/read`))).toBe(404);
    expect(await statusOf(as("agent"), "PATCH", R("kb_article", a.id), { article_type: "how_to" })).toBe(403);
    expect(await statusOf(as("km"), "PATCH", R("kb_article", a.id), { article_type: "how_to" })).toBe(409);
    expect(await statusOf(as("req"), "GET", K(`/articles/${a.id}/read`))).toBe(404);
  });

  it("lets a publishing model move only text without sensitive data, asking a person otherwise", async () => {
    await w.o.patch(R("kb_base", w.bases.guide), { publishing_model: "reuse", external_after_reuses: 1 });
    try {
      const dirty = await w.published({ title: "بازیابی کارساز چاپ", body: "## گام‌ها\n\n1. به کارساز چاپ وصل شوید\n2. صف را پاک کنید\n" });
      const clean = await w.published({ title: "پاک کردن صف چاپ", body: "## گام‌ها\n\n1. صف چاپ را باز کنید\n2. کارها را لغو کنید\n" });
      // internal articles (not yet validated) skip the requester check on submission: one names an internal host
      for (const id of [dirty.id, clean.id]) await w.e.db.query(`update sm_kb_articles set kcs_confidence = 'not_validated', confidential = true, reuse_count = 4 where id = $1`, [id]);
      await w.e.db.query(`update sm_kb_articles set body = $2 where id = $1`, [dirty.id, "## گام‌ها\n\n1. به PRN02.corp.local با نشانی 10.10.4.7 وصل شوید\n2. صف را پاک کنید\n"]);
      const r = await runPublishingModels(w.sys);
      expect(r.external).toBe(1);
      expect((await w.o.get(R("kb_article", clean.id))).row.confidential).toBe(false);
      expect((await w.o.get(R("kb_article", dirty.id))).row.confidential).toBe(true);
      const tasks = (await w.o.post(`${R("kb_task")}/query`, { filter: { and: [{ f: "article_id", op: "eq", v: dirty.id }, { f: "active", op: "eq", v: true }] }, fields: ["kind", "short_description"] })).rows;
      expect(tasks).toHaveLength(1);
      await runPublishingModels(w.sys);
      expect((await w.o.post(`${R("kb_task")}/query`, { filter: { f: "article_id", op: "eq", v: dirty.id }, fields: ["kind"] })).rows).toHaveLength(1);
    } finally {
      await w.o.patch(R("kb_base", w.bases.guide), { publishing_model: "jit" });
    }
  });
});

describe("rows of an article follow its deny lists; feedback and AQI come from the service paths", () => {
  it("hides versions and feedback of an article from a contributor it denies", async () => {
    const base = (await w.o.post(R("kb_base"), { name: "پایگاه سیاست‌های کارکنان", kind: "internal", contrib_groups: [w.g.network], read_mode: "everyone", publish_approval: false })).row;
    await w.drain();
    const a = await w.published({ base_id: base.id, title: "سیاست اضافه‌کار", body: "## سیاست\n\n1. اضافه‌کار با تأیید مدیر است\n2. سقف ماهانه دارد\n" });
    await as("agent").post(K(`/articles/${a.id}/vote`), { helpful: true });
    const versions = (await w.o.post(`${R("kb_version")}/query`, { filter: { f: "article_id", op: "eq", v: a.id }, fields: ["state"] })).rows;
    expect(versions.length).toBeGreaterThan(0);
    // a contributor of the base reads them, until the article denies them
    expect((await as("other").get(R("kb_version", versions[0].id))).row.id).toBe(versions[0].id);
    await as("km").patch(R("kb_article", a.id), { deny_users: [w.p.other.userId] });
    await w.drain();
    expect(await statusOf(as("other"), "GET", R("kb_article", a.id))).toBe(404);
    expect(await statusOf(as("other"), "GET", R("kb_version", versions[0].id))).toBe(404);
    expect((await as("other").post(`${R("kb_version")}/query`, { filter: { f: "article_id", op: "eq", v: a.id }, fields: ["title", "body"] })).rows).toEqual([]);
    expect((await as("other").post(`${R("kb_feedback")}/query`, { filter: { f: "article_id", op: "eq", v: a.id }, fields: ["kind"] })).rows).toEqual([]);
  });

  it("refuses votes and quality reviews made up through the record API", async () => {
    const a = await w.published({ title: "تنظیم پست صوتی", body: "## گام‌ها\n\n1. شماره را بگیرید\n2. پیام بگذارید\n" });
    const before = Number((await w.o.get(R("kb_article", a.id))).row.helpful_no ?? 0);
    expect(await statusOf(as("other"), "POST", R("kb_feedback"), { article_id: a.id, kind: "not_helpful" })).toBe(403);
    expect(await statusOf(as("other"), "POST", R("kb_quality_review"), { article_id: a.id, reviewer_id: w.p.other.userId, author_id: w.p.km.userId, results: {} })).toBe(403);
    expect(Number((await w.o.get(R("kb_article", a.id))).row.helpful_no ?? 0)).toBe(before);
    // the article's route still takes a reader's vote (one per reader)
    await as("other").post(K(`/articles/${a.id}/vote`), { helpful: false });
    await as("other").post(K(`/articles/${a.id}/vote`), { helpful: false });
    expect(Number((await w.o.get(R("kb_article", a.id))).row.helpful_no ?? 0)).toBe(before + 1);
  });
});

describe("search folds what Persian keyboards type", () => {
  it("matches phrases and words typed with ezafe hamza, bidi marks, zero-width spaces and decomposed letters", async () => {
    const a = await w.published({
      title: "تنظیم شبکهٔ بی\u200cسیم دفتر",
      body: "## گام‌ها\n\n1. رمز\u200bعبور شبکه را از پشتیبانی بگیرید\n2. اتصال به VPN\u200f در خانه را امتحان کنید\n3. ا\u0653موزش کوتاه دفتر را ببینید\n",
    });
    const ctx = await w.e.ctxOf(w.p.req.userId);
    await orgSchema(ctx); // loads the access subject, as the API does for each request
    const hits = async (q: string) => (await searchKnowledge(ctx, { q, semantic: false, log: false })).hits.map((h) => h.id);
    for (const q of ['"شبکه بی‌سیم"', '"vpn در خانه"', "رمزعبور", "آموزش", '"تنظیم شبکه"']) expect(await hits(q), q).toContain(a.id);
  });
});

describe("dashboards and AQI tasks show only what their reader may read", () => {
  it("keeps the organisation's searches to knowledge managers, masked, and stored counts from requesters", async () => {
    await as("req").get(K(`/search?q=${encodeURIComponent("رمز وای فای 09121234567")}`));
    await as("req").get(K(`/search?q=${encodeURIComponent("خطای چاپگر طبقه سوم")}`));
    const agent = await as("agent").get(K("/dashboard"));
    expect(agent.queries).toEqual([]);
    expect(agent.zero).toEqual([]);
    expect(JSON.stringify(agent)).not.toContain("09121234567");
    const km = await as("km").get(K("/dashboard"));
    expect(km.queries.map((q: any) => q.query)).toEqual(expect.arrayContaining(["[متن حساس]"]));
    expect(JSON.stringify(km)).not.toContain("09121234567");
    expect(JSON.stringify(km)).toContain("چاپگر");
    // the stored organisation-wide count of a base is not a requester's to see
    expect((await as("req").get(R("kb_base", w.bases.guide))).row.article_count).toBeUndefined();
  });

  it("gives an AQI review only to a coach who reads the article, and its title to nobody else", async () => {
    await w.e.db.query(`delete from sm_kb_quality_reviews where org_id = $1`, [w.e.org]);
    await w.o.post(R("kb_licence"), { user_id: w.p.other.userId, level: "coach" });
    const a = await w.published({ title: "رویهٔ محرمانهٔ حقوق و دستمزد", body: "## گام‌ها\n\n1. فایل حقوق را باز کنید\n2. بررسی کنید\n" }, as("hr"));
    await as("km").patch(R("kb_article", a.id), { deny_users: [w.p.other.userId] });
    await w.drain();
    expect(await statusOf(as("other"), "GET", R("kb_article", a.id))).toBe(404);
    expect(await sampleAqi(w.sys)).toBeGreaterThan(0);
    const [review] = (await w.e.db.query<{ reviewer_id: string | null }>(`select reviewer_id from sm_kb_quality_reviews where org_id = $1 and article_id = $2`, [w.e.org, a.id]));
    expect(review).toBeTruthy();
    expect(review.reviewer_id).not.toBe(w.p.other.userId);
    const tasks = (await as("other").post(`${R("kb_task")}/query`, { filter: { f: "kind", op: "eq", v: "aqi" }, fields: ["short_description"] })).rows;
    expect(JSON.stringify(tasks)).not.toContain("حقوق و دستمزد");
  });
});
