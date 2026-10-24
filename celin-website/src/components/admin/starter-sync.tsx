"use client";

import { useEffect, useState } from "react";
import { adminSyncStarter } from "@/app/actions/admin-catalog";
import { toast } from "@/components/admin/toast";

let started = false;

/**
 * The panel's first visit while the site still shows the built-in starter catalogue: copies it into the database
 * once (adminSyncStarter re-checks on the server), so the products, categories and collections the site shows are
 * listed here and can be edited.
 */
export function StarterSync() {
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    if (started) return;
    started = true;
    adminSyncStarter()
      .then((r) => {
        if (r.ok && r.message) toast(true, r.message);
        if (!r.ok) toast(false, r.error);
      })
      .catch(() => toast(false, "آوردن محصولات سایت به پنل انجام نشد؛ صفحه را دوباره باز کنید."))
      .finally(() => setBusy(false));
  }, []);
  if (!busy) return null;
  return (
    <p role="status" className="mb-6 border border-gold/30 bg-bone px-4 py-3 text-sm text-ink-2">
      محصولات، دسته‌ها و مجموعه‌هایی که الان در سایت هستند به پنل آورده می‌شوند…
    </p>
  );
}
