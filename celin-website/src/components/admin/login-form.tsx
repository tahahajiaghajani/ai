"use client";

import { useActionState } from "react";
import { login } from "@/app/actions/admin";
import { Button, Input } from "@/components/admin/ui";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="mt-8 space-y-4">
      <Input name="password" type="password" autoComplete="current-password" placeholder="رمز عبور مدیر" aria-label="رمز عبور مدیر" dir="ltr" required autoFocus />
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      <Button type="submit" className="w-full" size="lg" pending={pending}>
        ورود به پنل
      </Button>
    </form>
  );
}
