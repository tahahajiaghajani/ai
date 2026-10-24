"use server";

import { redirect } from "next/navigation";
import { changePassword, signIn, signUp, updateProfile } from "@/app/actions/account";
import { accountCopy } from "@/content/copy/account";
import { langOf } from "@/lib/action";
import { latinDigits } from "@/lib/format";

/**
 * The account's credential forms as form actions (FormData in, state out), for a submit that happens before the
 * page's script has run or without JS: React renders these forms as method="POST" with the action id, so a
 * password never lands in a URL. With JS the forms call the actions in account.ts themselves (same checks, same
 * limits) and these are not used. Sign-in and sign-up go on with a redirect; errors come back as form state.
 */

export type FormState = { error: string; field?: string; values?: Record<string, string>; ok?: boolean } | null;

const str = (f: FormData, k: string, max = 200) => String(f.get(k) ?? "").slice(0, max);

export async function signInForm(_prev: FormState, f: FormData): Promise<FormState> {
  const login = str(f, "login", 160);
  const r = await signIn({ login, password: str(f, "password", 200), lang: str(f, "lang", 4), next: str(f, "next", 400) });
  if (r.ok) redirect(r.next);
  return { error: r.error, field: r.field, values: { login } };
}

export async function signUpForm(_prev: FormState, f: FormData): Promise<FormState> {
  const values = { name: str(f, "name", 80), phone: str(f, "phone", 30), email: str(f, "email", 160), business: str(f, "business", 120) };
  const r = await signUp({ ...values, password: str(f, "password", 200), website: str(f, "website"), lang: str(f, "lang", 4), next: str(f, "next", 400) });
  if (r.ok) redirect(r.next);
  return { error: r.error, field: r.field, values };
}

export async function updateProfileForm(_prev: FormState, f: FormData): Promise<FormState> {
  const values = {
    name: str(f, "profile-name", 80),
    email: str(f, "profile-email", 160),
    business: str(f, "profile-business", 120),
    city: str(f, "profile-city", 80),
    address: str(f, "profile-address", 400),
    postal_code: latinDigits(str(f, "profile-postal_code", 20)).replace(/[\s-]/g, ""),
  };
  const lang = langOf(f.get("lang"));
  if (values.postal_code && !/^\d{10}$/.test(values.postal_code)) return { error: accountCopy(lang).fields.postalBad, field: "postal_code", values };
  const r = await updateProfile({ ...values, lang });
  return r.ok ? { ok: true, error: "", values: { ...values, message: r.message ?? "" } } : { error: r.error, field: r.field, values };
}

export async function changePasswordForm(_prev: FormState, f: FormData): Promise<FormState> {
  const r = await changePassword({ current: str(f, "pw-current"), password: str(f, "pw-password"), lang: str(f, "lang", 4) });
  return r.ok ? { ok: true, error: "", values: { message: r.message ?? "" } } : { error: r.error, field: r.field };
}
