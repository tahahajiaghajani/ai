import type { ReactNode } from "react";
import { formatDate, type Lang } from "@/lib/format";
import { ORDER_STEPS, STATUS_LABEL, type OrderDetail, type OrderStep } from "@/lib/order-meta";

/** When the order last reached each step (an admin may step back, so the latest event of that status counts). */
export function stepTimes(order: Pick<OrderDetail, "events" | "created_at">): Partial<Record<OrderStep, string>> {
  const out: Partial<Record<OrderStep, string>> = {};
  for (const e of order.events) if (e.status !== "cancelled") out[e.status] = e.created_at;
  if (!out.pending) out.pending = order.created_at;
  return out;
}

function Node({ state }: { state: "done" | "current" | "upcoming" }) {
  if (state === "done") {
    return (
      <span className="grid size-3 shrink-0 place-items-center rounded-full bg-ink">
        <svg viewBox="0 0 12 12" className="size-2 text-bone" aria-hidden>
          <path d="m2.5 6.2 2.3 2.3 4.7-4.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </span>
    );
  }
  if (state === "current") return <span className="size-3 shrink-0 rounded-full border-[1.5px] border-gold bg-ground ring-4 ring-gold-mist" />;
  return <span className="size-3 shrink-0 rounded-full border border-control bg-ground" />;
}

/**
 * The four steps as an ordered list: vertical on phones, horizontal from 768px flowing in the reading
 * direction (step 1 at the inline start). Reached steps show when they were reached.
 */
export function OrderStepper({ order, lang, extra }: { order: Pick<OrderDetail, "status" | "events" | "created_at">; lang: Lang; extra?: Partial<Record<OrderStep, ReactNode>> }) {
  if (order.status === "cancelled") return null;
  const at = ORDER_STEPS.indexOf(order.status);
  const times = stepTimes(order);
  const last = ORDER_STEPS.length - 1;
  return (
    <ol className="flex flex-col md:flex-row">
      {ORDER_STEPS.map((s, i) => {
        const state = i < at || (i === at && s === "shipped") ? "done" : i === at ? "current" : "upcoming";
        const reached = i <= at;
        return (
          <li key={s} aria-current={i === at ? "step" : undefined} className="flex gap-4 md:flex-1 md:flex-col md:gap-0">
            <div className="flex flex-col items-center pt-1.5 md:flex-row md:pt-0">
              <Node state={state} />
              {i < last && <span aria-hidden className={`my-1.5 w-px flex-1 md:mx-2 md:my-0 md:h-px md:w-auto ${i < at ? "bg-ink" : "bg-line-strong"}`} />}
            </div>
            <div className={`min-w-0 ${i < last ? "pb-7" : ""} md:pe-6 md:pt-4 md:pb-0`}>
              <p className={`text-sm leading-6 ${reached ? "text-ink" : "text-muted"}`}>{STATUS_LABEL[s][lang]}</p>
              {reached && times[s] && <p className="mt-0.5 text-xs text-muted">{formatDate(times[s]!, lang, true)}</p>}
              {reached && extra?.[s]}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
