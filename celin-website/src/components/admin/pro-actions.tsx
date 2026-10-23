"use client";

import { useState } from "react";
import { adminApproveRequest, adminExtendCode, adminIssueCode, adminRejectRequest, adminRevealCode, adminRevokeCode } from "@/app/actions/admin-members";
import { DaysDialog, useProCode } from "@/components/admin/pro-code-dialog";
import { Button, ConfirmButton, Dialog, Field, Textarea } from "@/components/admin/ui";
import { useAction } from "@/components/admin/toast";

/** Buttons for Pro requests and codes; each opens its own small dialog and hands codes to the page's CodeDialog. */

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
        title="تأیید درخواست Pro"
        confirmLabel="تأیید و صدور کد"
        defaultDays={defaultDays}
        pending={pending}
        onConfirm={(days) =>
          run(() => adminApproveRequest({ id, days }), {
            silent: true,
            onOk: (r) => {
              setOpen(false);
              show({ code: r.code, name: r.name || name, phone: r.phone || phone, note: r.note, href: `/admin/users/${userId}`, fresh: true });
            },
          })
        }
      >
        <p className="text-sm leading-7 text-ink-2">
          برای <span className="font-medium">{name || "این عضو"}</span> یک کد اختصاصی صادر می‌شود و در پیام‌های حسابش قرار می‌گیرد (و اگر پیامک یا ایمیل تنظیم شده باشد، فرستاده می‌شود).
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
      <Dialog open={open} onClose={() => setOpen(false)} title="رد درخواست Pro">
        <div className="space-y-4">
          <p className="text-sm leading-7 text-ink-2">
            درخواست <span className="font-medium">{name || "این عضو"}</span> رد می‌شود و پیامی در حسابش قرار می‌گیرد.
          </p>
          <Field label="پاسخ به عضو (اختیاری)" hint="اگر خالی بماند، یک متن کوتاه و مؤدبانه فرستاده می‌شود.">
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
        title="صدور کد Pro"
        confirmLabel="صدور کد"
        defaultDays={defaultDays}
        pending={pending}
        onConfirm={(days) =>
          run(() => adminIssueCode({ userId, days }), {
            silent: true,
            onOk: (r) => {
              setOpen(false);
              show({ code: r.code, name, phone, note: r.note, href: `/admin/users/${userId}`, fresh: true });
            },
          })
        }
      >
        <p className="text-sm leading-7 text-ink-2">
          کد تازه برای <span className="font-medium">{name || "این عضو"}</span> صادر می‌شود.
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

export function RevokeCodeButton({ codeId, size = "sm" }: { codeId: string; size?: Size }) {
  const { pending, run } = useAction();
  return (
    <ConfirmButton size={size} icon="close" pending={pending} confirmLabel="ابطال؟ دوباره بزنید" onConfirm={() => run(() => adminRevokeCode({ id: codeId }))}>
      ابطال
    </ConfirmButton>
  );
}
