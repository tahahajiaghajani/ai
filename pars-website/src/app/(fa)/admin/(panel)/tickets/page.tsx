import Link from "next/link";
import { db } from "@/lib/db";
import { listTickets } from "@/lib/admin-data";
import { formatDate } from "@/lib/i18n";
import { CATEGORY_LABEL, OPEN_STATUSES, PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL } from "@/lib/ticket-meta";
import { DbMissing, Empty, PageTitle } from "@/components/admin/ui";
import { PRIORITY_STYLE, STATUS_STYLE } from "@/components/support/status-style";

export default async function Tickets({ searchParams }: { searchParams: Promise<{ status?: string; priority?: string; q?: string }> }) {
  const sp = await searchParams;
  const status = sp.status ?? "open";
  const priority = sp.priority ?? "all";
  const rows = await listTickets({ status, priority, q: sp.q });
  const now = Date.now();
  const tabs: [string, string][] = [["open", "باز"], ...STATUSES.map((s) => [s, STATUS_LABEL[s].fa] as [string, string]), ["all", "همه"]];
  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ status, priority, ...(sp.q ? { q: sp.q } : {}), ...patch });
    return `/admin/tickets?${p}`;
  };
  return (
    <>
      <PageTitle title="تیکت‌ها" sub="درخواست‌های مشتریان؛ هوش مصنوعی هر درخواست را دسته‌بندی، اولویت‌بندی و خلاصه می‌کند." />
      {!db() ? (
        <DbMissing />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {tabs.map(([k, label]) => (
              <Link key={k} href={qs({ status: k })} className={`rounded-full border px-3.5 py-1.5 text-sm ${status === k ? "border-pink/50 bg-pink/10 text-fg" : "border-line text-muted hover:text-fg"}`}>
                {label}
              </Link>
            ))}
          </div>
          <form className="mb-5 flex flex-wrap gap-2" action="/admin/tickets">
            <input type="hidden" name="status" value={status} />
            <input name="q" defaultValue={sp.q} placeholder="جستجو: کد، عنوان، نام، ایمیل، سازمان…" className="h-11 min-w-64 flex-1 rounded-full border border-line bg-ink-2 px-4 text-sm outline-none focus:border-violet/60" />
            <select name="priority" defaultValue={priority} className="h-11 rounded-full border border-line bg-ink-2 px-4 text-sm">
              <option value="all">همه‌ی اولویت‌ها</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p].fa}
                </option>
              ))}
            </select>
            <button className="h-11 rounded-full bg-white/10 px-5 text-sm font-semibold hover:bg-white/15">اعمال</button>
          </form>
          {rows.length === 0 ? (
            <Empty>تیکتی با این فیلتر پیدا نشد.</Empty>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b border-line text-xs text-faint">
                  <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:text-start [&>th]:font-semibold">
                    <th>کد</th>
                    <th>موضوع</th>
                    <th>مشتری</th>
                    <th>نوع</th>
                    <th>اولویت</th>
                    <th>وضعیت</th>
                    <th>به‌روزرسانی</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => {
                    const late = OPEN_STATUSES.includes(r.status) && !r.first_response_at && r.due_at && new Date(r.due_at).getTime() < now;
                    return (
                      <tr key={r.id} className="transition hover:bg-white/[0.03] [&>td]:px-4 [&>td]:py-3.5">
                        <td>
                          <Link href={`/admin/tickets/${r.code}`} className="ltr font-brand text-xs text-pink hover:underline">
                            {r.code}
                          </Link>
                        </td>
                        <td className="max-w-72">
                          <Link href={`/admin/tickets/${r.code}`} className="block truncate font-semibold hover:text-pink">
                            {r.subject}
                          </Link>
                          {r.ai_summary && <span className="block truncate text-xs text-muted">🤖 {r.ai_summary}</span>}
                        </td>
                        <td>
                          <span className="block">{r.name}</span>
                          <span className="block text-xs text-faint">{r.organization}</span>
                        </td>
                        <td className="text-muted">{CATEGORY_LABEL[r.category].fa}</td>
                        <td className={PRIORITY_STYLE[r.priority]}>
                          {PRIORITY_LABEL[r.priority].fa}
                          {late && <span className="ms-2 rounded-full bg-danger/15 px-2 py-0.5 text-[10px] text-danger">دیرکرد</span>}
                        </td>
                        <td>
                          <span className={`rounded-full border px-2.5 py-0.5 text-[11px] ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status].fa}</span>
                        </td>
                        <td className="text-xs text-faint">{formatDate(r.updated_at, "fa")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
