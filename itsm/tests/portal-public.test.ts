// What the portal publishes without sign-in, and nothing else (an anonymous visitor): public knowledge (KB-031) —
// only live, «عمومی» articles of bases open to every reader, as a projection without ids, numbers or people, named
// by opaque slugs; the website widget — its script and configuration, and guest searches from its allowed sites
// only; a survey's signed single-use link. Publishing is the knowledge approvers' and administrators' alone.
import { beforeAll, describe, expect, it } from "vitest";
import { surveyToken } from "@server/modules/portal";
import { idOfSlug, slugOf } from "@server/modules/portal";
import { portalWorld, statusOf, type PortalWorld } from "./portal-helpers";

let w: PortalWorld;
let guide = "";
let agentsBase = "";
let pub: Record<string, any>;
let open: Record<string, any>;
let internal: Record<string, any>;
let agentsOnly: Record<string, any>;
let token = "";

async function published(base: string, data: Record<string, unknown>): Promise<Record<string, any>> {
  const r = await w.p.km.client.post(`${w.P}/knowledge/articles`, { base_id: base, title: "مقاله", body: "## گام‌ها\n\n1. یک", ...data });
  const v = (await w.p.km.client.post(`${w.P}/knowledge/versions/${r.version.id}/submit`, {})).row;
  if (v.state === "in_review") {
    const mine = (await w.o.get(`${w.P}/approvals/mine`)).approvals as { id: string; record_id: string }[];
    const a = mine.find((x) => x.record_id === r.version.id);
    if (a) await w.o.post(`${w.P}/approvals/${a.id}/decide`, { decision: "approved" });
  }
  await w.drain();
  return (await w.o.get(`${w.P}/r/kb_article/${r.article.id}`)).row;
}

beforeAll(async () => {
  w = await portalWorld();
  const bases = (await w.o.get(`${w.P}/r/kb_base?size=50`)).rows as { id: string; name: string }[];
  guide = bases.find((b) => b.name === "راهنمای کاربران")!.id;
  agentsBase = bases.find((b) => b.name === "دانش کارشناسان")!.id;
  open = await published(guide, { title: "تغییر گذرواژهٔ ایمیل", summary: "گام‌های تغییر گذرواژه", body: "## گام‌ها\n\n1. به نشانی پست بروید\n2. «تغییر گذرواژه» را بزنید\n\n![تصویر صفحه](attachment:0f5a1b2c-3d4e-4f60-8a7b-9c0d1e2f3a4b)", internal_body: "رمز مدیر: hunter2" });
  internal = await published(guide, { title: "تنظیم چاپگر طبقهٔ دوم", body: "## گام‌ها\n\n1. نشانی داخلی چاپگر را وارد کنید" });
  agentsOnly = await published(agentsBase, { title: "تنظیم سرور چاپ گذرواژه", article_type: "how_to", body: "## گام‌ها\n\n1. فقط کارشناسان" });
  await w.p.km.client.patch(`${w.P}/r/kb_article/${open.id}`, { classification: "public", version: open.version });
  await w.p.km.client.patch(`${w.P}/r/kb_article/${agentsOnly.id}`, { classification: "public", version: agentsOnly.version });
  pub = (await w.p.km.client.post(`${w.P}/r/portal_kb_publication`, { name: "راهنمای عمومی", bases: [guide, agentsBase], title: "مرکز راهنمای سازمان" })).row;
}, 150_000);

