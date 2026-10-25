import { requireAdmin } from "@/lib/admin-auth";
import { env } from "@/lib/env";
import { getFile, ghConfigured } from "@/lib/github";
import { KNOWLEDGE_FILE, parseKnowledgeFile, type Fact } from "@/lib/knowledge-file";
import { addFact, deleteFact } from "@/app/actions/admin";
import { NotConnected } from "@/components/admin/not-connected";

export default async function Knowledge() {
  await requireAdmin(); // the layout check alone does not stop this page from rendering
  if (!ghConfigured()) return <NotConnected />;
  let facts: Fact[];
  try {
    const f = await getFile(KNOWLEDGE_FILE);
    facts = f ? parseKnowledgeFile(f.text) : [];
  } catch (e) {
    return <NotConnected error={e instanceof Error ? e.message : String(e)} />;
  }
  const edit = `https://github.com/${env.githubRepo}/edit/HEAD/${KNOWLEDGE_FILE}`;
  return (
    <>
      <h1 className="mb-3 text-3xl font-bold">دانش دستیار</h1>
      <p className="mb-8 max-w-[70ch] text-sm leading-relaxed text-muted">
        محتوای همین سایت (پروفایل، پروژه‌ها، سوابق) همیشه بخشی از دانش دستیار است. نکته‌های بیشتر اینجا یا مستقیم در فایل{" "}
        <a href={edit} target="_blank" rel="noreferrer" className="link-draw" dir="ltr">{KNOWLEDGE_FILE}</a> مخزن داده اضافه می‌شوند و حداکثر تا ۵ دقیقه بعد در پاسخ‌ها اثر می‌کنند.
      </p>
      <form action={addFact} className="mb-12 grid gap-3 rounded-[8px] border border-line p-5">
        <input name="title" required placeholder="عنوان" className="rounded-[6px] border border-line-strong bg-transparent px-4 py-2.5 outline-none focus:border-fg" />
        <textarea name="body" required rows={5} placeholder="متن (فارسی یا انگلیسی)" className="rounded-[6px] border border-line-strong bg-transparent px-4 py-2.5 leading-relaxed outline-none focus:border-fg" />
        <input name="tags" placeholder="برچسب‌ها، با ویرگول" className="rounded-[6px] border border-line-strong bg-transparent px-4 py-2.5 outline-none focus:border-fg" />
        <button className="w-fit rounded-full bg-fg px-6 py-2.5 text-sm font-semibold text-bg">افزودن</button>
      </form>
      <div className="grid gap-4">
        {facts.map((r, i) => (
          <article key={`${i}-${r.title}`} className="rounded-[8px] border border-line p-5">
            <div className="flex items-start justify-between gap-4">
              <h2 className="font-semibold" dir="auto">{r.title}</h2>
              <form action={deleteFact}>
                <input type="hidden" name="index" value={i} />
                <input type="hidden" name="title" value={r.title} />
                <button className="text-xs text-muted hover:text-fg">حذف</button>
              </form>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg-2" dir="auto">{r.body}</p>
            {r.tags.length ? <p className="mt-2 text-xs text-muted">{r.tags.join(" · ")}</p> : null}
          </article>
        ))}
        {facts.length === 0 ? <p className="text-muted">هنوز نکته‌ی اضافه‌ای نیست.</p> : null}
      </div>
    </>
  );
}
