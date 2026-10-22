"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/site/icons";

/** A small link to the admin panel, shown only in a browser that has signed in to /admin (public pages stay static). */
export function AdminShortcut({ label }: { label: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(document.cookie.split("; ").includes("pars_admin_ui=1"));
  }, []);
  if (!show) return null;
  return (
    <a
      href="/admin"
      className="fixed bottom-5 start-5 z-[60] inline-flex h-10 items-center gap-2 rounded-full border border-line-strong bg-ink-3/85 px-4 text-xs font-semibold text-fg shadow-xl backdrop-blur-md transition hover:border-violet/60 print:hidden"
    >
      <Icon name="shield" className="size-4 text-violet" />
      {label}
    </a>
  );
}
