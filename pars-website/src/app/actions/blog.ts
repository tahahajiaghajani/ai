"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import type { AdminResult } from "@/app/actions/admin";
import { guard, str } from "@/lib/admin-action";
import { complete, getRuntime, knowledgeBlock, parseJsonObject } from "@/lib/ai/runtime";
import { isSlug, slugify, type PostLang, type PostStatus } from "@/lib/blog-shared";
import { STARTER_POSTS } from "@/lib/blog-starter";
import { requireDb } from "@/lib/db";
import { getKnowledge } from "@/lib/knowledge";
import { selectKnowledge } from "@/lib/retrieval";

export interface PostInput {
  id?: string;
  lang: PostLang;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  cover_url: string;
  tags: string[];
  status: PostStatus;
  /** ISO date; empty = now when publishing */
  published_at: string;
}

function refreshBlog() {
  revalidateTag("blog", { expire: 0 });
  revalidatePath("/", "layout");
}

const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

export async function savePost(input: PostInput): Promise<AdminResult<{ id: string; slug: string; published_at: string | null }>> {
  return guard(async () => {
    const lang: PostLang = input.lang === "en" ? "en" : "fa";
    const status: PostStatus = input.status === "published" ? "published" : "draft";
    const title = str(input.title, 200);
    if (!title) return { ok: false, error: "عنوان الزامی است." };
    const slug = str(input.slug, 80) ? slugify(str(input.slug, 120)) : slugify(title);
    if (!isSlug(slug)) return { ok: false, error: "نشانی (slug) معتبر نیست؛ فقط حروف، عدد و خط تیره." };
    const cover = str(input.cover_url, 600);
    if (cover && !/^https:\/\//i.test(cover)) return { ok: false, error: "نشانی تصویر باید با https:// شروع شود." };
    const when = str(input.published_at, 40);
    const at = when ? new Date(when) : null;
    if (at && Number.isNaN(at.getTime())) return { ok: false, error: "تاریخ انتشار معتبر نیست." };
    const row = {
      lang,
      slug,
      title,
      excerpt: str(input.excerpt, 400),
      body: str(input.body, 100000),
      cover_url: cover,
      tags: [...new Set((Array.isArray(input.tags) ? input.tags : []).map((t) => str(t, 40)).filter(Boolean))].slice(0, 10),
      status,
      published_at: status === "published" ? (at ?? new Date()).toISOString() : at ? at.toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    const c = requireDb();
    const q = isId(input.id) ? c.from("pars_posts").update(row).eq("id", input.id).select("id, published_at").single() : c.from("pars_posts").insert(row).select("id, published_at").single();
    const { data, error } = await q;
    if (error) {
      if (error.code === "23505") return { ok: false, error: "این نشانی (slug) در همین زبان قبلاً استفاده شده است." };
      if (error.code === "42P01" || error.code === "PGRST205") return { ok: false, error: "جدول وبلاگ هنوز ساخته نشده است؛ از «اتصالات» فایل SQL را اجرا کنید." };
      throw new Error(error.message);
    }
    refreshBlog();
    const saved = data as { id: string; published_at: string | null };
    // the editor takes the stored date back, so saving again does not move "now" forward
    return { ok: true, id: saved.id, slug, published_at: saved.published_at, message: status === "published" ? "نوشته منتشر شد." : "پیش‌نویس ذخیره شد." };
  });
}

export async function deletePost(id: string): Promise<AdminResult> {
  return guard(async () => {
    if (!isId(id)) return { ok: false, error: "شناسه معتبر نیست." };
    const { error } = await requireDb().from("pars_posts").delete().eq("id", id);
    if (error) throw new Error(error.message);
    refreshBlog();
    return { ok: true, message: "نوشته حذف شد." };
  });
}

/** Copies the starter articles into the database so they can be edited (existing slugs are kept). */
export async function loadStarterPosts(): Promise<AdminResult<{ count: number }>> {
  return guard(async () => {
    const rows = STARTER_POSTS.map(({ lang, slug, title, excerpt, body, cover_url, tags, status, published_at }) => ({ lang, slug, title, excerpt, body, cover_url, tags, status, published_at }));
    if (!rows.length) return { ok: false, error: "نوشته‌ی نمونه‌ای وجود ندارد." };
    const { data, error } = await requireDb().from("pars_posts").upsert(rows, { onConflict: "lang,slug", ignoreDuplicates: true }).select("id");
    if (error) throw new Error(error.message);
    refreshBlog();
    return { ok: true, count: data?.length ?? 0, message: `${new Intl.NumberFormat("fa-IR").format(data?.length ?? 0)} نوشته به پایگاه داده افزوده شد.` };
  });
}

/** A first draft from a title and notes, grounded in the company knowledge. The admin edits it before publishing. */
export async function draftPost(input: { lang: PostLang; title: string; notes: string }): Promise<AdminResult<{ body: string; excerpt: string; tags: string[] }>> {
  return guard(async () => {
    const title = str(input.title, 200);
    if (!title) return { ok: false, error: "اول عنوان نوشته را بنویسید." };
    const rt = await getRuntime();
    if (!rt) return { ok: false, error: "هوش مصنوعی تنظیم یا فعال نشده است (اتصالات → هوش مصنوعی)." };
    const notes = str(input.notes, 4000);
    const { entries } = await getKnowledge();
    const fa = input.lang !== "en";
    const system = `You write blog posts for the website of Pars Project Management (شرکت مدیریت پروژه پارس).
Every statement about Pars (clients, projects, numbers, products, people) must come from <knowledge>; never invent clients, numbers, features or promises. General project-management knowledge is fine.
${fa ? "Write fluent, natural modern Persian with correct half-spaces (نیم‌فاصله) and Persian digits; keep technical terms in English (EPM, EPPM, RAG, AI Agent, Primavera P6, Jira, PMO)." : "Write clear, natural English."}
Tone: concrete, calm, expert; short active sentences; no hype words.
Return ONLY a JSON object: {"excerpt": "1–2 sentences", "tags": ["3–5 short tags"], "body": "Markdown with ## and ### headings, paragraphs, - lists and **bold**; no H1, no tables, no HTML; 500–800 words"}.

<knowledge>
${knowledgeBlock(selectKnowledge(entries, `${title} ${notes}`, 16000))}
</knowledge>`;
    const user = `${fa ? "عنوان" : "Title"}: ${title}${notes ? `\n${fa ? "نکته‌ها" : "Notes"}: ${notes}` : ""}`;
    const { text } = await complete(rt, system, [{ role: "user", content: user }], { json: true, maxTokens: 3000 });
    const j = parseJsonObject<{ body?: unknown; excerpt?: unknown; tags?: unknown }>(text);
    // the editor replaces the admin's text with this body, so an empty or non-text body is an error
    const body = str(j?.body, 100000);
    if (!body) return { ok: false, error: "پاسخ مدل قابل استفاده نبود؛ دوباره امتحان کنید." };
    return {
      ok: true,
      body,
      excerpt: str(j?.excerpt, 400),
      tags: [...new Set((Array.isArray(j?.tags) ? (j.tags as unknown[]) : []).map((t) => str(t, 40)).filter(Boolean))].slice(0, 6),
      message: "پیش‌نویس آماده شد؛ پیش از انتشار بازبینی کنید.",
    };
  });
}
