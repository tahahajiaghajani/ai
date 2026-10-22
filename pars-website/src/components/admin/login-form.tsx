"use client";

import { useActionState } from "react";
import { login } from "@/app/actions/admin";
import { Button, Input, Spinner } from "@/components/ui/field";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="mt-6 space-y-4">
      <Input name="password" type="password" autoComplete="current-password" placeholder="رمز عبور" dir="ltr" required autoFocus />
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Spinner />}
        ورود
      </Button>
    </form>
  );
}
