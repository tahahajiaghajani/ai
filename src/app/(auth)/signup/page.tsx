"use client";
import * as React from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { signUpAction, type AuthState } from "@/app/actions/auth";
import { Button, Field, Input } from "@/components/ui/primitives";

export default function SignupPage() {
  const [state, action, pending] = React.useActionState<AuthState, FormData>(signUpAction, null);
  return (
    <div>
      <h1 className="text-2xl font-black">ثبت‌نام تسک‌دهنده</h1>
      <p className="mt-2 text-sm text-muted">پس از ثبت‌نام، حساب شما باید توسط مدیر تایید شود.</p>
      <form action={action} className="mt-8 space-y-4">
        <Field label="نام و نام خانوادگی" required>
          <Input name="full_name" required autoComplete="name" />
        </Field>
        <Field label="واحد / بانک / سازمان">
          <Input name="org_unit" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ایمیل" required>
            <Input name="email" type="email" dir="ltr" required autoComplete="email" />
          </Field>
          <Field label="موبایل">
            <Input name="phone" dir="ltr" inputMode="tel" />
          </Field>
        </div>
        <Field label="رمز عبور" hint="حداقل ۸ کاراکتر" required>
          <Input name="password" type="password" dir="ltr" required minLength={8} autoComplete="new-password" />
        </Field>
        {state?.error ? <p className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-600">{state.error}</p> : null}
        {state?.message ? <p className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-700">{state.message}</p> : null}
        <Button type="submit" size="lg" className="w-full" loading={pending}>
          <UserPlus className="size-5" /> ثبت‌نام
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        قبلاً ثبت‌نام کرده‌اید؟{" "}
        <Link href="/login" className="font-bold text-primary">
          ورود
        </Link>
      </p>
    </div>
  );
}
