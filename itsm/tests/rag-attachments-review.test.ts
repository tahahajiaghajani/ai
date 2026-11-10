// Regression of the AI index over knowledge attachments (KB-010, docs/spec/AI.md): the index answers only with files
// the attachments API would show the reader — the files the article's body shows, with the article's audience, and the
// files only its internal part shows, for agents (group «internal»); a file attached but shown by neither is never
// indexed. A table that narrows its files per reader (`filterSide`) indexes only the files its builder names.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kbWorld, type KbWorld } from "./knowledge-helpers";
import { upload } from "./engine-helpers";
import { orgSchema, systemCtx } from "@server/engine";
import { buildDocument } from "@server/modules/ai/rag/registry";

const before = process.env.ITSM_AI_FAKE;
afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

describe("knowledge attachments in the AI index", () => {
  let k: KbWorld;
  beforeAll(async () => {
    process.env.ITSM_AI_FAKE = "1";
    k = await kbWorld();
  }, 240_000);

  it("indexes only the files the article shows, each with the audience of the text that shows it", async () => {
    const article = await k.published({ title: "راه‌اندازی کنسول", body: "## گام‌ها\n\n1. کنسول را باز کنید\n" });
    const file = async (name: string, text: string) => {
      const res = await upload(k.e.app, k.p.km.client, `${k.P}/r/kb_article/${article.id}/attachments`, name, new TextEncoder().encode(text), "text/plain");
      expect(res.status).toBe(200);
      return ((await res.json()) as { attachment: { id: string } }).attachment.id;
    };
    const shown = await file("guide.txt", "راهنمای عمومی pubAttQ1");
    const internal = await file("internal.txt", "دستور داخلی intAttQ2");
    const hidden = await file("console.txt", "گزارش کنسول hidAttQ3");
    // the body shows the first file, the internal part the second; the third is attached but shown nowhere
    await k.e.db.query(`update sm_kb_articles set body = body || $2, internal_body = $3 where id = $1`, [article.id, `\n\n![راهنما](attachment:${shown})`, `پیوست داخلی attachment:${internal}`]);
    const sys = await systemCtx(k.e.cfg, k.e.org);
    const def = (await orgSchema(sys)).def("kb_article")!;
    const row = (await k.e.db.one<Record<string, unknown>>(`select * from sm_kb_articles where id = $1`, [article.id]))!;
    const doc = await buildDocument({ ctx: sys, q: k.e.db, def, row });
    const parts = (doc?.parts ?? []).filter((p) => p.field.startsWith("attachment:"));
    const of = (id: string) => parts.filter((p) => p.field === `attachment:${id}`);
    expect(of(shown).length).toBe(1);
    expect(of(shown)[0].text).toContain("pubAttQ1");
    expect(of(shown)[0].group ?? null).toBeNull(); // an article for requesters: its body's files answer them
    expect(of(internal).length).toBe(1);
    expect(of(internal)[0].group).toBe("internal"); // shown only by the internal part: agents only
    expect(of(hidden)).toEqual([]); // attached but shown nowhere: never indexed
    expect(JSON.stringify(doc)).not.toContain("hidAttQ3");
  });
});
