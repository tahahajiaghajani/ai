"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { signIn, signUp } from "@/app/actions/account";
import { accountCopy } from "@/content/copy/account";
import { commonCopy } from "@/content/copy/common";
import { num, type Lang } from "@/lib/format";
import { Icon } from "@/components/ui/icons";
import { CodeInput } from "@/components/pro/code-input";
import { sessionChanged } from "@/components/pro/session";
import { StoreContact, type StoreContactInfo } from "@/components/account/contact";
import { FormNote, TextField, btn } from "@/components/account/ui";

export type AuthTab = "signin" | "signup" | "code";
const TABS: AuthTab[] = ["signin", "signup", "code"];

type Errors = Partial<Record<string, string>>;

/** «ورود» · «ثبت‌نام» · «ورود با کد Pro» on one page; the tab lives in the URL (?tab=) without a server round trip. */
export function AuthForms({ lang, tab: initial, next, contact }: { lang: Lang; tab: AuthTab; next: string; contact: StoreContactInfo }) {
  const c = accountCopy(lang);
  const [tab, setTabState] = useState<AuthTab>(initial);
  const router = useRouter();
  const base = useId();

  function setTab(t: AuthTab) {
    setTabState(t);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("tab", t);
      window.history.replaceState(window.history.state, "", u.pathname + u.search);
    } catch {
      // URL sync is a convenience only
    }
  }

  const done = async (to: string) => {
    await sessionChanged();
    router.replace(to);
  };

  return (
    <div>
      <p className="label">{c.auth.eyebrow}</p>
      <h1 className="display mt-3 text-3xl sm:text-4xl">{c.auth.titles[tab]}</h1>
      <p className="mt-3 text-sm leading-7 text-muted">{c.auth.leads[tab]}</p>

      <div role="tablist" aria-label={c.auth.eyebrow} className="mt-8 grid grid-cols-3 border-b border-line text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            id={`${base}-tab-${t}`}
            role="tab"
            type="button"
            aria-selected={tab === t}
            aria-controls={`${base}-panel`}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => setTab(t)}
            onKeyDown={(e) => {
              const dir = document.documentElement.dir === "rtl" ? -1 : 1;
              const step = e.key === "ArrowRight" ? dir : e.key === "ArrowLeft" ? -dir : 0;
              if (!step) return;
              e.preventDefault();
              const nextTab = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length];
              setTab(nextTab);
              document.getElementById(`${base}-tab-${nextTab}`)?.focus();
            }}
            className={`-mb-px min-h-12 border-b px-1 leading-5 transition-colors ${tab === t ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {c.auth.tabs[t]}
          </button>
        ))}
      </div>

      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${tab}`} className="pt-8">
        {tab === "signin" && <SignInForm lang={lang} next={next} onDone={done} onCode={() => setTab("code")} onSignup={() => setTab("signup")} contact={contact} />}
        {tab === "signup" && <SignUpForm lang={lang} next={next} onDone={done} onSignin={() => setTab("signin")} />}
        {tab === "code" && (
          <div className="space-y-6">
            <CodeInput lang={lang} next={next} autoFocus onDone={(r) => router.replace(r.next)} />
            <button type="button" onClick={() => setTab("signin")} className={btn.text}>
              {c.auth.toSignin}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PasswordField({ id, label, value, onChange, error, autoComplete, help, lang }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; autoComplete: string; help?: React.ReactNode; lang: Lang }) {
  const c = accountCopy(lang).fields;
  const [show, setShow] = useState(false);
  return (
    <TextField
      id={id}
      label={label}
      type={show ? "text" : "password"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={autoComplete}
      dir="ltr"
      spellCheck={false}
      autoCapitalize="none"
      maxLength={128}
      required
      error={error}
      help={help}
      end={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? c.hide : c.show}
          aria-pressed={show}
          className="absolute inset-y-0 end-0 grid w-12 place-items-center text-muted hover:text-ink"
        >
          <Icon name={show ? "eye-off" : "eye"} className="size-5" />
        </button>
      }
    />
  );
}

function SignInForm({ lang, next, onDone, onCode, onSignup, contact }: { lang: Lang; next: string; onDone: (to: string) => Promise<void>; onCode: () => void; onSignup: () => void; contact: StoreContactInfo }) {
  const c = accountCopy(lang);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!login.trim() || !password) {
      document.getElementById(login.trim() ? "password" : "login")?.focus();
      return;
    }
    setPending(true);
    setError("");
    try {
      const r = await signIn({ login, password, lang, next });
      if (r.ok) return await onDone(r.next);
      setError(r.error);
    } catch {
      setError(commonCopy(lang).errors.network);
    }
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <TextField id="login" label={c.fields.login} value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" dir="ltr" spellCheck={false} autoCapitalize="none" maxLength={160} required />
      <PasswordField id="password" label={c.fields.password} value={password} onChange={setPassword} autoComplete="current-password" lang={lang} />
      <div aria-live="polite">{error && <FormNote tone="error">{error}</FormNote>}</div>
      <button type="submit" disabled={pending} className={`${btn.primary} w-full`}>
        {pending ? c.auth.pending : c.auth.signIn}
      </button>
      <div className="space-y-4 border-t border-line pt-6 text-sm leading-7">
        <p>
          <button type="button" onClick={onCode} className={`${btn.text} text-start`}>
            {c.auth.toCode}
          </button>
        </p>
        <div className="text-muted">
          <p>{c.auth.forgot}</p>
          <StoreContact contact={contact} lang={lang} className="mt-1" />
        </div>
        <p>
          <button type="button" onClick={onSignup} className={btn.quiet}>
            {c.auth.toSignup}
          </button>
        </p>
      </div>
    </form>
  );
}

