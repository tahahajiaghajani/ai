import "server-only";
import { unstable_cache } from "next/cache";
import { assertAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import type { Post, PostLang } from "@/lib/blog-shared";
import { STARTER_POSTS } from "@/lib/blog-starter";

const COLUMNS = "id, lang, slug, title, excerpt, body, cover_url, tags, status, published_at, updated_at";

type Blog = { posts: Post[]; source: "db" | "starter" };

const STARTER: Blog = { posts: STARTER_POSTS, source: "starter" };

const tableMissing = (e: { code?: string } | null) => ["42P01", "PGRST205"].includes(e?.code ?? "");

/** Published posts, newest first. The starter articles show only while the table is missing or holds no posts at all. */
async function loadBlog(): Promise<Blog> {
  const c = db();
  if (!c) return STARTER;
  const [published, all] = await Promise.all([
    c.from("pars_posts").select(COLUMNS).eq("status", "published").lte("published_at", new Date().toISOString()).order("published_at", { ascending: false }).limit(500),
    c.from("pars_posts").select("id", { count: "exact", head: true }),
  ]);
  if (tableMissing(published.error) || tableMissing(all.error)) return STARTER;
  if (published.error) throw new Error(`blog_read_failed: ${published.error.message}`);
  if (all.error) throw new Error(`blog_read_failed: ${all.error.message}`);
  if (!all.count) return STARTER;
  return { posts: (published.data ?? []) as Post[], source: "db" };
}

const cachedBlog = unstable_cache(loadBlog, ["pars-blog-v1"], { tags: ["blog"], revalidate: 300 });

/**
 * A failed read is never cached. At runtime it is rethrown, so ISR keeps serving the last good pages
 * (showing the starter articles instead would bring back deleted posts and 404 the real ones).
 * Only the build falls back to the starter articles, so a database outage cannot fail a deploy.
 */
export async function getBlog(): Promise<Blog> {
  try {
    return await cachedBlog();
  } catch (e) {
    if (process.env.NEXT_PHASE !== "phase-production-build") throw e;
    console.error("[blog]", e);
    return STARTER;
  }
}

export async function listPosts(lang: PostLang, limit?: number): Promise<Post[]> {
  const posts = (await getBlog()).posts.filter((p) => p.lang === lang);
  return limit ? posts.slice(0, limit) : posts;
}

export async function getPost(lang: PostLang, slug: string): Promise<Post | null> {
  let s = slug;
  try {
    s = decodeURIComponent(slug);
  } catch {
    // keep the raw value
  }
  return (await getBlog()).posts.find((p) => p.lang === lang && p.slug === s) ?? null;
}

/** Admin: every post in every state; `null` when the database is missing. Throws on a read error. */
export async function adminListPosts(): Promise<Post[] | null> {
  await assertAdmin();
  const c = db();
  if (!c) return null;
  const { data, error } = await c.from("pars_posts").select(COLUMNS).order("updated_at", { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as Post[];
}

export async function adminGetPost(id: string): Promise<Post | null> {
  await assertAdmin();
  const c = db();
  if (!c || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await c.from("pars_posts").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Post | null) ?? null;
}
