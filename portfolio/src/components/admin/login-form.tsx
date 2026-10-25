"use client";

import { useActionState } from "react";
import { login } from "@/app/actions/admin";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="grid gap-4">
      <label className="grid gap-2">
        <span className="text-sm text-muted">رمز عبور</span>
        <input name="password" type="password" required autoComplete="current-password" className="rounded-[6px] border border-line-strong bg-transparent px-4 py-3 text-[16px] outline-none focus:border-fg" />
      </label>
      {state?.error ? <p className="text-sm" role="alert">{state.error}</p> : null}
      <button disabled={pending} className="rounded-full bg-fg px-6 py-3 font-semibold text-bg disabled:opacity-60">{pending ? "…" : "ورود"}</button>
    </form>
  );
}
