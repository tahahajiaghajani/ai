"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { guard } from "@/lib/admin-action";
import { requireDb, UserError } from "@/lib/db";
import { formatPrice } from "@/lib/format";
import { postMessage } from "@/lib/messages";
import { canMove, isOrderStatus, STATUS_LABEL } from "@/lib/order-meta";
import { getOrder, setOrderStatus } from "@/lib/orders";
import { getSettings } from "@/lib/settings";
import { sendSms } from "@/lib/sms";
import { text, type Result } from "@/lib/action";

function money(v: unknown): number {
  const n = Math.round(Number(String(v ?? "0").replace(/[,٬\s]/g, "")));
  if (!Number.isFinite(n) || n < 0) throw new UserError("مبلغ باید عددی صفر یا بیشتر (به تومان) باشد.");
  return n;
}

/** Moves an order to a new status, tells the member (inbox, and SMS when enabled) and logs the step. */
export async function adminSetOrderStatus(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    const code = text(input.code, 20);
    const status = input.status;
    if (!isOrderStatus(status)) throw new UserError("وضعیت معتبر نیست.");
    const order = await getOrder(code);
    if (!order) throw new UserError("سفارش پیدا نشد.");
    const shippedOnly = "سفارش ارسال‌شده فقط قابل لغو است (بدون برگشت موجودی).";
    if (!canMove(order.status, status)) throw new UserError(order.status === "cancelled" ? "سفارش لغوشده قابل تغییر نیست." : shippedOnly);
    const note = text(input.note, 500);
    const r = await setOrderStatus(order.id, status, note, "admin");
    if (!r.ok) throw new UserError(r.reason === "cancelled" ? "سفارش لغوشده قابل تغییر نیست." : r.reason === "transition" ? shippedOnly : "تغییر وضعیت انجام نشد.");
    if (status === "shipped" && (input.carrier !== undefined || input.tracking_code !== undefined)) {
      await requireDb().from("celin_orders").update({ carrier: text(input.carrier, 80), tracking_code: text(input.tracking_code, 80) }).eq("id", order.id);
    }
    revalidatePath(`/admin/orders/${code}`);
    revalidatePath("/admin/orders");
    // nothing changed (e.g. the member cancelled it a moment earlier): nobody is told about a change
    if (!r.changed) return { ok: true, message: `وضعیت از قبل «${STATUS_LABEL[status].fa}» بود.` };
    if (order.user_id) {
      const uid = order.user_id;
      after(async () => {
        const label = STATUS_LABEL[status];
        const extra = status === "cancelled" && note ? `\nدلیل: ${note}` : status === "shipped" && input.tracking_code ? `\nکد رهگیری: ${text(input.tracking_code, 80)}` : "";
        const extraEn = status === "cancelled" && note ? `\nReason: ${note}` : status === "shipped" && input.tracking_code ? `\nTracking code: ${text(input.tracking_code, 80)}` : "";
        await postMessage(uid, {
          kind: "order",
          title_fa: `سفارش ${code}: ${label.fa}`,
          title_en: `Order ${code}: ${label.en}`,
          body_fa: `وضعیت سفارش شما به «${label.fa}» تغییر کرد.${extra}`,
          body_en: `Your order is now “${label.en}”.${extraEn}`,
          link: `/account/orders/${code}`,
        });
        const s = await getSettings();
        if (s.sms.onStatus && s.sms.provider !== "none" && order.customer.phone) {
          await sendSms(order.customer.phone, { kind: "status", order: code, status: label.fa, text: `سلین | سفارش ${code}: ${label.fa}${extra}` }, s.sms);
        }
      });
    }
    return { ok: true, message: `وضعیت: ${STATUS_LABEL[status].fa}` };
  });
}

/** Shipping fee, discount, carrier, tracking code and the internal note. */
export async function adminUpdateOrder(input: Record<string, unknown>): Promise<Result<{ total: string }>> {
  return guard(async () => {
    const code = text(input.code, 20);
    const order = await getOrder(code);
    if (!order) throw new UserError("سفارش پیدا نشد.");
    const shipping_fee = money(input.shipping_fee);
    const discount = money(input.discount);
    const moneyChanged = shipping_fee !== order.shipping_fee || discount !== order.discount;
    // a cancelled order keeps its amounts (only the internal note may still change)
    if (order.status === "cancelled" && moneyChanged) throw new UserError("مبلغ سفارش لغوشده قابل ویرایش نیست.");
    if (discount > order.subtotal + shipping_fee) throw new UserError("تخفیف از جمع سفارش بیشتر است.");
    const { error } = await requireDb()
      .from("celin_orders")
      .update({ shipping_fee, discount, carrier: text(input.carrier, 80), tracking_code: text(input.tracking_code, 80), admin_note: text(input.admin_note, 2000), updated_at: new Date().toISOString() })
      .eq("id", order.id);
    if (error) throw new Error(error.message);
    revalidatePath(`/admin/orders/${code}`);
    const total = Math.max(0, order.subtotal + shipping_fee - discount);
    if (moneyChanged && total !== order.total && order.user_id) {
      const uid = order.user_id;
      after(() =>
        postMessage(uid, {
          kind: "order",
          title_fa: `سفارش ${code}: مبلغ نهایی`,
          title_en: `Order ${code}: final amount`,
          body_fa: `مبلغ نهایی سفارش شما${shipping_fee ? ` با هزینه‌ی ارسال ${formatPrice(shipping_fee, "fa")}` : ""}${discount ? ` و تخفیف ${formatPrice(discount, "fa")}` : ""}: ${formatPrice(total, "fa")}`,
          body_en: `The final amount of your order${shipping_fee ? `, with ${formatPrice(shipping_fee, "en")} shipping` : ""}${discount ? ` and a ${formatPrice(discount, "en")} discount` : ""}: ${formatPrice(total, "en")}`,
          link: `/account/orders/${code}`,
        }),
      );
    }
    return { ok: true, message: "ذخیره شد.", total: formatPrice(total, "fa") };
  });
}
