"use client";

import { useState } from "react";
import { adminSetOrderStatus, adminUpdateOrder } from "@/app/actions/admin-orders";
import { CARRIERS, STATUS_TONE } from "@/components/admin/sales-ui";
import { Button, Card, Dialog, Field, Input, MoneyInput, Select, Textarea } from "@/components/admin/ui";
import { useAction } from "@/components/admin/toast";
import { Icon } from "@/components/ui/icons";
import { formatPrice } from "@/lib/format";
import { canMove, ORDER_STATUSES, restocksOnCancel, STATUS_LABEL, type OrderStatus } from "@/lib/order-meta";

const NEXT: Partial<Record<OrderStatus, OrderStatus>> = { pending: "packing", packing: "ready", ready: "shipped" };

const DOT: Record<string, string> = { warning: "bg-warning", gold: "bg-gold", ink: "bg-ink", success: "bg-success", danger: "bg-danger" };

/** Carrier: پست / تیپاکس / پیک, or «سایر» with a name. */
export function CarrierField({ value, onChange, label = "شیوه‌ی ارسال" }: { value: string; onChange: (v: string) => void; label?: string }) {
  const known = (CARRIERS as readonly string[]).includes(value);
  const [other, setOther] = useState(Boolean(value) && !known);
  const sel = known ? value : other ? "other" : "";
  return (
    <div className="space-y-2">
      <Field label={label}>
        <Select
          value={sel}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "other") {
              setOther(true);
              onChange("");
            } else {
              setOther(false);
              onChange(v);
            }
          }}
        >
          <option value="">— انتخاب کنید —</option>
          {CARRIERS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value="other">سایر</option>
        </Select>
      </Field>
      {sel === "other" && <Input value={value} maxLength={80} onChange={(e) => onChange(e.target.value)} placeholder="نام شرکت حمل (مثلاً ماهکس)" aria-label="نام شرکت حمل" />}
    </div>
  );
}

export function OrderStatusActions({ code, status, carrier, tracking }: { code: string; status: OrderStatus; carrier: string; tracking: string }) {
  const { pending, run } = useAction();
  const [target, setTarget] = useState<OrderStatus | null>(null);
  const next = NEXT[status];
  if (status === "cancelled") {
    return <p className="text-xs leading-6 text-muted">سفارش لغوشده دیگر قابل تغییر نیست.</p>;
  }
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {next && (
          <Button
            variant="primary"
            icon={next === "shipped" ? "truck" : "check"}
            pending={pending}
            className="!h-auto min-h-10 w-full !whitespace-normal py-2 text-start sm:w-auto"
            onClick={() => (next === "shipped" ? setTarget("shipped") : run(() => adminSetOrderStatus({ code, status: next, note: "" })))}
          >
            انتقال به مرحله‌ی بعد: {STATUS_LABEL[next].fa}
          </Button>
        )}
        {status !== "shipped" && (
          <Button variant="secondary" icon="edit" onClick={() => setTarget(status)} className="flex-1 sm:flex-none">
            تغییر وضعیت
          </Button>
        )}
        <Button variant="danger" icon="close" onClick={() => setTarget("cancelled")} className="flex-1 sm:flex-none">
          لغو سفارش
        </Button>
      </div>
      {target && <StatusDialog key={target} code={code} current={status} initial={target} carrier={carrier} tracking={tracking} onClose={() => setTarget(null)} />}
    </>
  );
}

