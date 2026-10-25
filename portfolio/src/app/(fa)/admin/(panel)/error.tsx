"use client";

/** A panel page that failed (usually GitHub: a timeout, a rate limit or an expired token). */
export default function PanelError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="max-w-[70ch] rounded-[8px] border border-fg p-6 leading-relaxed">
      <p className="font-semibold">این صفحه باز نشد.</p>
      <p className="mt-2 text-sm text-fg-2">معمولاً یعنی GitHub دیر پاسخ داد، به سقف درخواست‌ها رسیده‌ایم یا توکن منقضی شده است. وضعیت را در «اتصالات» ببینید.</p>
      {error.digest ? <p className="mt-2 font-mono text-xs text-faint" dir="ltr">{error.digest}</p> : null}
      <div className="mt-4 flex gap-3">
        <button type="button" onClick={() => retry()} className="rounded-full bg-fg px-5 py-2 text-sm font-semibold text-bg">
          دوباره
        </button>
        <a href="/admin/connections" className="rounded-full border border-line px-5 py-2 text-sm">
          اتصالات
        </a>
      </div>
    </div>
  );
}
