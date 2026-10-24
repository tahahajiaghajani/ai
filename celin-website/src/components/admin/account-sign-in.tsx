"use client";

import { useActionState } from "react";
import { adminSignIn } from "@/app/actions/admin";
import { Button, Field, Input } from "@/components/admin/ui";

/**
 * /admin/login: the site's own sign-in (mobile + password, same action and limits as /account/login). The form's
 * action is a Server Action, so React renders it as method="POST" (enctype multipart) with the action id: it
 * also works before the page's script has loaded and the password never ends up in the address bar. An admin
 * goes on to the panel; an account that may be made admin is asked for the admin password; any other account
 * sees «no admin access».
 */
export function AccountSignIn({ phone = "" }: { phone?: string }) {
  const [state, action, pending] = useActionState(adminSignIn, null);
  return (
    <form action={action} className="mt-8 space-y-4 text-start">
      <Field label="شماره‌ی موبایل (یا ایمیل)">
        <Input
          name="username"
          defaultValue={state?.login ?? phone}
          autoComplete="username"
          inputMode="tel"
          dir="ltr"
          className="text-start"
          required
          autoFocus={!phone}
          aria-invalid={Boolean(state?.error)}
          aria-describedby={state?.error ? "admin-signin-error" : undefined}
        />
      </Field>
      <Field label="رمز عبور">
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          className="text-start"
          required
          autoFocus={Boolean(phone)}
          aria-invalid={Boolean(state?.error)}
          aria-describedby={state?.error ? "admin-signin-error" : undefined}
        />
      </Field>
      {state?.error && (
        <p id="admin-signin-error" className="text-sm leading-6 text-danger" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" size="lg" pending={pending}>
        ورود به پنل
      </Button>
    </form>
  );
}
