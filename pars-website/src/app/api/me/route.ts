import { cookies } from "next/headers";
import { USER_HINT, sessionState } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** The signed-in account for the header button (public pages are static, so they ask here). */
export async function GET() {
  const s = await sessionState();
  const headers = { "cache-control": "private, no-store" };
  // could not check right now: keep the hint so the next page asks again
  if (s.state === "error") return Response.json({ user: null }, { status: 503, headers });
  if (s.state !== "ok") (await cookies()).delete(USER_HINT); // signed out or revoked: stop asking
  const me = s.state === "ok" ? s.user : null;
  return Response.json({ user: me ? { name: me.name, email: me.email, role: me.role, phone: me.phone, organization: me.organization } : null }, { headers });
}
