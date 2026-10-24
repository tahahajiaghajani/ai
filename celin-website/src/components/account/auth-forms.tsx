"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useId, useState, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { signIn, signUp } from "@/app/actions/account";
import { signInForm, signUpForm } from "@/app/actions/account-forms";
import { accountCopy } from "@/content/copy/account";
import { commonCopy } from "@/content/copy/common";
import { num, type Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { Icon } from "@/components/ui/icons";
import { ArchDoor } from "@/components/ui/arch-door";
import { CodeInput, type CodeState } from "@/components/pro/code-input";
import { ProHallmark, ProSeal } from "@/components/pro/seal";
import { sessionChanged } from "@/components/pro/session";
import { ProSteps } from "@/components/pro/steps";
import { StoreContact, contactLinks, type StoreContactInfo } from "@/components/account/contact";
import { BusyLabel, FormNote, TextField, btn } from "@/components/account/ui";

export type AuthTab = "signin" | "signup" | "code";
const TABS: AuthTab[] = ["signin", "signup", "code"];

type Errors = Partial<Record<string, string>>;

/** The login page with a tab (and where to go after): the tabs are real links, so they work without JS too. */
const tabHref = (lang: Lang, t: AuthTab, next: string) => `${href(lang, "/account/login")}?tab=${t}&next=${encodeURIComponent(next)}`;

/** A link to another tab; with JS it switches in place (no round trip). */
function TabLink({ lang, tab, next, onSwitch, className, children }: { lang: Lang; tab: AuthTab; next: string; onSwitch: () => void; className: string; children: ReactNode }) {
  return (
    <a
      href={tabHref(lang, tab, next)}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
        e.preventDefault();
        onSwitch();
      }}
      className={className}
    >
      {children}
    </a>
  );
}

/** «یا» between two hairlines, a rhombus on each side. */
function OrRule({ lang }: { lang: Lang }) {
  return (
    <p className="flex items-center gap-3 font-ui text-xs text-muted" aria-hidden>
      <span className="h-px flex-1 bg-linear-to-r from-transparent to-gold/40 rtl:bg-linear-to-l" />
      <span className="size-1 rotate-45 bg-gold/60" />
      {accountCopy(lang).auth.or}
      <span className="size-1 rotate-45 bg-gold/60" />
      <span className="h-px flex-1 bg-linear-to-l from-transparent to-gold/40 rtl:bg-linear-to-r" />
    </p>
  );
}

/**
 * «ورود» · «ثبت‌نام» · «ورود با کد Pro» on one page, inside the CELIN doorway; the tab lives in the URL (?tab=)
 * without a server round trip. Sign-in and sign-up stand on porcelain under the CELIN mark; the Pro code tab
 * turns the doorway into the night salon with the PRO hallmark, the 12-digit cells and the four steps.
 */
