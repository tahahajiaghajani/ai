// Knowledge in the flow of work and the quality loop: Persian search (letter forms, digits, half-spaces, stems, phrases,
// glossary synonyms, the organisation's rules, facets, sorting, zero results logged for the gap list), suggestions next
// to an incident, attaching an article (reuse counted once per record, detaching with a reason), capturing a KCS draft
// from a resolved incident (people scrubbed), WIP articles, the known-error article, flags collected into one knowledge
// task per article, subscribers told about a new version, translations that go stale when the master moves on, read
// and acknowledge, the sweep's health and duplicates, the dashboard and the knowledge manager's workspace.
import { describe, it, expect, beforeAll } from "vitest";
import { kbWorld, statusOf, type KbWorld } from "./knowledge-helpers";
import { kbSweep } from "@server/modules/knowledge";
import { searchForm } from "@shared/ai/text";

let w: KbWorld;
const P = () => w.P;
const q = (s: string) => encodeURIComponent(s);
const search = async (s: string, as = w.p.req.client, extra = "") => (await as.get(`${P()}/knowledge/search?q=${q(s)}${extra}`)) as { hits: any[]; total: number; facets: any; relaxed: boolean; expanded: string[]; terms: string[] };
const titles = (r: { hits: any[] }) => r.hits.map((h) => h.title);

let printer: Record<string, any>;
let vpn: Record<string, any>;
let wifi: Record<string, any>;

beforeAll(async () => {
  w = await kbWorld();
  printer = await w.published({ title: "رفع خطای چاپگر طبقهٔ ۳", summary: "چاپگر کاغذ را گیر می‌اندازد", keywords: ["چاپگر", "پرینتر"], body: "## گام‌ها\n\n1. درب پشتی چاپگر را باز کنید\n2. کاغذ گیرکرده را آرام بیرون بکشید\n" });
  vpn = await w.published({ title: "اتصال به شبکهٔ خصوصی مجازی", summary: "نصب و ورود به VPN سازمان", keywords: ["وی‌پی‌ان"], body: "## گام‌ها\n\n1. برنامهٔ اتصال را نصب کنید\n2. با نام کاربری سازمانی وارد شوید\n" });
  wifi = await w.published({ title: "اتصال به وای‌فای مهمان", summary: "رمز روزانهٔ شبکهٔ بی‌سیم مهمانان", body: "## گام‌ها\n\n1. شبکهٔ Guest را انتخاب کنید\n2. رمز روزانه را از پذیرش بگیرید\n" });
}, 180_000);

describe("Persian search", () => {
  it("matches across Arabic and Persian letters, digits and half-spaces", async () => {
    expect(titles(await search("چاپگر طبقه 3"))).toContain(printer.title);
    expect(titles(await search("چاپگر طبقه ٣"))).toContain(printer.title); // Arabic-Indic digit
    expect(titles(await search("كاغذ گير"))).toContain(printer.title); // Arabic kaf and yeh
    expect(titles(await search("گیرکرده"))).toContain(printer.title);
    expect(titles(await search("گیر کرده"))).toContain(printer.title);
  });

  it("weighs the title over the body, keeps phrases and relaxes a query nothing matches fully", async () => {
    const r = await search("اتصال");
    expect(titles(r).slice(0, 2).sort()).toEqual([vpn.title, wifi.title].sort());
    expect(titles(await search("\"رمز روزانه\""))).toEqual([wifi.title]);
    const relaxed = await search("چاپگر واژه‌ای‌که‌نیست");
    expect(relaxed.relaxed).toBe(true);
    expect(titles(relaxed)).toContain(printer.title);
  });

  it("widens a term with the glossary's synonyms", async () => {
    await w.o.post(`${P()}/r/kb_glossary`, { term: "وی‌پی‌ان", synonyms: ["VPN", "شبکهٔ خصوصی مجازی"], definition: "اتصال امن به شبکهٔ سازمان از بیرون", active: true });
    const r = await search("VPN");
    expect(titles(r)).toContain(vpn.title);
    // the reading view explains the glossary terms it contains
    const view = await w.p.req.client.get(`${P()}/knowledge/articles/${vpn.id}/read`);
    expect(view.glossary.map((g: any) => g.term)).toContain("وی‌پی‌ان");
  });

  it("applies the organisation's search rules (pin, hide)", async () => {
    await w.o.post(`${P()}/r/kb_search_rule`, { query: "اتصال", kind: "pin", articles: [wifi.id], active: true });
    expect((await search("اتصال")).hits[0].id).toBe(wifi.id);
    expect((await search("اتصال")).hits[0].pinned).toBe(true);
    await w.o.post(`${P()}/r/kb_search_rule`, { query: "شبکهٔ خصوصی", kind: "hide", articles: [vpn.id], active: true });
    expect(titles(await search("شبکهٔ خصوصی"))).not.toContain(vpn.title);
  });

  it("returns facets, sorts and pages", async () => {
    const r = await search("", w.p.req.client, "&sort=recent&size=2");
    expect(r.hits.length).toBe(2);
    expect(r.total).toBeGreaterThanOrEqual(4);
    expect(r.facets.base.find((f: any) => f.key === w.bases.guide)?.label).toBe("راهنمای کاربران");
    const page2 = await search("", w.p.req.client, "&sort=recent&size=2&page=2");
    expect(page2.hits[0].id).not.toBe(r.hits[0].id);
  });

  it("logs zero-result searches; the sweep turns repeated ones into a knowledge gap", async () => {
    for (let i = 0; i < 4; i++) await search("دستگاه کارت‌خوان ورود و خروج", i % 2 ? w.p.req.client : w.p.req2.client);
    await kbSweep(w.sys, { daily: true });
    const gaps = (await w.o.get(`${P()}/r/kb_gap?size=50`)).rows;
    expect(gaps.some((g: any) => searchForm(String(g.title)).includes(searchForm("کارت‌خوان")))).toBe(true);
  });
});

