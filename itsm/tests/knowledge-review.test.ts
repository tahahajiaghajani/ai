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

