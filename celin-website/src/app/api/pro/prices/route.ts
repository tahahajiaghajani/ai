import { currentUser, setProHint } from "@/lib/auth";
import { proPrices } from "@/lib/catalog";
import { proStatus } from "@/lib/pro";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Prices and stock for Pro members only. Public pages never contain them: the price layer asks here after
 * the readable hint says this browser has Pro, and the session is checked again on every call.
 */
export async function GET() {
  const headers = { "cache-control": "private, no-store" };
  const me = await currentUser();
  if (!me) return Response.json({ error: "signed_out" }, { status: 401, headers });
  const pro = await proStatus(me.id);
  if (!pro.active) {
    await setProHint(false);
    return Response.json({ error: "not_pro" }, { status: 403, headers });
  }
  try {
    const [prices, s] = await Promise.all([proPrices(), getSettings()]);
    return Response.json({ prices, stockDisplay: s.shop.stockDisplay, lowStock: s.shop.lowStock, minOrder: s.shop.minOrder }, { headers });
  } catch (e) {
    console.error("[pro prices]", e);
    return Response.json({ error: "failed" }, { status: 503, headers });
  }
}