describe("knowledge next to an incident", () => {
  let inc: Record<string, any>;
  beforeAll(async () => {
    inc = (await w.p.agent.client.post(`${P()}/r/incident`, { short_description: "چاپگر کاغذ گیر می‌اندازد", description: "از صبح چاپگر طبقهٔ سوم کاغذ را گیر می‌اندازد. تماس: 09121234567", caller_id: w.p.req.userId, assignment_group_id: w.g.desk, assigned_to: w.p.agent.userId })).row;
  });

  it("suggests articles from the record, shows what is linked and what the caller may do", async () => {
    const r = await w.p.agent.client.get(`${P()}/knowledge/records/incident/${inc.id}`);
    expect(r.suggestions.map((s: any) => s.id)).toContain(printer.id);
    expect(r.can.link).toBe(true);
    expect(r.can.capture).toBe(true);
    // a requester reading their own incident gets no linking
    const mine = await w.p.req.client.get(`${P()}/knowledge/records/incident/${inc.id}`);
    expect(mine.can.link).toBe(false);
  });

  it("attaching counts the reuse once per record; detaching needs a reason and recounts", async () => {
    const a = await w.p.agent.client.post(`${P()}/knowledge/records/incident/${inc.id}/attach`, { article_id: printer.id, kind: "kb_solved_by" });
    expect(a.link_id ?? a.link?.id).toBeTruthy();
    await w.p.agent.client.post(`${P()}/knowledge/records/incident/${inc.id}/attach`, { article_id: printer.id, kind: "kb_related" }).catch(() => undefined);
    await w.drain();
    expect((await w.o.get(`${P()}/r/kb_article/${printer.id}`)).row.reuse_count).toBe(1);
    const panel = await w.p.agent.client.get(`${P()}/knowledge/records/incident/${inc.id}`);
    const link = panel.linked.find((l: any) => l.article.id === printer.id);
    expect(link.kind).toBe("kb_solved_by");
    expect(await statusOf(w.p.agent.client, "POST", `${P()}/knowledge/records/incident/${inc.id}/detach`, { link_id: link.link_id, reason: "" })).toBe(400);
    expect(await statusOf(w.p.req.client, "POST", `${P()}/knowledge/records/incident/${inc.id}/attach`, { article_id: vpn.id })).toBe(403);
    await w.p.agent.client.post(`${P()}/knowledge/records/incident/${inc.id}/detach`, { link_id: link.link_id, reason: "مقالهٔ دیگری مسئله را حل کرد" });
    await w.drain();
    expect((await w.o.get(`${P()}/r/kb_article/${printer.id}`)).row.reuse_count).toBe(0);
    await w.p.agent.client.post(`${P()}/knowledge/records/incident/${inc.id}/attach`, { article_id: printer.id, kind: "kb_solved_by" });
    await w.drain();
  });

  it("captures a KCS draft from the resolved incident, people and contacts scrubbed, linked back", async () => {
    await w.p.agent.client.post(`${P()}/r/incident/${inc.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "درب پشتی را باز کردیم و غلتک را تمیز کردیم" } });
    const r = await w.p.agent.client.post(`${P()}/knowledge/capture`, { table: "incident", id: inc.id });
    expect(r.article.article_type).toBe("kcs");
    expect(r.article.source_number).toBe(inc.number);
    expect(r.version.body).toContain("غلتک را تمیز کردیم");
    expect(`${r.version.body}\n${r.version.internal_body ?? ""}`).not.toContain("09121234567");
    const panel = await w.p.agent.client.get(`${P()}/knowledge/records/incident/${inc.id}`);
    expect(panel.captured?.id).toBe(r.article.id);
  });

  it("a search that found nothing becomes a WIP article others can find", async () => {
    const inc2 = (await w.p.agent.client.post(`${P()}/r/incident`, { short_description: "نرم‌افزار حسابداری پیام خطای ۷۰۴ می‌دهد", caller_id: w.p.req.userId, assignment_group_id: w.g.desk, assigned_to: w.p.agent.userId })).row;
    const r = await w.p.agent.client.post(`${P()}/knowledge/capture`, { table: "incident", id: inc2.id, wip: true, title: "خطای ۷۰۴ نرم‌افزار حسابداری" });
    expect(r.article.kcs_confidence).toBe("wip");
    expect(r.article.confidential).toBe(true);
    await w.drain();
    // another agent searching finds the WIP article (searching is creating); requesters do not
    expect(titles(await search("خطای ۷۰۴", w.p.other.client))).toContain("خطای ۷۰۴ نرم‌افزار حسابداری");
    expect(titles(await search("خطای ۷۰۴"))).not.toContain("خطای ۷۰۴ نرم‌افزار حسابداری");
  });
});

describe("feedback, flags and the knowledge task", () => {
  it("collects flags into one open task of the owner group; closing it settles them", async () => {
    await w.p.req.client.post(`${P()}/knowledge/articles/${wifi.id}/flag`, { reason: "outdated", comment: "نام شبکه عوض شده است" });
    await w.p.req2.client.post(`${P()}/knowledge/articles/${wifi.id}/flag`, { reason: "missing_step", comment: "گام پذیرش گفته نشده" });
    await w.drain();
    const tasks = (await w.o.get(`${P()}/r/kb_task?filter=${q(JSON.stringify({ and: [{ f: "article_id", op: "eq", v: wifi.id }, { f: "kind", op: "eq", v: "flag" }] }))}`)).rows;
    expect(tasks.length).toBe(1);
    expect(tasks[0].assignment_group_id).toBe(w.g.managers);
    expect((await w.o.get(`${P()}/r/kb_article/${wifi.id}`)).row.open_flags).toBe(2);
    // the reporter does not read the task; the managers' group works it
    expect(await statusOf(w.p.req.client, "GET", `${P()}/r/kb_task/${tasks[0].id}`)).toBe(404);
    await w.p.km.client.post(`${P()}/r/kb_task/${tasks[0].id}/transition`, { to: "done", data: { close_code: "fixed", close_notes: "نام شبکه به‌روز شد" } });
    await w.drain();
    expect((await w.o.get(`${P()}/r/kb_article/${wifi.id}`)).row.open_flags).toBe(0);
  });

  it("ratings average, one vote per member that may change", async () => {
    await w.p.req.client.post(`${P()}/knowledge/articles/${printer.id}/rate`, { rating: 5 });
    await w.p.req2.client.post(`${P()}/knowledge/articles/${printer.id}/rate`, { rating: 2 });
    const r = await w.p.req2.client.post(`${P()}/knowledge/articles/${printer.id}/rate`, { rating: 4 });
    expect(r.rating_count).toBe(2);
    expect(Number(r.rating_avg)).toBe(4.5);
    await w.p.req.client.post(`${P()}/knowledge/articles/${printer.id}/vote`, { helpful: true });
    const v = await w.p.req.client.post(`${P()}/knowledge/articles/${printer.id}/vote`, { helpful: false, reason: "unclear" });
    expect([v.helpful_yes, v.helpful_no]).toEqual([0, 1]);
    const view = await w.p.req.client.get(`${P()}/knowledge/articles/${printer.id}/read`);
    expect(view.my.vote).toBe("not_helpful");
    expect(view.my.rating).toBe(5);
  });

  it("«مشکلم حل شد» counts as a deflection", async () => {
    const s = await w.p.req.client.post(`${P()}/knowledge/suggest`, { text: "کاغذ در چاپگر گیر کرده", session_id: "s-1" });
    expect(s.hits.map((h: any) => h.id)).toContain(printer.id);
    await w.p.req.client.post(`${P()}/knowledge/deflect`, { article_id: printer.id, query: "کاغذ در چاپگر گیر کرده", session_id: "s-1" });
    const d = await w.o.get(`${P()}/knowledge/dashboard?days=30`);
    expect(d.deflection.deflected).toBeGreaterThanOrEqual(1);
  });
});

describe("subscriptions, translations, acknowledgement", () => {
  it("tells subscribers about a new version, never those who may not read it", async () => {
    await w.p.req.client.post(`${P()}/knowledge/subscriptions`, { target_table: "kb_article", target_id: vpn.id });
    const d = (await w.p.km.client.post(`${P()}/knowledge/articles/${vpn.id}/draft`, { kind: "major" })).version;
    await w.p.km.client.patch(`${P()}/r/kb_version/${d.id}`, { body: "## گام‌ها\n\n1. برنامهٔ تازهٔ اتصال را نصب کنید\n2. با رمز یک‌بارمصرف وارد شوید\n", change_note: "برنامهٔ اتصال عوض شد" });
    await w.submit(d.id);
    await w.decide(w.o, "kb_version", d.id);
    await w.drain();
    const inbox = (await w.p.req.client.get(`${P()}/notify/inbox`)).items as { record_id: string }[];
    expect(inbox.some((x) => x.record_id === vpn.id)).toBe(true);
    expect((await w.p.req.client.get(`${P()}/knowledge/articles/${vpn.id}/read`)).my.subscribed).toBe(true);
  });

  it("a translation is linked to its master and goes stale when the master gets a major version", async () => {
    const t = await w.p.km.client.post(`${P()}/knowledge/articles/${printer.id}/translate`, { language: "en" });
    expect(t.article.translation_of).toBe(printer.id);
    expect(t.version.body).toContain("کاغذ گیرکرده"); // starts from the master's text
    await w.p.km.client.patch(`${P()}/r/kb_version/${t.version.id}`, { title: "Clearing a paper jam on the 3rd floor printer", body: "## Steps\n\n1. Open the rear door\n2. Pull the paper out\n" });
    await w.submit(t.version.id);
    await w.decide(w.o, "kb_version", t.version.id);
    expect(await statusOf(w.p.km.client, "POST", `${P()}/knowledge/articles/${printer.id}/translate`, { language: "en" })).toBe(400);
    const d = (await w.p.km.client.post(`${P()}/knowledge/articles/${printer.id}/draft`, { kind: "major" })).version;
    await w.p.km.client.patch(`${P()}/r/kb_version/${d.id}`, { body: "## گام‌ها\n\n1. چاپگر را خاموش کنید\n2. درب پشتی را باز کنید\n3. کاغذ را بیرون بکشید\n" });
    await w.submit(d.id);
    await w.decide(w.o, "kb_version", d.id);
    await w.drain();
    expect((await w.o.get(`${P()}/r/kb_article/${t.article.id}`)).row.translation_stale).toBe(true);
    const view = await w.p.req.client.get(`${P()}/knowledge/articles/${printer.id}/read`);
    expect(view.translations.map((x: any) => x.language)).toContain("en");
  });

  it("asks people to read and acknowledge a policy; the owner sees who did", async () => {
    const policy = await w.published({ title: "سیاست گذرواژه", article_type: "policy", summary: "قواعد گذرواژهٔ سازمانی", body: "## هدف\n\nحفاظت از حساب‌ها\n\n## دامنهٔ شمول\n\nهمهٔ همکاران\n\n## مفاد\n\nگذرواژه دست‌کم ۱۲ نویسه است.\n" });
    const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const camp = (await w.p.km.client.post(`${P()}/r/kb_attestation`, { article_id: policy.id, title: "مطالعهٔ سیاست گذرواژه", target_users: [w.p.req.userId, w.p.req2.userId], due_at: due })).row;
    expect((await w.p.req.client.get(`${P()}/knowledge/attestations/mine`)).items).toEqual([]); // a draft campaign asks nobody
    await w.p.km.client.post(`${P()}/r/kb_attestation/${camp.id}/transition`, { to: "active" });
    await w.drain();
    const mine = (await w.p.req.client.get(`${P()}/knowledge/attestations/mine`)).items;
    expect(mine.map((x: any) => x.id)).toContain(camp.id);
    const view = await w.p.req.client.get(`${P()}/knowledge/articles/${policy.id}/read`);
    expect(view.can.attest).toBe(true);
    await w.p.req.client.post(`${P()}/knowledge/attestations/${camp.id}/ack`, {});
    const st = await w.p.km.client.get(`${P()}/knowledge/attestations/${camp.id}/status`);
    expect(st.audience).toBe(2);
    expect(st.acknowledged).toBe(1);
    expect(st.pending).toEqual([w.p.req2.userId]);
    expect(await statusOf(w.p.req.client, "GET", `${P()}/knowledge/attestations/${camp.id}/status`)).toBe(404);
  });
});

describe("quality loop and the manager's screens", () => {
  it("finds near-duplicates and merges them by retiring one with the other as replacement", async () => {
    const one = await w.published({ title: "تنظیم ایمیل در گوشی اندروید", summary: "افزودن حساب ایمیل سازمانی به گوشی اندروید", body: "## گام‌ها\n\n1. برنامهٔ ایمیل را باز کنید\n2. حساب تازه بسازید\n3. نشانی سرور را بنویسید\n4. نام کاربری و گذرواژه را بنویسید\n" });
    const two = await w.published({ title: "تنظیم ایمیل روی گوشی اندروید", summary: "افزودن حساب ایمیل سازمانی به گوشی اندرویدی", body: "## گام‌ها\n\n1. برنامهٔ ایمیل را باز کنید\n2. حساب تازه بسازید\n3. نشانی سرور را بنویسید\n4. نام کاربری و گذرواژه را بنویسید\n" });
    await kbSweep(w.sys, { daily: true });
    const dups = (await w.o.get(`${P()}/r/kb_duplicate?size=50`)).rows;
    const d = dups.find((x: any) => [x.article_a, x.article_b].sort().join() === [one.id, two.id].sort().join());
    expect(d).toBeTruthy();
    const keep = d.article_a === one.id ? "a" : "b";
    await w.p.km.client.post(`${P()}/knowledge/duplicates/${d.id}/merge`, { keep });
    const gone = (await w.o.get(`${P()}/r/kb_article/${two.id}`)).row;
    expect(gone.state).toBe("retired");
    expect(gone.replaced_by).toBe(one.id);
  });

  it("scores health and proposes the next action", async () => {
    await kbSweep(w.sys, { daily: true });
    const a = (await w.o.get(`${P()}/r/kb_article/${wifi.id}`)).row;
    expect(typeof a.health_score).toBe("number");
    expect(a.next_action).toBeTruthy();
  });

  it("the dashboard and the workspace, with the caller's access", async () => {
    const d = await w.p.km.client.get(`${P()}/knowledge/dashboard?days=90`);
    expect(d.totals.published).toBeGreaterThanOrEqual(5);
    expect(d.search.searches).toBeGreaterThan(0);
    expect(d.zero.some((z: any) => z.query.includes(searchForm("کارت‌خوان")))).toBe(true);
    const ws = await w.p.km.client.get(`${P()}/knowledge/workspace`);
    expect(ws.cards.length).toBeGreaterThan(0);
    expect(Array.isArray(ws.routines)).toBe(true);
    // the dashboard is the agents' (counted with their own access); requesters have none
    expect(await statusOf(w.p.req.client, "GET", `${P()}/knowledge/dashboard?days=90`)).toBe(403);
    const od = await w.p.other.client.get(`${P()}/knowledge/dashboard?days=90`);
    expect(od.totals.drafts).toBeLessThan(d.totals.drafts);
  });

  it("the known-error article is internal and follows its known error", async () => {
    const ke = (await w.o.post(`${P()}/r/known_error`, { short_description: "قطع شدن VPN پس از ۳۰ دقیقه", symptoms: "اتصال پس از نیم ساعت می‌افتد", root_cause: "زمان‌سنج بیکاری سرور", workaround: "گزینهٔ نگه‌داشتن اتصال را روشن کنید" })).row;
    const r = await w.p.agent.client.post(`${P()}/knowledge/known-errors/${ke.id}/article`, {});
    expect(r.article.article_type).toBe("known_error");
    expect(r.article.known_error_id).toBe(ke.id);
    expect(r.article.confidential).toBe(true);
    const again = await w.p.agent.client.post(`${P()}/knowledge/known-errors/${ke.id}/article`, {});
    expect(again.existing).toBe(true);
  });
});
