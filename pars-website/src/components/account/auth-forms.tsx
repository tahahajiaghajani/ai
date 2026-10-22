"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import type { Copy } from "@/content/fa";
import { href, type Lang } from "@/lib/i18n";
import { changePassword, requestReset, resetPassword, signIn, signUp, updateProfile, type Result } from "@/app/actions/account";
import { Button, Input, Label, Spinner } from "@/components/ui/field";

type T = Copy["account"];

const NET_ERROR = { fa: "ارتباط برقرار نشد؛ اتصال اینترنت را بررسی کنید و دوباره امتحان کنید.", en: "Couldn't connect — check your connection and try again." };

/** Submits a form to a Server Action and keeps its outcome; `onOk` runs on success. */
function useSubmit<R extends Result>(lang: Lang, run: (data: Record<string, unknown>) => Promise<R>, onOk?: (r: Extract<R, { ok: true }>, form: HTMLFormElement) => void) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = { ...Object.fromEntries(new FormData(form)), lang };
    setNote(null);
    start(async () => {
      try {
        const r = await run(data);
        if (!r.ok) return setNote({ ok: false, text: r.error });
        if (r.message) setNote({ ok: true, text: r.message });
        onOk?.(r as Extract<R, { ok: true }>, form);
      } catch {
        setNote({ ok: false, text: NET_ERROR[lang] });
      }
    });
  };
  return { pending, note, submit };
}

function Note({ note }: { note: { ok: boolean; text: string } | null }) {
  if (!note) return null;
  return (
    <p role={note.ok ? "status" : "alert"} className={`rounded-2xl border px-4 py-3 text-sm ${note.ok ? "border-success/30 bg-success/10" : "border-danger/30 bg-danger/10"}`}>
      {note.text}
    </p>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <Label htmlFor={id} hint={hint}>
        {label}
      </Label>
      {children}
    </div>
  );
}

