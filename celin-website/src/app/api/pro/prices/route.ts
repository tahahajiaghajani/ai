import { currentUser, setProHint } from "@/lib/auth";
import { proPrices } from "@/lib/catalog";
import { proStatus } from "@/lib/pro";
import { getSettings } from "@/lib/settings";
import { MAX_QTY } from "@/lib/order-meta";
import type { ProPrices } from "@/lib/catalog-types";

/**
 * «نمایش موجودی: سطح»: members see in stock / running low (with the few pieces left) / out of stock, never
 * the exact count of a well-stocked piece — above the low-stock line the number is replaced by «plenty»
 * (enough for any basket; the order itself still checks the real stock).
 */
function levelled(prices: ProPrices, low: number): ProPrices {
  const plenty = Math.max(MAX_QTY, low + 1);
  const cap = (n: number) => (n > low ? plenty : n);
  return Object.fromEntries(
    Object.entries(prices).map(([id, p]) => [id, { ...p, stock: cap(p.stock), variants: Object.fromEntries(Object.entries(p.variants).map(([vid, v]) => [vid, { ...v, stock: cap(v.stock) }])) }]),
  );
}

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
    const shown = s.shop.stockDisplay === "level" ? levelled(prices, s.shop.lowStock) : prices;
    return Response.json({ prices: shown, stockDisplay: s.shop.stockDisplay, lowStock: s.shop.lowStock, minOrder: s.shop.minOrder }, { headers });
  } catch (e) {
    console.error("[pro prices]", e);
    return Response.json({ error: "failed" }, { status: 503, headers });
  }
}
