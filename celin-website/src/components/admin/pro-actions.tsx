"use client";

import { useState } from "react";
import { adminApproveRequest, adminExtendCode, adminIssueCode, adminRejectRequest, adminRevealCode, adminRevokeCode, adminSetPro } from "@/app/actions/admin-members";
import { DaysDialog, useProCode } from "@/components/admin/pro-code-dialog";
import { Button, ConfirmButton, Dialog, Field, Textarea } from "@/components/admin/ui";
import { useAction } from "@/components/admin/toast";

/** Buttons for membership requests and codes (and Pro by hand); each opens its own small dialog and hands codes to the page's CodeDialog. */

type Size = "sm" | "md";

export function ApproveRequestButton({
  id,
  name,
  phone,
  userId,
  defaultDays,
  size = "sm",
  label = "تأیید و صدور کد",
}: {
  id: string;
  name: string;
  phone: string;
  userId: string;
  defaultDays: number;
  size?: Size;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  const { show } = useProCode();
  return (
    <>
      <Button variant="gold" size={size} icon="check" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <DaysDialog
        open={open}
        onClose={() => setOpen(false)}
        title="تأیید درخواست عضویت"
        confirmLabel="تأیید و صدور کد"
        defaultDays={defaultDays}
        pending={pending}
        onConfirm={(days) =>
          run(() => adminApproveRequest({ id, days }), {
            silent: true,
            onOk: (r) => {
              setOpen(false);
              show({ code: r.code, name: r.name || name, phone: r.phone || phone, note: r.note, warn: r.warn, href: `/admin/users/${userId}`, fresh: true });
            },
          })
        }
      >
        <p className="text-sm leading-7 text-ink-2">
          برای <span className="font-medium">{name || "این حساب"}</span> کد عضویت صادر می‌شود. پس از صدور می‌بینید کد از چه راهی به عضو رسید و می‌توانید آن را با واتس‌اپ، پیامک یا تلگرام هم بفرستید.
        </p>
      </DaysDialog>
    </>
  );
}

export function RejectRequestButton({ id, name, size = "sm" }: { id: string; name: string; size?: Size }) {
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const { pending, run } = useAction();
  return (
    <>
      <Button variant="secondary" size={size} onClick={() => setOpen(true)}>
        رد درخواست
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="رد درخواست عضویت">
        <div className="space-y-4">
          <p className="text-sm leading-7 text-ink-2">
            درخواست عضویت <span className="font-medium">{name || "این حساب"}</span> رد می‌شود و پیامی در حسابش قرار می‌گیرد.
          </p>
          <Field label="پاسخ (اختیاری)" hint="اگر خالی بماند، یک متن کوتاه و مؤدبانه فرستاده می‌شود.">
            <Textarea rows={3} value={reply} maxLength={800} onChange={(e) => setReply(e.target.value)} placeholder="مثلاً: برای فعال‌سازی، لطفاً نشانی فروشگاه یا صفحه‌ی اینستاگرام را بفرستید." />
          </Field>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              انصراف
            </Button>
            <Button variant="danger" pending={pending} onClick={() => run(() => adminRejectRequest({ id, reply }), { onOk: () => setOpen(false) })}>
              رد درخواست
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

export function IssueCodeButton({
  userId,
  name,
  phone,
  defaultDays,
  replaces,
  size = "sm",
  variant = "secondary",
  label = "صدور کد تازه",
}: {
  userId: string;
  name: string;
  phone: string;
  defaultDays: number;
  /** the member already has an open code (it will be revoked) */
  replaces?: boolean;
  size?: Size;
  variant?: "secondary" | "gold" | "primary";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  const { show } = useProCode();
  return (
    <>
      <Button variant={variant} size={size} icon="plus" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <DaysDialog
        open={open}
        onClose={() => setOpen(false)}
        title="صدور کد عضویت"
        confirmLabel="صدور کد"
        defaultDays={defaultDays}
        pending={pending}
        onConfirm={(days) =>
          run(() => adminIssueCode({ userId, days }), {
            silent: true,
            onOk: (r) => {
              setOpen(false);
              show({ code: r.code, name, phone, note: r.note, warn: r.warn, href: `/admin/users/${userId}`, fresh: true });
            },
          })
        }
      >
        <p className="text-sm leading-7 text-ink-2">
          کد عضویت تازه برای <span className="font-medium">{name || "این حساب"}</span> صادر می‌شود.
          {replaces && <span className="mt-1 block text-warning">کد فعلی این حساب باطل می‌شود.</span>}
        </p>
      </DaysDialog>
    </>
  );
}

export function RevealCodeButton({ codeId, name, phone, userId, size = "sm" }: { codeId: string; name: string; phone: string; userId?: string; size?: Size }) {
  const { pending, run } = useAction();
  const { show } = useProCode();
  return (
    <Button
      variant="secondary"
      size={size}
      icon="eye"
      pending={pending}
      onClick={() => run(() => adminRevealCode({ id: codeId }), { silent: true, onOk: (r) => show({ code: r.code, name, phone, href: userId ? `/admin/users/${userId}` : undefined }) })}
    >
      نمایش کد
    </Button>
  );
}

export function ExtendCodeButton({ codeId, name, defaultDays, size = "sm" }: { codeId: string; name: string; defaultDays: number; size?: Size }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  return (
    <>
      <Button variant="secondary" size={size} icon="clock" onClick={() => setOpen(true)}>
        تمدید
      </Button>
      <DaysDialog
        open={open}
        onClose={() => setOpen(false)}
        title="تمدید اعتبار کد"
        confirmLabel="ذخیره‌ی اعتبار"
        defaultDays={defaultDays}
        pending={pending}
        onConfirm={(days) => run(() => adminExtendCode({ id: codeId, days }), { onOk: () => setOpen(false) })}
      >
        <p className="text-sm leading-7 text-ink-2">
          اعتبار کد <span className="font-medium">{name || "این عضو"}</span> از امروز دوباره حساب می‌شود؛ خود کد عوض نمی‌شود.
        </p>
      </DaysDialog>
    </>
  );
}

/** Pro by hand (with its own code, as when the threshold is reached), or back to the members' prices. */
export function SetProButton({ userId, on, size = "sm" }: { userId: string; on: boolean; size?: Size }) {
  const { pending, run } = useAction();
  return (
    <ConfirmButton
      size={size}
      variant={on ? "secondary" : "danger"}
      icon={on ? "diamond" : "close"}
      pending={pending}
      confirmLabel={on ? "Pro شود؟ دوباره بزنید" : "برداشتن Pro؟ دوباره بزنید"}
      onConfirm={() => run(() => adminSetPro({ id: userId, on }))}
    >
      {on ? "Pro کردن" : "برداشتن Pro"}
    </ConfirmButton>
  );
}

export function RevokeCodeButton({ codeId, size = "sm" }: { codeId: string; size?: Size }) {
  const { pending, run } = useAction();
  return (
    <ConfirmButton size={size} icon="close" pending={pending} confirmLabel="ابطال؟ دوباره بزنید" onConfirm={() => run(() => adminRevokeCode({ id: codeId }))}>
      ابطال
    </ConfirmButton>
  );
}
