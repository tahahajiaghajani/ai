import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { listChats } from "@/lib/admin-data";
import { formatDate } from "@/lib/i18n";
import { DbMissing, Empty, PageTitle } from "@/components/admin/ui";
import { ChatReviewButtons } from "@/components/admin/chat-review";
import { Markdown } from "@/components/chat/markdown";

const FILTERS: [string, string][] = [
  ["all", "همه"],
  ["unknown", "بی‌پاسخ"],
  ["negative", "بازخورد منفی"],
  ["positive", "بازخورد مثبت"],
  ["unreviewed", "بررسی‌نشده"],
];

export default async function Chats({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  await requireAdminPage();
  const f = (await searchParams).f ?? "all";
  const rows = await listChats(f);
  return (
    <>
      <PageTitle title="گفتگوهای دستیار" sub="پرسش‌های بازدیدکنندگان و پاسخ‌های دستیار. پاسخ نادرست یا پرسش بی‌پاسخ را با افزودن به دانش اصلاح کنید." actions={<ChatReviewButtons cleanup />} />
      {!db() ? (
        <DbMissing />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-2">
            {FILTERS.map(([k, label]) => (
              <Link key={k} href={`/admin/chats?f=${k}`} className={`rounded-full border px-3.5 py-1.5 text-sm ${f === k ? "border-pink/50 bg-pink/10 text-fg" : "border-line text-muted hover:text-fg"}`}>
                {label}
              </Link>
            ))}
          </div>
          {rows.length === 0 ? (
            <Empty>گفتگویی با این فیلتر نیست.</Empty>
          ) : (
            <ul className="space-y-3">
              {rows.map((r) => (
                <li key={r.id} className={`card p-5 ${r.reviewed ? "opacity-70" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
                    <span>{formatDate(r.created_at, "fa")}</span>
                    <span>· {r.lang === "en" ? "English" : "فارسی"}</span>
                    <span className="ltr">· {r.model}</span>
                    {r.unknown && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-warning">بی‌پاسخ</span>}
                    {r.rating === -1 && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-danger">👎 نادرست</span>}
                    {r.rating === 1 && <span className="rounded-full bg-success/15 px-2 py-0.5 text-success">👍 مفید</span>}
                    {r.reviewed && <span className="rounded-full bg-white/5 px-2 py-0.5">بررسی شد</span>}
                  </div>
                  <p className="mt-3 font-semibold leading-8" dir="auto">
                    {r.question}
                  </p>
                  <details className="mt-2 group">
                    <summary className="cursor-pointer text-sm text-violet">پاسخ دستیار</summary>
                    <div className="mt-2 rounded-2xl bg-ink-4/60 p-4 text-sm">
                      <Markdown text={r.answer || "—"} />
                    </div>
                  </details>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href={`/admin/knowledge?${new URLSearchParams({ title: r.question.slice(0, 160), body: r.unknown ? "" : r.answer.slice(0, 3000) })}`}
                      className="inline-flex h-10 items-center rounded-full bg-white/[0.06] px-4 text-sm font-semibold hover:bg-white/10"
                    >
                      + افزودن به دانش
                    </Link>
                    <ChatReviewButtons id={r.id} reviewed={r.reviewed} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
