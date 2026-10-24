"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Icon, type IconName } from "@/components/ui/icons";
import { toast } from "@/components/admin/toast";

/**
 * Admin building blocks: quiet, square, hairline-bordered (same tokens as the site, without the
 * editorial typography). Persian, RTL, logical utilities only.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "gold";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-bone hover:bg-ink-2 border border-ink",
  secondary: "bg-white text-ink border border-line-strong hover:border-ink",
  ghost: "text-ink hover:bg-bone border border-transparent",
  danger: "bg-white text-danger border border-danger/40 hover:bg-danger-soft",
  gold: "bg-gold text-white border border-gold hover:bg-gold-deep",
};
const SIZES = { sm: "h-8 px-3 text-xs gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-6 text-sm gap-2" };

export function Spinner({ className = "size-4" }: { className?: string }) {
  return <span aria-hidden className={`inline-block animate-spin rounded-full border-[1.5px] border-current border-e-transparent ${className}`} />;
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  pending,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZES; icon?: IconName; pending?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || pending}
      className={`inline-flex shrink-0 items-center justify-center rounded-sm font-medium whitespace-nowrap transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {pending ? <Spinner /> : icon ? <Icon name={icon} className="size-4" /> : null}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "secondary", size = "md", icon, className = "", children, external }: { href: string; variant?: Variant; size?: keyof typeof SIZES; icon?: IconName; className?: string; children: ReactNode; external?: boolean }) {
  const cls = `inline-flex shrink-0 items-center justify-center rounded-sm font-medium whitespace-nowrap transition-colors duration-200 ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
  const inner = (
    <>
      {icon && <Icon name={icon} className="size-4" />}
      {children}
    </>
  );
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}

export function PageHeader({ title, sub, actions, back }: { title: string; sub?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
            <Icon name="chevron" className="size-3.5" />
            {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-medium">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ title, sub, actions, children, className = "", padded = true }: { title?: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={`border border-line bg-white ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            {title && <h2 className="text-base font-medium">{title}</h2>}
            {sub && <p className="mt-0.5 text-xs leading-6 text-muted">{sub}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, error, children, className = "" }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : hint ? <span className="mt-1 block text-xs leading-5 text-muted">{hint}</span> : null}
    </label>
  );
}

const control = "w-full rounded-sm border border-line-strong bg-white px-3 text-sm text-ink outline-none transition-colors placeholder:text-faint focus:border-gold disabled:bg-bone disabled:text-muted";

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={`h-10 ${control} ${className}`} />;
}

export function Textarea({ className = "", rows = 4, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} {...rest} className={`py-2.5 leading-7 ${control} ${className}`} />;
}

export function Select({ className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={`h-10 ${control} ${className}`}>
      {children}
    </select>
  );
}

/** Money in Toman: shows thousands separators while typing, hands the raw digits to onChange. */
export function MoneyInput({ value, onChange, placeholder = "مثلاً ۲٬۵۰۰٬۰۰۰", ...rest }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const shown = value === null || Number.isNaN(value) ? "" : new Intl.NumberFormat("en-US").format(value);
  return (
    <div className="relative">
      <Input
        {...rest}
        inputMode="numeric"
        dir="ltr"
        placeholder={placeholder}
        value={shown}
        onChange={(e) => {
          const digits = e.target.value.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[^\d]/g, "");
          onChange(digits ? Number(digits) : null);
        }}
        // the input is ltr inside an rtl row: its start (left) keeps room for «تومان», digits sit at its end (right)
        className="ps-14 text-end"
      />
      <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted">تومان</span>
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start justify-between gap-4 border border-line bg-white px-4 py-3 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-5 text-muted">{hint}</span>}
      </span>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-line-strong transition peer-checked:bg-ink peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-gold after:absolute after:start-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:transition-all peer-checked:after:start-[18px]" />
    </label>
  );
}

type Tone = "neutral" | "gold" | "success" | "warning" | "danger" | "ink";
const TONES: Record<Tone, string> = {
  neutral: "bg-bone text-ink-2",
  gold: "bg-gold-mist text-gold-text",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  ink: "bg-ink text-bone",
};

