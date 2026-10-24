"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminDeleteMemberFromPage, adminSetDisabled, adminSetPassword, adminSetRole, adminUpdateMember } from "@/app/actions/admin-members";
import { Button, Card, ConfirmButton, Dialog, Field, Input, Textarea } from "@/components/admin/ui";
import { useAction } from "@/components/admin/toast";
import { Icon } from "@/components/ui/icons";

export interface ProfileValues {
  name: string;
  phone: string;
  email: string;
  business: string;
  city: string;
  address: string;
  postal_code: string;
  admin_note: string;
}

export function ProfileForm({ id, initial }: { id: string; initial: ProfileValues }) {
  const [f, setF] = useState(initial);
  const { pending, run } = useAction();
  const set = (k: keyof ProfileValues) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const changed = (Object.keys(initial) as (keyof ProfileValues)[]).some((k) => f[k] !== initial[k]);
  return (
    <Card title="مشخصات">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => adminUpdateMember({ id, ...f }));
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام و نام خانوادگی">
            <Input value={f.name} onChange={set("name")} required minLength={2} maxLength={80} />
          </Field>
          <Field label="موبایل" hint="نام کاربری برای ورود.">
            <Input value={f.phone} onChange={set("phone")} required inputMode="tel" dir="ltr" className="text-start" maxLength={30} />
          </Field>
          <Field label="ایمیل">
            <Input value={f.email} onChange={set("email")} type="email" dir="ltr" className="text-start" maxLength={160} />
          </Field>
          <Field label="نام کسب‌وکار">
            <Input value={f.business} onChange={set("business")} maxLength={120} />
          </Field>
          <Field label="شهر">
            <Input value={f.city} onChange={set("city")} maxLength={80} />
          </Field>
          <Field label="کد پستی">
            <Input value={f.postal_code} onChange={set("postal_code")} inputMode="numeric" dir="ltr" className="text-start" maxLength={20} />
          </Field>
        </div>
        <Field label="نشانی">
          <Textarea rows={2} value={f.address} onChange={set("address")} maxLength={400} />
        </Field>
        <Field label="یادداشت داخلی" hint="فقط در پنل دیده می‌شود.">
          <Textarea rows={2} value={f.admin_note} onChange={set("admin_note")} maxLength={1000} />
        </Field>
        <div className="flex justify-end border-t border-line pt-4">
          <Button type="submit" pending={pending} disabled={!changed}>
            ذخیره
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function SecurityCard({
  id,
  hasPassword,
  disabled,
  admin,
  promoteBlock,
  name,
  phone,
}: {
  id: string;
  hasPassword: boolean;
  disabled: boolean;
  admin: boolean;
  promoteBlock: string;
  name: string;
  phone: string;
}) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const pass = useAction();
  const state = useAction();
  return (
    <Card title="امنیت و دسترسی">
      <div className="space-y-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            pass.run(() => adminSetPassword({ id, password }), { onOk: () => setPassword("") });
          }}
        >
          <Field label="رمز عبور تازه" hint={hasPassword ? "با ذخیره، عضو از همه‌ی دستگاه‌ها خارج می‌شود." : "این حساب رمز ندارد و با کد Pro وارد می‌شود."}>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  dir="ltr"
                  className="ps-14 text-start"
                  minLength={8}
                  maxLength={128}
                  placeholder="دست‌کم ۸ نویسه"
                />
                <button type="button" onClick={() => setShow((v) => !v)} className="absolute inset-y-0 end-0 px-3 text-xs text-muted hover:text-ink">
                  {show ? "پنهان" : "نمایش"}
                </button>
              </div>
              <Button type="submit" variant="secondary" pending={pass.pending} disabled={password.length < 8}>
                ذخیره
              </Button>
            </div>
          </Field>
        </form>

        <div className="border-t border-line pt-5">
          <div className="mb-1 text-sm font-medium">{disabled ? "حساب غیرفعال است" : "حساب فعال است"}</div>
          <p className="mb-3 text-xs leading-6 text-muted">حساب غیرفعال نمی‌تواند وارد شود یا سفارش ثبت کند؛ نشست‌های باز هم بسته می‌شوند.</p>
          {disabled ? (
            <Button variant="secondary" icon="unlock" pending={state.pending} onClick={() => state.run(() => adminSetDisabled({ id, disabled: false }))}>
              فعال کردن حساب
            </Button>
          ) : (
            <ConfirmButton size="md" icon="lock" pending={state.pending} confirmLabel="غیرفعال شود؟ دوباره بزنید" onConfirm={() => state.run(() => adminSetDisabled({ id, disabled: true }))}>
              غیرفعال کردن حساب
            </ConfirmButton>
          )}
        </div>

        <RoleSection id={id} admin={admin} block={promoteBlock} name={name} phone={phone} />
      </div>
    </Card>
  );
}

