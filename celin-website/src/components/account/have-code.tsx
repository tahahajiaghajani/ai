"use client";

import { openProSheet } from "@/components/pro/events";

/** «کد دارید؟» — opens the site's Pro sheet on its code tab. */
export function HaveCodeButton({ label, className = "" }: { label: string; className?: string }) {
  return (
    <button type="button" onClick={() => openProSheet("code")} className={className}>
      {label}
    </button>
  );
}