function strength(p: string, lang: Lang): { text: string; level: 0 | 1 | 2 | 3 } {
  const c = accountCopy(lang).auth.strength;
  if (!p) return { text: c.empty, level: 0 };
  if (p.length < 8) return { text: c.short(num(8 - p.length, lang)), level: 1 };
  const kinds = [/[a-z]/i, /\d/, /[^a-z\d]/i].filter((r) => r.test(p)).length;
  return p.length >= 12 && kinds >= 2 ? { text: c.strong, level: 3 } : { text: c.ok, level: 2 };
}

function SignUpForm({ lang, next, onDone, onSignin }: { lang: Lang; next: string; onDone: (to: string) => Promise<void>; onSignin: () => void }) {
  const c = accountCopy(lang);
  const [f, setF] = useState({ name: "", phone: "", password: "", email: "", business: "", website: "" });
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setF((s) => ({ ...s, [k]: e.target.value }));
    if (errors[k]) setErrors((s) => ({ ...s, [k]: undefined }));
  };
  const st = strength(f.password, lang);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    setErrors({});
    try {
      const r = await signUp({ ...f, lang, next });
      if (r.ok) return await onDone(r.next);
      if (r.field) {
        setErrors({ [r.field]: r.error });
        document.getElementById(r.field)?.focus();
      } else setError(r.error);
    } catch {
      setError(commonCopy(lang).errors.network);
    }
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <TextField id="name" label={c.fields.name} value={f.name} onChange={set("name")} autoComplete="name" maxLength={80} required error={errors.name} />
      <TextField id="phone" label={c.fields.phone} type="tel" inputMode="tel" value={f.phone} onChange={set("phone")} autoComplete="tel" dir="ltr" maxLength={30} required error={errors.phone} help={c.fields.phoneHelp} />
      <PasswordField
        id="password"
        label={c.fields.password}
        value={f.password}
        onChange={(v) => {
          setF((s) => ({ ...s, password: v }));
          if (errors.password) setErrors((s) => ({ ...s, password: undefined }));
        }}
        autoComplete="new-password"
        error={errors.password}
        lang={lang}
        help={
          <span className="flex items-center gap-3" aria-live="polite">
            <span className="flex w-16 gap-1" aria-hidden>
              {[1, 2, 3].map((i) => (
                <span key={i} className={`h-0.5 flex-1 ${st.level >= i ? (st.level === 1 ? "bg-warning" : "bg-ink") : "bg-line-strong/50"}`} />
              ))}
            </span>
            {st.text}
          </span>
        }
      />
      <TextField id="email" label={c.fields.email} optional={c.fields.optional} type="email" inputMode="email" value={f.email} onChange={set("email")} autoComplete="email" dir="ltr" spellCheck={false} autoCapitalize="none" maxLength={160} error={errors.email} />
      <TextField id="business" label={c.fields.business} optional={c.fields.optional} value={f.business} onChange={set("business")} autoComplete="organization" maxLength={120} />
      {/* honeypot: people never see or reach it */}
      <div aria-hidden className="pointer-events-none absolute -z-10 size-0 overflow-hidden opacity-0">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} />
      </div>
      <div aria-live="polite">{error && <FormNote tone="error">{error}</FormNote>}</div>
      <button type="submit" disabled={pending} className={`${btn.primary} w-full`}>
        {pending ? c.auth.pending : c.auth.signUp}
      </button>
      <p className="text-xs leading-6 text-muted">{c.auth.terms}</p>
      <p className="border-t border-line pt-6">
        <button type="button" onClick={onSignin} className={btn.quiet}>
          {c.auth.toSignin}
        </button>
      </p>
    </form>
  );
}