export function AuthForm({ lang, t, initialMode, next }: { lang: Lang; t: T; initialMode: "signin" | "signup"; next: string }) {
  const [mode, setMode] = useState(initialMode);
  const go = (r: { next: string }) => window.location.assign(r.next);
  const signin = useSubmit(lang, signIn, go);
  const signup = useSubmit(lang, signUp, go);
  const f = mode === "signin" ? signin : signup;
  return (
    <div className="card mx-auto w-full max-w-md p-7 sm:p-9">
      <div role="tablist" className="mb-7 flex rounded-2xl border border-line p-1">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition ${mode === m ? "bg-white/[0.08] text-fg" : "text-muted hover:text-fg"}`}
          >
            {m === "signin" ? t.signIn : t.signUp}
          </button>
        ))}
      </div>
      <h1 className="text-xl font-semibold">{mode === "signin" ? t.signInTitle : t.signUpTitle}</h1>
      <form key={mode} onSubmit={f.submit} className="mt-6 space-y-5">
        <input type="hidden" name="next" value={next} />
        {mode === "signup" && (
          <Field id="name" label={t.name}>
            <Input id="name" name="name" autoComplete="name" maxLength={80} required />
          </Field>
        )}
        <Field id="email" label={t.email}>
          <Input id="email" name="email" type="email" autoComplete="email" maxLength={160} dir="ltr" required />
        </Field>
        <Field id="password" label={t.password} hint={mode === "signup" ? t.passwordHint : undefined}>
          <Input id="password" name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={mode === "signup" ? 8 : undefined} maxLength={72} dir="ltr" required />
        </Field>
        {mode === "signup" && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="phone" label={t.phone} hint={t.optional}>
              <Input id="phone" name="phone" type="tel" autoComplete="tel" maxLength={30} dir="ltr" />
            </Field>
            <Field id="organization" label={t.organization} hint={t.optional}>
              <Input id="organization" name="organization" autoComplete="organization" maxLength={120} />
            </Field>
          </div>
        )}
        {/* honeypot */}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -start-[9999px] h-0 w-0 opacity-0" />
        <Note note={f.note} />
        <Button type="submit" className="w-full" disabled={f.pending}>
          {f.pending ? <Spinner /> : null}
          {mode === "signin" ? t.submitSignIn : t.submitSignUp}
        </Button>
      </form>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-sm">
        <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="text-violet hover:text-fg">
          {mode === "signin" ? `${t.noAccount} ${t.signUp}` : `${t.haveAccount} ${t.signIn}`}
        </button>
        {mode === "signin" && (
          <a href={href(lang, "/account/reset")} className="text-muted hover:text-fg">
            {t.forgot}
          </a>
        )}
      </div>
    </div>
  );
}

export function ResetRequestForm({ lang, t }: { lang: Lang; t: T }) {
  const f = useSubmit(lang, requestReset);
  return (
    <form onSubmit={f.submit} className="card mx-auto w-full max-w-md space-y-5 p-7 sm:p-9">
      <h1 className="text-xl font-semibold">{t.resetTitle}</h1>
      <Field id="email" label={t.email}>
        <Input id="email" name="email" type="email" autoComplete="email" maxLength={160} dir="ltr" required />
      </Field>
      <Note note={f.note} />
      <Button type="submit" className="w-full" disabled={f.pending}>
        {f.pending ? <Spinner /> : null}
        {t.resetSend}
      </Button>
      <a href={href(lang, "/account/login")} className="block text-center text-sm text-muted hover:text-fg">
        {t.backToSignIn}
      </a>
    </form>
  );
}

export function ResetPasswordForm({ lang, t, token }: { lang: Lang; t: T; token: string }) {
  const f = useSubmit(lang, resetPassword, (r) => window.location.assign(r.next));
  return (
    <form onSubmit={f.submit} className="card mx-auto w-full max-w-md space-y-5 p-7 sm:p-9">
      <h1 className="text-xl font-semibold">{t.newPasswordTitle}</h1>
      <input type="hidden" name="token" value={token} />
      <Field id="password" label={t.newPassword} hint={t.passwordHint}>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} dir="ltr" required />
      </Field>
      <Note note={f.note} />
      <Button type="submit" className="w-full" disabled={f.pending}>
        {f.pending ? <Spinner /> : null}
        {t.setPassword}
      </Button>
    </form>
  );
}

export function ProfileForm({ lang, t, initial }: { lang: Lang; t: T; initial: { name: string; email: string; phone: string; organization: string } }) {
  const f = useSubmit(lang, updateProfile);
  return (
    <form onSubmit={f.submit} className="space-y-5">
      <Field id="name" label={t.name}>
        <Input id="name" name="name" defaultValue={initial.name} autoComplete="name" maxLength={80} required />
      </Field>
      <Field id="email" label={t.email}>
        <Input id="email" value={initial.email} dir="ltr" readOnly disabled />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="phone" label={t.phone} hint={t.optional}>
          <Input id="phone" name="phone" defaultValue={initial.phone} type="tel" autoComplete="tel" maxLength={30} dir="ltr" />
        </Field>
        <Field id="organization" label={t.organization} hint={t.optional}>
          <Input id="organization" name="organization" defaultValue={initial.organization} autoComplete="organization" maxLength={120} />
        </Field>
      </div>
      <Note note={f.note} />
      <Button type="submit" disabled={f.pending}>
        {f.pending ? <Spinner /> : null}
        {t.save}
      </Button>
    </form>
  );
}

export function PasswordForm({ lang, t }: { lang: Lang; t: T }) {
  const f = useSubmit(lang, changePassword, (_r, form) => form.reset());
  return (
    <form onSubmit={f.submit} className="space-y-5">
      <Field id="current" label={t.currentPassword}>
        <Input id="current" name="current" type="password" autoComplete="current-password" maxLength={72} dir="ltr" required />
      </Field>
      <Field id="newpass" label={t.newPassword} hint={t.passwordHint}>
        <Input id="newpass" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} dir="ltr" required />
      </Field>
      <Note note={f.note} />
      <Button type="submit" variant="soft" disabled={f.pending}>
        {f.pending ? <Spinner /> : null}
        {t.changePassword}
      </Button>
    </form>
  );
}
