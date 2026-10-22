import { Children, cloneElement, isValidElement, useId, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const base =
  "w-full rounded-2xl border border-line bg-ink-2/80 px-4 py-3 text-[15px] text-fg outline-none transition placeholder:text-faint focus:border-violet/60 focus:bg-ink-2 focus-visible:outline-none focus:shadow-[0_0_0_4px_rgb(169_162_255/0.12)]";

export function Label({ children, hint, htmlFor }: { children: ReactNode; hint?: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-2 flex items-center justify-between text-sm font-semibold text-fg/90">
      <span>{children}</span>
      {hint && <span className="text-xs font-normal text-faint">{hint}</span>}
    </label>
  );
}

/**
 * A label and its control, linked by id. The first element child is the control: it gets a generated id
 * (or keeps its own); anything after it (a note, a datalist, a button) is rendered below it.
 */
export function Field({ label, hint, className, children }: { label: ReactNode; hint?: string; className?: string; children: ReactNode }) {
  const auto = useId();
  const items = Children.toArray(children);
  const at = items.findIndex((c) => isValidElement(c));
  const control = at < 0 ? null : (items[at] as ReactElement<{ id?: string }>);
  const id = control?.props.id ?? auto;
  return (
    <div className={className}>
      <Label htmlFor={id} hint={hint}>
        {label}
      </Label>
      {control ? items.map((c, i) => (i === at ? cloneElement(control, { id }) : c)) : items}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${base} h-12 ${props.className ?? ""}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${base} min-h-32 resize-y leading-7 ${props.className ?? ""}`} />;
}

export function Select({ children, className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <span className="relative block">
      <select {...props} className={`${base} h-12 appearance-none pe-10 ${className}`}>
        {children}
      </select>
      <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute end-4 top-1/2 size-4 -translate-y-1/2 text-faint" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </span>
  );
}

export function Button({ variant = "primary", className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "soft" }) {
  const styles = {
    primary: "bg-magenta text-white hover:bg-magenta-deep shadow-[0_12px_32px_-12px_rgb(223_17_115/0.8)]",
    ghost: "border border-line-strong text-fg hover:border-pink/60",
    soft: "bg-white/[0.06] text-fg hover:bg-white/10",
  }[variant];
  return <button {...props} className={`inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`} />;
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  return <span aria-hidden className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}
