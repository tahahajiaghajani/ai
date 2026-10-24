import { cookies } from "next/headers";
import { PRO_HINT, USER_HINT, isAdminRow, sessionState, setProHint } from "@/lib/auth";
import { sign } from "@/lib/crypto";
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
  // an admin account (role, or ADMIN_PHONES) sees the «پنل مدیریت» link; the panel itself asks for a password session
  const admin = isAdminRow(me);
  const [pro, unread, request] = await Promise.all([proStatus(me.id), unreadCount(me.id), latestRequest(me.id)]);
  if (pro.active !== (jar.get(PRO_HINT)?.value === "1")) await setProHint(pro.active);
  return Response.json(
    {
      user: {
        name: me.name,
        phone: me.phone,
        email: me.email,
        role: admin ? "admin" : "user",
        business: me.business,
        city: me.city,
        address: me.address,
        postal_code: me.postal_code,
        pro: { active: pro.active, issued: pro.issued, expiresAt: pro.expiresAt, ended: pro.ended, request: request?.status ?? "none", reply: request?.status === "rejected" ? request.reply : "" },
        unread,
        // opaque and stable per account: the basket in the browser is bound to it (never the id itself)
        key: sign(`cart-owner:${me.id}`).slice(0, 22),
      },
    },
    { headers },
  );
}
