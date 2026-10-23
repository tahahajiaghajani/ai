"use server";

import { after } from "next/server";
import { currentUser, setProHint, USERS } from "@/lib/auth";
import { proPrices } from "@/lib/catalog";
import { db } from "@/lib/db";
import { formatPrice, normalizePhone } from "@/lib/format";
import { postMessage } from "@/lib/messages";
import { notifyTeam } from "@/lib/notify";
import { cleanLines, getOrder, placeOrder as place, setOrderStatus } from "@/lib/orders";
import { proStatus } from "@/lib/pro";
import { allow } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { langOf, text, type Result } from "@/lib/action";
import { env } from "@/lib/env";

const MSG = {
  signedOut: { fa: "برای ثبت سفارش وارد حساب خود شوید.", en: "Please sign in to place an order." },
  notPro: { fa: "ثبت سفارش ویژه‌ی اعضای Pro است.", en: "Ordering is for Pro members." },
  empty: { fa: "سبد سفارش خالی است.", en: "Your order is empty." },
  unavailable: { fa: "ثبت سفارش هنوز راه‌اندازی نشده است؛ لطفاً با فروشگاه تماس بگیرید.", en: "Online ordering is not set up yet — please contact the store." },
  name: { fa: "نام گیرنده را بنویسید.", en: "Please enter the recipient's name." },
  phone: { fa: "شماره‌ی موبایل گیرنده معتبر نیست.", en: "The recipient's mobile number is not valid." },
  address: { fa: "نشانی و شهر را برای ارسال بنویسید.", en: "Please enter the city and delivery address." },
  outOfStock: { fa: "موجودی یکی از اقلام کافی نیست؛ سبد به‌روز شد، لطفاً تعداد را بررسی کنید.", en: "One item does not have enough stock — please check the quantities." },
  gone: { fa: "یکی از اقلام دیگر در دسترس نیست و از سبد حذف شد.", en: "One item is no longer available and has been removed." },
  variant: { fa: "برای یکی از اقلام، رنگ یا گزینه را انتخاب کنید.", en: "Please choose an option for one of the items." },
  noPrice: { fa: "قیمت یکی از اقلام هنوز اعلام نشده است؛ برای آن با فروشگاه تماس بگیرید.", en: "One item has no price yet — please contact the store for it." },
  min: { fa: "حداقل مبلغ سفارش", en: "The minimum order is" },
  rate: { fa: "سفارش‌های زیادی در زمان کوتاه ثبت شد؛ کمی بعد دوباره امتحان کنید.", en: "Too many orders in a short time — please try again shortly." },
  failed: { fa: "ثبت سفارش انجام نشد؛ دوباره امتحان کنید.", en: "The order could not be placed — please try again." },
  placed: { fa: "سفارش شما ثبت شد.", en: "Your order has been placed." },
  cancelled: { fa: "سفارش لغو شد.", en: "The order has been cancelled." },
  cantCancel: { fa: "این سفارش دیگر قابل لغو نیست؛ با فروشگاه تماس بگیرید.", en: "This order can no longer be cancelled — please contact the store." },
};

