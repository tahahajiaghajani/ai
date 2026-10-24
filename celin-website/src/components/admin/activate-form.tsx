"use client";

import { useActionState } from "react";
import { activateAdmin } from "@/app/actions/admin";
import { Button, Field, Input } from "@/components/admin/ui";

/** /admin/login, once per account: «رمز مدیریت» (ADMIN_PASSWORD) makes the signed-in account an admin. */
export function ActivateForm() {
  const [state, action, pending] = useActionState(activateAdmin, null);
  return (
    <form action={action} className="mt-6 space-y-4 text-start">
      <Field label="رمز مدیریت">
        <Input
          name="password"
          type="password"
          autoComplete="off"
          dir="ltr"
          className="text-start"
          required
          autoFocus
          aria-invalid={Boolean(state?.error)}
          aria-describedby={state?.error ? "admin-activate-error" : undefined}
        />
      </Field>
      {state?.error && (
        <p id="admin-activate-error" className="text-sm leading-6 text-danger" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" size="lg" pending={pending}>
        فعال کردن پنل روی این حساب
      </Button>
    </form>
  );
}
