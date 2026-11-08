// Knowledge with the other modules, on real rows: the «دانش» panel of problems, changes, orders and requested items
// (suggestions from the record, attaching counts the reuse once per record), a KCS article from a resolved incident,
// deflection while ordering (suggest + «مشکلم حل شد» logged on the order channel), and the AI layer with every
// module's retrieval documents side by side: an unscoped retrieve / cited answer never returns a canary article of a
// base whose audience excludes the caller, nor a draft or a retired article to a plain reader.
import { beforeAll, describe, expect, it } from "vitest";
import { kbWorld, type KbWorld } from "./knowledge-helpers";
import { askWithCitations, retrieve } from "@server/modules/ai/rag";

let w: KbWorld;
const P = () => w.P;
let vpn: Record<string, any>;
let canaryBase = "";
let canary: Record<string, any>;
let retired: Record<string, any>;
let draft: Record<string, any>;

beforeAll(async () => {
  process.env.ITSM_AI_FAKE = "1";
  w = await kbWorld();
  const o = w.o;
  await o.post(`${P()}/ai/connections`, { preset: "fake", embed: { model: "fake-embed", dims: 32 } });
  // the other modules' defaults, as in an organisation with everything installed
  for (const m of ["cmdb", "service_portfolio", "change", "request"]) await o.post(`${P()}/${m}/seed`, {});
  vpn = await w.published({ title: "اتصال VPN از خانه", summary: "راه‌اندازی VPN سازمانی", body: "## گام‌ها\n\n1. برنامهٔ VPN را نصب کنید\n2. با نام کاربری سازمانی وارد شوید\n" });
  // a base only the HR agent may read, with a canary article
  canaryBase = (await o.post(`${P()}/r/kb_base`, { name: "پرونده‌های منابع انسانی", kind: "internal", read_mode: "audience", read_users: [w.p.hr.userId], publish_approval: false, manager_group_id: w.g.managers })).row.id;
  canary = await w.published({ base_id: canaryBase, title: "حقوق مدیران kbcanaryhr", summary: "kbcanaryhr", body: "## گام‌ها\n\n1. kbcanaryhrbody جدول حقوق\n" });
  retired = await w.published({ title: "راهنمای قدیمی kbcanaryold", summary: "قدیمی", body: "## گام‌ها\n\n1. kbcanaryoldbody\n" });
  await w.p.km.client.post(`${P()}/knowledge/articles/${retired.id}/retire`, { reason: "جایگزین شد" });
  draft = (await w.article({ title: "پیش‌نویس kbcanarydraft", body: "## گام‌ها\n\n1. kbcanarydraftbody\n" })).article;
  // records of other modules that the agent's index holds too
  await w.p.agent.client.post(`${P()}/r/incident`, { short_description: "VPN وصل نمی‌شود kbcanaryinc", assignment_group_id: w.g.desk });
  await w.drain();
}, 300_000);