/**
 * «مدیر کردن» / «برداشتن دسترسی مدیر», each behind a dialog that says what follows. Promotion follows the same
 * rules as the activation on /admin/login (members.ts setMemberRole): when it is not possible, the reason is
 * shown instead of the button.
 */
function RoleSection({ id, admin, block, name, phone }: { id: string; admin: boolean; block: string; name: string; phone: string }) {
  const role = useAction();
  const [open, setOpen] = useState(false);
  const who = (
    <>
      {name || "این حساب"} (<span className="ltr">{phone}</span>)
    </>
  );
  const run = (next: "admin" | "user") => role.run(() => adminSetRole({ id, role: next }), { onOk: () => setOpen(false) });
  return (
    <div className="border-t border-line pt-5">
      <div className="mb-1 text-sm font-medium">{admin ? "این حساب مدیر است" : "دسترسی مدیر"}</div>
      <p className="mb-3 flex items-start gap-1.5 text-xs leading-6 text-warning">
        <Icon name="warning" className="mt-1 size-3.5 shrink-0" />
        مدیر به همه‌ی بخش‌های پنل دسترسی کامل دارد: سفارش‌ها، کاربران، کدها و تنظیمات.
      </p>
      {admin ? (
        <Button variant="danger" icon="close" onClick={() => setOpen(true)}>
          برداشتن دسترسی مدیر
        </Button>
      ) : block ? (
        <p className="border border-line bg-bone px-3 py-2.5 text-xs leading-6 text-ink-2">{block}</p>
      ) : (
        <Button variant="secondary" icon="settings" onClick={() => setOpen(true)}>
          مدیر کردن این حساب
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={admin ? "برداشتن دسترسی مدیر" : "مدیر کردن این حساب"}>
        <div className="space-y-4 text-sm leading-7 text-ink-2">
          {admin ? (
            <p>{who} دیگر به پنل دسترسی ندارد و از همه‌ی دستگاه‌ها خارج می‌شود.</p>
          ) : (
            <>
              <p>{who} به همه‌ی بخش‌های پنل دسترسی کامل پیدا می‌کند.</p>
              <ul className="list-inside list-disc space-y-1 text-xs leading-6 text-muted">
                <li>از این پس فقط با شماره و رمز خودش وارد پنل می‌شود؛ حساب مدیر با کد Pro وارد نمی‌شود.</li>
                <li>همه‌ی نشست‌های باز این حساب بسته می‌شود.</li>
                <li>این کار با نام شما ثبت می‌شود و اگر «اعلان به مدیر» تنظیم باشد، خبرش فرستاده می‌شود.</li>
              </ul>
            </>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              انصراف
            </Button>
            <Button variant={admin ? "danger" : "primary"} pending={role.pending} onClick={() => run(admin ? "user" : "admin")}>
              {admin ? "برداشتن دسترسی" : "بله، مدیر شود"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

export function DangerCard({ id, orders }: { id: string; orders: number }) {
  const { pending, run } = useAction();
  const router = useRouter();
  return (
    <section className="border border-danger/30 bg-white">
      <header className="border-b border-danger/20 px-5 py-4">
        <h2 className="text-base font-medium text-danger">حذف حساب</h2>
      </header>
      <div className="space-y-3 p-5">
        <p className="text-xs leading-6 text-ink-2">
          حساب، کدهای Pro، درخواست‌ها و پیام‌های این عضو برای همیشه حذف می‌شود.
          {orders > 0 ? " سفارش‌های او در فهرست سفارش‌ها باقی می‌مانند." : ""} اگر فقط می‌خواهید جلوی ورود را بگیرید، حساب را غیرفعال کنید.
        </p>
        <ConfirmButton
          size="md"
          pending={pending}
          confirmLabel="حذف همیشگی؟ دوباره بزنید"
          onConfirm={() =>
            run(() => adminDeleteMemberFromPage({ id }), {
              onOk: () => {
                router.replace("/admin/users");
                router.refresh();
              },
            })
          }
        >
          حذف حساب
        </ConfirmButton>
      </div>
    </section>
  );
}
