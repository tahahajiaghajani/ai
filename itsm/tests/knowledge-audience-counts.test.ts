// The knowledge home's article counts per base and category are cached for a minute per AUDIENCE SET
// (src/server/modules/knowledge/dashboard.ts, PERFORMANCE_FA.md «دور دوم»): the key is the article read predicate
// itself, so people share counts only when the same rule decides what they read; whoever an audience row names
// (a narrowed reader, a denied person, an author…) gets counts of their own; publishing, retiring and audience changes
// recount at once. Counts are never shared across audiences: each person's counts equal what they may read.
import { describe, it, expect, beforeAll } from "vitest";
import { kbWorld, type KbWorld } from "./knowledge-helpers";
import { audienceCountStats, clearAudienceCounts } from "@server/modules/knowledge";
import type { Client } from "./helpers";

let w: KbWorld;
let req3: { client: Client; userId: string };
let narrow: Record<string, any>;
let deniedBase = "";
const P = () => w.P;

/** The knowledge home's article count of a base, as `c` gets it. */
async function homeCount(c: Client, base: string): Promise<number> {
  const home = await c.get(`${P()}/knowledge/home`);
  return Number(home.bases.find((b: { id: string }) => b.id === base)?.article_count ?? 0);
}

/** What `c` may read of a base's live articles, through the generic list (the engine's own predicate). */
async function readable(c: Client, base: string): Promise<number> {
  const filter = { and: [{ f: "base_id", op: "eq", v: base }, { f: "state", op: "in", v: ["published", "pending_retirement"] }] };
  return Number((await c.get(`${P()}/r/kb_article?size=1&total=true&filter=${encodeURIComponent(JSON.stringify(filter))}`)).total ?? 0);
}

beforeAll(async () => {
  w = await kbWorld();
  req3 = await w.e.member("member", "kb-req3@example.com");
  await w.o.put(`${P()}/access/members/${req3.userId}`, { roles: ["requester"], persona: "requester" });
  await w.published({ title: "تنظیم امضای ایمیل", summary: "امضای سازمانی", body: "## گام‌ها\n\n1. تنظیمات\n" });
  await w.published({ title: "اتصال به شبکهٔ بی‌سیم", summary: "شبکهٔ مهمان", body: "## گام‌ها\n\n1. شبکه\n" });
  narrow = await w.published({ title: "راهنمای ویژهٔ مدیران", summary: "فقط برای یک نفر", body: "## گام‌ها\n\n1. ویژه\n" });
  await w.p.km.client.patch(`${P()}/r/kb_article/${narrow.id}`, { audience_mode: "narrow", read_users: [w.p.req2.userId] });
  deniedBase = (await w.o.post(`${P()}/r/kb_base`, { name: "راهنمای پیمانکاران", kind: "external", read_mode: "everyone", publish_approval: false, deny_users: [w.p.req2.userId], manager_group_id: w.g.managers })).row.id;
  await w.published({ base_id: deniedBase, title: "ورود پیمانکاران", summary: "کارت ورود", body: "## گام‌ها\n\n1. کارت\n" });
  await w.drain();
}, 180_000);

describe("knowledge counts per audience", () => {
  it("equal what each person may read (never another audience's)", async () => {
    clearAudienceCounts();
    for (const who of [w.p.req.client, w.p.req2.client, req3.client, w.p.agent.client, w.p.km.client]) {
      for (const base of [w.bases.guide, deniedBase]) expect(await homeCount(who, base)).toBe(await readable(who, base));
    }
    // the narrowed reader sees one more in the guide; the denied person nothing of the contractors' base
    expect(await homeCount(w.p.req2.client, w.bases.guide)).toBe((await homeCount(w.p.req.client, w.bases.guide)) + 1);
    expect(await homeCount(w.p.req2.client, deniedBase)).toBe(0);
    expect(await homeCount(w.p.req.client, deniedBase)).toBe(1);
  });

  it("are computed once for people of the same audience and separately for anyone a row names", async () => {
    clearAudienceCounts();
    const { computed, served } = audienceCountStats;
    await homeCount(w.p.req.client, w.bases.guide);
    expect(audienceCountStats.computed).toBe(computed + 1);
    // another plain requester: the same predicate decides what they read — the same counts, from the cache
    await homeCount(req3.client, w.bases.guide);
    expect(audienceCountStats.computed).toBe(computed + 1);
    expect(audienceCountStats.served).toBe(served + 1);
    // req2 is named (a narrowed reader, a denied person): counts of their own
    await homeCount(w.p.req2.client, w.bases.guide);
    expect(audienceCountStats.computed).toBe(computed + 2);
    // an agent has another rule altogether
    await homeCount(w.p.agent.client, w.bases.guide);
    expect(audienceCountStats.computed).toBe(computed + 3);
  });

  it("recount at once when an audience changes or an article is published or retired", async () => {
    const before = await homeCount(w.p.req.client, w.bases.guide);
    await w.p.km.client.patch(`${P()}/r/kb_article/${narrow.id}`, { audience_mode: "inherit" });
    expect(await homeCount(w.p.req.client, w.bases.guide)).toBe(before + 1);
    expect(await homeCount(req3.client, w.bases.guide)).toBe(before + 1);
    await w.published({ title: "بازنشانی گذرواژه", summary: "گذرواژهٔ فراموش‌شده", body: "## گام‌ها\n\n1. بازنشانی\n" });
    expect(await homeCount(w.p.req.client, w.bases.guide)).toBe(before + 2);
    expect(await homeCount(w.p.req.client, w.bases.guide)).toBe(await readable(w.p.req.client, w.bases.guide));
  });
});
