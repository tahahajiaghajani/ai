"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { changePassword, signOut, updateProfile } from "@/app/actions/account";
import { accountCopy } from "@/content/copy/account";
import { commonCopy } from "@/content/copy/common";
import { formatPhone, latinDigits, num, type Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { Icon } from "@/components/ui/icons";
import { sessionChanged } from "@/components/pro/session";
import { FormNote, SectionTitle, TextArea, TextField, btn } from "@/components/account/ui";

interface Profile {
  name: string;
  phone: string;
  email: string;
  business: string;
  city: string;
  address: string;
  postal_code: string;
}

type Note = { tone: "ok" | "error"; text: string } | null;

export function ProfileForms({ lang, initial, hasPassword }: { lang: Lang; initial: Profile; hasPassword: boolean }) {
  return (
    <div className="max-w-3xl space-y-14">
      <DetailsForm lang={lang} initial={initial} />
      <PasswordForm lang={lang} hasPassword={hasPassword} username={initial.phone} />
      <SignOutCard lang={lang} />
    </div>
  );
}

function DetailsForm({ lang, initial }: { lang: Lang; initial: Profile }) {
  const c = accountCopy(lang);
  const f = c.fields;
  const router = useRouter();
  // stored digits are Latin; Persian pages show Persian digits (normalised again on save)
  const [v, setV] = useState({ ...initial, postal_code: num(initial.postal_code, lang) });
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Profile, string>>>({});
  const set = (k: keyof Profile) => (e: { target: { value: string } }) => {
    setV((s) => ({ ...s, [k]: e.target.value }));
    setNote(null);
    if (errors[k]) setErrors((s) => ({ ...s, [k]: undefined }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const postal = latinDigits(v.postal_code).replace(/[\s-]/g, "");
    if (postal && !/^\d{10}$/.test(postal)) {
      setErrors({ postal_code: f.postalBad });
      document.getElementById("profile-postal_code")?.focus();
      return;
    }
    setPending(true);
    setNote(null);
    setErrors({});
    try {
      const r = await updateProfile({ ...v, postal_code: postal, lang });
      if (r.ok) {
        setV((s) => ({ ...s, postal_code: num(postal, lang) }));
        setNote({ tone: "ok", text: r.message ?? c.profile.saved });
        void sessionChanged();
        router.refresh();
      } else if (r.field) {
        setErrors({ [r.field]: r.error });
        document.getElementById(`profile-${r.field}`)?.focus();
      } else setNote({ tone: "error", text: r.error });
    } catch {
      setNote({ tone: "error", text: commonCopy(lang).errors.network });
    }
    setPending(false);
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="profile-details">
      <SectionTitle id="profile-details">{c.profile.details}</SectionTitle>
      <div className="grid gap-6 sm:grid-cols-2">
        <TextField id="profile-name" label={f.name} value={v.name} onChange={set("name")} autoComplete="name" maxLength={80} required error={errors.name} />
        <TextField id="profile-phone" label={f.phone} value={formatPhone(v.phone, lang)} readOnly dir="ltr" help={c.profile.phoneNote} className="cursor-default bg-bone text-ink-2 focus:border-control" />
        <TextField id="profile-email" label={f.email} optional={f.optional} type="email" inputMode="email" dir="ltr" value={v.email} onChange={set("email")} autoComplete="email" spellCheck={false} autoCapitalize="none" maxLength={160} error={errors.email} />
        <TextField id="profile-business" label={f.business} optional={f.optional} value={v.business} onChange={set("business")} autoComplete="organization" maxLength={120} />
      </div>
      <h3 className="label mt-10 mb-5">{c.profile.addressTitle}</h3>
      <div className="grid gap-6 sm:grid-cols-2">
        <TextField id="profile-city" label={f.city} value={v.city} onChange={set("city")} autoComplete="address-level2" maxLength={80} />
        <TextField id="profile-postal_code" label={f.postal} optional={f.optional} value={v.postal_code} onChange={set("postal_code")} inputMode="numeric" dir="ltr" autoComplete="postal-code" maxLength={14} help={f.postalHelp} error={errors.postal_code} />
        <TextArea id="profile-address" label={f.address} value={v.address} onChange={set("address")} autoComplete="street-address" maxLength={400} rows={2} help={f.addressHelp} wrapClassName="sm:col-span-2" />
      </div>
      <div aria-live="polite" className="mt-6 empty:mt-0">
        {note && <FormNote tone={note.tone}>{note.text}</FormNote>}
      </div>
      <button type="submit" disabled={pending} className={`${btn.primary} mt-6 w-full sm:w-auto sm:min-w-44`}>
        {pending ? "…" : c.profile.save}
      </button>
    </form>
  );
}

function PasswordForm({ lang, hasPassword, username }: { lang: Lang; hasPassword: boolean; username: string }) {
  const c = accountCopy(lang);
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [errors, setErrors] = useState<{ current?: string; password?: string }>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setNote(null);
    setErrors({});
    try {
      const r = await changePassword({ current, password: next, lang });
      if (r.ok) {
        setCurrent("");
        setNext("");
        setNote({ tone: "ok", text: r.message ?? c.profile.saved });
        router.refresh();
      } else if (r.field === "current" || r.field === "password") {
        setErrors({ [r.field]: r.error });
        document.getElementById(`pw-${r.field}`)?.focus();
      } else setNote({ tone: "error", text: r.error });
    } catch {
      setNote({ tone: "error", text: commonCopy(lang).errors.network });
    }
    setPending(false);
  }

  const eye = (
    <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? c.fields.hide : c.fields.show} aria-pressed={show} className="absolute inset-y-0 end-0 grid w-12 place-items-center text-muted hover:text-ink">
      <Icon name={show ? "eye-off" : "eye"} className="size-5" />
    </button>
  );

  return (
    <form onSubmit={submit} noValidate aria-labelledby="profile-password" className="border-t border-line pt-10">
      <SectionTitle id="profile-password">{hasPassword ? c.profile.passwordChange : c.profile.passwordSet}</SectionTitle>
      {!hasPassword && <p className="-mt-1 mb-6 max-w-xl text-sm leading-7 text-muted">{c.profile.passwordSetLead}</p>}
      {/* lets password managers pair the new password with the account */}
      <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
      <div className="grid gap-6 sm:grid-cols-2">
        {hasPassword && (
          <TextField
            id="pw-current"
            label={c.fields.currentPassword}
            type={show ? "text" : "password"}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            dir="ltr"
            maxLength={128}
            required
            error={errors.current}
            end={eye}
          />
        )}
        <TextField
          id="pw-password"
          label={c.fields.newPassword}
          type={show ? "text" : "password"}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          dir="ltr"
          maxLength={128}
          required
          error={errors.password}
          help={c.auth.strength.empty}
          end={hasPassword ? undefined : eye}
        />
      </div>
      <div aria-live="polite" className="mt-6 empty:mt-0">
        {note && <FormNote tone={note.tone}>{note.text}</FormNote>}
      </div>
      <button type="submit" disabled={pending || next.length < 8 || (hasPassword && !current)} className={`${btn.outline} mt-6 w-full sm:w-auto sm:min-w-44`}>
        {pending ? "…" : c.profile.passwordSave}
      </button>
    </form>
  );
}

function SignOutCard({ lang }: { lang: Lang }) {
  const c = accountCopy(lang).profile;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <section aria-labelledby="profile-signout" className="border-t border-line pt-10">
      <SectionTitle id="profile-signout">{c.signOutTitle}</SectionTitle>
      <p className="-mt-1 max-w-xl text-sm leading-7 text-muted">{c.signOutText}</p>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          try {
            await signOut();
          } finally {
            await sessionChanged();
            router.replace(href(lang, "/"));
            router.refresh();
          }
        }}
        className={`${btn.outline} mt-6 w-full sm:w-auto sm:min-w-44`}
      >
        <Icon name="logout" className="size-4 rtl:-scale-x-100" />
        {pending ? "…" : c.signOut}
      </button>
    </section>
  );
}