describe("publishing", () => {
  it("is for knowledge approvers and administrators only", async () => {
    expect(await statusOf(w.p.req.client, "POST", `${w.P}/portal/public-kb/${pub.id}`, { enabled: true })).toBe(403);
    expect(await statusOf(w.p.agent.client, "POST", `${w.P}/portal/public-kb/${pub.id}`, { enabled: true })).toBe(403);
    expect(await statusOf(w.p.agent.client, "POST", `${w.P}/r/portal_kb_publication`, { name: "دور زدن", bases: [guide] })).toBe(403);
    const r = await w.p.km.client.post(`${w.P}/portal/public-kb/${pub.id}`, { enabled: true });
    expect(r.enabled).toBe(true);
    token = String(r.url).split("/").pop()!;
    expect(token.length).toBeGreaterThanOrEqual(24);
    const list = await w.p.km.client.get(`${w.P}/portal/public-kb`);
    const bases = list.publications[0].bases as { name: string; public: boolean; articles: number; held_back: number }[];
    expect(bases.find((b) => b.name === "راهنمای کاربران")).toMatchObject({ public: true, articles: 1 });
    expect(bases.find((b) => b.name === "دانش کارشناسان")).toMatchObject({ public: false, articles: 0 });
  });
});

describe("an anonymous visitor", () => {
  it("reads only the public articles, as a projection", async () => {
    const home = await w.anon.get(`/public/portal/kb/${token}`);
    expect(home.title).toBe("مرکز راهنمای سازمان");
    expect(home.bases.map((b: { name: string }) => b.name)).toEqual(["راهنمای کاربران"]);
    const titles = [...home.popular, ...home.recent].map((a: { title: string }) => a.title);
    expect(titles).toContain("تغییر گذرواژهٔ ایمیل");
    expect(titles).not.toContain("تنظیم چاپگر طبقهٔ دوم");
    expect(titles).not.toContain("تنظیم سرور چاپ گذرواژه");
    const text = JSON.stringify(home);
    for (const hidden of [open.id, open.number, guide, w.p.km.userId]) expect(text).not.toContain(String(hidden));
    const slug = home.popular.find((a: { title: string }) => a.title === "تغییر گذرواژهٔ ایمیل").slug;
    const a = await w.anon.get(`/public/portal/kb/${token}/a/${slug}`);
    expect(a.body).toContain("تغییر گذرواژه");
    expect(a.body).toContain("(تصویر: تصویر صفحه)");
    const at = JSON.stringify(a);
    for (const hidden of ["hunter2", "attachment:", open.id, String(open.number)]) expect(at).not.toContain(hidden);
  });

  it("searches only what is public", async () => {
    const s = await w.anon.get(`/public/portal/kb/${token}/search?q=${encodeURIComponent("گذرواژه")}`);
    expect(s.hits.map((h: { title: string }) => h.title)).toEqual(["تغییر گذرواژهٔ ایمیل"]);
    const none = await w.anon.get(`/public/portal/kb/${token}/search?q=${encodeURIComponent("چاپگر")}`);
    expect(none.hits).toHaveLength(0);
  });

  it("cannot reach an article that is not public by forging a slug", async () => {
    expect(await statusOf(w.anon, "GET", `/public/portal/kb/${token}/a/${slugOf(w.e.cfg.secret, token, internal.id)}`)).toBe(404);
    expect(await statusOf(w.anon, "GET", `/public/portal/kb/${token}/a/${slugOf(w.e.cfg.secret, token, agentsOnly.id)}`)).toBe(404);
    expect(await statusOf(w.anon, "GET", `/public/portal/kb/${token}/a/AAAAAAAAAAAAAAAAAAAAAA`)).toBe(404);
    expect(idOfSlug(w.e.cfg.secret, token, slugOf(w.e.cfg.secret, token, open.id))).toBe(open.id);
    // a slug of another publication's key means nothing here
    expect(idOfSlug(w.e.cfg.secret, "another-token-of-24-chars-x", slugOf(w.e.cfg.secret, token, open.id))).not.toBe(open.id);
  });

  it("never reaches the organisation's API, and loses the page when publishing stops", async () => {
    expect(await statusOf(w.anon, "GET", `${w.P}/portal/home`)).toBe(401);
    expect(await statusOf(w.anon, "GET", `${w.P}/portal/items`)).toBe(401);
    await w.anon.post(`/public/portal/kb/${token}/a/${(await w.anon.get(`/public/portal/kb/${token}`)).popular[0].slug}/vote`, { helpful: true });
    await w.p.km.client.post(`${w.P}/portal/public-kb/${pub.id}`, { enabled: false });
    expect(await statusOf(w.anon, "GET", `/public/portal/kb/${token}`)).toBe(404);
    // a new link: the old address and its slugs are gone
    const again = await w.p.km.client.post(`${w.P}/portal/public-kb/${pub.id}`, { enabled: true, regenerate: true });
    token = String(again.url).split("/").pop()!;
    expect((await w.anon.get(`/public/portal/kb/${token}`)).popular.length).toBe(1);
  });
});

