import { cookies } from "next/headers";
import { PRO_HINT, USER_HINT, sessionState, setProHint } from "@/lib/auth";
import { unreadCount } from "@/lib/messages";
import { latestRequest, proStatus } from "@/lib/pro";

export const dynamic = "force-dynamic";

/** The signed-in account for the header and the price layer (public pages are static, so they ask here). */
export async function GET() {
  const s = await sessionState();
  const headers = { "cache-control": "private, no-store" };
  // could not check right now: keep the hints so the next page asks again
  if (s.state === "error") return Response.json({ user: null }, { status: 503, headers });
  const jar = await cookies();
  if (s.state !== "ok") {
    // signed out or revoked: stop asking
    jar.delete(USER_HINT);
    jar.delete(PRO_HINT);
    return Response.json({ user: null }, { headers });
  }
  const me = s.user;
  const [pro, unread, request] = await Promise.all([proStatus(me.id), unreadCount(me.id), latestRequest(me.id)]);
  if (pro.active !== (jar.get(PRO_HINT)?.value === "1")) await setProHint(pro.active);
  return Response.json(
    {
      user: {
        name: me.name,
        phone: me.phone,
        email: me.email,
        role: me.role,
        business: me.business,
        city: me.city,
        address: me.address,
        postal_code: me.postal_code,
        pro: { active: pro.active, issued: pro.issued, expiresAt: pro.expiresAt, request: request?.status ?? "none", reply: request?.status === "rejected" ? request.reply : "" },
        unread,
      },
    },
    { headers },
  );
}
