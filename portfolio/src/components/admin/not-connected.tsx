import Link from "next/link";

/** Shown by the panel pages when the data repository is not set up or not reachable. */
export function NotConnected({ error }: { error?: string }) {
  return (
    <div className="max-w-[70ch] rounded-[8px] border border-line p-6 leading-relaxed">
      <p className="font-semibold">{error ? "مخزن داده در دسترس نیست." : "مخزن داده هنوز وصل نشده است."}</p>
      {error ? <p className="mt-2 text-sm text-muted" dir="auto">{error}</p> : null}
      <p className="mt-3 text-sm text-fg-2">
        درخواست‌ها، تنظیمات و دانش اضافه در یک مخزن خصوصی GitHub نگه داشته می‌شوند. وضعیت و راهنما در{" "}
        <Link href="/admin/connections" className="link-draw">اتصالات</Link>.
      </p>
    </div>
  );
}
