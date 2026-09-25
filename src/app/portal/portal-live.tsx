"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

/** Refreshes the server-rendered portal whenever one of the requester's tasks changes. */
export function PortalLive({ userId }: { userId: string }) {
  const router = useRouter();
  React.useEffect(() => {
    const sb = supabaseBrowser();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb
      .channel(`portal:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `requester_id=eq.${userId}` }, () => {
        if (t) clearTimeout(t);
        t = setTimeout(() => router.refresh(), 400);
      })
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      void sb.removeChannel(ch);
    };
  }, [userId, router]);
  return null;
}
