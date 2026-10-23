"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cancelMyOrder } from "@/app/actions/orders";
import { accountCopy } from "@/content/copy/account";
import { commonCopy } from "@/content/copy/common";
import type { Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import type { CartLine } from "@/lib/order-meta";
import { Icon } from "@/components/ui/icons";
import { Overlay } from "@/components/ui/overlay";
import { cart } from "@/components/cart/cart-store";
import { sessionChanged } from "@/components/pro/session";
import { FormNote, TextArea, btn } from "@/components/account/ui";

export function CopyButton({ text, lang }: { text: string; lang: Lang }) {
  const c = commonCopy(lang).actions;
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
      className="inline-flex min-h-11 items-center gap-1.5 px-1 text-xs text-gold-text hover:text-ink"
    >
      <Icon name={done ? "check" : "copy"} className="size-4" />
      <span aria-live="polite">{done ? c.copied : c.copy}</span>
    </button>
  );
}

/** «سفارش مجدد» (the lines that still exist go back into the basket) and «لغو سفارش» while it is pending. */
export function OrderActions({ lang, code, cancellable, lines }: { lang: Lang; code: string; cancellable: boolean; lines: CartLine[] }) {
  const c = accountCopy(lang).order;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  function reorder() {
    if (!lines.length) {
      setNote(c.reorderNone);
      return;
    }
    for (const l of lines) cart.add(l.productId, l.variantId, l.qty);
    router.push(href(lang, "/account/cart"));
  }

  async function cancel() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const r = await cancelMyOrder({ code, reason, lang });
      if (r.ok) {
        setOpen(false);
        void sessionChanged();
        router.refresh();
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else setError(r.error);
    } catch {
      setError(commonCopy(lang).errors.network);
    }
    setPending(false);
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button type="button" onClick={reorder} className={btn.outline}>
          <Icon name="refresh" className="size-4" />
          {c.reorder}
        </button>
        {cancellable && (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex h-12 items-center justify-center px-4 text-sm text-danger underline-offset-8 hover:underline">
            {c.cancel}
          </button>
        )}
      </div>
      {note && <p className="mt-3 text-sm text-muted">{note}</p>}
      <Overlay open={open} onClose={() => setOpen(false)} label={c.cancelTitle} closeLabel={commonCopy(lang).nav.close}>
        <div className="space-y-5 px-5 pt-6 pb-8 sm:px-8">
          <p className="display text-2xl">{c.cancelTitle}</p>
          <p className="text-sm leading-7 text-ink-2">{c.cancelText}</p>
          <TextArea id="cancel-reason" label={c.cancelReason} optional={accountCopy(lang).fields.optional} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3} />
          <div aria-live="polite">{error && <FormNote tone="error">{error}</FormNote>}</div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setOpen(false)} className={btn.outline}>
              {c.keep}
            </button>
            <button type="button" onClick={cancel} disabled={pending} className="inline-flex h-12 items-center justify-center bg-danger px-7 text-sm text-bone transition-opacity hover:opacity-90 disabled:opacity-50">
              {pending ? "…" : c.cancelConfirm}
            </button>
          </div>
        </div>
      </Overlay>
    </div>
  );
}
