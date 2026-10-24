import Link from "next/link";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { accountCopy } from "@/content/copy/account";
import { num, type Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { ORDER_STEPS, STATUS_LABEL, type OrderStatus } from "@/lib/order-meta";
import { Icon } from "@/components/ui/icons";

/** Small building blocks of the member pages (recipes from docs/DESIGN_SYSTEM.md). Hook-free: usable on both sides. */

export const btn = {
  /** espresso, champagne hairline — a firm secondary action */
  primary: "btn btn-ink",
  /** the main action of a page (submit sign-in, send a request, place an order) */
  metal: "btn btn-metal",
  outline: "btn btn-line text-ink",
  /** a text action with its rule and arrow (≥ 44px tall) */
  text: "btn-link",
  quiet: "btn-link btn-link-ink",
};

/** A button label that can turn busy: put `aria-busy` on the button; the label stays for screen readers, a thin comet turns in its place. */
export function BusyLabel({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <>
      <span>{children}</span>
      {busy && <span aria-hidden className="btn-spinner" />}
    </>
  );
}

export const inputCls =
  "block h-13 w-full border border-control bg-white/90 px-4 font-ui text-md text-ink shadow-[inset_0_1px_2px_rgb(26_19_16/0.05)] outline-none transition-[border-color,box-shadow,background-color] duration-300 placeholder:text-faint hover:border-ink-2/70 focus:border-gold focus:bg-white focus:shadow-[0_0_0_3px_rgb(156_94_52/0.14)] aria-[invalid=true]:border-danger aria-[invalid=true]:shadow-[0_0_0_3px_rgb(155_44_44/0.1)] disabled:bg-bone disabled:text-muted";

function describedBy(id: string, help?: ReactNode, error?: string) {
  return [help ? `${id}-help` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
}

export function FieldShell({ id, label, optional, help, error, children, className = "" }: { id: string; label: ReactNode; optional?: string; help?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-2 flex items-baseline gap-1.5 font-ui text-sm text-ink-2">
        {label}
        {optional && <span className="text-xs text-muted">({optional})</span>}
      </label>
      {children}
      {help && !error && (
        <p id={`${id}-help`} className="mt-2 font-ui text-xs leading-6 text-muted">
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-2 flex items-start gap-1.5 font-ui text-xs leading-6 text-danger">
          <Icon name="warning" className="mt-[0.3rem] size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & { id: string; label: ReactNode; optional?: string; help?: ReactNode; error?: string; wrapClassName?: string; end?: ReactNode };

export function TextField({ id, label, optional, help, error, wrapClassName, end, className = "", ...rest }: InputProps) {
  return (
    <FieldShell id={id} label={label} optional={optional} help={help} error={error} className={wrapClassName}>
      {/* the wrapper follows the field's own direction, so an end button sits where the field leaves room */}
      <div className="relative" dir={rest.dir}>
        <input id={id} name={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, help, error)} className={`${inputCls} ${end ? "pe-12" : ""} ${className}`} {...rest} />
        {end}
      </div>
    </FieldShell>
  );
}

type AreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & { id: string; label: ReactNode; optional?: string; help?: ReactNode; error?: string; wrapClassName?: string };

export function TextArea({ id, label, optional, help, error, wrapClassName, className = "", rows = 3, ...rest }: AreaProps) {
  return (
    <FieldShell id={id} label={label} optional={optional} help={help} error={error} className={wrapClassName}>
      <textarea
        id={id}
        name={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, help, error)}
        className={`${inputCls} h-auto min-h-24 py-3 leading-7 ${className}`}
        {...rest}
      />
    </FieldShell>
  );
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & { id: string; label: ReactNode; optional?: string; help?: ReactNode; error?: string; wrapClassName?: string; children: ReactNode };

export function SelectField({ id, label, optional, help, error, wrapClassName, className = "", children, ...rest }: SelectProps) {
  return (
    <FieldShell id={id} label={label} optional={optional} help={help} error={error} className={wrapClassName}>
      <div className="relative">
        <select id={id} name={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, help, error)} className={`${inputCls} appearance-none pe-11 ${className}`} {...rest}>
          {children}
        </select>
        <Icon name="chevron-down" className="pointer-events-none absolute inset-y-0 end-4 my-auto size-4 text-muted" />
      </div>
    </FieldShell>
  );
}

/** A form-level note: error (danger) or success (gold), announced politely. */
export function FormNote({ tone, children }: { tone: "error" | "ok" | "info"; children: ReactNode }) {
  const cls = tone === "error" ? "border-danger bg-danger-soft/80 text-danger" : tone === "ok" ? "border-gold bg-gold-mist text-gold-text" : "border-line-strong bg-bone/80 text-ink-2";
  return (
    <p className={`flex items-start gap-3 border-s-2 px-4 py-3 font-ui text-sm leading-7 ${cls}`}>
      <Icon name={tone === "error" ? "warning" : tone === "ok" ? "check" : "info"} className="mt-1.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Page title of an account page; on phones (no sidebar) inner pages get a back link to the account home. */
export function AccountHeader({
  lang,
  title,
  back = "/account",
  backLabel,
  backAlways = false,
  children,
}: {
  lang: Lang;
  title: ReactNode;
  /** null = no back link (the account home itself) */
  back?: string | null;
  backLabel?: string;
  /** keep the back link on desktop too (e.g. an order → «سفارش‌های من») */
  backAlways?: boolean;
  children?: ReactNode;
}) {
  const c = accountCopy(lang);
  return (
    <header className="mb-8 sm:mb-10">
      {back && (
        <Link href={href(lang, back)} className={`-ms-1 mb-4 inline-flex h-11 items-center gap-1.5 px-1 text-sm text-muted hover:text-ink ${backAlways ? "" : "lg:hidden"}`}>
          <Icon name="chevron" className="size-4 ltr:-scale-x-100" />
          {backLabel ?? c.nav.back}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <h1 className="title-page">{title}</h1>
        {children}
      </div>
    </header>
  );
}

export function SectionTitle({ id, children, action }: { id?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-baseline justify-between gap-4">
      <h2 id={id} className="title-section">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="border border-line px-6 py-12 text-center sm:py-16">
      <span className="mx-auto mb-5 block h-px w-10 bg-gold/60" aria-hidden />
      <p className="mx-auto max-w-sm text-sm leading-7 text-ink-2">{children}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

const TONE: Record<OrderStatus, string> = {
  pending: "bg-warning-soft text-warning",
  packing: "bg-gold-mist text-gold-text",
  ready: "bg-gold-mist text-gold-text",
  shipped: "bg-success-soft text-success",
  cancelled: "bg-bone text-muted",
};
const DOT: Record<OrderStatus, string> = { pending: "bg-warning", packing: "bg-gold", ready: "bg-gold", shipped: "bg-success", cancelled: "bg-faint" };

export function StatusChip({ status, lang, className = "" }: { status: OrderStatus; lang: Lang; className?: string }) {
  return (
    <span className={`inline-flex min-h-7 items-center gap-1.5 px-2.5 py-0.5 text-xs leading-5 ${TONE[status]} ${className}`}>
      <span className={`size-1.5 shrink-0 rounded-full ${DOT[status]}`} aria-hidden />
      {STATUS_LABEL[status][lang]}
    </span>
  );
}

/** Four quiet segments; the reached ones in ink. Reads left→right in English, right→left in Persian. */
export function MiniProgress({ status, lang, className = "" }: { status: OrderStatus; lang: Lang; className?: string }) {
  if (status === "cancelled") return null;
  const at = ORDER_STEPS.indexOf(status);
  const label = accountCopy(lang).status.progress(num(at + 1, lang), num(ORDER_STEPS.length, lang));
  return (
    <span role="img" aria-label={`${label} — ${STATUS_LABEL[status][lang]}`} className={`flex items-center gap-1 ${className}`}>
      {ORDER_STEPS.map((s, i) => (
        <span key={s} className={`h-0.5 flex-1 ${i <= at ? "bg-ink" : "bg-line-strong/60"}`} />
      ))}
    </span>
  );
}

/** «عضو PRO» / "PRO Member" — the words in the reading order of each language, a copper rhombus before them. */
export function ProChip({ lang, className = "" }: { lang: Lang; className?: string }) {
  const member = accountCopy(lang).nav.member;
  return (
    <span className={`inline-flex h-8 items-center gap-2 border border-gold/45 bg-gold-mist/60 px-3 font-ui text-xs text-gold-text ${className}`}>
      <span aria-hidden className="size-1.5 rotate-45 bg-[image:var(--metal-copper)]" />
      {lang === "fa" && <span>{member}</span>}
      <span className="font-label text-[11px] tracking-[0.18em] ltr">PRO</span>
      {lang === "en" && <span>{member}</span>}
    </span>
  );
}
