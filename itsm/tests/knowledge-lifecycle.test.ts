// Knowledge lifecycle end to end: day-one defaults (idempotent), an article and its first draft, submission and the
// publish approval of the base (separation of duties, rejection with feedback, approval), publication (pointers,
// version numbers, review and validity dates), a new minor and a new major version (the previous one outdated,
// translations stale), the diff and restoring an old version as a draft, scheduled publication, retirement with a
// replacement (and through approval), the trash and restoring from it, the one-click periodic review, and the KCS base
// where licensed staff publish just in time.
import { describe, it, expect, beforeAll } from "vitest";
import { kbWorld, statusOf, type KbWorld } from "./knowledge-helpers";
import { kbSweep } from "@server/modules/knowledge";

let w: KbWorld;
const P = () => w.P;

beforeAll(async () => {
  w = await kbWorld();
}, 120_000);

describe("knowledge: defaults", () => {
  it("seeds bases, categories, templates, approval rules, the task SLA, notifications and the welcome article once", async () => {
    const bases = (await w.o.get(`${P()}/r/kb_base?size=50`)).rows;
    expect(bases.map((b: any) => b.name).sort()).toEqual(["خطاهای شناخته‌شده", "دانش کارشناسان", "راهنمای کاربران"].sort());
    const templates = (await w.o.get(`${P()}/r/kb_template?size=50`)).rows;
    expect(templates.length).toBe(10);
    const rules = (await w.o.get(`${P()}/r/approval_rule?size=50&filter=${encodeURIComponent(JSON.stringify({ f: "table_key", op: "in", v: ["kb_version", "kb_article"] }))}`)).rows;
    expect(rules.length).toBe(4);
    const sla = (await w.o.get(`${P()}/r/sla_definition?size=50&filter=${encodeURIComponent(JSON.stringify({ f: "table_key", op: "eq", v: "kb_task" }))}`)).rows;
    expect(sla.length).toBe(1);
    const again = await w.o.post(`${P()}/knowledge/seed`, {});
    expect(again.skipped).toBe(true);
    const forced = await w.o.post(`${P()}/knowledge/seed`, { force: true });
    expect(Object.values(forced.created).reduce((s: number, n: any) => s + n, 0)).toBe(0);
    const welcome = (await w.o.get(`${P()}/knowledge/search?q=${encodeURIComponent("راهنمای مرکز دانش")}`)).hits;
    expect(welcome[0]?.title).toBe("راهنمای مرکز دانش");
  });
});

