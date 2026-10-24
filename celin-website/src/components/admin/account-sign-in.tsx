"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { signIn } from "@/app/actions/account";
import { Button, Field, Input } from "@/components/admin/ui";

/**
 * /admin/login: the site's own sign-in (mobile + password, same action and limits as /account/login) for
 * admin accounts. An admin goes on to the panel; any other account sees «no admin access» (page refresh).
 */
export function AccountSignIn({ phone = "" }: { phone?: string }) {
  const router = useRouter();
  const [login, setLogin] = useState(phone);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const r = await signIn({ login, password, lang: "fa", next: "/admin" });
      if (!r.ok) {
        setError(r.error);
        setPending(false);
        return;
      }
      if (r.next.startsWith("/admin")) {
        window.location.assign("/admin");
        return;
      }
      router.refresh();
    } catch {
      setError("ارتباط با سرور برقرار نشد؛ دوباره امتحان کنید.");
    }
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4 text-start">
      <Field label="شماره‌ی موبایل (یا ایمیل)">
        <Input name="username" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" inputMode="tel" dir="ltr" className="text-start" required autoFocus={!phone} />
      </Field>
      <Field label="رمز عبور">
        <Input name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" dir="ltr" className="text-start" required autoFocus={Boolean(phone)} />
      </Field>
      {error && (
        <p className="text-sm leading-6 text-danger" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" size="lg" pending={pending}>
        ورود به پنل
      </Button>
    </form>
  );
}
