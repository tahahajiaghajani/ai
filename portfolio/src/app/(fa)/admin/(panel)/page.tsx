import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { ghConfigured } from "@/lib/github";
import { formatDate } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { PRIORITY_LABEL, isPriority, isStatus } from "@/lib/request-meta";
import { listRequests, type RequestRow } from "@/lib/requests";
import { NotConnected } from "@/components/admin/not-connected";

export default async function Requests({ searchParams }: PageProps<"/admin">) {
  await requireAdmin(); // the layout check alone does not stop this page from rendering
  const { status } = await searchParams;
  if (!ghConfigured()) return <NotConnected />;
  let all: RequestRow[];
  try {
    all = await listRequests();
  } catch (e) {
    return <NotConnected error={e instanceof Error ? e.message : String(e)} />;
  }
  const rows = typeof status === "string" && isStatus(status) ? all.filter((r) => r.status === status) : all;
  const open = all.filter((r) => r.status === "new" || r.status === "reviewing").length;
  return (
    <>
      <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <h1 className="text-3xl font-bold">درخواست‌ها <span className="text-muted">({rows.length})</span></h1>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/admin" className="rounded-full border border-line px-3 py-1">همه</Link>
          {(["new", "reviewing", "answered", "scheduled", "closed"] as const).map((s) => (
            <Link key={s} href={`/admin?status=${s}`} className={`rounded-full border px-3 py-1 ${status === s ? "border-fg bg-fg text-bg" : "border-line"}`}>{ui.track.status[s].fa}</Link>
          ))}
        </div>
      </div>
      <p className="mb-6 text-sm text-muted">{open} درخواست باز · هر درخواست یک issue در مخزن داده است.</p>
      <div className="overflow-x-auto rounded-[8px] border border-line">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-bg-2 text-muted">
            <tr className="text-start">
              <th className="p-3 text-start font-normal">کد</th>
              <th className="p-3 text-start font-normal">موضوع</th>
              <th className="p-3 text-start font-normal">از طرف</th>
              <th className="p-3 text-start font-normal">نوع / اولویت</th>
              <th className="p-3 text-start font-normal">وضعیت</th>
              <th className="p-3 text-start font-normal">زمان</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.number} className="border-t border-line hover:bg-fg/[0.03]">
                <td className="p-3 font-mono" dir="ltr"><Link href={`/admin/requests/${r.number}`} className="link-draw">{r.code}</Link></td>
                <td className="max-w-[320px] truncate p-3">{r.subject}</td>
                <td className="p-3">{r.name}{r.organization ? <span className="text-muted"> · {r.organization}</span> : null}</td>
                <td className="p-3">{ui.request.kinds[r.kind]?.fa ?? r.kind} · {isPriority(r.priority) ? PRIORITY_LABEL[r.priority].fa : r.priority}</td>
                <td className="p-3">{ui.track.status[r.status]?.fa ?? r.status}</td>
                <td className="p-3 text-muted">{formatDate(r.created_at, "fa")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="p-6 text-muted">هنوز درخواستی نیامده.</p> : null}
      </div>
    </>
  );
}
