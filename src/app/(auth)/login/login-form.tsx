"use client";
import * as React from "react";
import Link from "next/link";
import { LogIn } from "lucide-react";
import { signInAction, type AuthState } from "@/app/actions/auth";
import { Button, Field, Input } from "@/components/ui/primitives";

export function LoginForm({ next, disabled }: { next: string; disabled: boolean }) {
  const [state, action, pending] = React.useActionState<AuthState, FormData>(signInAction, null);
  return (
    <div>
      <h1 className="text-2xl font-black">خوش آمدید</h1>
      <p className="mt-2 text-sm text-muted">برای ثبت و پیگیری تسک‌ها وارد شوید.</p>
      {disabled ? <p className="mt-4 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-600">حساب شما غیرفعال شده است.</p> : null}
      <form action={action} className="mt-8 space-y-4">
        <input type="hidden" name="next" value={next} />
        <Field label="ایمیل">
          <Input name="email" type="email" dir="ltr" autoComplete="email" required placeholder="name@example.com" />
        </Field>
        <Field label="رمز عبور">
          <Input name="password" type="password" dir="ltr" autoComplete="current-password" required />
        </Field>
        {state?.error ? <p className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-600">{state.error}</p> : null}
        <Button type="submit" size="lg" className="w-full" loading={pending}>
          <LogIn className="size-5" /> ورود
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        حساب ندارید؟{" "}
        <Link href="/signup" className="font-bold text-primary">
          ثبت‌نام تسک‌دهنده
        </Link>
      </p>
    </div>
  );
}
