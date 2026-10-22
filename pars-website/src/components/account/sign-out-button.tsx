"use client";

import { useTransition, type ReactNode } from "react";
import { signOut } from "@/app/actions/account";

/** Signs out, then reloads the page from the server so no part of it still shows the old account. */
export function SignOutButton({ to, className, role, children }: { to: string; className?: string; role?: string; children: ReactNode }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      role={role}
      disabled={pending}
      className={className}
      onClick={() =>
        start(async () => {
          try {
            await signOut();
          } finally {
            // ticket links saved in this browser (support page) and an unsent request belong to the person leaving
            try {
              localStorage.removeItem("pars-tickets");
              sessionStorage.removeItem("pars-ticket-draft");
            } catch {}
            window.location.assign(to);
          }
        })
      }
    >
      {children}
    </button>
  );
}