describe("the «دانش» panel on other modules' records", () => {
  it("suggests and attaches articles on a problem, a change, an order and its requested item; the reuse counts per record", async () => {
    const o = w.o;
    const prb = (await w.p.agent.client.post(`${P()}/r/problem`, { short_description: "قطعی‌های تکراری VPN", assignment_group_id: w.g.desk })).row;
    const chg = (await o.post(`${P()}/r/change_request`, { short_description: "ارتقای درگاه VPN", type: "normal", description: "ارتقا" })).row;
    const order = await w.p.req.client.post(`${P()}/request/order`, { lines: [{ item_id: (await o.get(`${P()}/r/catalog_item?filter=${encodeURIComponent(JSON.stringify({ f: "code", op: "eq", v: "other_request" }))}`)).rows[0].id, answers: { subject: "VPN از خانه", details: "اتصال VPN برقرار نمی‌شود" } }] });
    const records: [string, string][] = [["problem", prb.id], ["change_request", chg.id], ["request", order.request.id], ["request_item", order.items[0].id]];
    for (const [table, id] of records) {
      const panel = await o.get(`${P()}/knowledge/records/${table}/${id}`);
      expect(panel.suggestions.map((s: any) => s.id), table).toContain(vpn.id);
      expect(panel.can.link, table).toBe(true);
      // never an article the caller may not read
      expect(panel.suggestions.map((s: any) => s.id), table).not.toContain(draft.id);
    }
    for (const [table, id] of records) await o.post(`${P()}/knowledge/records/${table}/${id}/attach`, { article_id: vpn.id, kind: "kb_solved_by" });
    await w.drain();
    expect((await o.get(`${P()}/r/kb_article/${vpn.id}`)).row.reuse_count).toBe(records.length);
    for (const [table, id] of records) {
      const panel = await o.get(`${P()}/knowledge/records/${table}/${id}`);
      expect(panel.linked.map((l: any) => l.article.id), table).toEqual([vpn.id]);
    }
    // the requester sees the article linked to their own order, but links nothing
    const mine = await w.p.req.client.get(`${P()}/knowledge/records/request/${order.request.id}`);
    expect(mine.can.link).toBe(false);
  });

  it("captures a KCS article from a resolved incident", async () => {
    const inc = (await w.p.agent.client.post(`${P()}/r/incident`, { short_description: "Outlook باز نمی‌شود", description: "پس از به‌روزرسانی", assignment_group_id: w.g.desk, assigned_to: w.p.agent.userId })).row;
    await w.p.agent.client.post(`${P()}/r/incident/${inc.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "نمایهٔ Outlook را دوباره ساختیم" } });
    const r = await w.p.agent.client.post(`${P()}/knowledge/capture`, { table: "incident", id: inc.id });
    expect(r.article).toMatchObject({ article_type: "kcs", source_number: inc.number });
    expect(r.version.body).toContain("نمایهٔ Outlook را دوباره ساختیم");
  });
});

describe("deflection while ordering (KB-050)", () => {
  it("suggests articles for the typed text and logs «مشکلم حل شد» on the order channel", async () => {
    const s = await w.p.req.client.post(`${P()}/knowledge/suggest`, { text: "اتصال VPN از خانه", session_id: "order-session-1", channel: "order" });
    expect(s.hits.map((h: any) => h.id)).toContain(vpn.id);
    for (const x of [canary, draft, retired]) expect(s.hits.map((h: any) => h.id)).not.toContain(x.id);
    await w.p.req.client.post(`${P()}/knowledge/deflect`, { article_id: vpn.id, query: "اتصال VPN از خانه", session_id: "order-session-1", channel: "order" });
    const ev = await w.e.db.query<{ kind: string; channel: string }>(`select kind, channel from sm_kb_events where org_id = $1 and session_id = $2 order by at`, [w.e.org, "order-session-1"]);
    expect(ev.map((e) => e.kind)).toEqual(expect.arrayContaining(["deflect"]));
    expect(ev.find((e) => e.kind === "deflect")?.channel).toBe("order");
  });
});

describe("knowledge in the AI layer, next to every module's documents", () => {
  const leaks = (text: string) => /kbcanary(hr|old|draft)/.test(text);

  it("an unscoped retrieve never returns the canary, a draft or a retired article to people outside them", async () => {
    for (const who of [w.p.req, w.p.agent, w.p.other]) {
      const ctx = await w.e.ctxOf(who.userId);
      const r = await retrieve(ctx, "kbcanaryhr kbcanaryhrbody kbcanaryold kbcanaryoldbody kbcanarydraft kbcanarydraftbody", { k: 30 });
      const ids = r.passages.map((p) => p.citation.id);
      for (const x of [canary, retired, draft]) expect(ids, who.userId).not.toContain(x.id);
      expect(r.passages.some((p) => leaks(p.text)), who.userId).toBe(false);
    }
    // the HR agent, inside the audience, finds the canary (the test discriminates)
    const hr = await retrieve(await w.e.ctxOf(w.p.hr.userId), "kbcanaryhr kbcanaryhrbody", { k: 10 });
    expect(hr.passages.map((p) => p.citation.id)).toContain(canary.id);
    // another module's documents are still found unscoped
    const agent = await retrieve(await w.e.ctxOf(w.p.agent.userId), "kbcanaryinc VPN", { k: 10 });
    expect(agent.passages.some((p) => p.citation.table === "incident")).toBe(true);
  });

  it("a cited answer cites nothing outside the caller's audiences", async () => {
    const ctx = await w.e.ctxOf(w.p.req.userId);
    const a = await askWithCitations(ctx, "kbcanaryhrbody و kbcanaryoldbody و kbcanarydraftbody چیست؟", {}, { k: 8 });
    const cited = [...a.citations.map((c) => c.id), ...a.passages.map((p) => p.citation.id)];
    for (const x of [canary, retired, draft]) expect(cited).not.toContain(x.id);
    expect(leaks(`${a.answer}\n${a.passages.map((p) => p.text).join("\n")}`)).toBe(false);
  });
});
