"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminCreateMember } from "@/app/actions/admin-members";
import { DaysPicker, useProCode } from "@/components/admin/pro-code-dialog";
import { Button, Dialog, Field, Input, Textarea } from "@/components/admin/ui";
import { useAction } from "@/components/admin/toast";
import { normalizePhone } from "@/lib/format";

const EMPTY = { name: "", phone: "", email: "", business: "", city: "", address: "", password: "", admin_note: "" };

export function CreateMemberButton({ defaultDays }: { defaultDays: number }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [issue, setIssue] = useState(true);
  const [days, setDays] = useState(defaultDays);
  const [showPass, setShowPass] = useState(false);
  const { pending, run } = useAction();
  const { show } = useProCode();
  const router = useRouter();
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <>
      <Button icon="plus" onClick={() => setOpen(true)}>
        کاربر جدید
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="کاربر جدید" wide>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => adminCreateMember({ ...f, issue, days }), {
              onOk: (r) => {
                setOpen(false);
                setF(EMPTY);
                if (r.code) show({ code: r.code, name: f.name, phone: normalizePhone(f.phone), note: r.note, warn: r.warn, href: `/admin/users/${r.id}`, fresh: true });
                else router.push(`/admin/users/${r.id}`);
              },
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نام و نام خانوادگی">
              <Input value={f.name} onChange={set("name")} required minLength={2} maxLength={80} autoFocus />
            </Field>
            <Field label="موبایل" hint="نام کاربری عضو برای ورود.">
              <Input value={f.phone} onChange={set("phone")} required inputMode="tel" dir="ltr" className="text-start" placeholder="09123456789" maxLength={30} />
            </Field>
            <Field label="ایمیل (اختیاری)">
              <Input value={f.email} onChange={set("email")} type="email" dir="ltr" className="text-start" maxLength={160} />
            </Field>
            <Field label="نام کسب‌وکار">
              <Input value={f.business} onChange={set("business")} maxLength={120} />
            </Field>
            <Field label="شهر">
              <Input value={f.city} onChange={set("city")} maxLength={80} />
            </Field>
            <Field label="رمز عبور (اختیاری)" hint="بدون رمز، عضو با کد Pro وارد می‌شود.">
              <div className="relative">
                <Input
                  value={f.password}
                  onChange={set("password")}
                  type={showPass ? "text" : "password"}
                  autoComplete="new-password"
                  dir="ltr"
                  className="ps-16 text-start"
                  minLength={8}
                  maxLength={128}
                />
                <button type="button" onClick={() => setShowPass((v) => !v)} className="absolute inset-y-0 end-0 px-3 text-xs text-muted hover:text-ink">
                  {showPass ? "پنهان" : "نمایش"}
                </button>
              </div>
            </Field>
          </div>
          <Field label="نشانی">
            <Textarea rows={2} value={f.address} onChange={set("address")} maxLength={400} />
          </Field>
          <Field label="یادداشت داخلی" hint="فقط در پنل دیده می‌شود.">
            <Textarea rows={2} value={f.admin_note} onChange={set("admin_note")} maxLength={1000} />
          </Field>
          <div className="border border-line bg-white p-4">
            <label className="flex min-h-10 cursor-pointer items-center gap-3 text-sm font-medium">
              <input type="checkbox" checked={issue} onChange={(e) => setIssue(e.target.checked)} className="size-4 accent-ink" />
              صدور کد Pro برای این حساب
            </label>
            {issue && (
              <div className="mt-3">
                <div className="mb-2 text-xs text-ink-2">مدت اعتبار</div>
                <DaysPicker value={days} onChange={setDays} defaultDays={defaultDays} />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              انصراف
            </Button>
            <Button type="submit" pending={pending}>
              {issue ? "ساخت حساب و صدور کد" : "ساخت حساب"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