describe("knowledge: authoring and publication", () => {
  it("creates an article with its first draft from the base's template", async () => {
    const r = await w.article({ title: "اتصال به وای‌فای مهمان", body: undefined }, w.p.agent.client);
    expect(r.article.state).toBe("draft");
    expect(r.article.number).toMatch(/^KB\d{6}$/);
    expect(r.version.version_label).toBe("1.0");
    expect(r.version.body).toContain("## گام‌ها"); // the how-to template's skeleton
    expect(r.article.draft_version_id).toBe(r.version.id);
  });

  it("a requester cannot write knowledge", async () => {
    const r = await statusOf(w.p.req.client, "POST", `${P()}/knowledge/articles`, { base_id: w.bases.guide, title: "نوشتهٔ درخواست‌کننده" });
    expect(r).toBe(403);
  });

  it("submission asks the base's approvers (never the author); rejection returns it with the comment; approval publishes", async () => {
    const r = await w.article({ title: "تغییر گذرواژهٔ ایمیل", summary: "گام‌های تغییر گذرواژهٔ ایمیل سازمانی از پرتال", keywords: ["گذرواژه", "ایمیل"], body: "## گام‌ها\n\n1. به پرتال بروید\n2. «تغییر گذرواژه» را بزنید\n" }, w.p.agent.client);
    const v = await w.submit(r.version.id, w.p.agent.client);
    expect(v.state).toBe("in_review");
    expect(v.reviewer_ids).toContain(w.p.km.userId);
    expect(v.reviewer_ids).not.toContain(w.p.agent.userId);
    await w.drain();
    // the reviewer reads the version and the unpublished article; another agent does not
    expect(await statusOf(w.p.km.client, "GET", `${P()}/r/kb_version/${r.version.id}`)).toBe(200);
    expect(await statusOf(w.p.other.client, "GET", `${P()}/r/kb_article/${r.article.id}`)).toBe(404);
    await w.decide(w.p.km.client, "kb_version", r.version.id, "rejected", "عنوان را روشن‌تر کنید");
    const back = (await w.p.agent.client.get(`${P()}/r/kb_version/${r.version.id}`)).row;
    expect(back.state).toBe("draft");
    const notes = (await w.p.agent.client.get(`${P()}/r/kb_version/${r.version.id}/journal`)).entries.map((x: any) => x.body).join("\n");
    expect(notes).toContain("عنوان را روشن‌تر کنید");
    await w.p.agent.client.patch(`${P()}/r/kb_version/${r.version.id}`, { title: "تغییر گذرواژهٔ ایمیل سازمانی" });
    await w.submit(r.version.id, w.p.agent.client);
    await w.drain();
    await w.decide(w.p.km.client, "kb_version", r.version.id);
    const a = (await w.o.get(`${P()}/r/kb_article/${r.article.id}`)).row;
    expect(a.state).toBe("published");
    expect(a.title).toBe("تغییر گذرواژهٔ ایمیل سازمانی");
    expect(a.version_label).toBe("1.0");
    expect(a.published_version_id).toBe(r.version.id);
    expect(a.review_at).toBeTruthy();
    expect(a.valid_to).toBeTruthy();
    // requesters read it now
    expect(await statusOf(w.p.req.client, "GET", `${P()}/r/kb_article/${r.article.id}`)).toBe(200);
  });

  it("content is changed only through versions; a minor and a major version outdate the previous one", async () => {
    const a = await w.published({ title: "نصب چاپگر طبقهٔ دوم", summary: "افزودن چاپگر شبکه در ویندوز", body: "## گام‌ها\n\n1. تنظیمات را باز کنید\n2. چاپگر را بیفزایید\n" });
    const direct = await w.p.km.client.patch(`${P()}/r/kb_article/${a.id}`, { title: "دور زدن نسخه‌ها" });
    expect(direct.row.title).toBe("نصب چاپگر طبقهٔ دوم"); // readonly: ignored
    const d1 = (await w.p.km.client.post(`${P()}/knowledge/articles/${a.id}/draft`, { kind: "minor" })).version;
    expect(d1.version_label).toBe("1.1");
    const twice = await statusOf(w.p.km.client, "POST", `${P()}/knowledge/articles/${a.id}/draft`, { kind: "minor" });
    expect(twice).toBe(409);
    await w.p.km.client.patch(`${P()}/r/kb_version/${d1.id}`, { body: "## گام‌ها\n\n1. تنظیمات را باز کنید\n2. «افزودن چاپگر» را بزنید\n3. نام چاپگر را انتخاب کنید\n" });
    await w.submit(d1.id);
    await w.decide(w.o, "kb_version", d1.id);
    const a2 = (await w.o.get(`${P()}/r/kb_article/${a.id}`)).row;
    expect(a2.version_label).toBe("1.1");
    expect(a2.body).toContain("نام چاپگر را انتخاب کنید");
    const first = (await w.o.get(`${P()}/r/kb_version/${a.published_version_id}`)).row;
    expect(first.state).toBe("outdated");
    const diff = await w.p.km.client.get(`${P()}/knowledge/diff?a=${first.id}&b=${d1.id}`);
    expect(diff.fields.find((f: any) => f.field === "body").added).toBeGreaterThan(0);
    const restored = (await w.p.km.client.post(`${P()}/knowledge/versions/${first.id}/restore`, {})).version;
    expect(restored.state).toBe("draft");
    expect(restored.body).toBe(first.body);
    await w.p.km.client.patch(`${P()}/r/kb_version/${restored.id}`, { change_kind: "major", change_note: "بازنویسی" });
    expect((await w.p.km.client.get(`${P()}/r/kb_version/${restored.id}`)).row.version_label).toBe("2.0");
  });

  it("schedules a publication for later and the sweep publishes it when due", async () => {
    const r = await w.article({ title: "یادداشت انتشار نسخهٔ تازهٔ پرتال", article_type: "release_note", summary: "تغییرهای این ماه پرتال کاربران", body: "## چه تغییر کرد\n\nصفحهٔ نخست تازه شد.\n" });
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString();
    await w.p.km.client.post(`${P()}/knowledge/versions/${r.version.id}/submit`, { publish_at: later });
    await w.drain();
    await w.decide(w.o, "kb_version", r.version.id);
    expect((await w.o.get(`${P()}/r/kb_version/${r.version.id}`)).row.state).toBe("scheduled");
    expect((await w.o.get(`${P()}/r/kb_article/${r.article.id}`)).row.state).toBe("scheduled");
    await w.e.db.query(`update sm_kb_versions set publish_at = now() - interval '1 minute' where id = $1`, [r.version.id]);
    const s = await kbSweep(w.sys);
    expect(s.published).toBe(1);
    expect((await w.o.get(`${P()}/r/kb_article/${r.article.id}`)).row.state).toBe("published");
  });

  it("retires with a reason and a replacement; restores from the trash", async () => {
    const old = await w.published({ title: "تنظیم VPN قدیمی", summary: "راهنمای کلاینت قدیمی VPN", body: "## گام‌ها\n\n1. کلاینت قدیمی را نصب کنید\n" });
    const neu = await w.published({ title: "تنظیم VPN تازه", summary: "راهنمای کلاینت تازهٔ VPN", body: "## گام‌ها\n\n1. کلاینت تازه را نصب کنید\n" });
    const bad = await statusOf(w.p.km.client, "POST", `${P()}/knowledge/articles/${old.id}/retire`, { reason: "" });
    expect(bad).toBe(400);
    const r = await w.p.km.client.post(`${P()}/knowledge/articles/${old.id}/retire`, { reason: "کلاینت تازه آمده است", replaced_by: neu.id });
    expect(r.row.state).toBe("retired");
    const view = await w.p.req.client.get(`${P()}/knowledge/articles/${old.id}/read`);
    expect(view.banners[0].kind).toBe("retired");
    expect(view.banners[0].link.id).toBe(neu.id);
    // retired articles leave search
    const hits = (await w.p.req.client.get(`${P()}/knowledge/search?q=VPN`)).hits.map((h: any) => h.id);
    expect(hits).toContain(neu.id);
    expect(hits).not.toContain(old.id);
    // trash and restore
    await w.p.km.client.post(`${P()}/r/kb_article/${old.id}/transition`, { to: "trashed" });
    expect((await w.o.get(`${P()}/r/kb_article/${old.id}`)).row.state).toBe("trashed");
    const back = await w.p.km.client.post(`${P()}/knowledge/articles/${old.id}/restore`, {});
    expect(back.row.state).toBe("retired");
  });

  it("asks for approval to retire when the base wants it", async () => {
    await w.o.patch(`${P()}/r/kb_base/${w.bases.guide}`, { retire_approval: true });
    const a = await w.published({ title: "راهنمای دستگاه نمابر", summary: "ارسال نمابر از دستگاه چندکاره", body: "## گام‌ها\n\n1. شماره را بگیرید\n" }, w.p.agent.client);
    const r = await w.p.agent.client.post(`${P()}/knowledge/articles/${a.id}/retire`, { reason: "دستگاه نمابر جمع شد" });
    expect(r.row.state).toBe("pending_retirement");
    await w.drain();
    await w.decide(w.p.km.client, "kb_article", a.id);
    expect((await w.o.get(`${P()}/r/kb_article/${a.id}`)).row.state).toBe("retired");
    await w.o.patch(`${P()}/r/kb_base/${w.bases.guide}`, { retire_approval: false });
  });

  it("reminds owners of due reviews, shows «may be outdated» and confirms a review in one click", async () => {
    const a = await w.published({ title: "رزرو اتاق جلسه", summary: "رزرو اتاق جلسه از تقویم", body: "## گام‌ها\n\n1. تقویم را باز کنید\n" });
    await w.e.db.query(`update sm_kb_articles set review_at = current_date - 1 where id = $1`, [a.id]);
    await kbSweep(w.sys);
    const due = (await w.o.get(`${P()}/r/kb_article/${a.id}`)).row;
    expect(due.review_due).toBe(true);
    const tasks = (await w.o.get(`${P()}/r/kb_task?filter=${encodeURIComponent(JSON.stringify({ and: [{ f: "article_id", op: "eq", v: a.id }, { f: "kind", op: "eq", v: "review" }] }))}`)).rows;
    expect(tasks.length).toBe(1);
    const view = await w.p.req.client.get(`${P()}/knowledge/articles/${a.id}/read`);
    expect(view.banners.some((b: any) => b.kind === "outdated")).toBe(true);
    await w.p.km.client.post(`${P()}/knowledge/articles/${a.id}/review`, { outcome: "confirm" });
    const after = (await w.o.get(`${P()}/r/kb_article/${a.id}`)).row;
    expect(after.review_due).toBe(false);
    expect(after.review_at > due.review_at).toBe(true);
    expect((await w.o.get(`${P()}/r/kb_task/${tasks[0].id}`)).row.state).toBe("done");
  });

  it("publishes just in time in the KCS base for licensed publishers; candidates go through approval", async () => {
    const lic = await w.o.post(`${P()}/r/kb_licence`, { user_id: w.p.agent.userId, level: "publisher", base_id: w.bases.agents });
    expect(lic.row.state).toBe("active");
    const r = await w.article({ base_id: w.bases.agents, title: "بازنشانی سرویس چاپ روی سرور", body: "## مسئله\n\nچاپ متوقف است\n\n## محیط\n\nویندوز سرور\n\n## راه‌حل\n\n1. سرویس Spooler را دوباره راه بیندازید\n" }, w.p.agent.client);
    expect(r.article.kcs_confidence).toBe("not_validated");
    const v = await w.submit(r.version.id, w.p.agent.client);
    expect(v.needs_approval).toBe(false);
    await w.drain();
    expect((await w.o.get(`${P()}/r/kb_article/${r.article.id}`)).row.state).toBe("published");
    await w.o.post(`${P()}/r/kb_licence`, { user_id: w.p.other.userId, level: "candidate", base_id: w.bases.agents });
    const r2 = await w.article({ base_id: w.bases.agents, title: "پاک کردن حافظهٔ موقت مرورگر", body: "## مسئله\n\nصفحه کهنه است\n\n## محیط\n\nکروم\n\n## راه‌حل\n\n1. Ctrl+Shift+Del را بزنید\n" }, w.p.other.client);
    const v2 = await w.submit(r2.version.id, w.p.other.client);
    expect(v2.needs_approval).toBe(true);
    expect(v2.state).toBe("in_review");
  });
});
