"use client";

import { useActionState } from "react";
import { login } from "@/app/actions/admin";
import { Button, Input } from "@/components/admin/ui";

/**
 * The ADMIN_PASSWORD-only login (break-glass). A Server Action form: React renders it as method="POST", so it
 * works before the script has loaded and the password never ends up in the address bar.
 */
export function LoginForm({ focus = true }: { focus?: boolean }) {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="mt-6 space-y-4 text-start">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-ink-2">رمز مدیریت</span>
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          className="text-start"
          required
          autoFocus={focus}
          aria-invalid={Boolean(state?.error)}
          aria-describedby={state?.error ? "admin-login-error" : undefined}
        />
      </label>
      {state?.error && (
        <p id="admin-login-error" className="text-sm leading-6 text-danger" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" size="lg" pending={pending}>
        ورود به پنل
      </Button>
    </form>
  );
}