function StatusDialog({ code, current, initial, carrier, tracking, onClose }: { code: string; current: OrderStatus; initial: OrderStatus; carrier: string; tracking: string; onClose: () => void }) {
  const { pending, run } = useAction();
  const [status, setStatus] = useState<OrderStatus>(initial);
  const [note, setNote] = useState("");
  const [car, setCar] = useState(carrier || (initial === "shipped" ? "پست" : ""));
  const [track, setTrack] = useState(tracking);
  const cancel = status === "cancelled";
  const submit = () => run(() => adminSetOrderStatus({ code, status, note, ...(status === "shipped" ? { carrier: car, tracking_code: track } : {}) }), { onOk: onClose });
  return (
    <Dialog open onClose={onClose} title={cancel && initial === "cancelled" ? "لغو سفارش" : status === "shipped" && initial === "shipped" ? "ثبت ارسال" : "تغییر وضعیت سفارش"}>
      <div className="space-y-5">
        <div role="radiogroup" aria-label="وضعیت" className="grid gap-1.5">
          {ORDER_STATUSES.filter((s) => s === current || canMove(current, s)).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={status === s}
              onClick={() => setStatus(s)}
              className={`flex min-h-11 items-center gap-3 rounded-sm border px-3 text-start text-sm transition-colors ${status === s ? "border-ink bg-white" : "border-line bg-white/60 hover:border-line-strong"}`}
            >
              <span className={`grid size-4 shrink-0 place-items-center rounded-full border ${status === s ? "border-ink" : "border-line-strong"}`}>
                {status === s && <span className="size-2 rounded-full bg-ink" />}
              </span>
              <span className={`size-1.5 shrink-0 rounded-full ${DOT[STATUS_TONE[s]]}`} />
              <span className="flex-1">{STATUS_LABEL[s].fa}</span>
              {s === current && <span className="text-[11px] text-muted">وضعیت فعلی</span>}
            </button>
          ))}
        </div>

        {status === "shipped" && status !== current && (
          <div className="grid gap-4 sm:grid-cols-2">
            <CarrierField value={car} onChange={setCar} />
            <Field label="کد رهگیری (اختیاری)" hint="در پیام به مشتری فرستاده می‌شود.">
              <Input value={track} maxLength={80} dir="ltr" className="text-start" onChange={(e) => setTrack(e.target.value)} />
            </Field>
          </div>
        )}

        {cancel && status !== current && (
          <p className="flex items-start gap-2 border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs leading-6 text-danger">
            <Icon name="warning" className="mt-0.5 size-4 shrink-0" />
            {restocksOnCancel(current)
              ? "با لغو سفارش، موجودی کالاهای آن به انبار برمی‌گردد و سفارش لغوشده دیگر قابل تغییر نیست."
              : "این سفارش ارسال شده است: با لغو آن موجودی برنمی‌گردد (اگر کالا به فروشگاه برگشته، موجودی را در صفحه‌ی محصول اصلاح کنید). سفارش لغوشده دیگر قابل تغییر نیست."}
          </p>
        )}

        {status !== current && (
          <Field label={cancel ? "دلیل لغو" : "توضیح (اختیاری)"} hint={cancel ? "در پیام لغو به مشتری نمایش داده می‌شود." : "در تاریخچه‌ی سفارش ثبت می‌شود."}>
            <Textarea rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={cancel ? "مثلاً: یکی از کالاها موجود نبود." : ""} />
          </Field>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" onClick={onClose}>
            انصراف
          </Button>
          <Button variant={cancel ? "danger" : "primary"} pending={pending} disabled={status === current} onClick={submit}>
            {cancel ? "لغو سفارش" : status === "shipped" ? "ثبت ارسال" : "ثبت وضعیت"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function OrderEditCard({
  code,
  subtotal,
  shippingFee,
  discount,
  carrier,
  tracking,
  adminNote,
  cancelled = false,
}: {
  code: string;
  subtotal: number;
  shippingFee: number;
  discount: number;
  carrier: string;
  tracking: string;
  adminNote: string;
  /** a cancelled order keeps its amounts (the note can still change) */
  cancelled?: boolean;
}) {
  const { pending, run } = useAction();
  const [fee, setFee] = useState<number | null>(shippingFee || null);
  const [off, setOff] = useState<number | null>(discount || null);
  const [car, setCar] = useState(carrier);
  const [track, setTrack] = useState(tracking);
  const [note, setNote] = useState(adminNote);
  const total = Math.max(0, subtotal + (fee ?? 0) - (off ?? 0));
  const changed = (fee ?? 0) !== shippingFee || (off ?? 0) !== discount || car !== carrier || track !== tracking || note !== adminNote;
  return (
    <Card title="هزینه‌ها و ارسال">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => adminUpdateOrder({ code, shipping_fee: fee ?? 0, discount: off ?? 0, carrier: car, tracking_code: track, admin_note: note }));
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="هزینه‌ی ارسال">
            <MoneyInput value={fee} onChange={setFee} placeholder="۰" disabled={cancelled} />
          </Field>
          <Field label="تخفیف">
            <MoneyInput value={off} onChange={setOff} placeholder="۰" disabled={cancelled} />
          </Field>
          <CarrierField value={car} onChange={setCar} />
          <Field label="کد رهگیری">
            <Input value={track} maxLength={80} dir="ltr" className="text-start" onChange={(e) => setTrack(e.target.value)} />
          </Field>
        </div>
        <Field label="یادداشت داخلی" hint="فقط در پنل دیده می‌شود.">
          <Textarea rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <span className="text-sm">
            <span className="text-muted">جمع نهایی: </span>
            <span className="font-medium">{formatPrice(total, "fa")}</span>
          </span>
          <Button type="submit" pending={pending} disabled={!changed}>
            ذخیره
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function PrintButton() {
  return (
    <Button variant="secondary" icon="print" onClick={() => window.print()}>
      چاپ پیش‌فاکتور
    </Button>
  );
}
