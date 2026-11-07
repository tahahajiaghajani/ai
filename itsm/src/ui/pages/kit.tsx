// Small shared parts of the first-impression pages (auth, onboarding, business chooser, platform admin).
// Styles: ./pages.css (scoped under .pg-auth / .pg-plain).
import "./pages.css";
import { useCallback, type ReactNode } from "react";
import { Button, Dropdown, Tooltip, type FormInstance } from "antd";
import { CircleAlert, Check, Moon, Sun, LogOut, ShieldCheck, Building2 } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router";
import { useTheme } from "../lib/theme";
import { useSession } from "../lib/session";
import { Logo } from "../components/brand";

export const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

/** antd Input `classNames` for Latin values (email, URL, phone): typed LTR, aligned to the start next to the icon. */
export const LTR = { input: "pg-ltr" };

/** A form-level message that belongs to no single field: a surface with a ring, never a red slab. */
export function FormAlert({ children, tone = "danger" }: { children: ReactNode; tone?: "danger" | "warning" | "info" }) {
  return (
    <div className="pg-alert pg-swap" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      {tone === "warning" ? <span className="ds-nuqta" aria-hidden /> : <CircleAlert {...ICON} aria-hidden />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Validate on blur and on submit, never on each keystroke (components.md §5) — but once a field shows an error,
 * re-check it as the user types so the message clears the moment it is fixed. Pass the result to Form onValuesChange.
 */
export function useBlurValidation(form: FormInstance) {
  return useCallback(
    (changed: Record<string, unknown>) => {
      const names = Object.keys(changed).filter((n) => form.getFieldError(n).length > 0);
      if (names.length) form.validateFields(names).catch(() => {});
    },
    [form],
  );
}

/** The server's password rule (src/server/auth/password.ts passwordProblem), checked live as quiet hints. */
export function passwordIssue(pw: string | undefined): string | null {
  if (!pw || pw.length < 8) return "رمز عبور باید دست‌کم ۸ نویسه باشد.";
  if (pw.length > 200) return "رمز عبور خیلی طولانی است.";
  if (/^\d+$/.test(pw)) return "رمز عبور نباید فقط عدد باشد.";
  return null;
}

export function PasswordRules({ value }: { value: string | undefined }) {
  const v = value ?? "";
  const rules = [
    { ok: v.length >= 8, t: "دست‌کم ۸ نویسه" },
    { ok: v.length > 0 && !/^\d+$/.test(v), t: "فقط عدد نباشد" },
  ];
  return (
    <ul className="pg-req" aria-label="شرط‌های رمز عبور">
      {rules.map((r) => (
        <li key={r.t} data-ok={r.ok || undefined}>
          <span className="pg-req-m" aria-hidden>
            {r.ok ? <Check size={13} strokeWidth={2} absoluteStrokeWidth /> : null}
          </span>
          {r.t}
          <span className="sr-only">{r.ok ? "، برقرار است" : "، هنوز نه"}</span>
        </li>
      ))}
    </ul>
  );
}

/** Form rules for a new password: required, then the server's rule (the hints under the field say which part). */
export const newPasswordRules = (empty: string) => [
  { required: true, message: empty },
  {
    validator: (_: unknown, v: string | undefined) => {
      if (!v) return Promise.resolve();
      const p = passwordIssue(v);
      return p ? Promise.reject(new Error(p)) : Promise.resolve();
    },
  },
];

export function ThemeToggle() {
  const { dark, toggle } = useTheme();
  const label = dark ? "حالت روشن" : "حالت تیره";
  return (
    <Tooltip title={label}>
      <Button type="text" aria-label={label} icon={dark ? <Sun {...ICON} /> : <Moon {...ICON} />} onClick={toggle} />
    </Tooltip>
  );
}

/** Up to two initials for an avatar: «سارا محمدی» → «س‌م». */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "؟";
  return parts.length === 1 ? parts[0].slice(0, 1) : `${parts[0].slice(0, 1)}‌${parts[parts.length - 1].slice(0, 1)}`;
}

/** The quiet frame of the business chooser and the platform admin page: a glass top bar on the canvas. */
export function PlainFrame({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { me, logout } = useSession();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const user = me?.user;
  return (
    <div className="pg-plain">
      <header className="pg-bar">
        <Link to="/orgs" aria-label="سازمان‌ها" className="inline-flex items-center rounded-md p-1">
          <Logo size={22} />
        </Link>
        <div className="pg-bar-end">
          {user?.is_platform_admin && pathname !== "/admin" ? (
            <Button type="text" icon={<ShieldCheck {...ICON} />} onClick={() => nav("/admin")} className="max-sm:!hidden">
              مدیریت سامانه
            </Button>
          ) : null}
          <ThemeToggle />
          {user ? (
            <Dropdown
              trigger={["click"]}
              placement="bottomLeft"
              menu={{
                items: [
                  {
                    key: "who",
                    disabled: true,
                    label: (
                      <div className="py-1">
                        <div className="text-[13px] font-semibold leading-5 text-ink">{user.full_name}</div>
                        <div className="ds-latin text-ink-3">{user.email}</div>
                      </div>
                    ),
                  },
                  { type: "divider" },
                  { key: "orgs", icon: <Building2 {...ICON} />, label: "سازمان‌ها", onClick: () => nav("/orgs") },
                  ...(user.is_platform_admin ? [{ key: "admin", icon: <ShieldCheck {...ICON} />, label: "مدیریت سامانه", onClick: () => nav("/admin") }] : []),
                  { type: "divider" as const },
                  { key: "out", icon: <LogOut {...ICON} />, label: "خروج", onClick: logout },
                ],
              }}
            >
              <button type="button" className="pg-me" aria-label={`حساب ${user.full_name}`}>
                <span className="pg-av" aria-hidden>
                  {initials(user.full_name)}
                </span>
                <span className="pg-me-name">{user.full_name}</span>
              </button>
            </Dropdown>
          ) : null}
        </div>
      </header>
      <main className="pg-main" data-wide={wide || undefined}>
        {children}
      </main>
    </div>
  );
}