export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[11px] leading-5 font-medium whitespace-nowrap ${TONES[tone]} ${className}`}>{children}</span>;
}

export function Stat({ label, value, hint, href, tone = "neutral" }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: Tone }) {
  const body = (
    <>
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-2 text-2xl font-medium ${tone === "gold" ? "text-gold-text" : tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-ink"}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="block border border-line bg-white p-5 transition-colors hover:border-ink">
      {body}
    </Link>
  ) : (
    <div className="border border-line bg-white p-5">{body}</div>
  );
}

export function Empty({ title, children, action }: { title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="border border-dashed border-line-strong bg-white px-6 py-12 text-center">
      {title && <div className="text-sm font-medium">{title}</div>}
      {children && <div className="mx-auto mt-1 max-w-md text-sm leading-7 text-muted">{children}</div>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function DbMissing() {
  return (
    <Empty title="پایگاه داده هنوز وصل نشده است">
      متغیرهای <span className="ltr font-mono text-xs">SUPABASE_URL</span> و <span className="ltr font-mono text-xs">SUPABASE_SERVICE_ROLE_KEY</span> را در Vercel تنظیم کنید و فایل SQL را در Supabase اجرا کنید. راهنمای کامل در «اتصالات» و{" "}
      <span className="ltr font-mono text-xs">docs/SETUP_FA.md</span>.
    </Empty>
  );
}

/** A tab strip of links (state lives in the URL). */
export function Tabs({ items, active }: { items: { href: string; label: string; count?: number; key: string }[]; active: string }) {
  return (
    // wraps on phones (every filter stays in sight), one scrolling row from sm up
    <nav className="mb-6 flex flex-wrap gap-x-1 border-b border-line sm:flex-nowrap sm:overflow-x-auto">
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={`-mb-px flex shrink-0 items-center gap-2 border-b px-3.5 py-2.5 text-sm transition-colors ${t.key === active ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}
        >
          {t.label}
          {t.count ? <span className="rounded-sm bg-bone px-1.5 text-[11px] text-ink-2">{new Intl.NumberFormat("fa-IR").format(t.count)}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/** Modal / side sheet on the native <dialog> (focus trap, Esc to close). */
export function Dialog({ open, onClose, title, children, wide, side }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; side?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-0 max-h-[100dvh] max-w-none bg-transparent p-0 backdrop:bg-ink/40 backdrop:backdrop-blur-[2px] ${side ? "ms-auto h-[100dvh] w-full sm:w-[560px]" : `mx-auto mt-[8vh] w-[calc(100%-2rem)] ${wide ? "sm:w-[760px]" : "sm:w-[520px]"}`}`}
    >
      {open && (
        <div className={`flex flex-col border border-line bg-ground ${side ? "h-full" : "max-h-[84dvh]"}`}>
          <header className="flex items-center justify-between gap-3 border-b border-line bg-white py-2 ps-5 pe-3">
            <h2 id={titleId} className="text-base font-medium">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="grid size-11 shrink-0 place-items-center text-muted hover:text-ink" aria-label="بستن">
              <Icon name="close" className="size-5" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

/** A destructive button that asks once more inline before it runs. */
export function ConfirmButton({ onConfirm, children, confirmLabel = "مطمئنید؟ دوباره بزنید", pending, size = "sm", variant = "danger", icon = "trash" }: { onConfirm: () => void; children: ReactNode; confirmLabel?: string; pending?: boolean; size?: keyof typeof SIZES; variant?: Variant; icon?: IconName }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      variant={armed ? "primary" : variant}
      size={size}
      icon={icon}
      pending={pending}
      className={armed ? "!border-danger !bg-danger !text-white" : ""}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
}

export async function copyText(text: string, done = "کپی شد.") {
  try {
    await navigator.clipboard.writeText(text);
    toast(true, done);
  } catch {
    toast(false, "کپی انجام نشد؛ متن را دستی انتخاب کنید.");
  }
}

export function CopyButton({ text, label = "کپی", size = "sm", variant = "secondary" }: { text: string; label?: string; size?: keyof typeof SIZES; variant?: Variant }) {
  return (
    <Button size={size} variant={variant} icon="copy" onClick={() => void copyText(text)}>
      {label}
    </Button>
  );
}