export function AuthForms({ lang, tab: initial, next, contact }: { lang: Lang; tab: AuthTab; next: string; contact: StoreContactInfo }) {
  const c = accountCopy(lang);
  const [tab, setTabState] = useState<AuthTab>(initial);
  const [codeState, setCodeState] = useState<CodeState>("idle");
  // the code field takes the focus on ?tab=code and when its tab is clicked, not while arrowing over the tabs
  const [via, setVia] = useState<"load" | "pointer" | "keyboard">("load");
  const router = useRouter();
  const base = useId();
  const night = tab === "code";
  const links = contactLinks(contact, lang);
  const hasContact = Boolean(links.tel || links.wa);

  function setTab(t: AuthTab, how: "pointer" | "keyboard" = "pointer") {
    setVia(how);
    setTabState(t);
    setCodeState("idle");
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("tab", t);
      window.history.replaceState(window.history.state, "", u.pathname + u.search);
    } catch {
      // URL sync is a convenience only
    }
  }

  // an in-form link unmounts with its form: the focus moves to the tab it opened instead of falling to <body>
  // (the code field takes it by itself)
  function switchTo(t: AuthTab) {
    setTab(t);
    document.getElementById(`${base}-tab-${t}`)?.focus();
  }

  const done = async (to: string) => {
    await sessionChanged();
    router.replace(to);
  };

  const crown = night ? (
    <ProHallmark className="size-[6.5rem] animate-fade-in sm:size-28" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/celin-mark.svg" alt="" width={186} height={256} className="h-16 w-auto animate-fade-in sm:h-[4.5rem]" />
  );

  return (
    <div data-pro-state={codeState} data-tone={night ? "light" : undefined}>
      <ArchDoor tone={night ? "night" : "light"} crown={crown} bodyClassName="px-6 pt-[clamp(3rem,13vw,4.25rem)] pb-9 sm:px-10 sm:pb-11">
        <div className="mt-5 text-center">
          <p className={`label flex items-center justify-center gap-2.5 ${night ? "text-gold-on-dark!" : "text-gold-text!"}`}>
            <span aria-hidden className="size-1 rotate-45 bg-current" />
            {c.auth.eyebrow}
            <span aria-hidden className="size-1 rotate-45 bg-current" />
          </p>
          <h1 className={`title-page mt-2 ${night ? "text-metal-light" : "text-ink"}`}>{c.auth.titles[tab]}</h1>
          <p className={`mx-auto mt-2 max-w-xs font-ui text-sm leading-7 ${night ? "text-on-night-muted" : "text-muted"}`}>{c.auth.leads[tab]}</p>
        </div>

        <div role="tablist" aria-label={c.auth.eyebrow} className={`relative mt-8 grid grid-cols-3 border-b font-ui text-sm ${night ? "border-night-line" : "border-line"}`} style={{ "--t": TABS.indexOf(tab) } as CSSProperties}>
          {TABS.map((t) => (
            // links to ?tab= (they work without JS); with JS a roving tablist switching in place
            <a
              key={t}
              id={`${base}-tab-${t}`}
              href={tabHref(lang, t, next)}
              role="tab"
              aria-selected={tab === t}
              aria-controls={`${base}-panel`}
              tabIndex={tab === t ? 0 : -1}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
                e.preventDefault();
                setTab(t, e.detail === 0 ? "keyboard" : "pointer");
              }}
              onKeyDown={(e) => {
                const dir = document.documentElement.dir === "rtl" ? -1 : 1;
                const step = e.key === "ArrowRight" ? dir : e.key === "ArrowLeft" ? -dir : 0;
                const nextTab = e.key === "Home" ? TABS[0] : e.key === "End" ? TABS[TABS.length - 1] : step ? TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length] : null;
                if (!nextTab) return;
                e.preventDefault();
                setTab(nextTab, "keyboard");
                document.getElementById(`${base}-tab-${nextTab}`)?.focus();
              }}
              className={`grid min-h-12 place-items-center px-1 text-center leading-5 transition-colors duration-300 ${tab === t ? (night ? "text-on-night" : "text-ink") : night ? "text-on-night-muted hover:text-on-night" : "text-muted hover:text-ink"}`}
            >
              {c.auth.tabs[t]}
            </a>
          ))}
          {/* a metal rule slides under the open tab, its keystone in the middle */}
          <span aria-hidden className={`absolute -bottom-px h-px w-1/3 transition-[inset-inline-start] duration-500 ease-[var(--ease-out-expo)] ${night ? "bg-[image:var(--metal-champagne)]" : "bg-[image:var(--metal-copper)]"}`} style={{ insetInlineStart: "calc(var(--t) * 100% / 3)" }}>
            <span className={`absolute top-0 left-1/2 size-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 ${night ? "bg-gold-glow" : "bg-gold"}`} />
          </span>
        </div>

        <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${tab}`} className="pt-8">
          {tab === "signin" && <SignInForm lang={lang} next={next} onDone={done} onCode={() => setTab("code")} onSignup={() => switchTo("signup")} contact={contact} />}
          {tab === "signup" && <SignUpForm lang={lang} next={next} onDone={done} onSignin={() => switchTo("signin")} />}
          {tab === "code" && (
            <div className="space-y-8">
              <CodeInput lang={lang} next={next} autoFocus={via !== "keyboard"} tone="night" hideLabel onState={setCodeState} onDone={(r) => router.replace(r.next)} />
              <ProSteps lang={lang} current={codeState === "ok" ? 4 : 3} tone="night" />
              <div className="flex flex-col items-center gap-1 border-t border-night-line pt-6 text-center font-ui text-sm text-on-night-muted">
                <p>{commonCopy(lang).proSheet.noCode}</p>
                {hasContact ? (
                  <StoreContact contact={contact} lang={lang} tone="night" className="justify-center" />
                ) : (
                  <Link href={href(lang, "/contact")} className="btn-link btn-link-light">
                    {commonCopy(lang).proSheet.contact}
                  </Link>
                )}
                <TabLink lang={lang} tab="signin" next={next} onSwitch={() => switchTo("signin")} className="btn-link btn-link-light mt-2">
                  {c.auth.toSignin}
                </TabLink>
              </div>
            </div>
          )}
        </div>
      </ArchDoor>
    </div>
  );
}

function PasswordField({ id, label, value, onChange, error, autoComplete, help, lang, describedBy }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; autoComplete: string; help?: React.ReactNode; lang: Lang; describedBy?: string }) {
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
      {...(describedBy ? { "aria-invalid": true, "aria-describedby": describedBy } : {})}
      end={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? c.hide : c.show}
          aria-pressed={show}
          className="absolute inset-y-0 end-0 grid w-12 place-items-center text-muted transition-colors hover:text-gold-text"
        >
          <Icon name={show ? "eye-off" : "eye"} className="size-5" />
        </button>
      }
    />
  );
}

/** Sends the form through the client action with JS; the form action (POST) covers a submit before hydration. */
function Hidden({ lang, next }: { lang: Lang; next: string }) {
  return (
    <>
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="next" value={next} />
    </>
  );
}

function SignInForm({ lang, next, onDone, onCode, onSignup, contact }: { lang: Lang; next: string; onDone: (to: string) => Promise<void>; onCode: () => void; onSignup: () => void; contact: StoreContactInfo }) {
  const c = accountCopy(lang);
  // without JS (or before hydration) the form posts to signInForm; its answer comes back here as state
  const [state, formAction] = useActionState(signInForm, null);
  const [login, setLogin] = useState(state?.values?.login ?? "");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(state?.error ?? "");
  const [empty, setEmpty] = useState<{ login?: string; password?: string }>({});
  const noteId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    // an empty field says so (and takes the focus), instead of a submit that does nothing
    const missing = { login: login.trim() ? undefined : c.fields.loginEmpty, password: password ? undefined : c.fields.passwordEmpty };
    if (missing.login || missing.password) {
      setEmpty(missing);
      setError("");
      document.getElementById(missing.login ? "login" : "password")?.focus();
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

  // a wrong number or password marks both fields and points them at the note
  const wrong = error ? noteId : undefined;
  return (
    <form action={formAction} onSubmit={submit} className="space-y-6" noValidate>
      <Hidden lang={lang} next={next} />
      <TextField
        id="login"
        label={c.fields.login}
        value={login}
        onChange={(e) => {
          setLogin(e.target.value);
          if (empty.login) setEmpty((m) => ({ ...m, login: undefined }));
        }}
        autoComplete="username"
        dir="ltr"
        spellCheck={false}
        autoCapitalize="none"
        maxLength={160}
        required
        error={empty.login}
        {...(wrong ? { "aria-invalid": true, "aria-describedby": wrong } : {})}
      />
      <PasswordField
        id="password"
        label={c.fields.password}
        value={password}
        onChange={(v) => {
          setPassword(v);
          if (empty.password) setEmpty((m) => ({ ...m, password: undefined }));
        }}
        autoComplete="current-password"
        lang={lang}
        error={empty.password}
        describedBy={wrong}
      />
      <div className="empty:hidden">{error && <FormNote tone="error" id={noteId}>{error}</FormNote>}</div>
      {/* aria-disabled (not disabled) while sending: the focus stays on the button */}
      <button type="submit" aria-disabled={pending || undefined} aria-busy={pending || undefined} className={`${btn.metal} btn-lg w-full`}>
        <BusyLabel busy={pending}>{c.auth.signIn}</BusyLabel>
      </button>
      <OrRule lang={lang} />
      <TabLink lang={lang} tab="code" next={next} onSwitch={onCode} className={`${btn.outline} btn-lg w-full`}>
        <ProSeal className="-my-1 scale-[0.8]" />
        {c.auth.tabs.code}
      </TabLink>
      <div className="space-y-3 border-t border-line pt-6 text-center font-ui text-sm leading-7">
        <div className="text-muted">
          <p className="text-xs leading-6">{c.auth.forgot}</p>
          <StoreContact contact={contact} lang={lang} className="mt-1 justify-center" />
        </div>
        <TabLink lang={lang} tab="signup" next={next} onSwitch={onSignup} className={btn.quiet}>
          {c.auth.toSignup}
        </TabLink>
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
  // without JS (or before hydration) the form posts to signUpForm; its answer comes back here as state
  const [state, formAction] = useActionState(signUpForm, null);
  const [f, setF] = useState({ name: "", phone: "", password: "", email: "", business: "", website: "", ...state?.values });
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Errors>(state?.field ? { [state.field]: state.error } : {});
  const [error, setError] = useState(state && !state.field ? state.error : "");
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
    <form action={formAction} onSubmit={submit} className="space-y-6" noValidate>
      <Hidden lang={lang} next={next} />
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
            <span className="flex w-20 gap-1" aria-hidden>
              {[1, 2, 3].map((i) => (
                <span key={i} className={`h-[3px] flex-1 transition-colors duration-500 ${st.level >= i ? (st.level === 1 ? "bg-warning" : "bg-[image:var(--metal-copper)]") : "bg-line-strong/40"}`} />
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
      <div className="empty:hidden">{error && <FormNote tone="error">{error}</FormNote>}</div>
      {/* aria-disabled (not disabled) while sending: the focus stays on the button */}
      <button type="submit" aria-disabled={pending || undefined} aria-busy={pending || undefined} className={`${btn.metal} btn-lg w-full`}>
        <BusyLabel busy={pending}>{c.auth.signUp}</BusyLabel>
      </button>
      <p className="flex items-start gap-2 font-ui text-xs leading-6 text-muted">
        <Icon name="lock" className="mt-1 size-3.5 shrink-0 text-gold" />
        {c.auth.terms}
      </p>
      <p className="border-t border-line pt-6 text-center">
        <TabLink lang={lang} tab="signin" next={next} onSwitch={onSignin} className={btn.quiet}>
          {c.auth.toSignin}
        </TabLink>
      </p>
    </form>
  );
}
