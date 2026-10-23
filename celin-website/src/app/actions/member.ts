"use server";

import { currentUser } from "@/lib/auth";
import { latestRequest } from "@/lib/pro";

/** Status and date of the signed-in member's latest Pro request (the static /pro page asks for the date). */
export async function myProRequest(): Promise<{ status: "pending" | "approved" | "rejected"; created_at: string } | null> {
  const me = await currentUser();
  if (!me) return null;
  const r = await latestRequest(me.id);
  return r ? { status: r.status, created_at: r.created_at } : null;
}