describe("the website widget", () => {
  let key = "";
  it("serves its script and configuration, and searches for allowed sites only", async () => {
    const widget = await w.o.post(`${w.P}/r/portal_widget`, { name: "سایت اصلی", allowed_origins: ["https://www.example.com/"], publication_id: pub.id });
    expect(widget.row.allowed_origins).toEqual(["https://www.example.com"]);
    await w.o.post(`${w.P}/r/portal_widget`, { name: "بد", allowed_origins: ["javascript:alert(1)"] }, 400);
    key = (await w.o.post(`${w.P}/portal/widgets/${widget.row.id}/key`, {})).key;
    const js = await w.e.app.fetch(new Request(`http://local.test/api/public/portal/widget/${key}.js`));
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(await js.text()).toContain("attachShadow");
    const cfg = await w.anon.get(`/public/portal/widget/${key}/config`);
    expect(cfg).toMatchObject({ search: true, title: "راهنما و پشتیبانی" });
    expect(cfg.chat_url).toContain(`/${w.e.org}/portal/chat`);
    const ask = (origin: string | null) =>
      w.e.app.fetch(new Request(`http://local.test/api/public/portal/widget/${key}/search?q=${encodeURIComponent("گذرواژه")}`, { headers: origin ? { origin } : {} }));
    expect((await ask("https://evil.example")).status).toBe(403);
    expect((await ask(null)).status).toBe(403);
    const ok = await ask("https://www.example.com");
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.hits.map((h: { title: string }) => h.title)).toEqual(["تغییر گذرواژهٔ ایمیل"]);
    expect(body.hits[0].url).toContain(`/p/kb/${token}/a/`);
  });

  it("is set up only by connector administrators", async () => {
    expect(await statusOf(w.p.sdm.client, "POST", `${w.P}/r/portal_widget`, { name: "x", allowed_origins: ["https://a.example"] })).toBe(403);
  });
});

describe("a survey's signed link", () => {
  it("opens the invitation without sign-in, once, and refuses forged tokens", async () => {
    const inc = await w.incident(w.p.req.client, { short_description: "تلفن کار نمی‌کند" });
    await w.o.post(`${w.P}/r/incident/${inc.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "تلفن تعویض شد" } });
    await w.drain();
    const inv = (await w.p.req.client.get(`${w.P}/portal/todo`)).surveys[0];
    const t = surveyToken(w.e.cfg, w.e.org, inv.id);
    const view = await w.anon.get(`/public/portal/survey/${t}`);
    expect(view.record).toBeNull();
    expect(JSON.stringify(view)).not.toContain(String(inc.number));
    const forged = `${t.slice(0, -3)}abc`;
    expect(await statusOf(w.anon, "GET", `/public/portal/survey/${forged}`)).toBe(404);
    const other = surveyToken(w.e.cfg, w.e.org, "0f5a1b2c-3d4e-4f60-8a7b-9c0d1e2f3a4b");
    expect(await statusOf(w.anon, "GET", `/public/portal/survey/${other}`)).toBe(404);
    const q = view.questions.find((x: { metric: string }) => x.metric === "csat");
    await w.anon.post(`/public/portal/survey/${t}`, { answers: { [q.id]: 2 } });
    expect(await statusOf(w.anon, "POST", `/public/portal/survey/${t}`, { answers: { [q.id]: 5 } })).toBe(409);
    expect((await w.o.get(`${w.P}/r/incident/${inc.id}`)).row.satisfaction).toBe(2);
  });
});
