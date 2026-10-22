import type { ReactNode } from "react";

export function PageTitle({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, sub, children, className = "" }: { title?: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-5 sm:p-7 ${className}`}>
      {title && (
        <header className="mb-5">
          <h2 className="font-bold">{title}</h2>
          {sub && <p className="mt-1 text-sm leading-6 text-muted">{sub}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center text-sm text-muted">{children}</div>;
}

export function DbMissing() {
  return (
    <Empty>
      پایگاه داده هنوز وصل نشده است. متغیرهای <span className="ltr font-mono">SUPABASE_URL</span> و <span className="ltr font-mono">SUPABASE_SERVICE_ROLE_KEY</span> را در Vercel تنظیم کنید و فایل‌های SQL پوشه‌ی <span className="ltr font-mono">supabase/migrations</span> را به ترتیب نام در Supabase اجرا کنید
      (راهنما: <span className="ltr font-mono">docs/SETUP_FA.md</span>).
    </Empty>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-line px-4 py-3.5">
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-5 text-muted">{hint}</span>}
      </span>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative mt-0.5 h-6 w-11 shrink-0 rounded-full bg-white/15 transition peer-checked:bg-magenta peer-focus-visible:outline-2 peer-focus-visible:outline-violet after:absolute after:start-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:start-[22px]" />
    </label>
  );
}

export function Stat({ label, value, tone = "fg", hint }: { label: string; value: string | number; tone?: "fg" | "pink" | "warning" | "success" | "danger" | "violet"; hint?: string }) {
  const color = { fg: "text-fg", pink: "text-pink", warning: "text-warning", success: "text-success", danger: "text-danger", violet: "text-violet" }[tone];
  return (
    <div className="card p-5">
      <div className="text-xs text-faint">{label}</div>
      <div className={`mt-2 text-3xl font-extrabold ${color}`}>{typeof value === "number" ? new Intl.NumberFormat("fa-IR").format(value) : value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}
