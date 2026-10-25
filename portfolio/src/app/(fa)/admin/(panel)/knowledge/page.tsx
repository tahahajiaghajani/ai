import { db } from "@/lib/db";
import { addFact, deleteFact } from "@/app/actions/admin";

export default async function Knowledge() {
  const c = db();
  if (!c) return <p className="text-fg-2">پایگاه داده تنظیم نشده است.</p>;
  const { data } = await c.from("portfolio_knowledge").select("*").order("created_at", { ascending: false });
  const rows = (data ?? []) as { id: string; title: string; body: string; tags: string[] }[];
  return (
    <>
      <h1 className="mb-3 text-3xl font-bold">دانش دستیار</h1>
      <p className="mb-8 max-w-[70ch] text-sm leading-relaxed text-muted">محتوای همین سایت (پروفایل، پروژه‌ها، سوابق) همیشه بخشی از دانش دستیار است. اینجا نکته‌های بیشتری اضافه کنید؛ حداکثر تا ۵ دقیقه بعد در پاسخ‌ها اثر می‌کند.</p>
      <form action={addFact} className="mb-12 grid gap-3 rounded-[8px] border border-line p-5">
        <input name="title" required placeholder="عنوان" className="rounded-[6px] border border-line-strong bg-transparent px-4 py-2.5 outline-none focus:border-fg" />
        <textarea name="body" required rows={5} placeholder="متن (فارسی یا انگلیسی)" className="rounded-[6px] border border-line-strong bg-transparent px-4 py-2.5 leading-relaxed outline-none focus:border-fg" />
        <input name="tags" placeholder="برچسب‌ها، با ویرگول" className="rounded-[6px] border border-line-strong bg-transparent px-4 py-2.5 outline-none focus:border-fg" />
        <button className="w-fit rounded-full bg-fg px-6 py-2.5 text-sm font-semibold text-bg">افزودن</button>
      </form>
      <div className="grid gap-4">
        {rows.map((r) => (
          <article key={r.id} className="rounded-[8px] border border-line p-5">
            <div className="flex items-start justify-between gap-4">
              <h2 className="font-semibold">{r.title}</h2>
              <form action={deleteFact}>
                <input type="hidden" name="id" value={r.id} />
                <button className="text-xs text-muted hover:text-fg">حذف</button>
              </form>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg-2">{r.body}</p>
            {r.tags?.length ? <p className="mt-2 text-xs text-muted">{r.tags.join(" · ")}</p> : null}
          </article>
        ))}
      </div>
    </>
  );
}
