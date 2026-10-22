import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data?: unknown; error: { message: string; code?: string } | null; count?: number | null };

// A fake Supabase client: records inserts/updates, answers each query with the next queued result.
const h = vi.hoisted(() => ({ rows: [] as unknown[], queue: [] as Result[] }));

vi.mock("@/lib/db", () => {
  const client = {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "lte", "order", "limit", "single", "maybeSingle", "upsert", "delete"]) q[m] = () => q;
      q.insert = (row: unknown) => (h.rows.push(row), q);
      q.update = (row: unknown) => (h.rows.push(row), q);
      q.then = (ok: (r: Result) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(h.queue.shift() ?? { data: null, error: null }).then(ok, fail);
      return q;
    },
  };
  return { db: () => client, requireDb: () => client };
});
vi.mock("@/lib/admin-auth", () => ({ assertAdmin: async () => {} }));
vi.mock("@/lib/knowledge", () => ({ getKnowledge: async () => ({ entries: [] }) }));
vi.mock("@/lib/ai/runtime", () => ({ getRuntime: async () => ({}), complete: vi.fn(), knowledgeBlock: () => "", parseJsonObject: (t: string) => JSON.parse(t) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));

import { draftPost, savePost, type PostInput } from "@/app/actions/blog";
import { complete } from "@/lib/ai/runtime";
import { getBlog } from "@/lib/blog";
import { STARTER_POSTS } from "@/lib/blog-starter";

const input = (o: Partial<PostInput> = {}): PostInput => ({ lang: "fa", slug: "", title: "عنوان", excerpt: "", body: "متن", cover_url: "", tags: [], status: "published", published_at: "", ...o });

beforeEach(() => {
  h.rows = [];
  h.queue = [];
  vi.mocked(complete).mockReset();
});

describe("savePost", () => {
  it("returns the stored publish date, so saving again keeps it", async () => {
    h.queue.push({ data: { id: "11111111-1111-1111-1111-111111111111", published_at: "2026-10-01T08:00:00.000Z" }, error: null });
    const r = await savePost(input());
    expect(r).toMatchObject({ ok: true, published_at: "2026-10-01T08:00:00.000Z" });
  });
  it("drops repeated tags", async () => {
    h.queue.push({ data: { id: "11111111-1111-1111-1111-111111111111", published_at: null }, error: null });
    await savePost(input({ status: "draft", tags: ["PMO", "EPM", "PMO", " "] }));
    expect((h.rows[0] as { tags: string[] }).tags).toEqual(["PMO", "EPM"]);
  });
});

describe("draftPost", () => {
  it("refuses a body that is not text instead of blanking the editor", async () => {
    vi.mocked(complete).mockResolvedValue({ text: JSON.stringify({ excerpt: "x", tags: [], body: ["## a", "b"] }) } as never);
    expect(await draftPost({ lang: "fa", title: "عنوان", notes: "" })).toMatchObject({ ok: false });
  });
  it("returns a text body with unique tags", async () => {
    vi.mocked(complete).mockResolvedValue({ text: JSON.stringify({ excerpt: "x", tags: ["PMO", "PMO", 3], body: "## a\n\nb" }) } as never);
    expect(await draftPost({ lang: "fa", title: "عنوان", notes: "" })).toMatchObject({ ok: true, body: "## a\n\nb", tags: ["PMO"] });
  });
});

describe("getBlog", () => {
  const phase = process.env.NEXT_PHASE;
  beforeEach(() => {
    delete process.env.NEXT_PHASE;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterAll(() => {
    if (phase === undefined) delete process.env.NEXT_PHASE;
    else process.env.NEXT_PHASE = phase;
  });

  it("shows the starter articles while the table is missing or empty", async () => {
    h.queue.push({ data: null, error: { message: "missing", code: "PGRST205" } }, { error: { message: "missing", code: "PGRST205" }, count: null });
    expect((await getBlog()).source).toBe("starter");
    h.queue.push({ data: [], error: null }, { error: null, count: 0 });
    expect((await getBlog()).posts).toHaveLength(STARTER_POSTS.length);
  });
  it("rethrows other read errors at runtime, so the last good pages stay cached", async () => {
    h.queue.push({ data: null, error: { message: "fetch failed" } }, { error: null, count: 3 });
    await expect(getBlog()).rejects.toThrow(/blog_read_failed/);
  });
  it("falls back to the starter articles during the build, so an outage cannot fail a deploy", async () => {
    process.env.NEXT_PHASE = "phase-production-build";
    h.queue.push({ data: null, error: { message: "fetch failed" } }, { error: null, count: 3 });
    expect((await getBlog()).source).toBe("starter");
  });
  it("lists only the database posts once the table has rows", async () => {
    h.queue.push({ data: [{ id: "a", lang: "fa", slug: "x" }], error: null }, { error: null, count: 2 });
    expect(await getBlog()).toEqual({ posts: [{ id: "a", lang: "fa", slug: "x" }], source: "db" });
  });
});
