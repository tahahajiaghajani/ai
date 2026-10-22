"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deletePost, draftPost, loadStarterPosts, savePost } from "@/app/actions/blog";
import type { Post, PostLang, PostStatus } from "@/lib/blog-shared";
import { readingMinutes, slugify } from "@/lib/blog-shared";
import { ArticleBody } from "@/components/blog/article-body";
import { Button, Field, Input, Select, Spinner, Textarea } from "@/components/ui/field";
import { Empty, Panel } from "@/components/admin/ui";
import { useAction } from "@/components/admin/toast";
import { Icon } from "@/components/site/icons";

const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat("fa-IR-u-ca-persian", { dateStyle: "medium", timeZone: "Asia/Tehran" }).format(new Date(iso)) : "—");
const postHref = (p: Pick<Post, "lang" | "slug">) => `${p.lang === "en" ? "/en" : ""}/blog/${p.slug}`;

export function BlogList({ rows, error, starterCount }: { rows: Post[]; error: string; starterCount: number }) {
  const { pending, run } = useAction();
  if (error) {
    const missing = /pars_posts|does not exist|PGRST205|schema cache/i.test(error);
    return (
      <Empty>
        {missing ? (
          <>
            جدول وبلاگ هنوز در Supabase ساخته نشده است. از صفحه‌ی{" "}
            <Link href="/admin/connections" className="text-violet underline">
              اتصالات
            </Link>{" "}
            فایل SQL را کپی و اجرا کنید.
          </>
        ) : (
          <>خواندن نوشته‌ها ناموفق بود: {error}</>
        )}
      </Empty>
    );
  }
  return (
    <div className="space-y-4">
      {rows.length === 0 && (
        <Panel title="هنوز نوشته‌ای در پایگاه داده نیست">
          <p className="text-sm leading-7 text-muted">
            تا وقتی نوشته‌ای نسازید، {new Intl.NumberFormat("fa-IR").format(starterCount)} نوشته‌ی نمونه‌ی پارس در وبلاگ سایت نمایش داده می‌شود. برای ویرایش آن‌ها، اول به پایگاه داده منتقلشان کنید.
          </p>
          {starterCount > 0 && (
            <Button className="mt-4" variant="soft" disabled={pending} onClick={() => run(() => loadStarterPosts())}>
              {pending ? <Spinner /> : null} بارگذاری نوشته‌های نمونه برای ویرایش
            </Button>
          )}
        </Panel>
      )}
      {rows.length > 0 && (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.id} className="card flex items-center gap-3 p-4">
              <Link href={`/admin/blog/${r.id}`} className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold" dir="auto">
                    {r.title}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${r.status === "published" ? "bg-success/15 text-success" : "bg-white/[0.06] text-muted"}`}>{r.status === "published" ? "منتشرشده" : "پیش‌نویس"}</span>
                  <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-violet">{r.lang === "en" ? "English" : "فارسی"}</span>
                </span>
                <span className="mt-1 block text-xs text-faint">
                  {r.status === "published" ? `انتشار: ${fmt(r.published_at)}` : `آخرین ویرایش: ${fmt(r.updated_at)}`}
                </span>
              </Link>
              {r.status === "published" && (
                <a href={postHref(r)} target="_blank" rel="noreferrer" className="grid size-9 place-items-center rounded-full border border-line text-muted hover:text-fg" aria-label="دیدن در سایت">
                  <Icon name="external" className="size-4" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** ISO → value for <input type="datetime-local"> in the browser's time zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function BlogEditor({ post, lang }: { post: Post | null; lang: PostLang }) {
  const router = useRouter();
  const { pending, run } = useAction();
  const ai = useAction();
  const [d, setD] = useState({
    lang: post?.lang ?? lang,
    title: post?.title ?? "",
    slug: post?.slug ?? "",
    excerpt: post?.excerpt ?? "",
    body: post?.body ?? "",
    cover_url: post?.cover_url ?? "",
    tags: (post?.tags ?? []).join("، "),
    status: (post?.status ?? "draft") as PostStatus,
    published_at: toLocalInput(post?.published_at ?? null),
  });
  const [slugTouched, setSlugTouched] = useState(Boolean(post));
  const [preview, setPreview] = useState(false);
  const [notes, setNotes] = useState("");
  const dir = d.lang === "en" ? "ltr" : "rtl";
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });

  const save = (status: PostStatus) =>
    run(
      () =>
        savePost({
          id: post?.id,
          lang: d.lang,
          slug: d.slug,
          title: d.title,
          excerpt: d.excerpt,
          body: d.body,
          cover_url: d.cover_url,
          tags: d.tags.split(/[,،]/).map((x) => x.trim()).filter(Boolean),
          status,
          published_at: d.published_at ? new Date(d.published_at).toISOString() : "",
        }),
      {
        onOk: (r) => {
          setD((x) => ({ ...x, status, slug: r.slug, published_at: toLocalInput(r.published_at) }));
          if (!post) router.replace(`/admin/blog/${r.id}`);
        },
      },
    );

  const draft = () => {
    if (d.body.trim() && !window.confirm("متن فعلی با پیش‌نویس هوش مصنوعی جایگزین شود؟")) return;
    ai.run(() => draftPost({ lang: d.lang, title: d.title, notes }), {
      onOk: (r) => setD((x) => ({ ...x, body: r.body, excerpt: x.excerpt || r.excerpt, tags: x.tags || r.tags.join("، ") })),
    });
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <Field label="عنوان">
          <Input
            value={d.title}
            dir={dir}
            onChange={(e) => setD({ ...d, title: e.target.value, slug: slugTouched ? d.slug : slugify(e.target.value) })}
            placeholder={d.lang === "en" ? "Article title" : "عنوان نوشته"}
          />
        </Field>
        <Field label="خلاصه" hint="یک یا دو جمله؛ در فهرست وبلاگ و نتایج جستجو">
          <Textarea value={d.excerpt} onChange={set("excerpt")} rows={2} className="min-h-0" dir={dir} />
        </Field>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-fg/90">متن (Markdown)</span>
            <span className="flex items-center gap-1 rounded-full border border-line p-1 text-xs">
              <button type="button" onClick={() => setPreview(false)} aria-pressed={!preview} className={`rounded-full px-3 py-1 ${!preview ? "bg-white/[0.08] text-fg" : "text-muted"}`}>
                نوشتن
              </button>
              <button type="button" onClick={() => setPreview(true)} aria-pressed={preview} className={`rounded-full px-3 py-1 ${preview ? "bg-white/[0.08] text-fg" : "text-muted"}`}>
                پیش‌نمایش
              </button>
            </span>
          </div>
          {preview ? (
            <div dir={dir} lang={d.lang} className="min-h-[28rem] rounded-2xl border border-line bg-ink-2/60 px-6 py-4 text-[15px] leading-8 text-fg/85">
              {d.body.trim() ? <ArticleBody text={d.body} /> : <p className="text-faint">هنوز متنی نوشته نشده است.</p>}
            </div>
          ) : (
            <Textarea
              aria-label="متن (Markdown)"
              value={d.body}
              onChange={set("body")}
              dir={dir}
              className="min-h-[28rem] font-[inherit]"
              placeholder={"## عنوان بخش\n\nپاراگراف…\n\n- مورد اول\n- مورد دوم\n\n**پررنگ**، [پیوند](https://…)"}
            />
          )}
          <p className="mt-2 text-xs text-faint">
            حدود {new Intl.NumberFormat("fa-IR").format(readingMinutes(d.body))} دقیقه مطالعه · سرتیتر با <span className="ltr">##</span>، فهرست با <span className="ltr">-</span>، نقل‌قول با <span className="ltr">&gt;</span>، تصویر با <span className="ltr">![توضیح](https://…)</span>
          </p>
        </div>
      </div>

      <div className="space-y-5 xl:sticky xl:top-8 xl:self-start">
        <Panel title="انتشار">
          <div className="space-y-4">
            <Field label="زبان">
              <Select value={d.lang} onChange={(e) => setD({ ...d, lang: e.target.value === "en" ? "en" : "fa" })}>
                <option value="fa">فارسی (/blog)</option>
                <option value="en">English (/en/blog)</option>
              </Select>
            </Field>
            <Field label="نشانی (slug)" hint="بخش آخر آدرس صفحه">
              <Input
                value={d.slug}
                dir="ltr"
                onChange={(e) => {
                  setSlugTouched(true);
                  setD({ ...d, slug: e.target.value });
                }}
              />
            </Field>
            <Field label="تاریخ انتشار" hint="خالی = همین حالا">
              <Input type="datetime-local" value={d.published_at} onChange={set("published_at")} dir="ltr" />
            </Field>
            <Field label="برچسب‌ها" hint="با ویرگول جدا کنید">
              <Input value={d.tags} onChange={set("tags")} dir={dir} />
            </Field>
            <Field label="تصویر شاخص (اختیاری)" hint="https://…">
              <Input value={d.cover_url} onChange={set("cover_url")} dir="ltr" />
            </Field>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button disabled={pending} onClick={() => save("published")}>
                {pending ? <Spinner /> : null} {d.status === "published" ? "ذخیره و به‌روزرسانی" : "انتشار"}
              </Button>
              <Button variant="soft" disabled={pending} onClick={() => save("draft")}>
                {d.status === "published" ? "برگرداندن به پیش‌نویس" : "ذخیره‌ی پیش‌نویس"}
              </Button>
            </div>
            <p className="text-xs text-faint">وضعیت فعلی: {d.status === "published" ? "منتشرشده" : "پیش‌نویس"}</p>
            {post && d.status === "published" && (
              <a href={postHref({ lang: d.lang, slug: d.slug })} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-violet hover:text-fg">
                دیدن در سایت <Icon name="external" className="size-3.5" />
              </a>
            )}
          </div>
        </Panel>

        <Panel title="پیش‌نویس با هوش مصنوعی" sub="از روی عنوان و نکته‌های شما و فقط بر پایه‌ی «دانش پارس»؛ پیش از انتشار بازبینی کنید.">
          <div className="space-y-3">
            <Field label="نکته‌ها (اختیاری)">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className="min-h-0" placeholder="مخاطب، محورهای اصلی، نمونه‌ها…" />
            </Field>
            <Button variant="soft" disabled={ai.pending || !d.title.trim()} onClick={draft}>
              {ai.pending ? <Spinner /> : <Icon name="ai" className="size-4" />} نوشتن پیش‌نویس
            </Button>
          </div>
        </Panel>

        {post && (
          <button
            type="button"
            disabled={pending}
            onClick={() => window.confirm("این نوشته برای همیشه حذف شود؟") && run(() => deletePost(post.id), { onOk: () => router.replace("/admin/blog") })}
            className="text-sm text-danger/80 hover:text-danger"
          >
            حذف نوشته
          </button>
        )}
      </div>
    </div>
  );
}
