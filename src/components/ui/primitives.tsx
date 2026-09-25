"use client";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- Button
type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "success";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const BTN_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-brand text-white shadow-[0_8px_24px_-10px_var(--primary)] hover:brightness-110 active:brightness-95 disabled:opacity-60",
  secondary: "bg-surface-muted text-fg hover:bg-[color-mix(in_oklab,var(--surface-muted)_80%,var(--text)_8%)] border border-line",
  ghost: "text-muted hover:text-fg hover:bg-surface-muted",
  outline: "border border-line-strong text-fg hover:bg-surface-muted",
  danger: "bg-danger/90 text-white hover:bg-danger",
  success: "bg-success/90 text-white hover:bg-success",
};
const BTN_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-6 text-[15px] gap-2 rounded-xl",
  icon: "h-9 w-9 rounded-xl",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed",
        BTN_VARIANTS[variant],
        BTN_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : null}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------- Card
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("glass rounded-2xl", className)} {...props} />;
}

export function CardHeader({ title, subtitle, icon, actions, className }: { title: React.ReactNode; subtitle?: React.ReactNode; icon?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 border-b border-line px-5 py-4", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon ? <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">{icon}</div> : null}
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-bold">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- Badge
export type Tone = "neutral" | "info" | "warning" | "success" | "danger" | "violet" | "cyan" | "orange" | "pink";

const TONES: Record<Tone, string> = {
  neutral: "bg-[color-mix(in_oklab,var(--text)_8%,transparent)] text-muted",
  info: "bg-sky-500/12 text-sky-600 dark:text-sky-300",
  warning: "bg-amber-500/14 text-amber-700 dark:text-amber-300",
  success: "bg-emerald-500/14 text-emerald-700 dark:text-emerald-300",
  danger: "bg-rose-500/14 text-rose-700 dark:text-rose-300",
  violet: "bg-violet-500/14 text-violet-700 dark:text-violet-300",
  cyan: "bg-teal-500/14 text-teal-700 dark:text-teal-300",
  orange: "bg-orange-500/14 text-orange-700 dark:text-orange-300",
  pink: "bg-pink-500/14 text-pink-700 dark:text-pink-300",
};

export function Badge({ tone = "neutral", className, children, dot }: { tone?: Tone; className?: string; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold", TONES[tone], className)}>
      {dot ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- Inputs
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-xl border border-line bg-surface-strong px-3.5 text-sm text-fg placeholder:text-faint transition focus:border-primary focus:outline-none focus:ring-4 focus:ring-[var(--ring)] disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "min-h-28 w-full rounded-xl border border-line bg-surface-strong px-3.5 py-3 text-sm leading-7 text-fg placeholder:text-faint transition focus:border-primary focus:outline-none focus:ring-4 focus:ring-[var(--ring)]",
        className,
      )}
      {...props}
    />
  );
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        "h-11 w-full appearance-none rounded-xl border border-line bg-surface-strong bg-[length:16px] bg-[left_12px_center] bg-no-repeat px-3.5 pl-9 text-sm text-fg focus:border-primary focus:outline-none focus:ring-4 focus:ring-[var(--ring)]",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%238a93a6%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')]",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});

export function Field({ label, hint, error, children, className, required }: { label: React.ReactNode; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-[13px] font-semibold text-fg">
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </span>
      {children}
      {error ? <span className="block text-xs text-danger">{error}</span> : hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2.5 text-sm disabled:opacity-50"
    >
      <span className={cn("relative h-6 w-11 rounded-full transition-colors", checked ? "bg-primary" : "bg-line-strong")}>
        <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", checked ? "right-5.5" : "right-0.5")} />
      </span>
      {label}
    </button>
  );
}

// ---------------------------------------------------------------- Progress
export function Progress({ value, className, tone = "brand" }: { value: number; className?: string; tone?: "brand" | "success" | "warning" }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--text)_8%,transparent)]", className)}>
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-700 ease-out",
          tone === "brand" ? "bg-gradient-brand" : tone === "success" ? "bg-success" : "bg-warning",
        )}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- Avatar
const AVATAR_COLORS = ["#8b5cf6", "#0ea5e9", "#f97316", "#10b981", "#ec4899", "#f59e0b", "#14b8a6", "#6366f1"];

export function colorFor(key: string) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function Avatar({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  const initials = (name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("");
  const color = colorFor(name || "?");
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center rounded-full font-bold text-white ring-2 ring-[var(--bg-elevated)]", className)}
      style={{ width: size, height: size, fontSize: size * 0.4, background: `linear-gradient(135deg, ${color}, color-mix(in oklab, ${color} 60%, #000))` }}
      title={name}
    >
      {initials}
    </span>
  );
}

// ---------------------------------------------------------------- Misc
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-muted", className)} />;
}

export function EmptyState({ icon, title, description, action, className }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      {icon ? <div className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">{icon}</div> : null}
      <div>
        <p className="font-bold">{title}</p>
        {description ? <p className="mt-1 max-w-sm text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="ltr rounded-md border border-line bg-surface-muted px-1.5 py-0.5 font-mono text-[11px]">{children}</kbd>;
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-base font-extrabold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}
