// Knowledge articles that say the same thing (docs/spec/AI.md §13.4): the semantic pass compares published articles of
// one base by the organisation's embedding model (the vectors the AI index holds) and proposes the close pairs as
// `kb_duplicate` rows «معنایی» — once, for the knowledge staff — and proposes nothing without an embedding model.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runModel } from "@server/modules/ai/ml/jobs";
import { semanticKbDuplicates } from "@server/modules/ai/ml/kbdup";
import { kbWorld, type KbWorld } from "./knowledge-helpers";

const before = process.env.ITSM_AI_FAKE;
let w: KbWorld;
const steps = "## گام‌ها\n\n1. برنامهٔ ایمیل را باز کنید\n2. حساب تازه بسازید\n3. نشانی سرور را بنویسید\n4. نام کاربری و گذرواژه را بنویسید\n";

beforeAll(async () => {
  process.env.ITSM_AI_FAKE = "1";
  w = await kbWorld();
}, 180_000);

afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

describe("semantic duplicates of knowledge articles", () => {
  it("proposes nothing without an embedding model", async () => {
    const r = await semanticKbDuplicates(w.sys, 0.9);
    expect(r.pairs).toBe(0);
    expect(r.note).toMatch(/بردارسازی/);
  });

  it("proposes the articles of one base that say the same, once, to the knowledge staff only", async () => {
    await w.o.post(`${w.P}/ai/connections`, { preset: "fake", embed: { model: "fake-embed", dims: 64 } });
    const one = await w.published({ title: "تنظیم ایمیل در گوشی اندروید", summary: "افزودن حساب ایمیل سازمانی به گوشی اندروید", body: steps });
    const two = await w.published({ title: "تنظیم ایمیل روی گوشی اندروید", summary: "افزودن حساب ایمیل سازمانی به گوشی اندرویدی", body: steps });
    const other = await w.published({ title: "تعویض کارتریج چاپگر طبقهٔ دوم", summary: "جایگزینی کارتریج تمام‌شدهٔ چاپگر", body: "## گام‌ها\n\n1. درِ چاپگر را باز کنید\n2. کارتریج کهنه را بیرون بکشید\n3. کارتریج نو را جا بیندازید\n" });
    await w.o.get(`${w.P}/ai/ml/models`); // queues the organisation's ML tick, which keeps the registry
    await w.drain(); // the AI index embeds the articles' chunks with the organisation's model
    // the knowledge module's text pass may have found the pair already: start from none
    await w.e.db.query(`delete from sm_kb_duplicates where org_id = $1`, [w.e.org]);
    const r = (await runModel(w.e.cfg, w.e.org, "duplicate:kb_article", { force: true })) as { pairs: number; note: string | null };
    expect(r.note).toBeNull();
    expect(r.pairs).toBeGreaterThanOrEqual(1);
    const rows = (await w.o.get(`${w.P}/r/kb_duplicate?size=50`)).rows as { article_a: string; article_b: string; method: string; similarity: number }[];
    const pair = rows.find((x) => [x.article_a, x.article_b].sort().join() === [one.id, two.id].sort().join());
    expect(pair).toMatchObject({ method: "semantic" });
    expect(pair!.similarity).toBeGreaterThanOrEqual(90);
    expect(rows.some((x) => x.article_a === other.id || x.article_b === other.id)).toBe(false);
    // again: nothing new to propose
    expect(((await semanticKbDuplicates(w.sys, 0.9)) as { pairs: number }).pairs).toBe(0);
    // the registry row tells the administrator what the pass did
    const { models } = await w.o.get(`${w.P}/ai/ml/models`);
    expect(models.find((m: { key: string }) => m.key === "duplicate:kb_article")).toMatchObject({ kind: "duplicate", status: "ready" });
    // requesters never see the proposals
    const theirs = await w.p.req.client.req("GET", `${w.P}/r/kb_duplicate?size=50`, undefined, undefined as never).catch(() => ({ rows: [] }));
    expect(((theirs as { rows?: unknown[] }).rows ?? []).length).toBe(0);
  });
});
