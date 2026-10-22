"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteTicket, retriage, staffReply, updateTicket } from "@/app/actions/admin";
import { CATEGORIES, CATEGORY_LABEL, PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL } from "@/lib/ticket-meta";
import { Button, Select, Spinner, Textarea } from "@/components/ui/field";
import { Panel } from "@/components/admin/ui";
import { toast, useAction } from "@/components/admin/toast";

export function TicketReply({ code, draft, closed }: { code: string; draft: string; closed: boolean }) {
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [after, setAfter] = useState("answered");
  const { pending, run } = useAction();
  return (
    <Panel title={internal ? "یادداشت داخلی (مشتری نمی‌بیند)" : "پاسخ به مشتری"}>
      {closed && <p className="mb-3 text-sm text-warning">این تیکت بسته است؛ پاسخ شما آن را دوباره باز نمی‌کند مگر وضعیت را تغییر دهید.</p>}
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7} placeholder="متن پاسخ… (Markdown ساده پشتیبانی می‌شود)" dir="auto" />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {draft && (
            <Button type="button" variant="soft" onClick={() => setBody(draft)}>
              🤖 استفاده از پیش‌نویس هوش مصنوعی
            </Button>
          )}
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="size-4 accent-[#df1173]" />
            یادداشت داخلی
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!internal && (
            <select value={after} onChange={(e) => setAfter(e.target.value)} className="h-12 rounded-full border border-line bg-ink-2 px-4 text-sm">
              <option value="answered">بعد از ارسال: پاسخ داده شد</option>
              <option value="resolved">بعد از ارسال: حل شد</option>
              <option value="in_progress">بعد از ارسال: در حال بررسی</option>
            </select>
          )}
          <Button
            disabled={pending || body.trim().length < 2}
            onClick={() =>
              run(() => staffReply({ code, body, internal, status: after }), {
                onOk: () => setBody(""),
              })
            }
          >
            {pending && <Spinner />}
            {internal ? "ثبت یادداشت" : "ارسال پاسخ"}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

export function TicketControls({ code, status, priority, category, link }: { code: string; status: string; priority: string; category: string; link: string }) {
  const router = useRouter();
  const { pending, run } = useAction();
  return (
    <Panel title="مدیریت تیکت">
      <div className="space-y-3">
        <label className="block text-xs text-faint">
          وضعیت
          <Select className="mt-1.5" defaultValue={status} onChange={(e) => run(() => updateTicket({ code, status: e.target.value }))}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s].fa}
              </option>
            ))}
          </Select>
        </label>
        <label className="block text-xs text-faint">
          اولویت
          <Select className="mt-1.5" defaultValue={priority} onChange={(e) => run(() => updateTicket({ code, priority: e.target.value }))}>
            {PRIORITIES.map((s) => (
              <option key={s} value={s}>
                {PRIORITY_LABEL[s].fa}
              </option>
            ))}
          </Select>
        </label>
        <label className="block text-xs text-faint">
          نوع
          <Select className="mt-1.5" defaultValue={category} onChange={(e) => run(() => updateTicket({ code, category: e.target.value }))}>
            {CATEGORIES.map((s) => (
              <option key={s} value={s}>
                {CATEGORY_LABEL[s].fa}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div className="mt-5 grid gap-2">
        {link && (
          <Button
            variant="soft"
            onClick={() => {
              void navigator.clipboard?.writeText(link).then(() => toast(true, "پیوند مشتری کپی شد."));
            }}
          >
            کپی پیوند صفحه‌ی مشتری
          </Button>
        )}
        <Button variant="soft" disabled={pending} onClick={() => run(() => retriage(code))}>
          🤖 تحلیل دوباره با هوش مصنوعی
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          className="!text-danger"
          onClick={() => {
            if (confirm("این تیکت و همه‌ی پیام‌هایش برای همیشه حذف شود؟")) run(() => deleteTicket(code), { onOk: () => router.push("/admin/tickets") });
          }}
        >
          حذف تیکت
        </Button>
      </div>
    </Panel>
  );
}
