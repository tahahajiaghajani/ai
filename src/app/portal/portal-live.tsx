"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

/** Refreshes the server-rendered page whenever a task the user gave or was given changes. */
export function PortalLive({ userId }: { userId: string }) {
  const router = useRouter();
  React.useEffect(() => {
    const sb = supabaseBrowser();
    let t: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => router.refresh(), 400);
    };
    const ch = sb
      .channel(`portal:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `requester_id=eq.${userId}` }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `assignee_id=eq.${userId}` }, bump)
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      void sb.removeChannel(ch);
    };
  }, [userId, router]);
  return null;
}
