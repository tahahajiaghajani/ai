"use client";

import { useEffect, useRef, useState } from "react";
import type { Copy } from "@/content/fa";
import { href, type Lang } from "@/lib/i18n";
import { signOut } from "@/app/actions/account";
import { Icon } from "@/components/site/icons";
import { useAccount } from "@/components/account/use-account";

const initial = (name: string, email: string) => (name.trim() || email).charAt(0).toUpperCase();

/** Header: «ورود / ثبت‌نام» for visitors, the account menu once signed in. */
export function AccountButton({ lang, t }: { lang: Lang; t: Copy["account"] }) {
  const me = useAccount();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!me) {
    return (
      <a href={href(lang, "/account/login")} className="hidden h-10 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm text-muted transition hover:text-fg sm:inline-flex">
        <Icon name="human" className="size-4" />
        {/* the full label only where the header has room for it */}
        <span className="lg:hidden xl:inline">{t.entry}</span>
        <span className="hidden lg:inline xl:hidden">{t.signIn}</span>
      </a>
    );
  }
  return (
    <div ref={ref} className="relative hidden sm:block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.menu}
        onClick={() => setOpen((v) => !v)}
        className="grid size-10 place-items-center rounded-full border border-line-strong bg-white/[0.04] text-sm font-semibold text-fg transition hover:border-violet/60"
      >
        {initial(me.name, me.email)}
      </button>
      {open && (
        <div role="menu" className="absolute end-0 top-12 w-60 rounded-2xl border border-line-strong bg-ink-2/95 p-2 shadow-2xl backdrop-blur-xl">
          <div className="px-3 py-2">
            <div className="truncate text-sm font-semibold text-fg">{me.name || me.email}</div>
            <div className="ltr truncate text-xs text-faint rtl:text-right">{me.email}</div>
          </div>
          <div className="my-1 h-px bg-line" />
          <a role="menuitem" href={href(lang, "/account")} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted hover:bg-white/5 hover:text-fg">
            <Icon name="ticket" className="size-4" />
            {t.myTickets}
          </a>
          {me.role === "admin" && (
            <a role="menuitem" href="/admin" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted hover:bg-white/5 hover:text-fg">
              <Icon name="shield" className="size-4 text-violet" />
              {t.admin}
            </a>
          )}
          <form action={signOut.bind(null, lang)}>
            <button role="menuitem" type="submit" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-start text-sm text-muted hover:bg-white/5 hover:text-fg">
              <Icon name="close" className="size-4" />
              {t.signOut}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/** Mobile menu row: sign in, or the account page. */
export function AccountMenuLink({ lang, t, className }: { lang: Lang; t: Copy["account"]; className?: string }) {
  const me = useAccount();
  return (
    <a href={href(lang, me ? "/account" : "/account/login")} className={className}>
      <Icon name="human" className="size-4" />
      {me ? me.name || t.myAccount : t.entry}
    </a>
  );
}
