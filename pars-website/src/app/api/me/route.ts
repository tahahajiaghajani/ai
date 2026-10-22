import { cookies } from "next/headers";
import { USER_HINT, currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** The signed-in account for the header button (public pages are static, so they ask here). */
export async function GET() {
  const me = await currentUser();
  if (!me) (await cookies()).delete(USER_HINT); // a stale hint: stop asking
  return Response.json(
    { user: me ? { name: me.name, email: me.email, role: me.role, phone: me.phone, organization: me.organization } : null },
    { headers: { "cache-control": "private, no-store" } },
  );
}