export async function placeOrder(input: Record<string, unknown>): Promise<Result<{ code: string }> & { reason?: string; itemId?: string }> {
  const lang = langOf(input.lang);
  const me = await currentUser();
  if (!me) return { ok: false, error: MSG.signedOut[lang] };
  if (!(await proStatus(me.id)).active) {
    await setProHint(false);
    return { ok: false, error: MSG.notPro[lang] };
  }
  const lines = cleanLines(input.lines);
  if (!lines.length) return { ok: false, error: MSG.empty[lang] };
  const raw = (input.customer ?? {}) as Record<string, unknown>;
  const customer = {
    name: text(raw.name, 80),
    phone: normalizePhone(text(raw.phone, 30)),
    business: text(raw.business, 120),
    city: text(raw.city, 80),
    address: text(raw.address, 400),
    postal_code: text(raw.postal_code, 20),
  };
  if (customer.name.length < 2) return { ok: false, error: MSG.name[lang], reason: "field:name" };
  if (!customer.phone) return { ok: false, error: MSG.phone[lang], reason: "field:phone" };
  if (!customer.city || customer.address.length < 6) return { ok: false, error: MSG.address[lang], reason: "field:address" };
  if (!(await allow(`order:${me.id}`, 3600, 15))) return { ok: false, error: MSG.rate[lang] };

  const s = await getSettings();
  if (s.shop.minOrder > 0) {
    const prices = await proPrices();
    const subtotal = lines.reduce((sum, l) => {
      const p = prices[l.productId];
      const unit = l.variantId ? p?.variants[l.variantId]?.price ?? p?.price : p?.price;
      return sum + (unit ?? 0) * l.qty;
    }, 0);
    if (subtotal < s.shop.minOrder) return { ok: false, error: `${MSG.min[lang]} ${formatPrice(s.shop.minOrder, lang)}${lang === "fa" ? " است." : "."}` };
  }

  const r = await place(me.id, lines, customer, text(input.note, 1500));
  if (!r.ok) {
    const e = r.error;
    const itemId = "id" in e ? e.id : undefined;
    const msg =
      e.reason === "out_of_stock" ? MSG.outOfStock
      : e.reason === "product_unavailable" || e.reason === "variant_unavailable" ? MSG.gone
      : e.reason === "variant_required" ? MSG.variant
      : e.reason === "no_price" ? MSG.noPrice
      : e.reason === "empty" ? MSG.empty
      : e.reason === "unavailable" ? MSG.unavailable
      : MSG.failed;
    return { ok: false, error: msg[lang], reason: e.reason, itemId };
  }

  // keep the delivery details on the account for next time
  if (input.saveAddress !== false) {
    await db()!.from(USERS).update({ business: customer.business || me.business, city: customer.city, address: customer.address, postal_code: customer.postal_code, updated_at: new Date().toISOString() }).eq("id", me.id);
  }
  after(async () => {
    const order = await getOrder(r.code, me.id);
    await postMessage(me.id, {
      kind: "order",
      title_fa: `سفارش ${r.code} ثبت شد`,
      title_en: `Order ${r.code} received`,
      body_fa: `سفارش شما${order ? ` به مبلغ ${formatPrice(order.total, "fa")}` : ""} ثبت شد و در انتظار تأیید فروشگاه است. وضعیت آن را از «سفارش‌های من» دنبال کنید.`,
      body_en: `Your order${order ? ` of ${formatPrice(order.total, "en")}` : ""} has been received and is awaiting the store's confirmation. Follow it under “My orders”.`,
      link: `/account/orders/${r.code}`,
    });
    if (s.notify.onOrder) {
      const lines = (order?.items ?? []).map((i) => `• ${i.name_fa}${i.variant_fa ? ` (${i.variant_fa})` : ""} × ${i.qty}`).join("\n");
      await notifyTeam(`سفارش تازه ${r.code}\n${customer.name} — ${customer.phone}${customer.business ? `\n${customer.business}` : ""}\n${customer.city}\n${lines}${order ? `\nجمع: ${formatPrice(order.total, "fa")}` : ""}\n${env.siteUrl}/admin/orders/${r.code}`, s.notify);
    }
  });
  return { ok: true, code: r.code, message: MSG.placed[lang] };
}

/** A member may cancel their own order while it still awaits the store's confirmation. */
export async function cancelMyOrder(input: Record<string, unknown>): Promise<Result> {
  const lang = langOf(input.lang);
  const me = await currentUser();
  if (!me) return { ok: false, error: MSG.signedOut[lang] };
  const order = await getOrder(text(input.code, 20), me.id);
  if (!order || order.status !== "pending") return { ok: false, error: MSG.cantCancel[lang] };
  const r = await setOrderStatus(order.id, "cancelled", text(input.reason, 300) || (lang === "fa" ? "لغو توسط مشتری" : "Cancelled by the customer"), "customer", "pending");
  if (!r.ok) return { ok: false, error: MSG.cantCancel[lang] };
  after(async () => {
    const s = await getSettings();
    if (s.notify.onOrder) await notifyTeam(`سفارش ${order.code} توسط مشتری لغو شد\n${me.name} — ${me.phone}`, s.notify);
  });
  return { ok: true, message: MSG.cancelled[lang] };
}
